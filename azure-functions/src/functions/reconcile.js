const { app } = require('@azure/functions');
const { reconcileToPeer } = require('../db');
const { checkReplicationKey } = require('../auth');

app.http('reconcile', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'replicate/reconcile',
  handler: async (request, context) => {
    try {
      if (!checkReplicationKey(request)) {
        return { status: 401, jsonBody: { error: 'Unauthorized' } };
      }

      const result = await reconcileToPeer();
      return { status: 200, jsonBody: { status: 'reconciled', synced: result } };
    } catch (err) {
      context.error('Reconcile failed:', err);
      return { status: 500, jsonBody: { error: 'Reconcile failed' } };
    }
  },
});
