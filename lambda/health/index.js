const { Pool } = require('pg');

// A lightweight health check that actually queries the database, not just
// "is the Lambda warm". This matters for the failover experiment: if RDS
// becomes unreachable but Lambda itself is fine, we still want Route 53
// to mark this endpoint unhealthy and redirect traffic to Azure.
let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 3000,
    });
  }
  return pool;
}

exports.handler = async () => {
  try {
    const db = getPool();
    await db.query('SELECT 1');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ok', cloud: 'aws' }),
    };
  } catch (err) {
    console.error('Health check failed:', err);
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'unhealthy', cloud: 'aws' }),
    };
  }
};
