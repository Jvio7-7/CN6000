const { findUserByEmail, resetPasswordWithAnswer } = require('/opt/nodejs/db');
const { hashPassword, verifyPassword, validatePassword } = require('/opt/nodejs/auth');

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { email, answer, newPassword } = body;

    if (!email || !answer || !newPassword) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'email, answer, and newPassword are all required' }),
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

    const user = await findUserByEmail(email);
    if (!user) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No account found with that email' }),
      };
    }

    // same normalisation as when the answer was first set - see register
    const normalisedAnswer = answer.trim().toLowerCase();
    const answerCorrect = await verifyPassword(normalisedAnswer, user.security_answer_hash);
    if (!answerCorrect) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'That answer doesn\u2019t match' }),
      };
    }

    const newPasswordHash = await hashPassword(newPassword);
    await resetPasswordWithAnswer({ email, newPasswordHash });

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
