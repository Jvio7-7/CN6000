const { listMyBookings } = require('/opt/nodejs/db');
const { verifyToken } = require('/opt/nodejs/auth');

exports.handler = async (event) => {
  try {
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    const payload = verifyToken(authHeader);
    if (!payload) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Missing or invalid token' }) };
    }

    const bookings = await listMyBookings(payload.sub);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookings),
    };
  } catch (err) {
    console.error('Failed to list my bookings:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to list bookings' }),
    };
  }
};
