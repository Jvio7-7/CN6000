const { app } = require('@azure/functions');
const { createEvent } = require('../db');

app.http('createEvent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'events',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const { title, date, location, capacity } = body;

      if (!title || !date || !location || capacity === undefined) {
        return {
          status: 400,
          jsonBody: { error: 'title, date, location, and capacity are all required' },
        };
      }

      const created = await createEvent({ title, date, location, capacity });
      return { status: 201, jsonBody: created };
    } catch (err) {
      context.error('Failed to create event:', err);
      return { status: 500, jsonBody: { error: 'Failed to create event' } };
    }
  },
});
