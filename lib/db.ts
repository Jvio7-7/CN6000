import { Pool } from 'pg';
import sql from 'mssql';

// DB_TYPE controls which cloud's database this instance talks to.
// "postgres" -> AWS RDS PostgreSQL (also used for local Docker testing)
// "mssql"    -> Azure SQL Database
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
  eventId: number;
  attendeeName: string;
  attendeeEmail: string;
}

export async function createEvent(data: EventInput) {
  if (DB_TYPE === 'mssql') {
    const pool = await getMssqlPool();
    const result = await pool
      .request()
      .input('title', sql.NVarChar, data.title)
      .input('eventDate', sql.DateTime, data.date)
      .input('location', sql.NVarChar, data.location)
      .input('capacity', sql.Int, data.capacity)
      .query(
        `INSERT INTO events (title, event_date, location, capacity)
         OUTPUT INSERTED.id, INSERTED.title, INSERTED.event_date, INSERTED.location, INSERTED.capacity
         VALUES (@title, @eventDate, @location, @capacity)`
      );
    return result.recordset[0];
  }

  const pool = getPgPool();
  const result = await pool.query(
    `INSERT INTO events (title, event_date, location, capacity)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, event_date, location, capacity`,
    [data.title, data.date, data.location, data.capacity]
  );
  return result.rows[0];
}

export async function createBooking(data: BookingInput) {
  if (DB_TYPE === 'mssql') {
    const pool = await getMssqlPool();
    const result = await pool
      .request()
      .input('eventId', sql.Int, data.eventId)
      .input('attendeeName', sql.NVarChar, data.attendeeName)
      .input('attendeeEmail', sql.NVarChar, data.attendeeEmail)
      .query(
        `INSERT INTO bookings (event_id, attendee_name, attendee_email)
         OUTPUT INSERTED.id, INSERTED.event_id, INSERTED.attendee_name, INSERTED.attendee_email, INSERTED.created_at
         VALUES (@eventId, @attendeeName, @attendeeEmail)`
      );
    return result.recordset[0];
  }

  const pool = getPgPool();
  const result = await pool.query(
    `INSERT INTO bookings (event_id, attendee_name, attendee_email)
     VALUES ($1, $2, $3)
     RETURNING id, event_id, attendee_name, attendee_email, created_at`,
    [data.eventId, data.attendeeName, data.attendeeEmail]
  );
  return result.rows[0];
}
