const { app } = require('@azure/functions');
const { requestPasswordReset } = require('../db');

app.http('forgotPassword', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'users/forgot-password',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const { email } = body;

      if (!email) {
        return { status: 400, jsonBody: { error: 'email is required' } };
      }

      await requestPasswordReset(email);

      return {
        status: 200,
        jsonBody: { message: 'If an account exists for that email, a reset code has been sent.' },
      };
    } catch (err) {
      context.error('Failed to process password reset request:', err);
      return { status: 500, jsonBody: { error: 'Something went wrong' } };
    }
  },
});
