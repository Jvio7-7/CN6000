const { app } = require('@azure/functions');
const { replicateBooking } = require('../db');

app.http('replicateBooking', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'replicate/bookings',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      await replicateBooking(body);
      return { status: 200, jsonBody: { status: 'replicated' } };
    } catch (err) {
      context.error('Failed to replicate booking:', err);
      return { status: 500, jsonBody: { error: 'Replication failed' } };
    }
  },
});
