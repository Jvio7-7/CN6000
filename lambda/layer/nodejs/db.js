const { Pool } = require('pg');
const crypto = require('crypto');

// thrown for things like "event is full" or "already booked" - handlers
// catch this specifically and respond 400/409, not the generic 500 they
// give everything else
class ValidationError extends Error {}

// AWS side. Every write: generate a UUID, write to RDS, replicate to Azure.
// awaited, not fire-and-forget - Lambda kills any async work still running
// after the handler returns, so a background fetch just never finishes.
// found this out the hard way when replication silently did nothing.

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

// Events - now owned by the user who created them (userId required),
// with a soft-delete (cancelled_at) instead of a hard DELETE, since
// bookings/payments reference the event by foreign key.

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

// booking_count is a live count of non-cancelled bookings, not a stored
// column - simpler than keeping a counter in sync, and this list is
// never large enough for the subquery to matter
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

// Returns null if the event doesn't exist or isn't owned by this user -
// caller turns that into a 404, not a 500. Cascades: every active
// booking against this event gets cancelled too, and anyone with a
// completed payment gets a (simulated) refund notification - there's no
// real payment processor, so this is exactly what "refund" means here.
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

// Bookings - same ownership + soft-delete pattern as events

async function createBooking({ userId, eventId, attendeeName, attendeeEmail }) {
  const db = getPool();

  const dup = await db.query(
    `SELECT id FROM bookings WHERE user_id = $1 AND event_id = $2 AND cancelled_at IS NULL`,
    [userId, eventId]
  );
  if (dup.rows[0]) {
    throw new ValidationError('You\u2019ve already booked a spot for this event');
  }

  const eventResult = await db.query('SELECT user_id, capacity FROM events WHERE id = $1', [eventId]);
  const event = eventResult.rows[0];
  if (!event) {
    throw new ValidationError('Event not found');
  }
  if (event.user_id.toLowerCase() === userId.toLowerCase()) {
    throw new ValidationError('You can\u2019t book your own event');
  }
  const countResult = await db.query(
    `SELECT COUNT(*) AS count FROM bookings WHERE event_id = $1 AND cancelled_at IS NULL`,
    [eventId]
  );
  if (Number(countResult.rows[0].count) >= event.capacity) {
    throw new ValidationError('This event is full');
  }

  const id = crypto.randomUUID();
  const result = await db.query(
    `INSERT INTO bookings (id, user_id, event_id, attendee_name, attendee_email, origin_cloud)
     VALUES ($1, $2, $3, $4, $5, 'aws')
     RETURNING id, user_id, event_id, attendee_name, attendee_email, cancelled_at, created_at, origin_cloud`,
    [id, userId, eventId, attendeeName, attendeeEmail]
  );
  const record = result.rows[0];

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

// shared core used both by the participant's own cancel request (which
// checks ownership) and by cancelEvent's cascade (which doesn't - the
// event owner is cancelling on their behalf)
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

// participant cancelling their own booking - sends a refund notification
// if they'd actually paid (nothing to refund otherwise)
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

// Users - registration, profile edit, password change/reset

// no email verification anymore - see README for why (SES sandbox mode
// needs a domain we don't have to ever get past). Account is usable
// immediately, same as before that was ever added.
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

// includes password_hash, unlike findUserById - only for internal use by
// the change-password handler, which needs to verify the current password
async function findUserByIdWithPassword(id) {
  const db = getPool();
  const result = await db.query('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
  return result.rows[0] || null;
}

// name-only update - password changes go through changePassword instead,
// since that one needs the current-password check
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

// GDPR-style account deletion. In a multi-cloud active-active system a plain
// hard DELETE is unsafe: reconcile re-pushes local rows to the peer, so a row
// deleted on one cloud but still present on the other would be resurrected on
// the next recovery. Instead this is a tombstone with anonymisation:
//   - personally identifiable fields are actually overwritten (right to erasure)
//   - deleted_at is set as the tombstone, so reconcile converges on the deleted
//     state rather than restoring the account
//   - the id is kept so events/bookings foreign keys stay intact
// The user's own events are cancelled (which refunds their attendees via the
// existing cancelEvent path) and the user's own bookings are cancelled too.
async function deleteAccount(userId) {
  const db = getPool();

  // cancel every event this user hosts - reuses cancelEvent so attendees are
  // refunded and each cancellation replicates on its own
  const owned = await db.query(
    'SELECT id FROM events WHERE user_id = $1 AND cancelled_at IS NULL',
    [userId]
  );
  for (const row of owned.rows) {
    await cancelEvent(row.id, userId);
  }

  // cancel this user's own bookings on other hosts' events
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

// currentPasswordHash/newPasswordHash are handled by the caller (auth.js) -
// db.js just does the lookup, comparison, and write
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

// upsert - could be a new user or a profile/password/answer update
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

// Returns null if no account exists for this email - the handler turns
// that into an explicit "no account found" response (same deliberate
// existence-disclosure decision as before, just without an email step
// in between now). Never returns the answer itself, only the question.
async function getSecurityQuestion(email) {
  const user = await findUserByEmail(email);
  if (!user) return null;
  return user.security_question;
}

// answerMatches is computed by the caller (auth.js's verifyPassword,
// reused here since bcrypt.compare works the same way regardless of
// what's being compared) - db.js just does the lookup and the write
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

// Payments (fake) and notifications (fake, not replicated)

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

// resync after a cloud has been down. the normal replicate is best-effort
// so writes made while the peer was down never got there. this just reads
// everything and sends it again. the /replicate/* endpoints upsert so
// re-sending rows that already exist doesn't matter, only the missing ones
// get added. run it on both clouds after one comes back.

// separate push with a 10s timeout (the normal one aborts at 3s) so a
// re-sync of many rows doesn't get cut off. returns true/false so we can
// count how many actually went through.
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
