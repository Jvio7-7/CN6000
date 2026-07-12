const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// JWT_SECRET must be identical on both AWS and Azure - it's what lets a
// token issued by one cloud be validated by the other. This is what makes
// sessions survive Route 53 sending a user's next request to a different
// cloud than the one that logged them in.
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

// Returns the decoded payload, or null if the token is missing/invalid/expired.
// Never throws - callers just check for null and respond 401.
function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
