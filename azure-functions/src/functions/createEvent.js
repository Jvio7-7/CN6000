const { app } = require('@azure/functions');
const { createEvent, ValidationError } = require('../db');
const { verifyToken } = require('../auth');

app.http('createEvent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'events',
  handler: async (request, context) => {
    try {
      const payload = verifyToken(request.headers.get('authorization'));
      if (!payload) {
        return { status: 401, jsonBody: { error: 'Log in to host an event' } };
      }

      const body = await request.json();
      const { title, date, location, capacity, price } = body;

      if (!title || !date || !location || capacity === undefined) {
        return {
          status: 400,
          jsonBody: { error: 'title, date, location, and capacity are all required' },
        };
      }

      const created = await createEvent({
        userId: payload.sub,
        title,
        date,
        location,
        capacity,
        price,
      });
      return { status: 201, jsonBody: created };
    } catch (err) {
      if (err instanceof ValidationError) {
        return { status: 400, jsonBody: { error: err.message } };
      }
      context.error('Failed to create event:', err);
      return { status: 500, jsonBody: { error: 'Failed to create event' } };
    }
  },
});
