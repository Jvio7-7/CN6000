const { app } = require('@azure/functions');
const { findUserByEmail, resetPasswordWithAnswer } = require('../db');
const { hashPassword, verifyPassword, validatePassword } = require('../auth');

app.http('resetPassword', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'users/reset-password',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const { email, answer, newPassword } = body;

      if (!email || !answer || !newPassword) {
        return { status: 400, jsonBody: { error: 'email, answer, and newPassword are all required' } };
      }
      const passwordError = validatePassword(newPassword);
      if (passwordError) {
        return { status: 400, jsonBody: { error: passwordError } };
      }

      const user = await findUserByEmail(email);
      if (!user) {
        return { status: 404, jsonBody: { error: 'No account found with that email' } };
      }

      const normalisedAnswer = answer.trim().toLowerCase();
      const answerCorrect = await verifyPassword(normalisedAnswer, user.security_answer_hash);
      if (!answerCorrect) {
        return { status: 400, jsonBody: { error: 'That answer doesn\u2019t match' } };
      }

      const newPasswordHash = await hashPassword(newPassword);
      await resetPasswordWithAnswer({ email, newPasswordHash });

      return { status: 200, jsonBody: { message: 'Password updated' } };
    } catch (err) {
      context.error('Failed to reset password:', err);
      return { status: 500, jsonBody: { error: 'Something went wrong' } };
    }
  },
});
