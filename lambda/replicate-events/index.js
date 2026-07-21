const { replicateEvent } = require('/opt/nodejs/db');
const { checkReplicationKey } = require('/opt/nodejs/auth');

// one hop only, doesn't replicate again (no ping-pong loop)
exports.handler = async (event) => {
  if (!checkReplicationKey(event)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    await replicateEvent(body);
    return { statusCode: 200, body: JSON.stringify({ status: 'replicated' }) };
  } catch (err) {
    console.error('Failed to replicate event:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Replication failed' }) };
  }
};
