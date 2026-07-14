const { cancelEvent } = require('/opt/nodejs/db');
const { verifyToken } = require('/opt/nodejs/auth');

exports.handler = async (event) => {
  try {
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    const payload = verifyToken(authHeader);
    if (!payload) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Missing or invalid token' }) };
    }

    const eventId = event.pathParameters?.id;
    if (!eventId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing event id' }) };
    }

    const cancelled = await cancelEvent(eventId, payload.sub);
    if (!cancelled) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Event not found, already cancelled, or not yours' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cancelled),
    };
  } catch (err) {
    console.error('Failed to cancel event:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to cancel event' }),
    };
  }
};
