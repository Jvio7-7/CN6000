const { Pool } = require('pg');

// actually queries the db, not just "is lambda warm" - matters for
// the failover test since RDS could be down while lambda itself is fine
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
