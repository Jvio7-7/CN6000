const { app } = require('@azure/functions');
const { cancelEvent } = require('../db');
const { verifyToken } = require('../auth');

app.http('cancelEvent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'events/{id}/cancel',
  handler: async (request, context) => {
    try {
      const payload = verifyToken(request.headers.get('authorization'));
      if (!payload) {
        return { status: 401, jsonBody: { error: 'Missing or invalid token' } };
      }

      const eventId = request.params.id;
      const cancelled = await cancelEvent(eventId, payload.sub);
      if (!cancelled) {
        return {
          status: 404,
          jsonBody: { error: 'Event not found, already cancelled, or not yours' },
        };
      }

      return { status: 200, jsonBody: cancelled };
    } catch (err) {
      context.error('Failed to cancel event:', err);
      return { status: 500, jsonBody: { error: 'Failed to cancel event' } };
    }
  },
});
