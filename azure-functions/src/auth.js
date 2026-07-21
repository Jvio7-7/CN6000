const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// must match the AWS side exactly
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

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

// mirrors lambda/layer/nodejs/auth.js exactly
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 24) {
    return 'Password must be 12-24 characters long';
  }
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must include a number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include a special character';
  return null;
}

// Shared-secret check for the internal replication endpoints. Azure Functions
// v4 exposes headers as a Headers object, hence .get() rather than indexing.
function checkReplicationKey(request) {
  const expected = process.env.REPLICATION_SECRET;
  if (!expected) return false;
  return request.headers.get('x-replication-key') === expected;
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  validatePassword,
  checkReplicationKey,
};
