const sql = require('mssql');

// Azure Functions app only ever talks to Azure SQL Database, so this is
// the mssql-only counterpart to the Lambda side's pg-only db.js. Same
// two operations (createEvent, createBooking), same shape of return
// values, so the two clouds stay directly comparable in the experiments.
let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect({
      server: process.env.DB_SERVER,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      // Azure SQL Database requires encrypted connections.
      options: { encrypt: true, trustServerCertificate: false },
      pool: { max: 2 },
    });
  }
  return poolPromise;
}

async function createEvent({ title, date, location, capacity }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('title', sql.NVarChar, title)
    .input('eventDate', sql.DateTime, date)
    .input('location', sql.NVarChar, location)
    .input('capacity', sql.Int, capacity)
    .query(
      `INSERT INTO events (title, event_date, location, capacity)
       OUTPUT INSERTED.id, INSERTED.title, INSERTED.event_date, INSERTED.location, INSERTED.capacity
       VALUES (@title, @eventDate, @location, @capacity)`
    );
  return result.recordset[0];
}

async function createBooking({ eventId, attendeeName, attendeeEmail }) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('eventId', sql.Int, eventId)
    .input('attendeeName', sql.NVarChar, attendeeName)
    .input('attendeeEmail', sql.NVarChar, attendeeEmail)
    .query(
      `INSERT INTO bookings (event_id, attendee_name, attendee_email)
       OUTPUT INSERTED.id, INSERTED.event_id, INSERTED.attendee_name, INSERTED.attendee_email, INSERTED.created_at
       VALUES (@eventId, @attendeeName, @attendeeEmail)`
    );
  return result.recordset[0];
}

module.exports = { createEvent, createBooking };
