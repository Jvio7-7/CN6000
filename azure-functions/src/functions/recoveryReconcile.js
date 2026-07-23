const { app } = require('@azure/functions');
const { reconcileToPeer } = require('../db');
const { secretsMatch } = require('../auth');

// Dedicated recovery handler. Azure Monitor calls this when its availability
// test for the AWS endpoint transitions back to healthy (AWS recovered). It
// reconciles Azure's rows to AWS, filling whatever AWS missed while it was
// down. This is the Azure-side mirror of the AWS CloudWatch alarm that
// reconciles on Azure recovery, so both directions now self-heal.
//
// A recovered availability test means AWS can answer /health, but its Lambda
// write path may not be warm yet, so the first reconcile can report failures.
// This retries on any reported failure, backing off between attempts, until
// the sync completes cleanly or the attempts are exhausted.
//
// Auth: Azure Monitor cannot send our x-replication-key header, so this
// endpoint is guarded by a shared secret in the query string instead, checked
// against RECOVERY_SECRET. The action group URL carries ?key=<secret>.

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
