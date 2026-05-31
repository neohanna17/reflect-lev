import { chromium } from 'playwright';
import { FieldValue } from 'firebase-admin/firestore';
import { db, bucket } from './firebase-admin.js';
import { runTest } from './playback.js';

const VIEWPORT = { width: 1280, height: 800 };

async function uploadScreenshot(runId, index, buffer) {
  if (!bucket) return null;
  const file = bucket.file(`runs/${runId}/step-${String(index).padStart(2, '0')}.png`);
  await file.save(buffer, { contentType: 'image/png', resumable: false });
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 1000 * 60 * 60 * 24 * 365, // 1 year
  });
  return url;
}

async function executeRun(runId) {
  const runRef = db.collection('runs').doc(runId);
  const runSnap = await runRef.get();
  if (!runSnap.exists) {
    console.error(`Run ${runId} not found`);
    return;
  }
  const run = runSnap.data();

  const testSnap = await db.collection('tests').doc(run.testId).get();
  if (!testSnap.exists) {
    await runRef.update({
      status: 'error',
      error: `Test ${run.testId} no longer exists`,
      finishedAt: FieldValue.serverTimestamp(),
    });
    return;
  }
  const test = { id: testSnap.id, ...testSnap.data() };

  await runRef.update({ status: 'running', testName: test.name });
  console.log(`▶ Running "${test.name}" (${test.steps?.length || 0} steps) → run ${runId}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  const collected = [];
  const startedAt = Date.now();
  let outcome = 'passed';
  let errorMsg = null;

  try {
    let i = 0;
    const { status } = await runTest(page, test, async (result, pg) => {
      try {
        const shot = await pg.screenshot({ fullPage: false });
        result.screenshotUrl = await uploadScreenshot(runId, i, shot);
      } catch (e) {
        console.warn('screenshot failed:', e.message);
      }
      i += 1;
      collected.push(result);
      // stream progress to the dashboard
      await runRef.update({ steps: collected, durationMs: Date.now() - startedAt });
      console.log(`  ${result.status === 'passed' ? '✓' : '✗'} ${result.label}`);
    });
    outcome = status;
  } catch (e) {
    outcome = 'error';
    errorMsg = e.message;
    console.error('run error:', e);
  } finally {
    await browser.close();
  }

  await runRef.update({
    status: outcome,
    steps: collected,
    error: errorMsg,
    durationMs: Date.now() - startedAt,
    finishedAt: FieldValue.serverTimestamp(),
  });
  console.log(`■ Run ${runId} finished: ${outcome}`);
  return outcome;
}

async function drainQueue() {
  const snap = await db
    .collection('runs')
    .where('status', '==', 'queued')
    .orderBy('startedAt', 'asc')
    .limit(25)
    .get();
  if (snap.empty) {
    console.log('No queued runs.');
    return;
  }
  console.log(`Draining ${snap.size} queued run(s)…`);
  for (const doc of snap.docs) {
    await executeRun(doc.id);
  }
}

async function main() {
  const runId = process.env.RUN_ID;
  if (runId) {
    const outcome = await executeRun(runId);
    // non-zero exit on failure so the GitHub Actions job reflects it
    if (outcome === 'failed' || outcome === 'error') process.exitCode = 1;
  } else {
    await drainQueue();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
