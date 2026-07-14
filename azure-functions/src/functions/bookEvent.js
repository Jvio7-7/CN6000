const { app } = require('@azure/functions');
const { createBooking, ValidationError } = require('../db');
const { verifyToken } = require('../auth');

app.http('bookEvent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'bookings',
  handler: async (request, context) => {
    try {
      const payload = verifyToken(request.headers.get('authorization'));
      if (!payload) {
        return { status: 401, jsonBody: { error: 'Log in to book a spot' } };
      }

      const body = await request.json();
      const { eventId, attendeeName, attendeeEmail } = body;

      if (!eventId || !attendeeName || !attendeeEmail) {
        return {
          status: 400,
          jsonBody: { error: 'eventId, attendeeName, and attendeeEmail are all required' },
        };
      }

      const created = await createBooking({
        userId: payload.sub,
        eventId,
        attendeeName,
        attendeeEmail,
      });
      return { status: 201, jsonBody: created };
    } catch (err) {
      if (err instanceof ValidationError) {
        return { status: 409, jsonBody: { error: err.message } };
      }
      context.error('Failed to create booking:', err);
      return { status: 500, jsonBody: { error: 'Failed to create booking' } };
    }
  },
});
