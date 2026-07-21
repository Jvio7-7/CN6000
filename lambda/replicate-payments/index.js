const { replicatePayment } = require('/opt/nodejs/db');
const { checkReplicationKey } = require('/opt/nodejs/auth');

exports.handler = async (event) => {
  if (!checkReplicationKey(event)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    await replicatePayment(body);
    return { statusCode: 200, body: JSON.stringify({ status: 'replicated' }) };
  } catch (err) {
    console.error('Failed to replicate payment:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Replication failed' }) };
  }
};
