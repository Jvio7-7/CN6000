const { app } = require('@azure/functions');
const { createBooking } = require('../db');

app.http('bookEvent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'bookings',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const { eventId, attendeeName, attendeeEmail } = body;

      if (!eventId || !attendeeName || !attendeeEmail) {
        return {
          status: 400,
          jsonBody: { error: 'eventId, attendeeName, and attendeeEmail are all required' },
        };
      }

      const created = await createBooking({ eventId, attendeeName, attendeeEmail });
      return { status: 201, jsonBody: created };
    } catch (err) {
      context.error('Failed to create booking:', err);
      return { status: 500, jsonBody: { error: 'Failed to create booking' } };
    }
  },
});
