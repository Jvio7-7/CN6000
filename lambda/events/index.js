const { createEvent } = require('/opt/nodejs/db');

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { title, date, location, capacity } = body;

    if (!title || !date || !location || capacity === undefined) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'title, date, location, and capacity are all required',
        }),
      };
    }

    const created = await createEvent({ title, date, location, capacity });

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(created),
    };
  } catch (err) {
    console.error('Failed to create event:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to create event' }),
    };
  }
};
