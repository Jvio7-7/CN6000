const { replicateEvent } = require('/opt/nodejs/db');

// Receives a full event record (with ID already assigned by Azure) and
// writes it locally. Never calls replicateToAzure again - replication is
// one-hop, not a ping-pong loop.
exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    await replicateEvent(body);
    return { statusCode: 200, body: JSON.stringify({ status: 'replicated' }) };
  } catch (err) {
    console.error('Failed to replicate event:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Replication failed' }) };
  }
};
