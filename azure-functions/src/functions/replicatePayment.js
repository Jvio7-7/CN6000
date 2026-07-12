const { app } = require('@azure/functions');
const { replicatePayment } = require('../db');

app.http('replicatePaymentFn', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'replicate/payments',
  handler: async (request, context) => {
    try {
      const body = await request.json();
      await replicatePayment(body);
      return { status: 200, jsonBody: { status: 'replicated' } };
    } catch (err) {
      context.error('Failed to replicate payment:', err);
      return { status: 500, jsonBody: { error: 'Replication failed' } };
    }
  },
});
