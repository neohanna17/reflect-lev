import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { watchTests, watchRecentRuns, watchComponents, createTest, enqueueRun } from '../lib/db';
import { triggerRun } from '../lib/triggerRun';
import { useAuth } from '../context/AuthContext';
import { cryptoId } from '../lib/schema';
import { TUTORIAL_AUTOMATIONS, ADMIN_BASE, TUTORIAL_HUB } from '../lib/tutorialAutomations';
import StatusBadge from '../components/StatusBadge';
import Spinner from '../components/Spinner';
import { timeAgo, fmtDuration } from '../lib/format';

const HUB_SLUG = '__tutorial_hub__';

// Every automation we know how to generate: the tutorial-hub monitor first,
// then one smoke check per tutorial category.
const SPECS = [
  {
    slug: HUB_SLUG,
    title: 'Tutorial hub — daily update check',
    module: 'Tutorial Monitor',
    links: [TUTORIAL_HUB],
    hub: true,
  },
  ...TUTORIAL_AUTOMATIONS.map((c) => ({
    slug: c.slug,
    title: c.title,
    module: c.title,
    links: c.links,
  })),
];

// Build the steps for one automation test: log in, then visit each admin page
// and assert the URL landed (catches auth failures, redirects, dead links).
function buildSteps(spec, login) {
  const steps = [
    { id: cryptoId(), type: 'component', componentId: login.id, componentName: login.name, selectors: [] },
  ];
  for (const l of spec.links) {
    steps.push({
      id: cryptoId(),
      type: 'navigate',
      value: ADMIN_BASE + l.href,
      selectors: [],
      target: { label: l.label },
    });
    steps.push({
      id: cryptoId(),
      type: 'assertUrl',
      value: l.href,
      selectors: [],
      target: { label: '' },
    });
  }
  return steps;
}

// Resolve a single check's health from its test + most recent automation run.
//   not_generated → no test created yet
//   needs_steps   → test exists but has no steps (can't run)
//   running       → queued or in progress
//   failed        → last run failed/errored
//   changed       → last run passed but a step differs from its visual baseline
//   passed        → last run all green
//   never         → generated, has steps, but never run
function checkStatus(test, last) {
  if (!test) return 'not_generated';
  if ((test.steps?.length || 0) === 0) return 'needs_steps';
  if (!last) return 'never';
  if (last.status === 'queued' || last.status === 'running') return 'running';
  if (last.status === 'failed' || last.status === 'error') return 'failed';
  const changed = (last.steps || []).some((s) => s?.visual?.status === 'changed');
  return changed ? 'changed' : 'passed';
}

// Health buckets for the mini dashboard, in display order. Soft, modern tones.
const HEALTH = [
  { key: 'passed', label: 'Healthy', dot: 'bg-emerald-500', seg: 'bg-emerald-500' },
  { key: 'changed', label: 'Changed', dot: 'bg-amber-400', seg: 'bg-amber-400' },
  { key: 'failed', label: 'Failing', dot: 'bg-rose-500', seg: 'bg-rose-500' },
  { key: 'notReady', label: "Can't run", dot: 'bg-slate-400', seg: 'bg-slate-300' },
  { key: 'pending', label: 'Not run yet', dot: 'bg-ink-500', seg: 'bg-ink-500' },
];
// Map a raw status to its dashboard bucket.
const BUCKET = {
  passed: 'passed',
  changed: 'changed',
  failed: 'failed',
  needs_steps: 'notReady',
  not_generated: 'notReady',
  never: 'pending',
  running: 'pending',
};

export default function Automations() {
  const { user } = useAuth();
  const [tests, setTests] = useState(null);
  const [runs, setRuns] = useState([]);
  const [components, setComponents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    const u1 = watchTests(setTests);
    const u2 = watchRecentRuns(setRuns, 200);
    const u3 = watchComponents(setComponents);
    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  const login = useMemo(
    () => components.find((c) => /log\s*in|sign\s*in/i.test(c.name || '')),
    [components],
  );

  const autoTests = useMemo(() => (tests || []).filter((t) => t.automation), [tests]);
  // watchRecentRuns returns newest-first, so [0] is the latest automation run.
  const autoRuns = useMemo(() => runs.filter((r) => r.automation), [runs]);
  const testBySlug = useMemo(() => {
    const m = {};
    for (const t of autoTests) if (t.tutorialSlug) m[t.tutorialSlug] = t;
    return m;
  }, [autoTests]);
  const lastRunFor = (testId) => runs.find((r) => r.automation && r.testId === testId);

  const generated = SPECS.filter((s) => testBySlug[s.slug]);
  const missing = SPECS.filter((s) => !testBySlug[s.slug]);

  // Per-check status + the mini-dashboard rollup.
  const checks = useMemo(
    () =>
      SPECS.map((spec) => {
        const test = testBySlug[spec.slug];
        const last = test && lastRunFor(test.id);
        const status = checkStatus(test, last);
        return { spec, test, last, status, bucket: BUCKET[status] };
      }),
    [tests, runs],
  );
  const counts = useMemo(() => {
    const c = { passed: 0, changed: 0, failed: 0, notReady: 0, pending: 0 };
    for (const ch of checks) c[ch.bucket] += 1;
    return c;
  }, [checks]);
  // Things the user should act on: failing, or can't run (no steps / not made).
  const attention = checks.filter((ch) => ['failed', 'needs_steps', 'not_generated'].includes(ch.status));
  const lastSweep = autoRuns[0];
  const healthPct = generated.length ? Math.round((counts.passed / SPECS.length) * 100) : 0;

  async function generate() {
    if (!login) {
      alert(
        'No “Log in” component found. Create a reusable component named “Log in” on the Components page first (it should use {{LEV_TEST_EMAIL}} / {{LEV_TEST_PASSWORD}}), then generate.',
      );
      return;
    }
    if (
      !confirm(
        `Create ${missing.length} automation test(s)? They log in and smoke-check the admin pages from the tutorial. Existing ones are left untouched.`,
      )
    )
      return;
    setBusy(true);
    setNote('');
    try {
      let made = 0;
      for (const spec of missing) {
        await createTest({
          name: `[Auto] ${spec.title}`,
          module: spec.module,
          automation: true,
          tutorialSlug: spec.slug,
          startUrl: ADMIN_BASE + spec.links[0].href,
          description: spec.hub
            ? 'Daily check that the admin Tutorial hub still loads when logged in. Set a visual baseline on this test so the morning run flags new tutorials/sections as a visual change.'
            : `Daily login + smoke check for “${spec.title}”: logs in and verifies each linked admin page loads. Read-only — safe to run unattended.`,
          steps: buildSteps(spec, login),
          createdBy: user?.email || null,
        });
        made += 1;
        setNote(`Created ${made}/${missing.length}…`);
      }
      setNote(`✓ Created ${made} automation test${made === 1 ? '' : 's'}.`);
    } catch (e) {
      alert('Generation failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function runAll() {
    const runnable = autoTests.filter((t) => (t.steps?.length || 0) > 0);
    if (runnable.length === 0) return;
    if (!confirm(`Run all ${runnable.length} automation test(s) now?`)) return;
    setBusy(true);
    setNote('');
    try {
      const who = user?.email || 'dashboard';
      // Enqueue every run first WITHOUT dispatching, then fire a single workflow
      // that drains the whole queue. Dispatching one workflow per run would hit
      // GitHub's concurrency group, which cancels all-but-one pending job and
      // strands the rest as "queued". One drain job works through them in order.
      const [first, ...rest] = runnable;
      for (let i = 0; i < rest.length; i += 1) {
        await enqueueRun(rest[i], who, { automation: true });
        setNote(`Queuing ${i + 1}/${runnable.length}…`);
      }
      await triggerRun(first, { automation: true }); // dispatches; the runner drains the rest
      setNote(
        `✓ Queued ${runnable.length} run${runnable.length === 1 ? '' : 's'}. One runner is working through them — watch the results below.`,
      );
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function runOne(test) {
    setBusy(true);
    try {
      await triggerRun(test, { automation: true });
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!tests) return <Spinner label="Loading automations…" />;

  const statusChip = {
    not_generated: { label: 'not generated', cls: 'bg-ink-700 text-gray-500' },
    needs_steps: { label: 'no steps', cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/70' },
    changed: { label: 'changed', cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/70' },
  };

  // Anything currently queued or executing in CI — used for the busy banner.
  const inflight = autoRuns.filter((r) => r.status === 'running' || r.status === 'queued');

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-gray-900">Automations</h1>
            <span className="rounded-full bg-ink-700 px-2.5 py-0.5 text-xs font-medium text-gray-500">
              Daily · scheduled
            </span>
          </div>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-gray-500">
            Quick, read-only login-and-smoke checks generated from the admin{' '}
            <a href={`${ADMIN_BASE}/admin/tutorial`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
              tutorial
            </a>
            . The QA bot signs in and confirms each admin page still loads — on their own
            morning schedule, separate from Modules, Runs and Suites.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {missing.length > 0 && (
            <button onClick={generate} disabled={busy} className="btn-primary">
              {busy ? 'Working…' : `Generate ${missing.length} test${missing.length === 1 ? '' : 's'}`}
            </button>
          )}
          {autoTests.length > 0 && (
            <button onClick={runAll} disabled={busy} className="btn-ghost">
              <PlayIcon className="h-3.5 w-3.5" />
              Run all
            </button>
          )}
        </div>
      </div>

      {note && (
        <div className="mt-4 rounded-xl border border-brand/20 bg-brand/5 px-4 py-2.5 text-sm text-brand-700">
          {note}
        </div>
      )}

      {inflight.length > 0 && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-brand/20 bg-brand/5 px-4 py-3">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand/30 border-t-brand" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-brand-700">
              Running automations… {inflight.length} in progress
            </div>
            <div className="text-xs text-gray-500">
              This usually takes a few minutes. Results refresh here automatically — no need to
              reload; check back shortly.
            </div>
          </div>
        </div>
      )}

      {!login && missing.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800">
          To generate these, first create a reusable <strong>Log in</strong> component on the{' '}
          <Link to="/components" className="font-medium underline">Components</Link> page (using{' '}
          <code>{'{{LEV_TEST_EMAIL}}'}</code> / <code>{'{{LEV_TEST_PASSWORD}}'}</code>). The
          automations reuse it to log in every morning.
        </div>
      )}

      {/* Mini health dashboard */}
      <HealthSummary counts={counts} total={SPECS.length} healthPct={healthPct} lastSweep={lastSweep} />

      {attention.length > 0 && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/60 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-rose-700">
            <AlertIcon className="h-4 w-4" />
            {attention.length} check{attention.length === 1 ? '' : 's'} need attention
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {attention.map((ch) => (
              <li key={ch.spec.slug} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate text-gray-600">
                  <span className="text-gray-400">
                    {ch.status === 'failed' ? 'failing' : ch.status === 'needs_steps' ? 'no steps' : 'not generated'}
                    {' · '}
                  </span>
                  {ch.spec.title}
                </span>
                {ch.test ? (
                  <Link to={`/tests/${ch.test.id}`} className="shrink-0 text-xs font-medium text-brand hover:underline">
                    {ch.status === 'failed' ? 'View' : 'Fix'}
                  </Link>
                ) : (
                  <span className="shrink-0 text-xs text-gray-400">Generate above</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Schedule explainer */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Info title="When they run" body="Every morning at 05:30 UTC (~07:30 SAST / 08:30 IDT) via GitHub Actions — plus any time you press Run all." />
        <Info title="Safe to run daily" body="Read-only page loads only. Anything that creates, edits or deletes data isn't auto-generated — keep those as normal Module tests." />
        <Info title="Catching tutorial updates" body="Set a visual baseline on the Tutorial hub check; the morning run then flags a change whenever new tutorials or sections appear." />
      </div>

      {/* The automation set */}
      <div className="mb-2.5 mt-8 flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wide text-gray-400">Checks</h2>
        <span className="text-xs text-gray-400">
          {generated.length} of {SPECS.length} generated
        </span>
      </div>
      <div className="card divide-y divide-ink-600/70 overflow-hidden">
        {checks.map(({ spec, test, last, status }) => {
          const chip = statusChip[status];
          return (
            <div
              key={spec.slug}
              className="flex flex-wrap items-center gap-3 px-4 py-3.5 transition-colors hover:bg-ink-700/40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {spec.hub && <BellIcon className="h-3.5 w-3.5 shrink-0 text-brand" />}
                  <span className="truncate text-sm font-medium text-gray-800">{spec.title}</span>
                  {status === 'changed' && last ? (
                    <Link
                      to={`/runs/${last.id}`}
                      title="See exactly what changed — opens the run's visual diff"
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium hover:underline ${chip.cls}`}
                    >
                      {chip.label} →
                    </Link>
                  ) : (
                    chip && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}>
                        {chip.label}
                      </span>
                    )
                  )}
                  {status === 'running' && (
                    <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-ink-500 border-t-brand" />
                  )}
                </div>
                <div className="mt-0.5 text-xs text-gray-400">
                  {spec.links.length} page{spec.links.length === 1 ? '' : 's'}
                  {last && (
                    <>
                      {' · '}
                      {timeAgo(last.startedAt)} · {fmtDuration(last.durationMs)}
                    </>
                  )}
                </div>
              </div>
              {last && <StatusBadge status={last.status} />}
              {test ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => runOne(test)} disabled={busy} className="btn-ghost py-1 px-2.5 text-xs">
                    <PlayIcon className="h-3 w-3" />
                    Run
                  </button>
                  <Link to={`/tests/${test.id}`} className="btn-ghost py-1 px-2.5 text-xs">
                    Open
                  </Link>
                </div>
              ) : (
                <span className="shrink-0 text-xs text-gray-300">—</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent automation runs */}
      <h2 className="mb-2.5 mt-8 text-xs font-medium uppercase tracking-wide text-gray-400">
        Recent automation runs
      </h2>
      <div className="card divide-y divide-ink-600/70 overflow-hidden">
        {autoRuns.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-gray-400">
            No automation runs yet. Generate the checks, then Run all (or wait for the morning
            sweep).
          </div>
        )}
        {autoRuns.slice(0, 40).map((r) => (
          <Link
            key={r.id}
            to={`/runs/${r.id}`}
            className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-ink-700/40"
          >
            <StatusBadge status={r.status} />
            <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{r.testName}</span>
            <span className="shrink-0 text-xs text-gray-400">
              {timeAgo(r.startedAt)} · {fmtDuration(r.durationMs)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// Mini dashboard: one big health figure, a thin segmented bar, and a calm
// dot-legend — minimal, so failing / can't-run checks read at a glance.
function HealthSummary({ counts, total, healthPct, lastSweep }) {
  const seg = (n, cls) =>
    n > 0 ? <div key={cls} className={cls} style={{ width: `${(n / total) * 100}%` }} /> : null;
  return (
    <div className="card mt-5 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
            Automation health
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tracking-tight text-gray-900">{healthPct}%</span>
            <span className="text-sm text-gray-400">
              {counts.passed} of {total} healthy
            </span>
          </div>
        </div>
        <span className="text-xs text-gray-400">
          {lastSweep ? `Last run ${timeAgo(lastSweep.startedAt)}` : 'Never run'}
        </span>
      </div>
      <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-ink-700">
        {HEALTH.map((h) => seg(counts[h.key], h.seg))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2.5">
        {HEALTH.map((h) => (
          <div key={h.key} className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${h.dot}`} />
            <span className="text-sm font-semibold tabular-nums text-gray-700">{counts[h.key]}</span>
            <span className="text-xs text-gray-400">{h.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Info({ title, body }) {
  return (
    <div className="rounded-xl bg-ink-700/60 px-4 py-3">
      <div className="text-xs font-medium text-gray-600">{title}</div>
      <div className="mt-1 text-xs leading-relaxed text-gray-500">{body}</div>
    </div>
  );
}

// — Minimal inline icons (Lucide-style), so the page uses crisp SVGs not emoji —
function PlayIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function BellIcon({ className = 'h-4 w-4' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function AlertIcon({ className = 'h-4 w-4' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
