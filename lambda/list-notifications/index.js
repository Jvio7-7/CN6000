const { listNotifications } = require('/opt/nodejs/db');

exports.handler = async () => {
  try {
    const notifications = await listNotifications();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notifications),
    };
  } catch (err) {
    console.error('Failed to list notifications:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to list notifications' }),
    };
  }
};
