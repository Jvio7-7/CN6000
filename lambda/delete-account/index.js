const { deleteAccount } = require('/opt/nodejs/db');
const { verifyToken } = require('/opt/nodejs/auth');

// Deletes the caller's own account. Requires a valid token; a user can only
// delete themselves (the id comes from the token, not the request body).
exports.handler = async (event) => {
  try {
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    const payload = verifyToken(authHeader);
    if (!payload) {
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing or invalid token' }),
      };
    }

    const ok = await deleteAccount(payload.sub);
    if (!ok) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Account not found or already deleted' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'deleted' }),
    };
  } catch (err) {
    console.error('Failed to delete account:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to delete account' }),
    };
  }
};
