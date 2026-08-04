const { app } = require('@azure/functions');
const { reconcileToPeer } = require('../db');
const { secretsMatch } = require('../auth');

// Called by Azure Monitor when AWS recovers. AWS can answer /health before its
// write path is warm, so this retries with a backoff until the sync is clean.
// Azure Monitor can't send custom headers, hence the secret in the query string.

const MAX_ATTEMPTS = 4;
const BACKOFF_MS = 30000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.http('recoveryReconcile', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'internal/recovery-reconcile',
  handler: async (request, context) => {
    const supplied = request.query.get('key');
    if (!secretsMatch(supplied, process.env.RECOVERY_SECRET)) {
      return { status: 401, jsonBody: { error: 'Unauthorized' } };
    }

    let result;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        result = await reconcileToPeer();
        context.log(
          'recovery reconcile attempt ' + attempt + '/' + MAX_ATTEMPTS + ':',
          JSON.stringify(result)
        );
        if (result && result.failed === 0) {
          return { status: 200, jsonBody: { status: 'reconciled', attempts: attempt, synced: result } };
        }
      } catch (err) {
        context.error('recovery reconcile attempt ' + attempt + ' threw:', err);
      }
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BACKOFF_MS);
      }
    }

    context.log('recovery reconcile did not reach failed:0 after all attempts');
    return { status: 200, jsonBody: { status: 'incomplete', attempts: MAX_ATTEMPTS, synced: result } };
  },
});
