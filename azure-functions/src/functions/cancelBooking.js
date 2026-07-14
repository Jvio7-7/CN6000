const { app } = require('@azure/functions');
const { cancelBooking } = require('../db');
const { verifyToken } = require('../auth');

app.http('cancelBooking', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'bookings/{id}/cancel',
  handler: async (request, context) => {
    try {
      const payload = verifyToken(request.headers.get('authorization'));
      if (!payload) {
        return { status: 401, jsonBody: { error: 'Missing or invalid token' } };
      }

      const bookingId = request.params.id;
      const cancelled = await cancelBooking(bookingId, payload.sub);
      if (!cancelled) {
        return {
          status: 404,
          jsonBody: { error: 'Booking not found, already cancelled, or not yours' },
        };
      }

      return { status: 200, jsonBody: cancelled };
    } catch (err) {
      context.error('Failed to cancel booking:', err);
      return { status: 500, jsonBody: { error: 'Failed to cancel booking' } };
    }
  },
});
