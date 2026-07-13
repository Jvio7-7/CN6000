const { app } = require('@azure/functions');
const { listNotifications } = require('../db');

app.http('listNotifications', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'notifications',
  handler: async (request, context) => {
    try {
      const notifications = await listNotifications();
      return { status: 200, jsonBody: notifications };
    } catch (err) {
      context.error('Failed to list notifications:', err);
      return { status: 500, jsonBody: { error: 'Failed to list notifications' } };
    }
  },
});
