const { app } = require('@azure/functions');
const { createUser, findUserByEmail } = require('../db');
const { hashPassword, validatePassword, signToken } = require('../auth');

// no email verification - see lambda/register/index.js
app.http('register', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'users/register',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const { name, email, password, securityQuestion, securityAnswer } = body;

      if (!name || !email || !password || !securityQuestion || !securityAnswer) {
        return {
          status: 400,
          jsonBody: {
            error: 'name, email, password, securityQuestion, and securityAnswer are all required',
          },
        };
      }
      const passwordError = validatePassword(password);
      if (passwordError) {
        return { status: 400, jsonBody: { error: passwordError } };
      }
      if (securityAnswer.trim().length < 2) {
        return { status: 400, jsonBody: { error: 'securityAnswer is too short' } };
      }

      const existing = await findUserByEmail(email);
      if (existing) {
        return { status: 409, jsonBody: { error: 'An account with that email already exists' } };
      }

      const passwordHash = await hashPassword(password);
      const securityAnswerHash = await hashPassword(securityAnswer.trim().toLowerCase());

      const user = await createUser({
        name,
        email,
        passwordHash,
        securityQuestion,
        securityAnswerHash,
      });
      const token = signToken(user);

      return { status: 201, jsonBody: { user, token } };
    } catch (err) {
      context.error('Failed to register user:', err);
      return { status: 500, jsonBody: { error: 'Failed to register user' } };
    }
  },
});
