import { Pool } from 'pg';
import sql from 'mssql';
import { randomUUID } from 'crypto';

// DB_TYPE controls which cloud's database this instance talks to.
// "postgres" -> AWS RDS PostgreSQL (also used for local Docker testing)
// "mssql"    -> Azure SQL Database
//
// IDs are UUIDs, generated here rather than by the database, matching the
// Lambda and Azure Function code - this local dev app doesn't replicate
// anywhere, but keeping the ID strategy consistent across all three
// codebases avoids a schema mismatch (the shared schema files use UUID
// primary keys with no default, since Lambda/Functions need to know the
// ID before insert in order to replicate it to the other cloud).
const DB_TYPE = process.env.DB_TYPE || 'postgres';

let pgPool: Pool | null = null;
let mssqlPool: sql.ConnectionPool | null = null;

function getPgPool(): Pool {
  if (!pgPool) {
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pgPool;
}

async function getMssqlPool(): Promise<sql.ConnectionPool> {
  if (!mssqlPool) {
    mssqlPool = await sql.connect({
      server: process.env.DB_SERVER as string,
      database: process.env.DB_NAME as string,
      user: process.env.DB_USER as string,
      password: process.env.DB_PASSWORD as string,
      options: { encrypt: true, trustServerCertificate: false },
    });
  }
  return mssqlPool;
}

export interface EventInput {
  title: string;
  date: string;
  location: string;
  capacity: number;
}

export interface BookingInput {
  eventId: string;
  attendeeName: string;
  attendeeEmail: string;
}

export async function createEvent(data: EventInput) {
  const id = randomUUID();

  if (DB_TYPE === 'mssql') {
    const pool = await getMssqlPool();
    const result = await pool
      .request()
      .input('id', sql.UniqueIdentifier, id)
      .input('title', sql.NVarChar, data.title)
      .input('eventDate', sql.DateTime, data.date)
      .input('location', sql.NVarChar, data.location)
      .input('capacity', sql.Int, data.capacity)
      .query(
        `INSERT INTO events (id, title, event_date, location, capacity, origin_cloud)
         OUTPUT INSERTED.id, INSERTED.title, INSERTED.event_date, INSERTED.location, INSERTED.capacity
         VALUES (@id, @title, @eventDate, @location, @capacity, 'local')`
      );
    return result.recordset[0];
  }

  const pool = getPgPool();
  const result = await pool.query(
    `INSERT INTO events (id, title, event_date, location, capacity, origin_cloud)
     VALUES ($1, $2, $3, $4, $5, 'local')
     RETURNING id, title, event_date, location, capacity`,
    [id, data.title, data.date, data.location, data.capacity]
  );
  return result.rows[0];
}

export async function createBooking(data: BookingInput) {
  const id = randomUUID();

  if (DB_TYPE === 'mssql') {
    const pool = await getMssqlPool();
    const result = await pool
      .request()
      .input('id', sql.UniqueIdentifier, id)
      .input('eventId', sql.UniqueIdentifier, data.eventId)
      .input('attendeeName', sql.NVarChar, data.attendeeName)
      .input('attendeeEmail', sql.NVarChar, data.attendeeEmail)
      .query(
        `INSERT INTO bookings (id, event_id, attendee_name, attendee_email, origin_cloud)
         OUTPUT INSERTED.id, INSERTED.event_id, INSERTED.attendee_name, INSERTED.attendee_email, INSERTED.created_at
         VALUES (@id, @eventId, @attendeeName, @attendeeEmail, 'local')`
      );
    return result.recordset[0];
  }

  const pool = getPgPool();
  const result = await pool.query(
    `INSERT INTO bookings (id, event_id, attendee_name, attendee_email, origin_cloud)
     VALUES ($1, $2, $3, $4, 'local')
     RETURNING id, event_id, attendee_name, attendee_email, created_at`,
    [id, data.eventId, data.attendeeName, data.attendeeEmail]
  );
  return result.rows[0];
}

export async function listEvents() {
  if (DB_TYPE === 'mssql') {
    const pool = await getMssqlPool();
    const result = await pool
      .request()
      .query(
        `SELECT id, title, event_date, location, capacity
         FROM events
         ORDER BY event_date ASC`
      );
    return result.recordset;
  }

  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, title, event_date, location, capacity
     FROM events
     ORDER BY event_date ASC`
  );
  return result.rows;
}
