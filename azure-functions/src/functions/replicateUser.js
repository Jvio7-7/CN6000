const { app } = require('@azure/functions');
const { replicateUser } = require('../db');
const { checkReplicationKey } = require('../auth');

app.http('replicateUserFn', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'replicate/users',
  handler: async (request, context) => {
    try {
      if (!checkReplicationKey(request)) {
        return { status: 401, jsonBody: { error: 'Unauthorized' } };
      }

      const body = await request.json();
      await replicateUser(body);
      return { status: 200, jsonBody: { status: 'replicated' } };
    } catch (err) {
      context.error('Failed to replicate user:', err);
      return { status: 500, jsonBody: { error: 'Replication failed' } };
    }
  },
});
