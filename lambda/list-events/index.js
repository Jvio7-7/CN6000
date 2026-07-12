const { listEvents } = require('/opt/nodejs/db');

exports.handler = async () => {
  try {
    const events = await listEvents();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(events),
    };
  } catch (err) {
    console.error('Failed to list events:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to list events' }),
    };
  }
};
