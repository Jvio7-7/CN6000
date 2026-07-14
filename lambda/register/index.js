const { createUser, findUserByEmail } = require('/opt/nodejs/db');
const { hashPassword, validatePassword, signToken } = require('/opt/nodejs/auth');

// no email verification - account is usable immediately, same as
// signToken issuing a real session right away (see README for why
// email verification was tried and then removed)
exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { name, email, password, securityQuestion, securityAnswer } = body;

    if (!name || !email || !password || !securityQuestion || !securityAnswer) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'name, email, password, securityQuestion, and securityAnswer are all required',
        }),
      };
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: passwordError }),
      };
    }
    if (securityAnswer.trim().length < 2) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'securityAnswer is too short' }),
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
    // trimmed + lowercased before hashing so "Blue" and "blue " both
    // match later - this isn't a high-security context, being forgiving
    // here matters more than exact-match strictness
    const securityAnswerHash = await hashPassword(securityAnswer.trim().toLowerCase());

    const user = await createUser({
      name,
      email,
      passwordHash,
      securityQuestion,
      securityAnswerHash,
    });
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
