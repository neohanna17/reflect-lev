import { chromium, webkit, devices } from 'playwright';
import { FieldValue } from 'firebase-admin/firestore';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { Cron } from 'croner';
import { db, bucket } from './firebase-admin.js';
import { runTest } from './playback.js';

const VIEWPORT = { width: 1280, height: 800 };

// Browser/device presets. Must mirror TEST_TARGETS in app/src/lib/schema.js.
// `engine` picks the Playwright browser; `device` (optional) pulls a mobile
// descriptor (viewport, touch, user-agent) from playwright's device registry.
const TARGETS = {
  chromium: { engine: 'chromium' },
  webkit: { engine: 'webkit' },
  iphone: { engine: 'webkit', device: 'iPhone 13' },
  android: { engine: 'chromium', device: 'Galaxy S24' },
  // Back-compat: older runs were recorded with target 'pixel'. Keep the alias
  // so re-runs and historical run docs still resolve to an Android emulation.
  pixel: { engine: 'chromium', device: 'Galaxy S24' },
};

function resolveTarget(id) {
  const t = TARGETS[id] || TARGETS.chromium;
  const engine = t.engine === 'webkit' ? webkit : chromium;
  // Fall back gracefully if a device name isn't in this Playwright version.
  const device = t.device && devices[t.device] ? devices[t.device] : null;
  return { id: TARGETS[id] ? id : 'chromium', engine, device };
}

// Data-driven testing: replace {{name}} tokens in a step value with the value
// for this run's data row. Tokens with no matching variable are left intact so
// the playback layer can still resolve {{ENV_SECRET}} credentials. Applied to
// the step values up front (these are test data, not secrets) so run labels and
// the dashboard show the real value.
function applyDataVars(value, cells) {
  if (typeof value !== 'string' || !cells) return value;
  return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(cells, name) ? String(cells[name]) : m,
  );
}
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
async function compareVisual({ testId, runId, index, shot, update, target }) {
  if (!bucket) return null;
  // Baselines are per-target so a mobile/Safari screenshot is never compared
  // against the desktop-Chrome baseline. Chrome keeps the original path so
  // existing baselines stay valid; other targets live under a subfolder.
  const prefix =
    !target || target === 'chromium'
      ? `baselines/${testId}`
      : `baselines/${testId}/${target}`;
  const baseFile = bucket.file(`${prefix}/step-${pad(index)}.png`);

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
  const n = pixelmatch(base.data, cur.data, diff.data, width, height, {
    // Per-pixel colour tolerance: higher = ignore minor sub-pixel / rendering
    // noise so only real changes register. includeAA:false means anti-aliased
    // edges aren't counted as changes either.
    threshold: 0.15,
    includeAA: false,
    // Show the page faintly behind the change markers (instead of a near-blank
    // image) so the diff is actually readable, with changes in solid red.
    alpha: 0.45,
    aaColor: [255, 210, 0],
    diffColor: [255, 30, 30],
  });
  const ratio = n / (width * height);
  if (ratio > VISUAL_THRESHOLD) {
    const diffUrl = await uploadBuffer(
      `runs/${runId}/diff-${pad(index)}.png`,
      PNG.sync.write(diff),
      'image/png',
    );
    return {
      status: 'changed',
      ratio,
      changedPixels: n,
      diffUrl,
      baselineUrl: await signedUrl(baseFile),
    };
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

// Heads-up ping when an automation run sees a page change from its visual
// baseline — most usefully, a new tutorial/section on the admin Tutorial hub.
// Uses the same Discord webhook as failure alerts (no-op if unset).
async function notifyAutomationChange({ runId, testName, changed }) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url || !changed?.length) return;

  const base = (process.env.DASHBOARD_URL || '').replace(/\/+$/, '');
  const link = base ? `${base}/runs/${runId}` : undefined;
  const lines = changed
    .slice(0, 8)
    .map((s) => `• ${s.label || s.type} — ${Math.round((s.visual?.ratio || 0) * 100)}% different`)
    .join('\n');

  // Ping Hanna (or whoever DISCORD_AUTOMATION_MENTION points at) so a real
  // Discord notification fires — same idea as the feature-request pings. Set it
  // to "<@USER_ID>" or "<@&ROLE_ID>"; allowed_mentions lets it resolve.
  const mention = (process.env.DISCORD_AUTOMATION_MENTION || '<@1334096973900419072>').trim();
  const body = {
    content: `${mention ? mention + ' ' : ''}👀 **Heads up — an automated check spotted a change** on ${testName || 'an admin page'}.`,
    allowed_mentions: { parse: ['users', 'roles'] },
    embeds: [
      {
        title: `👀 Automation noticed a change: ${testName || 'Automation'}`,
        url: link,
        color: 0xf59e0b,
        description:
          `${changed.length} step(s) look different from the visual baseline — ` +
          `the page may have been updated (e.g. a new tutorial or section).\n\n${lines}` +
          `\n\nIf the change is expected, open the run and re-set the visual baseline.`,
        timestamp: new Date().toISOString(),
        footer: { text: 'Lev.Charity QA · Automations' },
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn('Discord change notify failed:', res.status);
    else console.log('→ Discord automation-change ping sent');
  } catch (e) {
    console.warn('Discord change notify error:', e.message);
  }
}

// Replace any "component" steps with the steps of the referenced component.
// One level deep: a component's own steps must not contain components (the
// editor enforces this; we also defensively skip any that slip through).
async function expandComponents(steps) {
  const list = steps || [];
  if (!list.some((s) => s.type === 'component')) return list;

  const cache = new Map();
  const out = [];
  for (const step of list) {
    if (step.type !== 'component') {
      out.push(step);
      continue;
    }
    if (!step.componentId) continue;
    let comp = cache.get(step.componentId);
    if (!comp) {
      const snap = await db.collection('components').doc(step.componentId).get();
      comp = snap.exists ? { id: snap.id, ...snap.data() } : { name: step.componentName, steps: [] };
      cache.set(step.componentId, comp);
    }
    for (const child of comp.steps || []) {
      if (child.type === 'component') continue; // no nesting
      out.push({ ...child, fromComponent: comp.name || step.componentName || 'component' });
    }
  }
  return out;
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

  // Optional partial run: slice the step range before expanding components.
  const allSteps = test.steps || [];
  const from = Number.isInteger(run.fromStep) ? run.fromStep : 0;
  const to = Number.isInteger(run.toStep) ? run.toStep : allSteps.length - 1;
  const sliced = allSteps.slice(from, to + 1);
  const partial = from > 0 || to < allSteps.length - 1;

  // A suite can wrap each test with reusable components: one or more run before
  // (e.g. Accept cookies → Log in) and one or more after (e.g. Log out). Older
  // runs carry a single setupComponentId; honour that as a fallback. Wrapping is
  // skipped on partial runs, where step indices must match the test's own steps.
  const setupIds =
    Array.isArray(run.setupComponentIds) && run.setupComponentIds.length
      ? run.setupComponentIds
      : run.setupComponentId
        ? [run.setupComponentId]
        : [];
  const teardownIds = Array.isArray(run.teardownComponentIds) ? run.teardownComponentIds : [];
  const hasSetup = !partial && (setupIds.length > 0 || teardownIds.length > 0);
  const withSetup = hasSetup
    ? [
        ...setupIds.map((id) => ({ type: 'component', componentId: id })),
        ...sliced,
        ...teardownIds.map((id) => ({ type: 'component', componentId: id })),
      ]
    : sliced;

  // Expand any reusable-component steps into their underlying steps.
  const expandedSteps = await expandComponents(withSetup);

  // Data-driven run: substitute {{name}} tokens with this row's values.
  const dataCells = run.dataRow?.cells || null;
  const effectiveSteps = dataCells
    ? expandedSteps.map((s) =>
        typeof s.value === 'string' ? { ...s, value: applyDataVars(s.value, dataCells) } : s,
      )
    : expandedSteps;
  const effectiveTest = { ...test, steps: effectiveSteps };

  // Whether to do visual-regression at all for this test. Pixel diffing is
  // noisy on dynamic pages, so for automation runs we only watch the tutorial
  // hub (where we genuinely want to catch new tutorials) — the other smoke
  // checks just assert the page loads. A test can opt in/out explicitly with
  // test.visualCheck. Manual (non-automation) tests keep visual checks on.
  const visualWanted =
    test.visualCheck === true ||
    (test.visualCheck !== false &&
      (!run.automation || test.tutorialSlug === '__tutorial_hub__'));

  // Visual baselines are keyed by step index, which only lines up on a full
  // run with no prepended setup, so we skip visual comparison otherwise.
  const updateBaselines =
    !!run.updateBaselines && !partial && !hasSetup && !dataCells && visualWanted;
  await runRef.update({
    status: 'running',
    testName: test.name,
    mode: updateBaselines ? 'baseline' : 'test',
    partial,
  });
  console.log(
    `▶ ${updateBaselines ? 'Baselining' : 'Running'} "${test.name}"` +
      (partial ? ` [steps ${from + 1}–${to + 1}]` : '') +
      ` (${effectiveSteps.length} steps) → run ${runId}`,
  );

  const target = resolveTarget(run.target);
  console.log(`  target: ${target.id}${target.device ? ` (${run.target})` : ''}`);
  if (run.dataLabel) console.log(`  data: ${run.dataLabel}`);
  const artifactDir = path.join(os.tmpdir(), `run-${runId}`);
  await fs.mkdir(artifactDir, { recursive: true });
  // A mobile target brings its own viewport/touch/user-agent via the device
  // descriptor; desktop targets use the standard viewport.
  const viewport = target.device?.viewport || VIEWPORT;
  // --disable-dev-shm-usage avoids Chromium crashing (SIGSEGV) on CI runners
  // whose /dev/shm is tiny, especially with several browsers in parallel.
  const launchArgs = target.engine === chromium ? ['--disable-dev-shm-usage'] : [];

  const collected = [];
  const startedAt = Date.now();
  let outcome = 'passed';
  let errorMsg = null;
  let videoUrl = null;
  let traceUrl = null;
  // Hoisted so the catch/finally can clean up even if launch/context creation
  // throws (a browser segfault must NOT crash the whole drain/sweep).
  let browser = null;
  let context = null;
  let page = null;

  try {
    browser = await target.engine.launch({ args: launchArgs });
    context = await browser.newContext({
      ...(target.device || { viewport }),
      recordVideo: { dir: artifactDir, size: viewport },
    });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    page = await context.newPage();
    let i = 0;
    const { status } = await runTest(page, effectiveTest, async (result, pg) => {
      const index = i;
      try {
        // For visual-watched steps, let the page settle (network idle + web
        // fonts) so a half-loaded frame isn't compared against the baseline —
        // a big source of false "changes". Bounded so it never hangs the run.
        if (visualWanted) {
          await pg.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
          await pg.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
        }
        // animations:'disabled' freezes CSS animations/transitions and hides
        // the text caret, so blinking cursors / spinners don't read as changes.
        const shot = await pg.screenshot({ fullPage: false, animations: 'disabled' });
        result.screenshotUrl = await uploadScreenshot(runId, index, shot);
        if (!partial && !hasSetup && !dataCells && visualWanted) {
          try {
            result.visual = await compareVisual({
              testId: test.id,
              runId,
              index,
              shot,
              update: updateBaselines,
              target: target.id,
            });
          } catch (e) {
            console.warn('visual compare failed:', e.message);
          }
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
      if (context) {
        const video = page ? page.video() : null;
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
        ).catch(() => null);
      }
    } catch (e) {
      console.warn('video/trace upload failed:', e.message);
    }
    if (browser) await browser.close().catch(() => {});
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
  // Automation runs additionally ping Discord when a page looks different from
  // its visual baseline — e.g. a new tutorial/section was published. (The run
  // itself still "passes"; a visual change is a heads-up, not a failure.)
  if (run.automation) {
    const changed = collected.filter((s) => s.visual?.status === 'changed');
    if (changed.length) {
      await notifyAutomationChange({ runId, testName: test.name, changed }).catch((e) =>
        console.warn('automation change notify failed:', e.message),
      );
    }
  }
  return outcome;
}

// Execute one run, but never let it throw: a browser segfault or any crash is
// caught here, the run doc is marked errored, and the caller's pool keeps going
// instead of the whole drain/sweep dying. Returns true if the run didn't pass.
async function safeExecute(id) {
  try {
    const outcome = await executeRun(id);
    return outcome === 'failed' || outcome === 'error';
  } catch (e) {
    console.error(`run ${id} crashed (continuing with the rest):`, e.message);
    await db
      .collection('runs')
      .doc(id)
      .update({
        status: 'error',
        error: `Runner crashed: ${e.message}`,
        finishedAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {});
    return true;
  }
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
  const concurrency = Number(process.env.RUN_CONCURRENCY) || 3;
  console.log(`Draining ${docs.length} queued run(s), ${concurrency} at a time…`);
  let failures = 0;
  await pool(
    docs.map((d) => d.id),
    concurrency,
    async (id) => {
      if (await safeExecute(id)) failures += 1;
    },
  );
  if (failures > 0) process.exitCode = 1;
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
async function enqueueAndRun(tests, triggeredBy, setupForTest) {
  if (tests.length === 0) return 0;
  const concurrency = Number(process.env.RUN_CONCURRENCY) || 3;
  console.log(`Running ${tests.length} test(s), ${concurrency} at a time (${triggeredBy})…`);

  // Create all run docs up front so they show as "queued" immediately.
  const runIds = [];
  for (const test of tests) {
    const wrap = (setupForTest && setupForTest(test)) || {};
    const runRef = await db.collection('runs').add({
      testId: test.id,
      testName: test.name,
      status: 'queued',
      startedAt: FieldValue.serverTimestamp(),
      finishedAt: null,
      triggeredBy,
      setupComponentIds: wrap.setupComponentIds || null,
      teardownComponentIds: wrap.teardownComponentIds || null,
      suiteId: wrap.suiteId || null,
      suiteRunId: wrap.suiteRunId || null,
      suiteName: wrap.suiteName || null,
      // Scheduled / daily sweeps run on Chrome to keep CI time predictable;
      // cross-browser matrices are launched on demand from the dashboard.
      target: wrap.target || 'chromium',
      batchId: null,
      // Tag automation runs so the dashboard keeps them in the Automations area.
      automation: !!test.automation || triggeredBy === 'automation',
      steps: [],
      durationMs: 0,
      browser: 'chromium',
      error: null,
    });
    runIds.push(runRef.id);
  }

  let failures = 0;
  await pool(runIds, concurrency, async (id) => {
    if (await safeExecute(id)) failures += 1;
  });
  return failures;
}

// Delete runs (and their stored screenshots/video/trace) older than
// RETENTION_DAYS so Firestore + Storage don't grow without bound. Runs on the
// daily sweep. Set RETENTION_DAYS=0 to disable.
async function cleanupOldRuns() {
  const days = Number(process.env.RETENTION_DAYS ?? 30);
  if (!days || days <= 0) return;
  const cutoff = new Date(Date.now() - days * 86400000);
  const snap = await db.collection('runs').where('startedAt', '<', cutoff).limit(500).get();
  if (snap.empty) {
    console.log(`Retention: no runs older than ${days} days.`);
    return;
  }
  console.log(`Retention: removing ${snap.size} run(s) older than ${days} days…`);
  let removed = 0;
  for (const docSnap of snap.docs) {
    if (bucket) {
      try {
        await bucket.deleteFiles({ prefix: `runs/${docSnap.id}/` });
      } catch (e) {
        console.warn(`  could not delete artifacts for ${docSnap.id}:`, e.message);
      }
    }
    await docSnap.ref.delete();
    removed += 1;
  }
  console.log(`Retention: removed ${removed} run(s).`);
}

// Enqueue and execute every active test. Used by the daily scheduled job so
// the whole suite is checked automatically without anyone clicking "Run".
async function runAllActive() {
  await cleanupOldRuns().catch((e) => console.warn('Retention cleanup failed:', e.message));
  const snap = await db.collection('tests').get();
  const tests = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => t.status !== 'archived' && !t.automation); // automations run in their own sweep
  if (tests.length === 0) {
    console.log('No active tests to run.');
    return;
  }
  console.log(`Daily check: ${tests.length} active test(s).`);
  const failures = await enqueueAndRun(tests, 'schedule');
  if (failures > 0) process.exitCode = 1;
}

// Enqueue and execute every active automation test. Runs as its own morning
// sweep (separate from the regular daily sweep and from suites) so the daily
// admin-tutorial / smoke checks happen unattended. Each automation test logs
// in via its embedded Log in component step.
async function runAutomations() {
  await cleanupOldRuns().catch((e) => console.warn('Retention cleanup failed:', e.message));
  const snap = await db.collection('tests').where('automation', '==', true).get();
  const tests = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => t.status !== 'archived');
  if (tests.length === 0) {
    console.log('No automation tests to run.');
    return;
  }
  console.log(`Automation sweep: ${tests.length} test(s).`);
  const failures = await enqueueAndRun(tests, 'automation');
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
  const setupByTest = new Map(); // testId → { setupComponentIds, teardownComponentIds }
  const ranSuites = [];
  for (const suite of suites) {
    const expr = (suite.schedule || '').trim();
    if (!expr) continue;
    let prev;
    try {
      // The cron's time-of-day is wall-clock in the suite's timezone. Older
      // suites without scheduleTz fall back to UTC (how they were stored).
      prev = new Cron(expr, { timezone: suite.scheduleTz || 'UTC' }).previousRun(now);
    } catch (e) {
      console.warn(`Suite "${suite.name}" has an invalid schedule "${expr}":`, e.message);
      continue;
    }
    if (!prev) continue;
    const last = suite.lastScheduledAt?.toMillis ? suite.lastScheduledAt.toMillis() : 0;
    if (prev.getTime() <= last) continue; // already ran this occurrence

    const setupIds =
      Array.isArray(suite.setupComponentIds) && suite.setupComponentIds.length
        ? suite.setupComponentIds
        : suite.setupComponentId
          ? [suite.setupComponentId]
          : [];
    const teardownIds = Array.isArray(suite.teardownComponentIds) ? suite.teardownComponentIds : [];
    // One id per suite occurrence so its runs roll up to a single result, just
    // like a manual "Run suite". A test shared by two due suites keeps the
    // first suite's grouping.
    const suiteRunId = randomUUID();
    (suite.testIds || []).forEach((id) => {
      dueTestIds.add(id);
      if (!setupByTest.has(id))
        setupByTest.set(id, {
          setupComponentIds: setupIds,
          teardownComponentIds: teardownIds,
          suiteId: suite.id,
          suiteRunId,
          suiteName: suite.name || '',
        });
    });
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

  const failures = await enqueueAndRun(tests, 'schedule', (t) => setupByTest.get(t.id) || null);

  // Mark each due suite's occurrence as handled so it won't re-fire.
  for (const s of ranSuites) {
    await db
      .collection('suites')
      .doc(s.id)
      .update({ lastScheduledAt: s.occurrence, lastScheduledRunAt: FieldValue.serverTimestamp() });
  }
  if (failures > 0) process.exitCode = 1;
}

// Reap orphaned runs left "running" by a previous job that died mid-flight
// (segfault / timeout / cancelled), which would otherwise show as forever
// "in progress" on the dashboard. The concurrency group guarantees no other
// job is executing while this one runs, so any "running" doc older than a small
// grace window is genuinely abandoned. Marks them errored so they're visible
// and re-runnable. Stale "queued" runs are left alone — drainQueue picks those
// up normally.
async function reapStaleRuns(graceMinutes = 10) {
  const cutoff = Date.now() - graceMinutes * 60000;
  let reaped = 0;
  const snap = await db.collection('runs').where('status', '==', 'running').limit(200).get();
  for (const doc of snap.docs) {
    const t = doc.data().startedAt;
    const ms = t?.toMillis ? t.toMillis() : 0;
    if (ms && ms > cutoff) continue; // too recent — leave it
    await doc.ref
      .update({
        status: 'error',
        error: 'Abandoned — the runner stopped before finishing this run (it will not resume).',
        finishedAt: FieldValue.serverTimestamp(),
      })
      .catch(() => {});
    reaped += 1;
  }
  if (reaped) console.log(`Reaped ${reaped} abandoned "running" run(s).`);
}

async function main() {
  // Always clear orphaned "running" docs from a prior crashed job first.
  await reapStaleRuns().catch((e) => console.warn('reap failed:', e.message));

  const runId = process.env.RUN_ID;
  if (runId) {
    const outcome = await executeRun(runId);
    // non-zero exit on failure so the GitHub Actions job reflects it
    if (outcome === 'failed' || outcome === 'error') process.exitCode = 1;
    // A batch launch (Run all / suite / cross-browser) enqueues many runs, but
    // GitHub's concurrency group cancels all-but-one pending dispatch — leaving
    // the siblings stranded as "queued". Drain them here in the surviving job.
    await drainQueue();
  } else if (process.env.RUN_ALL === '1') {
    await runAllActive();
  } else if (process.env.RUN_AUTOMATIONS === '1') {
    await runAutomations();
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
