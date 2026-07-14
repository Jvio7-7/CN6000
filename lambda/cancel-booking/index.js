const { cancelBooking } = require('/opt/nodejs/db');
const { verifyToken } = require('/opt/nodejs/auth');

exports.handler = async (event) => {
  try {
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    const payload = verifyToken(authHeader);
    if (!payload) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Missing or invalid token' }) };
    }

    const bookingId = event.pathParameters?.id;
    if (!bookingId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing booking id' }) };
    }

    const cancelled = await cancelBooking(bookingId, payload.sub);
    if (!cancelled) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Booking not found, already cancelled, or not yours' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cancelled),
    };
  } catch (err) {
    console.error('Failed to cancel booking:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to cancel booking' }),
    };
  }
};
