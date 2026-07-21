const { reconcileToPeer } = require('/opt/nodejs/db');

// pushes all local rows to the other cloud to fill in whatever it missed
// while it was down. fine to run any time. returns the row counts sent.
exports.handler = async () => {
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
