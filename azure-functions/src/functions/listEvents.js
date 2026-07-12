const { app } = require('@azure/functions');
const { listEvents } = require('../db');

app.http('listEvents', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'events',
  handler: async (request, context) => {
    try {
      const events = await listEvents();
      return { status: 200, jsonBody: events };
    } catch (err) {
      context.error('Failed to list events:', err);
      return { status: 500, jsonBody: { error: 'Failed to list events' } };
    }
  },
});
