const { app } = require('@azure/functions');
const { reconcileToPeer } = require('../db');

// pushes all local rows to the other cloud to fill in whatever it missed
// while it was down. fine to run any time. returns the row counts sent.
app.http('reconcile', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'replicate/reconcile',
  handler: async (request, context) => {
    try {
      const result = await reconcileToPeer();
      return { status: 200, jsonBody: { status: 'reconciled', synced: result } };
    } catch (err) {
      context.error('Reconcile failed:', err);
      return { status: 500, jsonBody: { error: 'Reconcile failed' } };
    }
  },
});
