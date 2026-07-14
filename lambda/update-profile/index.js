const { updateProfile } = require('/opt/nodejs/db');
const { verifyToken } = require('/opt/nodejs/auth');

exports.handler = async (event) => {
  try {
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    const payload = verifyToken(authHeader);
    if (!payload) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Missing or invalid token' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { name } = body;
    if (!name || !name.trim()) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'name is required' }),
      };
    }

    const updated = await updateProfile(payload.sub, { name: name.trim() });
    if (!updated) {
      return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    };
  } catch (err) {
    console.error('Failed to update profile:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to update profile' }),
    };
  }
};
