import { auth } from '../firebase';
import { enqueueRun } from './db';

const FN_URL = import.meta.env.VITE_TRIGGER_FUNCTION_URL || '/.netlify/functions/trigger-run';

// Creates a queued run doc, then asks the Netlify function to dispatch a
// GitHub Actions workflow that executes it. Returns the new run id.
export async function triggerRun(test) {
  const user = auth.currentUser;
  const runId = await enqueueRun(test, user ? user.email : 'dashboard');

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
