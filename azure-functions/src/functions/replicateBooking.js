const { app } = require('@azure/functions');
const { replicateBooking } = require('../db');
const { checkReplicationKey } = require('../auth');

app.http('replicateBooking', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'replicate/bookings',
  handler: async (request, context) => {
    try {
      if (!checkReplicationKey(request)) {
        return { status: 401, jsonBody: { error: 'Unauthorized' } };
      }

      const body = await request.json();
      await replicateBooking(body);
      return { status: 200, jsonBody: { status: 'replicated' } };
    } catch (err) {
      context.error('Failed to replicate booking:', err);
      return { status: 500, jsonBody: { error: 'Replication failed' } };
    }
  },
});
