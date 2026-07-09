const { Pool } = require('pg');

// Lambda functions only ever talk to AWS RDS PostgreSQL, so this is
// simpler than the dual-driver lib/db.ts used by the local Next.js app.
let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Lambda executions are short-lived; keep the pool small so we
      // don't exhaust RDS connections across concurrent invocations.
      max: 2,
      // RDS PostgreSQL requires encrypted connections by default.
      // rejectUnauthorized:false skips CA verification, which is fine
      // for a coursework deployment but would use the RDS CA bundle
      // in a production setup.
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

async function createEvent({ title, date, location, capacity }) {
  const db = getPool();
  const result = await db.query(
    `INSERT INTO events (title, event_date, location, capacity)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, event_date, location, capacity`,
    [title, date, location, capacity]
  );
  return result.rows[0];
}

async function createBooking({ eventId, attendeeName, attendeeEmail }) {
  const db = getPool();
  const result = await db.query(
    `INSERT INTO bookings (event_id, attendee_name, attendee_email)
     VALUES ($1, $2, $3)
     RETURNING id, event_id, attendee_name, attendee_email, created_at`,
    [eventId, attendeeName, attendeeEmail]
  );
  return result.rows[0];
}

module.exports = { createEvent, createBooking };
