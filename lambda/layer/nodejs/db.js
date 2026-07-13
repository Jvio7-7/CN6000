const { Pool } = require('pg');
const crypto = require('crypto');

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
const REPLICATION_TIMEOUT_MS = 3000;

async function replicateToAzure(path, payload) {
  if (!AZURE_BASE_URL) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REPLICATION_TIMEOUT_MS);
    const res = await fetch(`${AZURE_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

async function createEvent({ title, date, location, capacity }) {
  const id = crypto.randomUUID();
  const db = getPool();
  const result = await db.query(
    `INSERT INTO events (id, title, event_date, location, capacity, origin_cloud)
     VALUES ($1, $2, $3, $4, $5, 'aws')
     RETURNING id, title, event_date, location, capacity, origin_cloud`,
    [id, title, date, location, capacity]
  );
  const record = result.rows[0];

  await replicateToAzure('/replicate/events', record);

  return record;
}

async function createBooking({ eventId, attendeeName, attendeeEmail }) {
  const id = crypto.randomUUID();
  const db = getPool();
  const result = await db.query(
    `INSERT INTO bookings (id, event_id, attendee_name, attendee_email, origin_cloud)
     VALUES ($1, $2, $3, $4, 'aws')
     RETURNING id, event_id, attendee_name, attendee_email, created_at, origin_cloud`,
    [id, eventId, attendeeName, attendeeEmail]
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

// ON CONFLICT DO NOTHING so a retried replication request doesn't error out
async function replicateEvent(record) {
  const db = getPool();
  await db.query(
    `INSERT INTO events (id, title, event_date, location, capacity, origin_cloud)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [record.id, record.title, record.event_date, record.location, record.capacity, record.origin_cloud || 'azure']
  );
}

async function replicateBooking(record) {
  const db = getPool();
  await db.query(
    `INSERT INTO bookings (id, event_id, attendee_name, attendee_email, created_at, origin_cloud)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [
      record.id,
      record.event_id,
      record.attendee_name,
      record.attendee_email,
      record.created_at,
      record.origin_cloud || 'azure',
    ]
  );
}

async function listEvents() {
  const db = getPool();
  const result = await db.query(
    `SELECT id, title, event_date, location, capacity, origin_cloud
     FROM events
     ORDER BY event_date ASC`
  );
  return result.rows;
}

async function createUser({ name, email, passwordHash }) {
  const id = crypto.randomUUID();
  const db = getPool();
  const result = await db.query(
    `INSERT INTO users (id, name, email, password_hash, origin_cloud)
     VALUES ($1, $2, $3, $4, 'aws')
     RETURNING id, name, email, created_at, origin_cloud`,
    [id, name, email, passwordHash]
  );
  const record = result.rows[0];

  await replicateToAzure('/replicate/users', { ...record, password_hash: passwordHash });

  return record;
}

async function findUserByEmail(email) {
  const db = getPool();
  const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] || null;
}

async function findUserById(id) {
  const db = getPool();
  const result = await db.query(
    'SELECT id, name, email, created_at, origin_cloud FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

// upsert, not skip-if-exists - needs to handle a password/reset-token
// update arriving from the other cloud too, not just brand new users
async function replicateUser(record) {
  const db = getPool();
  await db.query(
    `INSERT INTO users (id, name, email, password_hash, reset_token, reset_token_expires, origin_cloud)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       reset_token = EXCLUDED.reset_token,
       reset_token_expires = EXCLUDED.reset_token_expires`,
    [
      record.id,
      record.name,
      record.email,
      record.password_hash,
      record.reset_token || null,
      record.reset_token_expires || null,
      record.origin_cloud || 'azure',
    ]
  );
}

async function requestPasswordReset(email) {
  const db = getPool();
  const user = await findUserByEmail(email);
  if (!user) return; // don't reveal whether the email exists

  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000);

  await db.query('UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3', [
    token,
    expires,
    user.id,
  ]);

  await replicateToAzure('/replicate/users', {
    ...user,
    reset_token: token,
    reset_token_expires: expires,
  });

  await createNotification({
    recipientEmail: email,
    subject: 'Password reset requested',
    body: `Use this code to reset your password: ${token}. It expires in 1 hour. If you didn't request this, you can ignore this message.`,
    relatedBookingId: null,
  });
}

// newPasswordHash comes in pre-hashed from the handler
async function resetPassword({ email, code, newPasswordHash }) {
  const db = getPool();
  const user = await findUserByEmail(email);
  if (!user || !user.reset_token || user.reset_token !== code) {
    return false;
  }
  if (!user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
    return false;
  }

  await db.query(
    'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
    [newPasswordHash, user.id]
  );

  await replicateToAzure('/replicate/users', {
    ...user,
    password_hash: newPasswordHash,
    reset_token: null,
    reset_token_expires: null,
  });

  return true;
}

// card ending in 0000 = declined, anything else = success (like Stripe test cards)
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

module.exports = {
  createEvent,
  createBooking,
  replicateEvent,
  replicateBooking,
  listEvents,
  createUser,
  findUserByEmail,
  findUserById,
  replicateUser,
  requestPasswordReset,
  resetPassword,
  createPayment,
  replicatePayment,
  createNotification,
  listNotifications,
};
