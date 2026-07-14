const { app } = require('@azure/functions');
const { getSecurityQuestion } = require('../db');

// deliberately DOES reveal whether the email is registered - see
// lambda/forgot-password/index.js
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

      const question = await getSecurityQuestion(email);
      if (!question) {
        return { status: 404, jsonBody: { error: 'No account found with that email' } };
      }

      return { status: 200, jsonBody: { question } };
    } catch (err) {
      context.error('Failed to look up security question:', err);
      return { status: 500, jsonBody: { error: 'Something went wrong' } };
    }
  },
});
