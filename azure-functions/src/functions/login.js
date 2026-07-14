const { app } = require('@azure/functions');
const { findUserByEmail } = require('../db');
const { verifyPassword, signToken } = require('../auth');

app.http('login', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'users/login',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const { email, password } = body;

      if (!email || !password) {
        return { status: 400, jsonBody: { error: 'email and password are both required' } };
      }

      const user = await findUserByEmail(email);
      if (!user) {
        return { status: 401, jsonBody: { error: 'Invalid email or password' } };
      }

      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        return { status: 401, jsonBody: { error: 'Invalid email or password' } };
      }

      const token = signToken(user);
      const { password_hash, security_answer_hash, ...safeUser } = user;

      return { status: 200, jsonBody: { user: safeUser, token } };
    } catch (err) {
      context.error('Failed to log in:', err);
      return { status: 500, jsonBody: { error: 'Failed to log in' } };
    }
  },
});
