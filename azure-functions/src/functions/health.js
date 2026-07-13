const { app } = require('@azure/functions');
const sql = require('mssql');

// mirrors the lambda health check, actually hits the db
let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect({
      server: process.env.DB_SERVER,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      options: { encrypt: true, trustServerCertificate: false },
      connectionTimeout: 3000,
      pool: { max: 1 },
    });
  }
  return poolPromise;
}

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (request, context) => {
    try {
      const pool = await getPool();
      await pool.request().query('SELECT 1 AS ok');
      return { status: 200, jsonBody: { status: 'ok', cloud: 'azure' } };
    } catch (err) {
      context.error('Health check failed:', err);
      return { status: 503, jsonBody: { status: 'unhealthy', cloud: 'azure' } };
    }
  },
});
