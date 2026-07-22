const { app } = require('@azure/functions');
const { deleteAccount } = require('../db');
const { verifyToken } = require('../auth');

// Deletes the caller's own account. The id comes from the token, so a user
// can only delete themselves. Mirrors the AWS delete-account Lambda.
app.http('deleteAccount', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'users/me',
  handler: async (request, context) => {
    try {
      const authHeader = request.headers.get('authorization');
      const payload = verifyToken(authHeader);
      if (!payload) {
        return { status: 401, jsonBody: { error: 'Missing or invalid token' } };
      }

      const ok = await deleteAccount(payload.sub);
      if (!ok) {
        return { status: 404, jsonBody: { error: 'Account not found or already deleted' } };
      }

      return { status: 200, jsonBody: { status: 'deleted' } };
    } catch (err) {
      context.error('Failed to delete account:', err);
      return { status: 500, jsonBody: { error: 'Failed to delete account' } };
    }
  },
});
