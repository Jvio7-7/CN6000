const { createPayment } = require('/opt/nodejs/db');

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { bookingId, amount, currency, cardNumber } = body;

    if (!bookingId || !amount || !cardNumber) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'bookingId, amount, and cardNumber are all required' }),
      };
    }
    if (cardNumber.replace(/\s/g, '').length < 12) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'cardNumber does not look valid' }),
      };
    }

    const payment = await createPayment({ bookingId, amount, currency, cardNumber });

    // decline is a normal outcome, not a server error
    const statusCode = payment.status === 'declined' ? 402 : 201;

    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payment),
    };
  } catch (err) {
    console.error('Failed to process payment:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to process payment' }),
    };
  }
};
