const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// same secret on both clouds so a token works on either side
const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = '24h';

async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name }, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });
}

// returns null if token is missing/invalid/expired, never throws
function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// 12-24 chars, at least one uppercase, one lowercase, one digit, one
// special character. Used for register, reset-password, and
// change-password alike so the rule can't be bypassed via one of them.
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 24) {
    return 'Password must be 12-24 characters long';
  }
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must include a number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include a special character';
  return null; // null = valid
}

// Shared-secret check for the internal replication endpoints. These are
// published on the same public API Gateway as everything else, so without
// this any caller could write straight into the database.
function checkReplicationKey(event) {
  const expected = process.env.REPLICATION_SECRET;
  if (!expected) return false;
  const headers = event && event.headers ? event.headers : {};
  const supplied = headers['x-replication-key'] || headers['X-Replication-Key'];
  return supplied === expected;
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  validatePassword,
  checkReplicationKey,
};
