const { app } = require('@azure/functions');
const { findUserByIdWithPassword, changePassword } = require('../db');
const { verifyToken, verifyPassword, hashPassword, validatePassword } = require('../auth');

app.http('changePassword', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'users/change-password',
  handler: async (request, context) => {
    try {
      const payload = verifyToken(request.headers.get('authorization'));
      if (!payload) {
        return { status: 401, jsonBody: { error: 'Missing or invalid token' } };
      }

      const body = await request.json();
      const { currentPassword, newPassword } = body;
      if (!currentPassword || !newPassword) {
        return { status: 400, jsonBody: { error: 'currentPassword and newPassword are both required' } };
      }
      const passwordError = validatePassword(newPassword);
      if (passwordError) {
        return { status: 400, jsonBody: { error: passwordError } };
      }

      const user = await findUserByIdWithPassword(payload.sub);
      if (!user) {
        return { status: 404, jsonBody: { error: 'User not found' } };
      }

      const valid = await verifyPassword(currentPassword, user.password_hash);
      if (!valid) {
        return { status: 401, jsonBody: { error: 'Current password is incorrect' } };
      }

      const newPasswordHash = await hashPassword(newPassword);
      await changePassword(payload.sub, newPasswordHash);

      return { status: 200, jsonBody: { message: 'Password updated' } };
    } catch (err) {
      context.error('Failed to change password:', err);
      return { status: 500, jsonBody: { error: 'Failed to change password' } };
    }
  },
});
