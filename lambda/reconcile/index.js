const { reconcileToPeer } = require('/opt/nodejs/db');
const { checkReplicationKey } = require('/opt/nodejs/auth');

exports.handler = async (event) => {
  if (!checkReplicationKey(event)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const result = await reconcileToPeer();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'reconciled', synced: result }),
    };
  } catch (err) {
    console.error('Reconcile failed:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Reconcile failed' }),
    };
  }
};
