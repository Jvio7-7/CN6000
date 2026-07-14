const { getSecurityQuestion } = require('/opt/nodejs/db');

// deliberately DOES reveal whether the email is registered, same
// product decision as before - now returns the security question
// itself, never the answer
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

    const question = await getSecurityQuestion(email);
    if (!question) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No account found with that email' }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    };
  } catch (err) {
    console.error('Failed to look up security question:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Something went wrong' }),
    };
  }
};
