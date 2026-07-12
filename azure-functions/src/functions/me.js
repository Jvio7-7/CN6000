const { app } = require('@azure/functions');
const { findUserById } = require('../db');
const { verifyToken } = require('../auth');

app.http('me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'users/me',
  handler: async (request, context) => {
    try {
      const authHeader = request.headers.get('authorization');
      const payload = verifyToken(authHeader);

      if (!payload) {
        return { status: 401, jsonBody: { error: 'Missing or invalid token' } };
      }

      const user = await findUserById(payload.sub);
      if (!user) {
        return { status: 404, jsonBody: { error: 'User not found' } };
      }

      return { status: 200, jsonBody: user };
    } catch (err) {
      context.error('Failed to fetch current user:', err);
      return { status: 500, jsonBody: { error: 'Failed to fetch current user' } };
    }
  },
});
