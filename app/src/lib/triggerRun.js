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

// Cap on the number of data-variable combinations a single launch will run, so
// a stray long list can't queue hundreds of runs. Mirror MAX_RUNS in
// TestDataEditor.jsx (kept here too so the runner side has no UI dependency).
const MAX_DATA_RUNS = 25;

// Expand a test's data variables into the cross product of their values. Each
// entry is a `cells` object like { size: '12', color: 'red' }. Returns [] when
// the test has no usable data variables (caller then does a normal run).
export function expandDataRows(data) {
  const vars = (data?.variables || [])
    .map((v) => ({ name: (v.name || '').trim(), values: (v.values || []).filter((x) => x !== '') }))
    .filter((v) => v.name && v.values.length);
  if (!vars.length) return [];
  let combos = [{}];
  for (const v of vars) {
    const next = [];
    for (const c of combos) for (const val of v.values) next.push({ ...c, [v.name]: val });
    combos = next;
  }
  return combos;
}

const cellsLabel = (cells) =>
  Object.entries(cells)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

// Full fan-out: data rows × browsers/devices. With no data variables this is
// just triggerRunTargets. Every run in the launch shares one batchId (when
// there's more than one) so the dashboard groups the matrix. Returns the run
// ids plus whether the data cap was hit.
export async function triggerRunMatrix(test, targetIds, opts = {}) {
  const ids = targetIds && targetIds.length ? [...new Set(targetIds)] : [DEFAULT_TARGET];
  let rows = expandDataRows(test.data);
  const capped = rows.length > MAX_DATA_RUNS;
  if (capped) rows = rows.slice(0, MAX_DATA_RUNS);
  const cellsList = rows.length ? rows : [null];

  const batchId = ids.length * cellsList.length > 1 ? cryptoId() : null;
  const runIds = [];
  for (const cells of cellsList) {
    const dataLabel = cells ? cellsLabel(cells) : null;
    for (const target of ids) {
      runIds.push(
        await triggerRun(test, {
          ...opts,
          target,
          batchId,
          dataRow: cells ? { cells } : null,
          dataLabel,
        }),
      );
    }
  }
  return { runIds, capped, cap: MAX_DATA_RUNS };
}
