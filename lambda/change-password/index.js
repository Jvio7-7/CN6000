const { findUserByIdWithPassword, changePassword } = require('/opt/nodejs/db');
const { verifyToken, verifyPassword, hashPassword, validatePassword } = require('/opt/nodejs/auth');

exports.handler = async (event) => {
  try {
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    const payload = verifyToken(authHeader);
    if (!payload) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Missing or invalid token' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'currentPassword and newPassword are both required' }),
      };
    }
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: passwordError }),
      };
    }

    const user = await findUserByIdWithPassword(payload.sub);
    if (!user) {
      return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };
    }

    const valid = await verifyPassword(currentPassword, user.password_hash);
    if (!valid) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Current password is incorrect' }),
      };
    }

    const newPasswordHash = await hashPassword(newPassword);
    await changePassword(payload.sub, newPasswordHash);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Password updated' }),
    };
  } catch (err) {
    console.error('Failed to change password:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to change password' }),
    };
  }
};
