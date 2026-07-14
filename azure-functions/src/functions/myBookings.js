const { app } = require('@azure/functions');
const { listMyBookings } = require('../db');
const { verifyToken } = require('../auth');

app.http('myBookings', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'users/me/bookings',
  handler: async (request, context) => {
    try {
      const payload = verifyToken(request.headers.get('authorization'));
      if (!payload) {
        return { status: 401, jsonBody: { error: 'Missing or invalid token' } };
      }

      const bookings = await listMyBookings(payload.sub);
      return { status: 200, jsonBody: bookings };
    } catch (err) {
      context.error('Failed to list my bookings:', err);
      return { status: 500, jsonBody: { error: 'Failed to list bookings' } };
    }
  },
});
