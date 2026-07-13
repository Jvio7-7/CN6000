const { app } = require('@azure/functions');
const { resetPassword } = require('../db');
const { hashPassword } = require('../auth');

app.http('resetPassword', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'users/reset-password',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const { email, code, newPassword } = body;

      if (!email || !code || !newPassword) {
        return { status: 400, jsonBody: { error: 'email, code, and newPassword are all required' } };
      }
      if (newPassword.length < 8) {
        return { status: 400, jsonBody: { error: 'password must be at least 8 characters' } };
      }

      const newPasswordHash = await hashPassword(newPassword);
      const ok = await resetPassword({ email, code, newPasswordHash });

      if (!ok) {
        return { status: 400, jsonBody: { error: 'That code is invalid or has expired' } };
      }

      return { status: 200, jsonBody: { message: 'Password updated' } };
    } catch (err) {
      context.error('Failed to reset password:', err);
      return { status: 500, jsonBody: { error: 'Something went wrong' } };
    }
  },
});
