const sql = require('mssql');
const crypto = require('crypto');

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

const AWS_BASE_URL = process.env.AWS_BASE_URL; // e.g. https://l30myjhqlk.execute-api.ap-southeast-1.amazonaws.com
const REPLICATION_TIMEOUT_MS = 3000;

async function replicateToAws(path, payload) {
  if (!AWS_BASE_URL) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REPLICATION_TIMEOUT_MS);
    const res = await fetch(`${AWS_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

async function createEvent({ title, date, location, capacity }) {
  const id = crypto.randomUUID();
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .input('title', sql.NVarChar, title)
    .input('eventDate', sql.DateTime, date)
    .input('location', sql.NVarChar, location)
    .input('capacity', sql.Int, capacity)
    .query(
      `INSERT INTO events (id, title, event_date, location, capacity, origin_cloud)
       OUTPUT INSERTED.id, INSERTED.title, INSERTED.event_date, INSERTED.location, INSERTED.capacity, INSERTED.origin_cloud
       VALUES (@id, @title, @eventDate, @location, @capacity, 'azure')`
    );
  const record = result.recordset[0];

  await replicateToAws('/replicate/events', record);

  return record;
}

async function createBooking({ eventId, attendeeName, attendeeEmail }) {
  const id = crypto.randomUUID();
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .input('eventId', sql.UniqueIdentifier, eventId)
    .input('attendeeName', sql.NVarChar, attendeeName)
    .input('attendeeEmail', sql.NVarChar, attendeeEmail)
    .query(
      `INSERT INTO bookings (id, event_id, attendee_name, attendee_email, origin_cloud)
       OUTPUT INSERTED.id, INSERTED.event_id, INSERTED.attendee_name, INSERTED.attendee_email, INSERTED.created_at, INSERTED.origin_cloud
       VALUES (@id, @eventId, @attendeeName, @attendeeEmail, 'azure')`
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

// SQL Server has no ON CONFLICT, so check first then insert
async function replicateEvent(record) {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input('id', sql.UniqueIdentifier, record.id)
    .query('SELECT id FROM events WHERE id = @id');
  if (existing.recordset.length > 0) return;

  await pool
    .request()
    .input('id', sql.UniqueIdentifier, record.id)
    .input('title', sql.NVarChar, record.title)
    .input('eventDate', sql.DateTime, record.event_date)
    .input('location', sql.NVarChar, record.location)
    .input('capacity', sql.Int, record.capacity)
    .input('originCloud', sql.NVarChar, record.origin_cloud || 'aws')
    .query(
      `INSERT INTO events (id, title, event_date, location, capacity, origin_cloud)
       VALUES (@id, @title, @eventDate, @location, @capacity, @originCloud)`
    );
}

async function replicateBooking(record) {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input('id', sql.UniqueIdentifier, record.id)
    .query('SELECT id FROM bookings WHERE id = @id');
  if (existing.recordset.length > 0) return;

  await pool
    .request()
    .input('id', sql.UniqueIdentifier, record.id)
    .input('eventId', sql.UniqueIdentifier, record.event_id)
    .input('attendeeName', sql.NVarChar, record.attendee_name)
    .input('attendeeEmail', sql.NVarChar, record.attendee_email)
    .input('createdAt', sql.DateTime, record.created_at)
    .input('originCloud', sql.NVarChar, record.origin_cloud || 'aws')
    .query(
      `INSERT INTO bookings (id, event_id, attendee_name, attendee_email, created_at, origin_cloud)
       VALUES (@id, @eventId, @attendeeName, @attendeeEmail, @createdAt, @originCloud)`
    );
}

async function listEvents() {
  const pool = await getPool();
  const result = await pool
    .request()
    .query(
      `SELECT id, title, event_date, location, capacity, origin_cloud
       FROM events
       ORDER BY event_date ASC`
    );
  return result.recordset;
}

async function createUser({ name, email, passwordHash }) {
  const id = crypto.randomUUID();
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .input('name', sql.NVarChar, name)
    .input('email', sql.NVarChar, email)
    .input('passwordHash', sql.NVarChar, passwordHash)
    .query(
      `INSERT INTO users (id, name, email, password_hash, origin_cloud)
       OUTPUT INSERTED.id, INSERTED.name, INSERTED.email, INSERTED.created_at, INSERTED.origin_cloud
       VALUES (@id, @name, @email, @passwordHash, 'azure')`
    );
  const record = result.recordset[0];

  await replicateToAws('/replicate/users', { ...record, password_hash: passwordHash });

  return record;
}

async function findUserByEmail(email) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('email', sql.NVarChar, email)
    .query('SELECT * FROM users WHERE email = @email');
  return result.recordset[0] || null;
}

async function findUserById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.UniqueIdentifier, id)
    .query('SELECT id, name, email, created_at, origin_cloud FROM users WHERE id = @id');
  return result.recordset[0] || null;
}

// upsert - could be a new user or a password/reset-token update
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
      .input('passwordHash', sql.NVarChar, record.password_hash)
      .input('resetToken', sql.NVarChar, record.reset_token || null)
      .input('resetTokenExpires', sql.DateTime, record.reset_token_expires || null)
      .query(
        `UPDATE users
         SET password_hash = @passwordHash, reset_token = @resetToken, reset_token_expires = @resetTokenExpires
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
    .input('resetToken', sql.NVarChar, record.reset_token || null)
    .input('resetTokenExpires', sql.DateTime, record.reset_token_expires || null)
    .input('originCloud', sql.NVarChar, record.origin_cloud || 'aws')
    .query(
      `INSERT INTO users (id, name, email, password_hash, reset_token, reset_token_expires, origin_cloud)
       VALUES (@id, @name, @email, @passwordHash, @resetToken, @resetTokenExpires, @originCloud)`
    );
}

async function requestPasswordReset(email) {
  const pool = await getPool();
  const user = await findUserByEmail(email);
  if (!user) return;

  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await pool
    .request()
    .input('id', sql.UniqueIdentifier, user.id)
    .input('resetToken', sql.NVarChar, token)
    .input('resetTokenExpires', sql.DateTime, expires)
    .query('UPDATE users SET reset_token = @resetToken, reset_token_expires = @resetTokenExpires WHERE id = @id');

  await replicateToAws('/replicate/users', {
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

async function resetPassword({ email, code, newPasswordHash }) {
  const pool = await getPool();
  const user = await findUserByEmail(email);
  if (!user || !user.reset_token || user.reset_token !== code) {
    return false;
  }
  if (!user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
    return false;
  }

  await pool
    .request()
    .input('id', sql.UniqueIdentifier, user.id)
    .input('passwordHash', sql.NVarChar, newPasswordHash)
    .query(
      'UPDATE users SET password_hash = @passwordHash, reset_token = NULL, reset_token_expires = NULL WHERE id = @id'
    );

  await replicateToAws('/replicate/users', {
    ...user,
    password_hash: newPasswordHash,
    reset_token: null,
    reset_token_expires: null,
  });

  return true;
}

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
