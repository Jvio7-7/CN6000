const { createBooking } = require('/opt/nodejs/db');

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { eventId, attendeeName, attendeeEmail } = body;

    if (!eventId || !attendeeName || !attendeeEmail) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'eventId, attendeeName, and attendeeEmail are all required',
        }),
      };
    }

    const created = await createBooking({ eventId, attendeeName, attendeeEmail });

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(created),
    };
  } catch (err) {
    console.error('Failed to create booking:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to create booking' }),
    };
  }
};
