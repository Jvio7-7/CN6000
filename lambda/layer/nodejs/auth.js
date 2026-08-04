const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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

// Guards the internal /replicate/* endpoints, which sit on the same public
// API Gateway as everything else. Hashing both sides first fixes their
// length, so timingSafeEqual can't throw and the timing gives nothing away.
function secretsMatch(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string') return false;
  const a = crypto.createHash('sha256').update(supplied).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function checkReplicationKey(event) {
  const expected = process.env.REPLICATION_SECRET;
  if (!expected) return false;
  const headers = event && event.headers ? event.headers : {};
  const supplied = headers['x-replication-key'] || headers['X-Replication-Key'];
  return secretsMatch(supplied, expected);
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  validatePassword,
  checkReplicationKey,
};
