const sql = require('mssql');
const crypto = require('crypto');

// mirrors lambda/layer/nodejs/db.js's ValidationError
class ValidationError extends Error {}

// Azure side, mirrors lambda/layer/nodejs/db.js. Replication awaited here too.

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect({
      server: process.env.DB_SERVER,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      options: { encrypt: true, trustServerCertificate: false },
      pool: { max: 2 },
    });
  }
  return poolPromise;
}

const AWS_BASE_URL = process.env.AWS_BASE_URL;
const REPLICATION_SECRET = process.env.REPLICATION_SECRET;
const REPLICATION_TIMEOUT_MS = 3000;

async function replicateToAws(path, payload) {
  if (!AWS_BASE_URL) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REPLICATION_TIMEOUT_MS);
    const res = await fetch(`${AWS_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-replication-key': REPLICATION_SECRET,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`replicate to aws failed: ${path} -> ${res.status}`);
    }
  } catch (err) {
    console.error(`replicate to aws failed: ${path}`, err.message);
  }
}

// Events - owned by the creating user (userId required), soft-deleted
// via cancelled_at rather than a hard DELETE (bookings/payments reference
// the event by foreign key).

async function createEvent({ userId, title, date, location, capacity, price }) {
  if (new Date(date) <= new Date()) {
    throw new ValidationError('Event date must be in the future');
  }
  const priceNum = Number(price) || 0;
  if (priceNum < 0) {
    throw new ValidationError('Price can\u2019t be negative');
  }

  const id = crypto.randomUUID();
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .input('userId', sql.UniqueIdentifier, userId)
    .input('title', sql.NVarChar, title)
    .input('date', sql.DateTime, new Date(date))
    .input('location', sql.NVarChar, location)
    .input('capacity', sql.Int, capacity)
    .input('price', sql.Decimal(10, 2), priceNum)
    .query(
      `INSERT INTO events (id, user_id, title, event_date, location, capacity, price, origin_cloud)
       OUTPUT INSERTED.id, INSERTED.user_id, INSERTED.title, INSERTED.event_date, INSERTED.location, INSERTED.capacity, INSERTED.price, INSERTED.cancelled_at, INSERTED.origin_cloud
       VALUES (@id, @userId, @title, @date, @location, @capacity, @price, 'azure')`
    );
  const record = result.recordset[0];

  await replicateToAws('/replicate/events', record);

  return record;
}

// booking_count is a live count, not a stored column - see
// lambda/layer/nodejs/db.js
async function listEvents() {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(
      `SELECT e.id, e.title, e.event_date, e.location, e.capacity, e.price, e.origin_cloud,
              (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.id AND b.cancelled_at IS NULL) AS booking_count
       FROM events e
       WHERE e.cancelled_at IS NULL
       ORDER BY e.event_date ASC`
    );
  return result.recordset;
}

async function listMyEvents(userId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('userId', sql.UniqueIdentifier, userId)
    .query(
      `SELECT id, title, event_date, location, capacity, price, cancelled_at, origin_cloud
       FROM events
       WHERE user_id = @userId
       ORDER BY event_date DESC`
    );
  return result.recordset;
}

// cascades: every active booking against this event gets cancelled too,
// with a refund notification for anyone who'd completed a payment - see
// lambda/layer/nodejs/db.js
async function cancelEvent(eventId, userId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, eventId)
    .input('userId', sql.UniqueIdentifier, userId)
    .query(
      `UPDATE events SET cancelled_at = GETDATE()
       OUTPUT INSERTED.id, INSERTED.user_id, INSERTED.title, INSERTED.event_date, INSERTED.location, INSERTED.capacity, INSERTED.price, INSERTED.cancelled_at, INSERTED.origin_cloud
       WHERE id = @id AND user_id = @userId AND cancelled_at IS NULL`
    );
  const record = result.recordset[0];
  if (!record) return null;

  await replicateToAws('/replicate/events', record);

  const bookings = await pool
    .request()
    .input('eventId', sql.UniqueIdentifier, eventId)
    .query('SELECT id, attendee_name, attendee_email FROM bookings WHERE event_id = @eventId AND cancelled_at IS NULL');

  for (const booking of bookings.recordset) {
    const cancelled = await cancelBookingInternal(booking.id);
    if (!cancelled) continue;

    const payment = await pool
      .request()
      .input('bookingId', sql.UniqueIdentifier, booking.id)
      .query(
        `SELECT TOP 1 id FROM payments WHERE booking_id = @bookingId AND status = 'completed' ORDER BY created_at DESC`
      );

    try {
      if (payment.recordset[0]) {
        await createNotification({
          recipientEmail: booking.attendee_email,
          subject: 'Event cancelled \u2014 refund issued',
          body: `${record.title} was cancelled by the host. Your payment has been refunded.`,
          relatedBookingId: booking.id,
        });
      } else {
        await createNotification({
          recipientEmail: booking.attendee_email,
          subject: 'Event cancelled',
          body: `${record.title} was cancelled by the host.`,
          relatedBookingId: booking.id,
        });
      }
    } catch (err) {
      console.error('cancellation notification failed:', err);
    }
  }

  return record;
}

// upsert - a cancellation from the other cloud needs to update the row
// here too, not be skipped because the id already exists
async function replicateEvent(record) {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input('id', sql.UniqueIdentifier, record.id)
    .query('SELECT id FROM events WHERE id = @id');

  if (existing.recordset.length > 0) {
    await pool
      .request()
      .input('id', sql.UniqueIdentifier, record.id)
      .input('title', sql.NVarChar, record.title)
      .input('date', sql.DateTime, new Date(record.event_date))
      .input('location', sql.NVarChar, record.location)
      .input('capacity', sql.Int, record.capacity)
      .input('price', sql.Decimal(10, 2), record.price || 0)
      .input('cancelledAt', sql.DateTime, record.cancelled_at || null)
      .query(
        `UPDATE events SET title = @title, event_date = @date, location = @location,
         capacity = @capacity, price = @price, cancelled_at = @cancelledAt WHERE id = @id`
      );
    return;
  }

  await pool
    .request()
    .input('id', sql.UniqueIdentifier, record.id)
    .input('userId', sql.UniqueIdentifier, record.user_id)
    .input('title', sql.NVarChar, record.title)
    .input('date', sql.DateTime, new Date(record.event_date))
    .input('location', sql.NVarChar, record.location)
    .input('capacity', sql.Int, record.capacity)
    .input('price', sql.Decimal(10, 2), record.price || 0)
    .input('cancelledAt', sql.DateTime, record.cancelled_at || null)
    .input('originCloud', sql.NVarChar, record.origin_cloud || 'aws')
    .query(
      `INSERT INTO events (id, user_id, title, event_date, location, capacity, price, cancelled_at, origin_cloud)
       VALUES (@id, @userId, @title, @date, @location, @capacity, @price, @cancelledAt, @originCloud)`
    );
}

// Bookings - same ownership + soft-delete pattern

async function createBooking({ userId, eventId, attendeeName, attendeeEmail }) {
  const pool = await getPool();

  const dup = await pool
    .request()
    .input('userId', sql.UniqueIdentifier, userId)
    .input('eventId', sql.UniqueIdentifier, eventId)
    .query('SELECT id FROM bookings WHERE user_id = @userId AND event_id = @eventId AND cancelled_at IS NULL');
  if (dup.recordset[0]) {
    throw new ValidationError('You\u2019ve already booked a spot for this event');
  }

  const eventResult = await pool
    .request()
    .input('eventId', sql.UniqueIdentifier, eventId)
    .query('SELECT user_id, capacity FROM events WHERE id = @eventId');
  const eventRow = eventResult.recordset[0];
  if (!eventRow) {
    throw new ValidationError('Event not found');
  }
  if (eventRow.user_id.toLowerCase() === userId.toLowerCase()) {
    throw new ValidationError('You can\u2019t book your own event');
  }
  const countResult = await pool
    .request()
    .input('eventId', sql.UniqueIdentifier, eventId)
    .query('SELECT COUNT(*) AS count FROM bookings WHERE event_id = @eventId AND cancelled_at IS NULL');
  if (Number(countResult.recordset[0].count) >= eventRow.capacity) {
    throw new ValidationError('This event is full');
  }

  const id = crypto.randomUUID();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .input('userId', sql.UniqueIdentifier, userId)
    .input('eventId', sql.UniqueIdentifier, eventId)
    .input('attendeeName', sql.NVarChar, attendeeName)
    .input('attendeeEmail', sql.NVarChar, attendeeEmail)
    .query(
      `INSERT INTO bookings (id, user_id, event_id, attendee_name, attendee_email, origin_cloud)
       OUTPUT INSERTED.id, INSERTED.user_id, INSERTED.event_id, INSERTED.attendee_name, INSERTED.attendee_email, INSERTED.cancelled_at, INSERTED.created_at, INSERTED.origin_cloud
       VALUES (@id, @userId, @eventId, @attendeeName, @attendeeEmail, 'azure')`
    );
  const record = result.recordset[0];

  await replicateToAws('/replicate/bookings', record);

  try {
    await createNotification({
      recipientEmail: attendeeEmail,
      subject: 'Booking confirmed',
      body: `Your booking (${id}) is confirmed.`,
      relatedBookingId: id,
    });
  } catch (err) {
    console.error('booking notification failed:', err);
  }

  return record;
}

async function listMyBookings(userId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('userId', sql.UniqueIdentifier, userId)
    .query(
      `SELECT b.id, b.event_id, b.attendee_name, b.attendee_email, b.cancelled_at, b.created_at, b.origin_cloud,
              e.title AS event_title, e.event_date
       FROM bookings b
       JOIN events e ON e.id = b.event_id
       WHERE b.user_id = @userId
       ORDER BY b.created_at DESC`
    );
  return result.recordset;
}

// shared core used both by the participant's own cancel request and by
// cancelEvent's cascade - see lambda/layer/nodejs/db.js
async function cancelBookingInternal(bookingId, userId = null) {
  const pool = await getPool();
  const request = pool.request().input('id', sql.UniqueIdentifier, bookingId);
  let where = 'id = @id AND cancelled_at IS NULL';
  if (userId) {
    request.input('userId', sql.UniqueIdentifier, userId);
    where = 'id = @id AND user_id = @userId AND cancelled_at IS NULL';
  }

  const result = await request.query(
    `UPDATE bookings SET cancelled_at = GETDATE()
     OUTPUT INSERTED.id, INSERTED.user_id, INSERTED.event_id, INSERTED.attendee_name, INSERTED.attendee_email, INSERTED.cancelled_at, INSERTED.created_at, INSERTED.origin_cloud
     WHERE ${where}`
  );
  const record = result.recordset[0];
  if (!record) return null;

  await replicateToAws('/replicate/bookings', record);
  return record;
}

// participant cancelling their own booking - refund notification if
// they'd actually paid
async function cancelBooking(bookingId, userId) {
  const record = await cancelBookingInternal(bookingId, userId);
  if (!record) return null;

  const pool = await getPool();
  const payment = await pool
    .request()
    .input('bookingId', sql.UniqueIdentifier, bookingId)
    .query(
      `SELECT TOP 1 id, amount, currency FROM payments WHERE booking_id = @bookingId AND status = 'completed' ORDER BY created_at DESC`
    );

  if (payment.recordset[0]) {
    try {
      const p = payment.recordset[0];
      await createNotification({
        recipientEmail: record.attendee_email,
        subject: 'Booking cancelled \u2014 refund issued',
        body: `Your booking was cancelled and your payment of ${p.currency} ${p.amount} has been refunded.`,
        relatedBookingId: bookingId,
      });
    } catch (err) {
      console.error('refund notification failed:', err);
    }
  }

  return record;
}

async function replicateBooking(record) {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input('id', sql.UniqueIdentifier, record.id)
    .query('SELECT id FROM bookings WHERE id = @id');

  if (existing.recordset.length > 0) {
    await pool
      .request()
      .input('id', sql.UniqueIdentifier, record.id)
      .input('attendeeName', sql.NVarChar, record.attendee_name)
      .input('attendeeEmail', sql.NVarChar, record.attendee_email)
      .input('cancelledAt', sql.DateTime, record.cancelled_at || null)
      .query(
        `UPDATE bookings SET attendee_name = @attendeeName, attendee_email = @attendeeEmail,
         cancelled_at = @cancelledAt WHERE id = @id`
      );
    return;
  }

  await pool
    .request()
    .input('id', sql.UniqueIdentifier, record.id)
    .input('userId', sql.UniqueIdentifier, record.user_id)
    .input('eventId', sql.UniqueIdentifier, record.event_id)
    .input('attendeeName', sql.NVarChar, record.attendee_name)
    .input('attendeeEmail', sql.NVarChar, record.attendee_email)
    .input('cancelledAt', sql.DateTime, record.cancelled_at || null)
    .input('createdAt', sql.DateTime, record.created_at)
    .input('originCloud', sql.NVarChar, record.origin_cloud || 'aws')
    .query(
      `INSERT INTO bookings (id, user_id, event_id, attendee_name, attendee_email, cancelled_at, created_at, origin_cloud)
       VALUES (@id, @userId, @eventId, @attendeeName, @attendeeEmail, @cancelledAt, @createdAt, @originCloud)`
    );
}

// Users - registration, profile edit, password change/reset

// no email verification - account usable immediately, mirrors
// lambda/layer/nodejs/db.js
async function createUser({ name, email, passwordHash, securityQuestion, securityAnswerHash }) {
  const id = crypto.randomUUID();
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .input('name', sql.NVarChar, name)
    .input('email', sql.NVarChar, email)
    .input('passwordHash', sql.NVarChar, passwordHash)
    .input('securityQuestion', sql.NVarChar, securityQuestion)
    .input('securityAnswerHash', sql.NVarChar, securityAnswerHash)
    .query(
      `INSERT INTO users (id, name, email, password_hash, security_question, security_answer_hash, origin_cloud)
       OUTPUT INSERTED.id, INSERTED.name, INSERTED.email, INSERTED.created_at, INSERTED.origin_cloud
       VALUES (@id, @name, @email, @passwordHash, @securityQuestion, @securityAnswerHash, 'azure')`
    );
  const record = result.recordset[0];

  await replicateToAws('/replicate/users', {
    ...record,
    password_hash: passwordHash,
    security_question: securityQuestion,
    security_answer_hash: securityAnswerHash,
  });

  return record;
}

async function findUserByEmail(email) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('email', sql.NVarChar, email)
    .query('SELECT * FROM users WHERE email = @email AND deleted_at IS NULL');
  return result.recordset[0] || null;
}

async function findUserById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .query('SELECT id, name, email, created_at, origin_cloud FROM users WHERE id = @id AND deleted_at IS NULL');
  return result.recordset[0] || null;
}

// includes password_hash, unlike findUserById - only for internal use by
// the change-password handler
async function findUserByIdWithPassword(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .query('SELECT * FROM users WHERE id = @id AND deleted_at IS NULL');
  return result.recordset[0] || null;
}

async function updateProfile(userId, { name }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, userId)
    .input('name', sql.NVarChar, name)
    .query(
      `UPDATE users SET name = @name
       OUTPUT INSERTED.id, INSERTED.name, INSERTED.email, INSERTED.password_hash, INSERTED.security_question, INSERTED.security_answer_hash, INSERTED.created_at, INSERTED.origin_cloud
       WHERE id = @id`
    );
  const record = result.recordset[0];
  if (!record) return null;

  await replicateToAws('/replicate/users', record);
  const { password_hash, security_answer_hash, ...safe } = record;
  return safe;
}

// GDPR-style account deletion (tombstone + anonymisation). See the AWS
// db.js copy for the full reasoning: a plain hard DELETE is unsafe here
// because reconcile would resurrect the row from the peer. Instead PII is
// overwritten, deleted_at is set as the tombstone, and the id is kept so
// events/bookings foreign keys stay intact. The user's hosted events are
// cancelled (refunding attendees via cancelEvent) and their own bookings too.
async function deleteAccount(userId) {
  const pool = await getPool();

  const owned = await pool
    .request()
    .input('uid', sql.UniqueIdentifier, userId)
    .query('SELECT id FROM events WHERE user_id = @uid AND cancelled_at IS NULL');
  for (const row of owned.recordset) {
    await cancelEvent(row.id, userId);
  }

  const myBookings = await pool
    .request()
    .input('uid', sql.UniqueIdentifier, userId)
    .query(
      `UPDATE bookings SET cancelled_at = GETDATE()
       OUTPUT INSERTED.id, INSERTED.user_id, INSERTED.event_id, INSERTED.attendee_name, INSERTED.attendee_email, INSERTED.cancelled_at, INSERTED.created_at, INSERTED.origin_cloud
       WHERE user_id = @uid AND cancelled_at IS NULL`
    );
  for (const b of myBookings.recordset) {
    await replicateToAws('/replicate/bookings', b);
  }

  // read the real email before anonymising, so the activity log (notifications,
  // keyed by email rather than id) can be cleared for this person too.
  const before = await pool
    .request()
    .input('id', sql.UniqueIdentifier, userId)
    .query('SELECT email FROM users WHERE id = @id');
  const oldEmail = before.recordset[0] ? before.recordset[0].email : null;

  const anonEmail = `deleted+${userId}@deleted.invalid`;
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, userId)
    .input('email', sql.NVarChar, anonEmail)
    .query(
      `UPDATE users
         SET name = 'Deleted user', email = @email, password_hash = '',
             security_question = '', security_answer_hash = '', deleted_at = GETDATE()
       OUTPUT INSERTED.id, INSERTED.name, INSERTED.email, INSERTED.password_hash, INSERTED.security_question, INSERTED.security_answer_hash, INSERTED.deleted_at, INSERTED.origin_cloud
       WHERE id = @id AND deleted_at IS NULL`
    );
  const record = result.recordset[0];
  if (!record) return false;

  // remove this person's activity log so a later signup with the same email
  // does not inherit the deleted user's history
  if (oldEmail) {
    await pool
      .request()
      .input('oldEmail', sql.NVarChar, oldEmail)
      .query('DELETE FROM notifications WHERE recipient_email = @oldEmail');
  }

  await replicateToAws('/replicate/users', record);
  return true;
}

async function changePassword(userId, newPasswordHash) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, userId)
    .input('passwordHash', sql.NVarChar, newPasswordHash)
    .query(
      `UPDATE users SET password_hash = @passwordHash
       OUTPUT INSERTED.id, INSERTED.name, INSERTED.email, INSERTED.password_hash, INSERTED.security_question, INSERTED.security_answer_hash, INSERTED.created_at, INSERTED.origin_cloud
       WHERE id = @id`
    );
  const record = result.recordset[0];
  if (!record) return null;

  await replicateToAws('/replicate/users', record);
  return true;
}

// upsert - could be a new user or a profile/password/answer update
async function replicateUser(record) {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input('id', sql.UniqueIdentifier, record.id)
    .query('SELECT id FROM users WHERE id = @id');

  if (existing.recordset.length > 0) {
    await pool
      .request()
      .input('id', sql.UniqueIdentifier, record.id)
      .input('name', sql.NVarChar, record.name)
      .input('passwordHash', sql.NVarChar, record.password_hash)
      .input('securityQuestion', sql.NVarChar, record.security_question)
      .input('securityAnswerHash', sql.NVarChar, record.security_answer_hash)
      .input('email', sql.NVarChar, record.email)
      .input('deletedAt', sql.DateTime, record.deleted_at || null)
      .query(
        `UPDATE users
         SET name = @name, email = @email, password_hash = @passwordHash,
             security_question = @securityQuestion, security_answer_hash = @securityAnswerHash,
             deleted_at = @deletedAt
         WHERE id = @id`
      );
    return;
  }

  await pool
    .request()
    .input('id', sql.UniqueIdentifier, record.id)
    .input('name', sql.NVarChar, record.name)
    .input('email', sql.NVarChar, record.email)
    .input('passwordHash', sql.NVarChar, record.password_hash)
    .input('securityQuestion', sql.NVarChar, record.security_question)
    .input('securityAnswerHash', sql.NVarChar, record.security_answer_hash)
    .input('originCloud', sql.NVarChar, record.origin_cloud || 'aws')
    .input('deletedAt', sql.DateTime, record.deleted_at || null)
    .query(
      `INSERT INTO users (id, name, email, password_hash, security_question, security_answer_hash, deleted_at, origin_cloud)
       VALUES (@id, @name, @email, @passwordHash, @securityQuestion, @securityAnswerHash, @deletedAt, @originCloud)`
    );
}

// returns null if no account exists for this email - see
// lambda/layer/nodejs/db.js for the existence-disclosure reasoning
async function getSecurityQuestion(email) {
  const user = await findUserByEmail(email);
  if (!user) return null;
  return user.security_question;
}

async function resetPasswordWithAnswer({ email, newPasswordHash }) {
  const pool = await getPool();
  const user = await findUserByEmail(email);
  if (!user) return false;

  await pool
    .request()
    .input('id', sql.UniqueIdentifier, user.id)
    .input('passwordHash', sql.NVarChar, newPasswordHash)
    .query('UPDATE users SET password_hash = @passwordHash WHERE id = @id');

  await replicateToAws('/replicate/users', {
    ...user,
    password_hash: newPasswordHash,
  });

  return true;
}

// Payments (fake) and notifications (fake, not replicated)

async function createPayment({ bookingId, amount, currency, cardNumber }) {
  const id = crypto.randomUUID();
  const last4 = cardNumber.slice(-4);
  const status = last4 === '0000' ? 'declined' : 'completed';

  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .input('bookingId', sql.UniqueIdentifier, bookingId)
    .input('amount', sql.Decimal(10, 2), amount)
    .input('currency', sql.NVarChar, currency || 'USD')
    .input('cardLast4', sql.NVarChar, last4)
    .input('status', sql.NVarChar, status)
    .query(
      `INSERT INTO payments (id, booking_id, amount, currency, card_last4, status, origin_cloud)
       OUTPUT INSERTED.id, INSERTED.booking_id, INSERTED.amount, INSERTED.currency, INSERTED.card_last4, INSERTED.status, INSERTED.created_at, INSERTED.origin_cloud
       VALUES (@id, @bookingId, @amount, @currency, @cardLast4, @status, 'azure')`
    );
  const record = result.recordset[0];

  await replicateToAws('/replicate/payments', record);

  try {
    const bookingResult = await pool
      .request()
      .input('bookingId', sql.UniqueIdentifier, bookingId)
      .query('SELECT attendee_email FROM bookings WHERE id = @bookingId');
    const recipientEmail = bookingResult.recordset[0]?.attendee_email;
    if (recipientEmail) {
      await createNotification({
        recipientEmail,
        subject: status === 'declined' ? 'Payment declined' : 'Payment receipt',
        body:
          status === 'declined'
            ? `Your payment of ${currency || 'USD'} ${amount} was declined.`
            : `Payment of ${currency || 'USD'} ${amount} received, thank you.`,
        relatedBookingId: bookingId,
      });
    }
  } catch (err) {
    console.error('payment notification failed:', err);
  }

  return record;
}

async function replicatePayment(record) {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input('id', sql.UniqueIdentifier, record.id)
    .query('SELECT id FROM payments WHERE id = @id');
  if (existing.recordset.length > 0) return;

  await pool
    .request()
    .input('id', sql.UniqueIdentifier, record.id)
    .input('bookingId', sql.UniqueIdentifier, record.booking_id)
    .input('amount', sql.Decimal(10, 2), record.amount)
    .input('currency', sql.NVarChar, record.currency)
    .input('cardLast4', sql.NVarChar, record.card_last4)
    .input('status', sql.NVarChar, record.status)
    .input('createdAt', sql.DateTime, record.created_at)
    .input('originCloud', sql.NVarChar, record.origin_cloud || 'aws')
    .query(
      `INSERT INTO payments (id, booking_id, amount, currency, card_last4, status, created_at, origin_cloud)
       VALUES (@id, @bookingId, @amount, @currency, @cardLast4, @status, @createdAt, @originCloud)`
    );
}

async function createNotification({ recipientEmail, subject, body, relatedBookingId }) {
  const id = crypto.randomUUID();
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .input('recipientEmail', sql.NVarChar, recipientEmail)
    .input('subject', sql.NVarChar, subject)
    .input('body', sql.NVarChar, body)
    .input('relatedBookingId', sql.UniqueIdentifier, relatedBookingId || null)
    .query(
      `INSERT INTO notifications (id, recipient_email, subject, body, related_booking_id, status, origin_cloud)
       VALUES (@id, @recipientEmail, @subject, @body, @relatedBookingId, 'sent', 'azure')`
    );
}

async function listNotifications() {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(
      `SELECT id, recipient_email, subject, body, related_booking_id, status, created_at, origin_cloud
       FROM notifications
       ORDER BY created_at DESC`
    );
  return result.recordset;
}

// resync after a cloud has been down - same as the AWS side in
// lambda/layer/nodejs/db.js. reads everything and re-sends it; the
// /replicate/* endpoints upsert so only the missed rows get added.
async function pushToPeer(path, payload) {
  if (!AWS_BASE_URL) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${AWS_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-replication-key': REPLICATION_SECRET,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch (err) {
    return false;
  }
}

async function reconcileToPeer() {
  const pool = await getPool();
  const result = { users: 0, events: 0, bookings: 0, payments: 0, failed: 0 };

  const tables = [
    { key: 'users',    sql: 'SELECT * FROM users',    path: '/replicate/users' },
    { key: 'events',   sql: 'SELECT * FROM events',   path: '/replicate/events' },
    { key: 'bookings', sql: 'SELECT * FROM bookings', path: '/replicate/bookings' },
    { key: 'payments', sql: 'SELECT * FROM payments', path: '/replicate/payments' },
  ];

  for (const t of tables) {
    const rows = (await pool.request().query(t.sql)).recordset;
    for (const row of rows) {
      const ok = await pushToPeer(t.path, row);
      if (ok) { result[t.key]++; } else { result.failed++; }
    }
  }
  return result;
}

module.exports = {
  createEvent,
  listEvents,
  listMyEvents,
  cancelEvent,
  replicateEvent,
  createBooking,
  listMyBookings,
  cancelBooking,
  replicateBooking,
  createUser,
  findUserByEmail,
  findUserById,
  findUserByIdWithPassword,
  updateProfile,
  changePassword,
  replicateUser,
  deleteAccount,
  getSecurityQuestion,
  resetPasswordWithAnswer,
  createPayment,
  replicatePayment,
  createNotification,
  listNotifications,
  reconcileToPeer,
  ValidationError,
};
