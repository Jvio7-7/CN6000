const { createUser, findUserByEmail } = require('/opt/nodejs/db');
const { hashPassword, validatePassword, signToken } = require('/opt/nodejs/auth');

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
