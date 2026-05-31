import { chromium } from 'playwright';
import { FieldValue } from 'firebase-admin/firestore';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { Cron } from 'croner';
import { db, bucket } from './firebase-admin.js';
import { runTest } from './playback.js';

const VIEWPORT = { width: 1280, height: 800 };
// Fraction of pixels that must differ before a step is flagged as a visual
// change. Override with VISUAL_THRESHOLD (e.g. 0.02 = 2%).
const VISUAL_THRESHOLD = Number(process.env.VISUAL_THRESHOLD) || 0.01;

const pad = (i) => String(i).padStart(2, '0');

async function signedUrl(file) {
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 1000 * 60 * 60 * 24 * 365, // 1 year
  });
  return url;
}

async function uploadBuffer(objectPath, buffer, contentType) {
  if (!bucket) return null;
  const file = bucket.file(objectPath);
  await file.save(buffer, { contentType, resumable: false });
  return signedUrl(file);
}

const uploadScreenshot = (runId, index, buffer) =>
  uploadBuffer(`runs/${runId}/step-${pad(index)}.png`, buffer, 'image/png');

// Visual regression: compare a step screenshot against a stored baseline.
// Returns a result describing the comparison, or null when storage is off.
// With `update`, the current shot replaces the baseline instead of comparing.
async function compareVisual({ testId, runId, index, shot, update }) {
  if (!bucket) return null;
  const baseFile = bucket.file(`baselines/${testId}/step-${pad(index)}.png`);

  if (update) {
    await baseFile.save(shot, { contentType: 'image/png', resumable: false });
    return { status: 'baseline-updated' };
  }

  let baseBuf;
  try {
    [baseBuf] = await baseFile.download();
  } catch {
    await baseFile.save(shot, { contentType: 'image/png', resumable: false });
    return { status: 'baseline-created' };
  }

  let base, cur;
  try {
    base = PNG.sync.read(baseBuf);
    cur = PNG.sync.read(shot);
  } catch (e) {
    return { status: 'error', note: 'could not decode PNG: ' + e.message };
  }

  if (base.width !== cur.width || base.height !== cur.height) {
    return {
      status: 'changed',
      ratio: 1,
      note: `size changed ${base.width}x${base.height} → ${cur.width}x${cur.height}`,
      baselineUrl: await signedUrl(baseFile),
    };
  }

  const { width, height } = base;
  const diff = new PNG({ width, height });
  const n = pixelmatch(base.data, cur.data, diff.data, width, height, { threshold: 0.1 });
  const ratio = n / (width * height);
  if (ratio > VISUAL_THRESHOLD) {
    const diffUrl = await uploadBuffer(
      `runs/${runId}/diff-${pad(index)}.png`,
      PNG.sync.write(diff),
      'image/png',
    );
    return { status: 'changed', ratio, diffUrl, baselineUrl: await signedUrl(baseFile) };
  }
  return { status: 'match', ratio };
}

// Post a failure alert to a Discord channel webhook. No-op unless the run
// failed and DISCORD_WEBHOOK_URL is configured.
async function notifyDiscord({ runId, testName, outcome, errorMsg, steps, durationMs }) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  if (outcome !== 'failed' && outcome !== 'error') return;

  const failed = (steps || []).find((s) => s.status === 'failed' || s.status === 'error');
  const detail = failed
    ? `**Failed step:** ${failed.label || failed.type}\n\`\`\`${(failed.message || 'no message').slice(0, 600)}\`\`\``
    : errorMsg
      ? `\`\`\`${errorMsg.slice(0, 600)}\`\`\``
      : 'The run failed.';
  const base = (process.env.DASHBOARD_URL || '').replace(/\/+$/, '');
  const link = base ? `${base}/runs/${runId}` : undefined;

  const body = {
    embeds: [
      {
        title: `❌ Test failed: ${testName || 'Untitled test'}`,
        url: link,
        color: 0xef4444,
        description: detail,
        fields: [
          { name: 'Status', value: String(outcome), inline: true },
          { name: 'Duration', value: `${Math.round((durationMs || 0) / 1000)}s`, inline: true },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'Lev.Charity QA' },
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn('Discord notify failed:', res.status, await res.text().catch(() => ''));
    else console.log('→ Discord alert sent');
  } catch (e) {
    console.warn('Discord notify error:', e.message);
  }
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

  const updateBaselines = !!run.updateBaselines;
  await runRef.update({
    status: 'running',
    testName: test.name,
    mode: updateBaselines ? 'baseline' : 'test',
  });
  console.log(
    `▶ ${updateBaselines ? 'Baselining' : 'Running'} "${test.name}" (${test.steps?.length || 0} steps) → run ${runId}`,
  );

  const browser = await chromium.launch();
  const artifactDir = path.join(os.tmpdir(), `run-${runId}`);
  await fs.mkdir(artifactDir, { recursive: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: artifactDir, size: VIEWPORT },
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage();

  const collected = [];
  const startedAt = Date.now();
  let outcome = 'passed';
  let errorMsg = null;
  let videoUrl = null;
  let traceUrl = null;

  try {
    let i = 0;
    const { status } = await runTest(page, test, async (result, pg) => {
      const index = i;
      try {
        const shot = await pg.screenshot({ fullPage: false });
        result.screenshotUrl = await uploadScreenshot(runId, index, shot);
        try {
          result.visual = await compareVisual({
            testId: test.id,
            runId,
            index,
            shot,
            update: updateBaselines,
          });
        } catch (e) {
          console.warn('visual compare failed:', e.message);
        }
      } catch (e) {
        console.warn('screenshot failed:', e.message);
      }
      i += 1;
      collected.push(result);
      // stream progress to the dashboard
      await runRef.update({ steps: collected, durationMs: Date.now() - startedAt });
      const vflag = result.visual?.status === 'changed' ? ' ⚠ visual change' : '';
      console.log(`  ${result.status === 'passed' ? '✓' : '✗'} ${result.label}${vflag}`);
    });
    outcome = status;
  } catch (e) {
    outcome = 'error';
    errorMsg = e.message;
    console.error('run error:', e);
  } finally {
    try {
      const video = page.video();
      const tracePath = path.join(artifactDir, 'trace.zip');
      await context.tracing.stop({ path: tracePath }).catch(() => {});
      await context.close(); // flushes the video file to disk
      if (video) {
        const vpath = await video.path();
        videoUrl = await uploadBuffer(`runs/${runId}/video.webm`, await fs.readFile(vpath), 'video/webm');
      }
      traceUrl = await uploadBuffer(
        `runs/${runId}/trace.zip`,
        await fs.readFile(tracePath),
        'application/zip',
      );
    } catch (e) {
      console.warn('video/trace upload failed:', e.message);
    }
    await browser.close();
  }

  await runRef.update({
    status: outcome,
    steps: collected,
    error: errorMsg,
    durationMs: Date.now() - startedAt,
    videoUrl,
    traceUrl,
    updateBaselines: FieldValue.delete(),
    finishedAt: FieldValue.serverTimestamp(),
  });
  console.log(`■ Run ${runId} finished: ${outcome}`);
  await notifyDiscord({
    runId,
    testName: test.name,
    outcome,
    errorMsg,
    steps: collected,
    durationMs: Date.now() - startedAt,
  });
  return outcome;
}

async function drainQueue() {
  // No orderBy so no composite index is required; the queued set is small, so
  // we sort by start time in memory.
  const snap = await db.collection('runs').where('status', '==', 'queued').limit(50).get();
  if (snap.empty) {
    console.log('No queued runs.');
    return;
  }
  const toMs = (t) => (t?.toMillis ? t.toMillis() : 0);
  const docs = snap.docs.sort((a, b) => toMs(a.data().startedAt) - toMs(b.data().startedAt));
  console.log(`Draining ${docs.length} queued run(s)…`);
  for (const doc of docs) {
    await executeRun(doc.id);
  }
}

// Run `worker` over `items` with at most `size` in flight at once.
async function pool(items, size, worker) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      await worker(items[cur], cur);
    }
  });
  await Promise.all(runners);
}

// Enqueue run docs for the given tests and execute them in parallel
// (RUN_CONCURRENCY at a time, default 3). Returns the failure count.
async function enqueueAndRun(tests, triggeredBy) {
  if (tests.length === 0) return 0;
  const concurrency = Number(process.env.RUN_CONCURRENCY) || 3;
  console.log(`Running ${tests.length} test(s), ${concurrency} at a time (${triggeredBy})…`);

  // Create all run docs up front so they show as "queued" immediately.
  const runIds = [];
  for (const test of tests) {
    const runRef = await db.collection('runs').add({
      testId: test.id,
      testName: test.name,
      status: 'queued',
      startedAt: FieldValue.serverTimestamp(),
      finishedAt: null,
      triggeredBy,
      steps: [],
      durationMs: 0,
      browser: 'chromium',
      error: null,
    });
    runIds.push(runRef.id);
  }

  let failures = 0;
  await pool(runIds, concurrency, async (id) => {
    const outcome = await executeRun(id);
    if (outcome === 'failed' || outcome === 'error') failures += 1;
  });
  return failures;
}

// Enqueue and execute every active test. Used by the daily scheduled job so
// the whole suite is checked automatically without anyone clicking "Run".
async function runAllActive() {
  const snap = await db.collection('tests').get();
  const tests = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => t.status !== 'archived');
  if (tests.length === 0) {
    console.log('No active tests to run.');
    return;
  }
  console.log(`Daily check: ${tests.length} active test(s).`);
  const failures = await enqueueAndRun(tests, 'schedule');
  if (failures > 0) process.exitCode = 1;
}

// Run any suites whose schedule is "due". The scheduler workflow fires this
// hourly; a suite's cron may be daily/weekly/etc. We fire each scheduled
// occurrence exactly once by remembering the last occurrence we ran
// (suite.lastScheduledAt) and only running when a newer occurrence has passed.
async function runScheduledSuites() {
  const now = new Date();
  const suitesSnap = await db.collection('suites').get();
  const suites = suitesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const dueTestIds = new Set();
  const ranSuites = [];
  for (const suite of suites) {
    const expr = (suite.schedule || '').trim();
    if (!expr) continue;
    let prev;
    try {
      // Schedules are stored as UTC cron strings (the UI converts local time).
      prev = new Cron(expr, { timezone: 'UTC' }).previousRun(now);
    } catch (e) {
      console.warn(`Suite "${suite.name}" has an invalid schedule "${expr}":`, e.message);
      continue;
    }
    if (!prev) continue;
    const last = suite.lastScheduledAt?.toMillis ? suite.lastScheduledAt.toMillis() : 0;
    if (prev.getTime() <= last) continue; // already ran this occurrence

    (suite.testIds || []).forEach((id) => dueTestIds.add(id));
    ranSuites.push({ id: suite.id, name: suite.name, occurrence: prev });
  }

  if (ranSuites.length === 0) {
    console.log('No suites due this hour.');
    return;
  }
  console.log(`Due suites: ${ranSuites.map((s) => s.name).join(', ')}`);

  // Resolve the unique set of active tests across all due suites.
  const tests = [];
  for (const id of dueTestIds) {
    const snap = await db.collection('tests').doc(id).get();
    if (snap.exists && snap.data().status !== 'archived') {
      tests.push({ id: snap.id, ...snap.data() });
    }
  }

  const failures = await enqueueAndRun(tests, 'schedule');

  // Mark each due suite's occurrence as handled so it won't re-fire.
  for (const s of ranSuites) {
    await db
      .collection('suites')
      .doc(s.id)
      .update({ lastScheduledAt: s.occurrence, lastScheduledRunAt: FieldValue.serverTimestamp() });
  }
  if (failures > 0) process.exitCode = 1;
}

async function main() {
  const runId = process.env.RUN_ID;
  if (runId) {
    const outcome = await executeRun(runId);
    // non-zero exit on failure so the GitHub Actions job reflects it
    if (outcome === 'failed' || outcome === 'error') process.exitCode = 1;
  } else if (process.env.RUN_ALL === '1') {
    await runAllActive();
  } else if (process.env.RUN_SCHEDULED === '1') {
    await runScheduledSuites();
  } else {
    await drainQueue();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
