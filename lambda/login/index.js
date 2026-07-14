const { findUserByEmail } = require('/opt/nodejs/db');
const { verifyPassword, signToken } = require('/opt/nodejs/auth');

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { email, password } = body;

    if (!email || !password) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'email and password are both required' }),
      };
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid email or password' }),
      };
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid email or password' }),
      };
    }

    const token = signToken(user);
    const { password_hash, security_answer_hash, ...safeUser } = user;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: safeUser, token }),
    };
  } catch (err) {
    console.error('Failed to log in:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to log in' }),
    };
  }
};
