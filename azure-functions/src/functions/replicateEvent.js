const { app } = require('@azure/functions');
const { replicateEvent } = require('../db');

app.http('replicateEvent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'replicate/events',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      await replicateEvent(body);
      return { status: 200, jsonBody: { status: 'replicated' } };
    } catch (err) {
      context.error('Failed to replicate event:', err);
      return { status: 500, jsonBody: { error: 'Replication failed' } };
    }
  },
});
