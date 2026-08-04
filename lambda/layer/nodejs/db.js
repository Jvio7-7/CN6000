const { Pool } = require('pg');
const crypto = require('crypto');

class ValidationError extends Error {}

// AWS side. Every write: generate a UUID, write to RDS, replicate to Azure.
// Replication is awaited - Lambda freezes once the handler returns.

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

const AZURE_BASE_URL = process.env.AZURE_BASE_URL;
const REPLICATION_SECRET = process.env.REPLICATION_SECRET;
const REPLICATION_TIMEOUT_MS = 3000;

async function replicateToAzure(path, payload) {
  if (!AZURE_BASE_URL) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REPLICATION_TIMEOUT_MS);
    const res = await fetch(`${AZURE_BASE_URL}${path}`, {
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
      console.error(`replicate to azure failed: ${path} -> ${res.status}`);
    }
  } catch (err) {
    console.error(`replicate to azure failed: ${path}`, err.message);
  }
}


async function createEvent({ userId, title, date, location, capacity, price }) {
  if (new Date(date) <= new Date()) {
    throw new ValidationError('Event date must be in the future');
  }
  const priceNum = Number(price) || 0;
  if (priceNum < 0) {
    throw new ValidationError('Price can\u2019t be negative');
  }

  const id = crypto.randomUUID();
  const db = getPool();
  const result = await db.query(
    `INSERT INTO events (id, user_id, title, event_date, location, capacity, price, origin_cloud)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'aws')
     RETURNING id, user_id, title, event_date, location, capacity, price, cancelled_at, origin_cloud`,
    [id, userId, title, date, location, capacity, priceNum]
  );
  const record = result.rows[0];

  await replicateToAzure('/replicate/events', record);

  return record;
}

async function listEvents() {
  const db = getPool();
  const result = await db.query(
    `SELECT e.id, e.title, e.event_date, e.location, e.capacity, e.price, e.origin_cloud,
            (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.id AND b.cancelled_at IS NULL) AS booking_count
     FROM events e
     WHERE e.cancelled_at IS NULL
     ORDER BY e.event_date ASC`
  );
  return result.rows;
}

async function listMyEvents(userId) {
  const db = getPool();
  const result = await db.query(
    `SELECT id, title, event_date, location, capacity, price, cancelled_at, origin_cloud
     FROM events
     WHERE user_id = $1
     ORDER BY event_date DESC`,
    [userId]
  );
  return result.rows;
}

async function cancelEvent(eventId, userId) {
  const db = getPool();
  const result = await db.query(
    `UPDATE events SET cancelled_at = NOW()
     WHERE id = $1 AND user_id = $2 AND cancelled_at IS NULL
     RETURNING id, user_id, title, event_date, location, capacity, price, cancelled_at, origin_cloud`,
    [eventId, userId]
  );
  const record = result.rows[0];
  if (!record) return null;

  await replicateToAzure('/replicate/events', record);

  const bookings = await db.query(
    `SELECT id, attendee_name, attendee_email FROM bookings WHERE event_id = $1 AND cancelled_at IS NULL`,
    [eventId]
  );

  for (const booking of bookings.rows) {
    const cancelled = await cancelBookingInternal(booking.id);
    if (!cancelled) continue;

    const payment = await db.query(
      `SELECT id FROM payments WHERE booking_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
      [booking.id]
    );

    try {
      if (payment.rows[0]) {
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

// upsert, not insert-or-skip - a cancellation on the other cloud needs to
// update the row here too, not just be ignored because the id already exists
async function replicateEvent(record) {
  const db = getPool();
  await db.query(
    `INSERT INTO events (id, user_id, title, event_date, location, capacity, price, cancelled_at, origin_cloud)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       event_date = EXCLUDED.event_date,
       location = EXCLUDED.location,
       capacity = EXCLUDED.capacity,
       price = EXCLUDED.price,
       cancelled_at = EXCLUDED.cancelled_at`,
    [
      record.id,
      record.user_id,
      record.title,
      record.event_date,
      record.location,
      record.capacity,
      record.price || 0,
      record.cancelled_at || null,
      record.origin_cloud || 'azure',
    ]
  );
}


// The capacity check and the insert share one transaction with the event
// row locked, so two concurrent bookings can't both claim the last seat.
// Replication runs after the commit, never while holding the lock.
async function createBooking({ userId, eventId, attendeeName, attendeeEmail }) {
  const db = getPool();
  const client = await db.connect();
  let record;

  try {
    await client.query('BEGIN');

    const eventResult = await client.query(
      'SELECT user_id, capacity FROM events WHERE id = $1 FOR UPDATE',
      [eventId]
    );
    const event = eventResult.rows[0];
    if (!event) {
      throw new ValidationError('Event not found');
    }
    if (event.user_id.toLowerCase() === userId.toLowerCase()) {
      throw new ValidationError('You can\u2019t book your own event');
    }

    const dup = await client.query(
      `SELECT id FROM bookings WHERE user_id = $1 AND event_id = $2 AND cancelled_at IS NULL`,
      [userId, eventId]
    );
    if (dup.rows[0]) {
      throw new ValidationError('You\u2019ve already booked a spot for this event');
    }

    const countResult = await client.query(
      `SELECT COUNT(*) AS count FROM bookings WHERE event_id = $1 AND cancelled_at IS NULL`,
      [eventId]
    );
    if (Number(countResult.rows[0].count) >= event.capacity) {
      throw new ValidationError('This event is full');
    }

    const id = crypto.randomUUID();
    const result = await client.query(
      `INSERT INTO bookings (id, user_id, event_id, attendee_name, attendee_email, origin_cloud)
       VALUES ($1, $2, $3, $4, $5, 'aws')
       RETURNING id, user_id, event_id, attendee_name, attendee_email, cancelled_at, created_at, origin_cloud`,
      [id, userId, eventId, attendeeName, attendeeEmail]
    );
    record = result.rows[0];

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const id = record.id;
  await replicateToAzure('/replicate/bookings', record);

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
  const db = getPool();
  const result = await db.query(
    `SELECT b.id, b.event_id, b.attendee_name, b.attendee_email, b.cancelled_at, b.created_at, b.origin_cloud,
            e.title AS event_title, e.event_date
     FROM bookings b
     JOIN events e ON e.id = b.event_id
     WHERE b.user_id = $1
     ORDER BY b.created_at DESC`,
    [userId]
  );
  return result.rows;
}

async function cancelBookingInternal(bookingId, userId = null) {
  const db = getPool();
  const conditions = userId ? 'id = $1 AND user_id = $2 AND cancelled_at IS NULL' : 'id = $1 AND cancelled_at IS NULL';
  const params = userId ? [bookingId, userId] : [bookingId];

  const result = await db.query(
    `UPDATE bookings SET cancelled_at = NOW()
     WHERE ${conditions}
     RETURNING id, user_id, event_id, attendee_name, attendee_email, cancelled_at, created_at, origin_cloud`,
    params
  );
  const record = result.rows[0];
  if (!record) return null;

  await replicateToAzure('/replicate/bookings', record);
  return record;
}

async function cancelBooking(bookingId, userId) {
  const record = await cancelBookingInternal(bookingId, userId);
  if (!record) return null;

  const db = getPool();
  const payment = await db.query(
    `SELECT id, amount, currency FROM payments WHERE booking_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
    [bookingId]
  );

  if (payment.rows[0]) {
    try {
      const p = payment.rows[0];
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
  const db = getPool();
  await db.query(
    `INSERT INTO bookings (id, user_id, event_id, attendee_name, attendee_email, cancelled_at, created_at, origin_cloud)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       attendee_name = EXCLUDED.attendee_name,
       attendee_email = EXCLUDED.attendee_email,
       cancelled_at = EXCLUDED.cancelled_at`,
    [
      record.id,
      record.user_id,
      record.event_id,
      record.attendee_name,
      record.attendee_email,
      record.cancelled_at || null,
      record.created_at,
      record.origin_cloud || 'azure',
    ]
  );
}


async function createUser({ name, email, passwordHash, securityQuestion, securityAnswerHash }) {
  const id = crypto.randomUUID();
  const db = getPool();
  const result = await db.query(
    `INSERT INTO users (id, name, email, password_hash, security_question, security_answer_hash, origin_cloud)
     VALUES ($1, $2, $3, $4, $5, $6, 'aws')
     RETURNING id, name, email, created_at, origin_cloud`,
    [id, name, email, passwordHash, securityQuestion, securityAnswerHash]
  );
  const record = result.rows[0];

  await replicateToAzure('/replicate/users', {
    ...record,
    password_hash: passwordHash,
    security_question: securityQuestion,
    security_answer_hash: securityAnswerHash,
  });

  return record;
}

async function findUserByEmail(email) {
  const db = getPool();
  const result = await db.query('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
  return result.rows[0] || null;
}

async function findUserById(id) {
  const db = getPool();
  const result = await db.query(
    'SELECT id, name, email, created_at, origin_cloud FROM users WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  return result.rows[0] || null;
}

async function findUserByIdWithPassword(id) {
  const db = getPool();
  const result = await db.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
  return result.rows[0] || null;
}

async function updateProfile(userId, { name }) {
  const db = getPool();
  const result = await db.query(
    `UPDATE users SET name = $1 WHERE id = $2
     RETURNING id, name, email, password_hash, security_question, security_answer_hash, created_at, origin_cloud`,
    [name, userId]
  );
  const record = result.rows[0];
  if (!record) return null;

  await replicateToAzure('/replicate/users', record);
  const { password_hash, security_answer_hash, ...safe } = record;
  return safe;
}

// GDPR-style deletion. A hard DELETE is unsafe here: reconcile would push
// the row back from the peer on the next recovery. So this overwrites the
// personal fields, sets deleted_at as a tombstone both clouds converge on,
// and keeps the id so foreign keys stay intact. The user's events and
// bookings are cancelled through the normal cancel paths.
async function deleteAccount(userId) {
  const db = getPool();

  const owned = await db.query(
    'SELECT id FROM events WHERE user_id = $1 AND cancelled_at IS NULL',
    [userId]
  );
  for (const row of owned.rows) {
    await cancelEvent(row.id, userId);
  }

  const myBookings = await db.query(
    `UPDATE bookings SET cancelled_at = NOW()
     WHERE user_id = $1 AND cancelled_at IS NULL
     RETURNING id, user_id, event_id, attendee_name, attendee_email, cancelled_at, created_at, origin_cloud`,
    [userId]
  );
  for (const b of myBookings.rows) {
    await replicateToAzure('/replicate/bookings', b);
  }

  // read the real email before anonymising, so the activity log (notifications,
  // keyed by email rather than id) can be cleared for this person too.
  const before = await db.query('SELECT email FROM users WHERE id = $1', [userId]);
  const oldEmail = before.rows[0] ? before.rows[0].email : null;

  // anonymise PII and tombstone the account. email is set to a unique
  // placeholder so the UNIQUE constraint holds and the address is freed.
  const anonEmail = `deleted+${userId}@deleted.invalid`;
  const result = await db.query(
    `UPDATE users
       SET name = 'Deleted user',
           email = $2,
           password_hash = '',
           security_question = '',
           security_answer_hash = '',
           deleted_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, name, email, password_hash, security_question, security_answer_hash, deleted_at, origin_cloud`,
    [userId, anonEmail]
  );
  const record = result.rows[0];
  if (!record) return false;

  // remove this person's activity log so a later signup with the same email
  // does not inherit the deleted user's history
  if (oldEmail) {
    await db.query('DELETE FROM notifications WHERE recipient_email = $1', [oldEmail]);
  }

  await replicateToAzure('/replicate/users', record);
  return true;
}

async function changePassword(userId, newPasswordHash) {
  const db = getPool();
  const result = await db.query(
    `UPDATE users SET password_hash = $1 WHERE id = $2
     RETURNING id, name, email, password_hash, security_question, security_answer_hash, created_at, origin_cloud`,
    [newPasswordHash, userId]
  );
  const record = result.rows[0];
  if (!record) return null;

  await replicateToAzure('/replicate/users', record);
  return true;
}

async function replicateUser(record) {
  const db = getPool();
  await db.query(
    `INSERT INTO users (id, name, email, password_hash, security_question, security_answer_hash, deleted_at, origin_cloud)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       password_hash = EXCLUDED.password_hash,
       security_question = EXCLUDED.security_question,
       security_answer_hash = EXCLUDED.security_answer_hash,
       deleted_at = EXCLUDED.deleted_at`,
    [
      record.id,
      record.name,
      record.email,
      record.password_hash,
      record.security_question,
      record.security_answer_hash,
      record.deleted_at || null,
      record.origin_cloud || 'azure',
    ]
  );
}

async function getSecurityQuestion(email) {
  const user = await findUserByEmail(email);
  if (!user) return null;
  return user.security_question;
}

async function resetPasswordWithAnswer({ email, newPasswordHash }) {
  const db = getPool();
  const user = await findUserByEmail(email);
  if (!user) return false;

  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPasswordHash, user.id]);

  await replicateToAzure('/replicate/users', {
    ...user,
    password_hash: newPasswordHash,
  });

  return true;
}


async function createPayment({ bookingId, amount, currency, cardNumber }) {
  const id = crypto.randomUUID();
  const last4 = cardNumber.slice(-4);
  const status = last4 === '0000' ? 'declined' : 'completed';

  const db = getPool();
  const result = await db.query(
    `INSERT INTO payments (id, booking_id, amount, currency, card_last4, status, origin_cloud)
     VALUES ($1, $2, $3, $4, $5, $6, 'aws')
     RETURNING id, booking_id, amount, currency, card_last4, status, created_at, origin_cloud`,
    [id, bookingId, amount, currency || 'USD', last4, status]
  );
  const record = result.rows[0];

  await replicateToAzure('/replicate/payments', record);

  try {
    const bookingResult = await db.query('SELECT attendee_email FROM bookings WHERE id = $1', [
      bookingId,
    ]);
    const recipientEmail = bookingResult.rows[0]?.attendee_email;
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
  const db = getPool();
  await db.query(
    `INSERT INTO payments (id, booking_id, amount, currency, card_last4, status, created_at, origin_cloud)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [
      record.id,
      record.booking_id,
      record.amount,
      record.currency,
      record.card_last4,
      record.status,
      record.created_at,
      record.origin_cloud || 'azure',
    ]
  );
}

async function createNotification({ recipientEmail, subject, body, relatedBookingId }) {
  const id = crypto.randomUUID();
  const db = getPool();
  await db.query(
    `INSERT INTO notifications (id, recipient_email, subject, body, related_booking_id, status, origin_cloud)
     VALUES ($1, $2, $3, $4, $5, 'sent', 'aws')`,
    [id, recipientEmail, subject, body, relatedBookingId || null]
  );
}

async function listNotifications() {
  const db = getPool();
  const result = await db.query(
    `SELECT id, recipient_email, subject, body, related_booking_id, status, created_at, origin_cloud
     FROM notifications
     ORDER BY created_at DESC`
  );
  return result.rows;
}

// resync after a cloud has been down. normal replication is best-effort, so
// writes made while the peer was unreachable never arrived. this resends
// everything; /replicate/* upserts, so only the missing rows get added.

async function pushToPeer(path, payload) {
  if (!AZURE_BASE_URL) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${AZURE_BASE_URL}${path}`, {
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
  const db = getPool();
  const result = { users: 0, events: 0, bookings: 0, payments: 0, failed: 0 };

  const tables = [
    { key: 'users',    sql: 'SELECT * FROM users',    path: '/replicate/users' },
    { key: 'events',   sql: 'SELECT * FROM events',   path: '/replicate/events' },
    { key: 'bookings', sql: 'SELECT * FROM bookings', path: '/replicate/bookings' },
    { key: 'payments', sql: 'SELECT * FROM payments', path: '/replicate/payments' },
  ];

  for (const t of tables) {
    const rows = (await db.query(t.sql)).rows;
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
