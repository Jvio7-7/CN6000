const { resetPassword } = require('/opt/nodejs/db');
const { hashPassword } = require('/opt/nodejs/auth');

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { email, code, newPassword } = body;

    if (!email || !code || !newPassword) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'email, code, and newPassword are all required' }),
      };
    }
    if (newPassword.length < 8) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'password must be at least 8 characters' }),
      };
    }

    const newPasswordHash = await hashPassword(newPassword);
    const ok = await resetPassword({ email, code, newPasswordHash });

    if (!ok) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'That code is invalid or has expired' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Password updated' }),
    };
  } catch (err) {
    console.error('Failed to reset password:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Something went wrong' }),
    };
  }
};
