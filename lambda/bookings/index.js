const { createBooking, ValidationError } = require('/opt/nodejs/db');
const { verifyToken } = require('/opt/nodejs/auth');

exports.handler = async (event) => {
  try {
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    const payload = verifyToken(authHeader);
    if (!payload) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Log in to book a spot' }),
      };
    }

    const body = JSON.parse(event.body || '{}');
    const { eventId, attendeeName, attendeeEmail } = body;

    if (!eventId || !attendeeName || !attendeeEmail) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'eventId, attendeeName, and attendeeEmail are all required' }),
      };
    }

    const created = await createBooking({
      userId: payload.sub,
      eventId,
      attendeeName,
      attendeeEmail,
    });

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(created),
    };
  } catch (err) {
    if (err instanceof ValidationError) {
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message }),
      };
    }
    console.error('Failed to create booking:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to create booking' }),
    };
  }
};
