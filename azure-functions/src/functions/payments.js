const { app } = require('@azure/functions');
const { createPayment } = require('../db');

app.http('payments', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'payments',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      const { bookingId, amount, currency, cardNumber } = body;

      if (!bookingId || !amount || !cardNumber) {
        return { status: 400, jsonBody: { error: 'bookingId, amount, and cardNumber are all required' } };
      }
      if (cardNumber.replace(/\s/g, '').length < 12) {
        return { status: 400, jsonBody: { error: 'cardNumber does not look valid' } };
      }

      const payment = await createPayment({ bookingId, amount, currency, cardNumber });
      const status = payment.status === 'declined' ? 402 : 201;

      return { status, jsonBody: payment };
    } catch (err) {
      context.error('Failed to process payment:', err);
      return { status: 500, jsonBody: { error: 'Failed to process payment' } };
    }
  },
});
