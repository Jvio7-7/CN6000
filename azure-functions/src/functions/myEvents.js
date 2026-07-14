const { app } = require('@azure/functions');
const { listMyEvents } = require('../db');
const { verifyToken } = require('../auth');

app.http('myEvents', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'users/me/events',
  handler: async (request, context) => {
    try {
      const payload = verifyToken(request.headers.get('authorization'));
      if (!payload) {
        return { status: 401, jsonBody: { error: 'Missing or invalid token' } };
      }

      const events = await listMyEvents(payload.sub);
      return { status: 200, jsonBody: events };
    } catch (err) {
      context.error('Failed to list my events:', err);
      return { status: 500, jsonBody: { error: 'Failed to list events' } };
    }
  },
});
