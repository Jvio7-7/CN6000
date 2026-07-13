const { requestPasswordReset } = require('/opt/nodejs/db');

// same response either way, don't leak whether the email exists
exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { email } = body;

    if (!email) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'email is required' }),
      };
    }

    await requestPasswordReset(email);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'If an account exists for that email, a reset code has been sent.' }),
    };
  } catch (err) {
    console.error('Failed to process password reset request:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Something went wrong' }),
    };
  }
};
