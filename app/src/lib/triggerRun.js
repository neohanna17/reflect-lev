import { auth } from '../firebase';
import { enqueueRun } from './db';
import { cryptoId, DEFAULT_TARGET } from './schema';

const FN_URL = import.meta.env.VITE_TRIGGER_FUNCTION_URL || '/.netlify/functions/trigger-run';

// Creates a queued run doc, then asks the Netlify function to dispatch a
// GitHub Actions workflow that executes it. Returns the new run id.
export async function triggerRun(test, opts = {}) {
  const user = auth.currentUser;
  const runId = await enqueueRun(test, user ? user.email : 'dashboard', opts);

  const idToken = user ? await user.getIdToken() : null;
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ runId, testId: test.id }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to dispatch run (${res.status}): ${text}`);
  }
  return runId;
}

// Fan-out: launch the same test on several browsers/devices at once. Each
// target becomes its own run; when there's more than one they share a batchId
// so the dashboard can group the matrix together. Returns the new run ids.
export async function triggerRunTargets(test, targetIds, opts = {}) {
  const ids = targetIds && targetIds.length ? [...new Set(targetIds)] : [DEFAULT_TARGET];
  const batchId = ids.length > 1 ? cryptoId() : null;
  const runIds = [];
  for (const target of ids) {
    runIds.push(await triggerRun(test, { ...opts, target, batchId }));
  }
  return runIds;
}
