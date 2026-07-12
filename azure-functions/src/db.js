const sql = require('mssql');
const crypto = require('crypto');

// Azure side of the active-active replication - mirrors lambda/layer/nodejs/db.js.
// Replication is awaited (not fire-and-forget) for the same reason as the
// Lambda side: serverless compute platforms generally don't guarantee that
// work continues after the response is sent, especially on a Consumption
// plan where the instance can be recycled. See db.js on the AWS side for
// the fuller explanation.

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
      console.error(`Replication to AWS failed: ${path} returned ${res.status}`);
    } else {
      console.log(`Replication to AWS succeeded: ${path}`);
    }
  } catch (err) {
    console.error(`Replication to AWS failed: ${path}`, err.message);
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

  return record;
}

// Idempotent insert for records replicated FROM AWS. SQL Server has no
// native "ON CONFLICT DO NOTHING" - the standard equivalent is checking
// existence first, or catching the primary-key-violation error. We do the
// existence check since it's clearer to read and this isn't a hot path.
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

async function replicateUser(record) {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input('id', sql.UniqueIdentifier, record.id)
    .query('SELECT id FROM users WHERE id = @id');
  if (existing.recordset.length > 0) return;

  await pool
    .request()
    .input('id', sql.UniqueIdentifier, record.id)
    .input('name', sql.NVarChar, record.name)
    .input('email', sql.NVarChar, record.email)
    .input('passwordHash', sql.NVarChar, record.password_hash)
    .input('originCloud', sql.NVarChar, record.origin_cloud || 'aws')
    .query(
      `INSERT INTO users (id, name, email, password_hash, origin_cloud)
       VALUES (@id, @name, @email, @passwordHash, @originCloud)`
    );
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
};
