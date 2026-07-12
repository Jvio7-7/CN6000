const { createUser, findUserByEmail } = require('/opt/nodejs/db');
const { hashPassword, signToken } = require('/opt/nodejs/auth');

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { name, email, password } = body;

    if (!name || !email || !password) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'name, email, and password are all required' }),
      };
    }
    if (password.length < 8) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'password must be at least 8 characters' }),
      };
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return {
        statusCode: 409,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'An account with that email already exists' }),
      };
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser({ name, email, passwordHash });
    const token = signToken(user);

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, token }),
    };
  } catch (err) {
    console.error('Failed to register user:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to register user' }),
    };
  }
};
