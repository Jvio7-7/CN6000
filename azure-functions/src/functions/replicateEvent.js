const { app } = require('@azure/functions');
const { replicateEvent } = require('../db');
const { checkReplicationKey } = require('../auth');

app.http('replicateEvent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'replicate/events',
  handler: async (request, context) => {
    try {
      if (!checkReplicationKey(request)) {
        return { status: 401, jsonBody: { error: 'Unauthorized' } };
      }

      const body = await request.json();
      await replicateEvent(body);
      return { status: 200, jsonBody: { status: 'replicated' } };
    } catch (err) {
      context.error('Failed to replicate event:', err);
      return { status: 500, jsonBody: { error: 'Replication failed' } };
    }
  },
});
