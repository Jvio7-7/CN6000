const { app } = require('@azure/functions');
const { updateProfile } = require('../db');
const { verifyToken } = require('../auth');

app.http('updateProfile', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'users/me',
  handler: async (request, context) => {
    try {
      const payload = verifyToken(request.headers.get('authorization'));
      if (!payload) {
        return { status: 401, jsonBody: { error: 'Missing or invalid token' } };
      }

      const body = await request.json();
      const { name } = body;
      if (!name || !name.trim()) {
        return { status: 400, jsonBody: { error: 'name is required' } };
      }

      const updated = await updateProfile(payload.sub, { name: name.trim() });
      if (!updated) {
        return { status: 404, jsonBody: { error: 'User not found' } };
      }

      return { status: 200, jsonBody: updated };
    } catch (err) {
      context.error('Failed to update profile:', err);
      return { status: 500, jsonBody: { error: 'Failed to update profile' } };
    }
  },
});
