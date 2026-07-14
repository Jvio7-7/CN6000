const { createEvent, ValidationError } = require('/opt/nodejs/db');
const { verifyToken } = require('/opt/nodejs/auth');

exports.handler = async (event) => {
  try {
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    const payload = verifyToken(authHeader);
    if (!payload) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Log in to host an event' }),
      };
    }

    const body = JSON.parse(event.body || '{}');
    const { title, date, location, capacity, price } = body;

    if (!title || !date || !location || capacity === undefined) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'title, date, location, and capacity are all required',
        }),
      };
    }

    const created = await createEvent({
      userId: payload.sub,
      title,
      date,
      location,
      capacity,
      price,
    });

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(created),
    };
  } catch (err) {
    if (err instanceof ValidationError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message }),
      };
    }
    console.error('Failed to create event:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to create event' }),
    };
  }
};
