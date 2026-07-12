const { app } = require('@azure/functions');
const { createUser, findUserByEmail } = require('../db');
const { hashPassword, signToken } = require('../auth');

app.http('register', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'users/register',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const { name, email, password } = body;

      if (!name || !email || !password) {
        return { status: 400, jsonBody: { error: 'name, email, and password are all required' } };
      }
      if (password.length < 8) {
        return { status: 400, jsonBody: { error: 'password must be at least 8 characters' } };
      }

      const existing = await findUserByEmail(email);
      if (existing) {
        return { status: 409, jsonBody: { error: 'An account with that email already exists' } };
      }

      const passwordHash = await hashPassword(password);
      const user = await createUser({ name, email, passwordHash });
      const token = signToken(user);

      return { status: 201, jsonBody: { user, token } };
    } catch (err) {
      context.error('Failed to register user:', err);
      return { status: 500, jsonBody: { error: 'Failed to register user' } };
    }
  },
});
