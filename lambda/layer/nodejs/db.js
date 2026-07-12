const { Pool } = require('pg');
const crypto = require('crypto');

// AWS side of the active-active replication. Every write:
//  1. Generates a UUID (shared with the replica, not DB-generated)
//  2. Writes locally to RDS
//  3. Replicates to Azure's matching endpoint, AWAITED with a bounded timeout
//
// IMPORTANT: step 3 is awaited, not fire-and-forget. Lambda freezes its
// execution environment the instant the handler returns a response - any
// async work still in flight at that point (like an un-awaited fetch())
// gets frozen mid-request and may never complete. So "best effort, don't
// block the user" is implemented as "always await it, but bound how long
// with a timeout, and never let a replication failure fail the overall
// request" - not as true background/detached work, which Lambda doesn't
// support. This does mean replication latency is included in the API's
// measured response time, which is worth noting directly in the
// latency/RPO sections of the report as a real design tradeoff.

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

const AZURE_BASE_URL = process.env.AZURE_BASE_URL; // e.g. https://eventapp-func-zhw36q.azurewebsites.net/api
const REPLICATION_TIMEOUT_MS = 3000;

async function replicateToAzure(path, payload) {
  if (!AZURE_BASE_URL) return; // replication not configured, skip silently
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
      console.error(`Replication to Azure failed: ${path} returned ${res.status}`);
    } else {
      console.log(`Replication to Azure succeeded: ${path}`);
    }
  } catch (err) {
    console.error(`Replication to Azure failed: ${path}`, err.message);
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

  return record;
}

// Called when AZURE replicates a write TO this side. Uses ON CONFLICT DO
// NOTHING so replaying the same record twice (e.g. a retried request)
// doesn't error - replication should be idempotent.
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

module.exports = { createEvent, createBooking, replicateEvent, replicateBooking };
