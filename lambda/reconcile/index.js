const { reconcileToPeer } = require('/opt/nodejs/db');
const { checkReplicationKey } = require('/opt/nodejs/auth');

// pushes all local rows to the other cloud to fill in whatever it missed
// while it was down. fine to run any time. returns the row counts sent.
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
