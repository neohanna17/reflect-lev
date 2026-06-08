import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { watchRun, getTest, deleteRun } from '../lib/db';
import { triggerRun } from '../lib/triggerRun';
import StatusBadge from '../components/StatusBadge';
import TargetBadge from '../components/TargetBadge';
import DataBadge from '../components/DataBadge';
import Spinner from '../components/Spinner';
import BugReportModal from '../components/BugReportModal';
import { timeAgo, fmtDuration } from '../lib/format';

export default function RunDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState(undefined);
  const [shot, setShot] = useState(null);
  const [compare, setCompare] = useState(null); // { label, baselineUrl, currentUrl, diffUrl }
  const [openSteps, setOpenSteps] = useState({}); // step index -> explicitly open/closed
  const [bugOpen, setBugOpen] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [rebaselining, setRebaselining] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => watchRun(id, setRun), [id]);

  if (run === undefined) return <Spinner label="Loading run…" />;
  if (run === null) return <div className="text-gray-400">Run not found.</div>;

  const pending = run.status === 'queued' || run.status === 'running';
  const failed = run.status === 'failed' || run.status === 'error';
  const changedSteps = (run.steps || []).filter((s) => s.visual?.status === 'changed');

  // Steps expand to show details. Failed/errored steps default to open so the
  // problem is visible immediately; the rest open on click.
  const isStepOpen = (i, status) =>
    openSteps[i] !== undefined ? openSteps[i] : status === 'failed' || status === 'error';
  const toggleStep = (i, status) => setOpenSteps((m) => ({ ...m, [i]: !isStepOpen(i, status) }));

  // One-click "accept the new look": re-run capturing fresh visual baselines so
  // this change (if it's expected) stops being flagged. Same target as this run.
  async function handleRebaseline() {
    if (
      !confirm(
        'Set the current look as the new visual baseline? A quick run will recapture every step’s baseline, and future runs compare against it.',
      )
    )
      return;
    setRebaselining(true);
    try {
      const test = await getTest(run.testId);
      if (!test) {
        alert('The test for this run no longer exists.');
        return;
      }
      const runId = await triggerRun(test, {
        updateBaselines: true,
        target: run.target || 'chromium',
        automation: run.automation || false,
      });
      navigate(`/runs/${runId}`);
    } catch (e) {
      alert(e.message);
    } finally {
      setRebaselining(false);
    }
  }

  async function handleRerun() {
    setRerunning(true);
    try {
      const test = await getTest(run.testId);
      if (!test) {
        alert('The test for this run no longer exists.');
        return;
      }
      const runId = await triggerRun(test, {
        fromStep: run.fromStep,
        toStep: run.toStep,
        target: run.target || 'chromium',
        dataRow: run.dataRow || null,
        dataLabel: run.dataLabel || null,
        setupComponentIds:
          run.setupComponentIds ||
          (run.setupComponentId ? [run.setupComponentId] : undefined),
        teardownComponentIds: run.teardownComponentIds || undefined,
      });
      navigate(`/runs/${runId}`);
    } catch (e) {
      alert(e.message);
    } finally {
      setRerunning(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this run? Its video, trace and screenshots will be cleaned up automatically. This cannot be undone.'))
      return;
    setDeleting(true);
    try {
      const { testId } = run;
      await deleteRun(id);
      navigate(testId ? `/tests/${testId}` : '/runs');
    } catch (e) {
      alert(e.message);
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link to="/runs" className="hover:text-gray-700">
            Runs
          </Link>
          <span>/</span>
          <Link to={`/tests/${run.testId}`} className="hover:text-gray-700">
            {run.testName}
          </Link>
        </div>
        <div className="flex gap-2">
          {run.testId && (
            <Link
              to={`/tests/${run.testId}`}
              className="btn-ghost py-1.5 px-3 text-xs"
              title="Open this test in the editor"
            >
              ✎ Edit this test
            </Link>
          )}
          {!pending && changedSteps.length > 0 && (
            <button
              onClick={handleRebaseline}
              disabled={rebaselining}
              className="btn-ghost py-1.5 px-3 text-xs"
              title="The flagged changes look fine — make the current look the new baseline"
            >
              {rebaselining ? 'Starting…' : `✓ Accept ${changedSteps.length} change${changedSteps.length === 1 ? '' : 's'} as baseline`}
            </button>
          )}
          {failed && (
            <button onClick={() => setBugOpen(true)} className="btn-ghost py-1.5 px-3 text-xs">
              Create bug report
            </button>
          )}
          {!pending && (
            <button onClick={handleRerun} disabled={rerunning} className="btn-primary py-1.5 px-3 text-xs">
              {rerunning ? 'Starting…' : '↻ Re-run'}
            </button>
          )}
          {!pending && (
            <button onClick={handleDelete} disabled={deleting} className="btn-danger py-1.5 px-3 text-xs">
              {deleting ? 'Deleting…' : 'Delete run'}
            </button>
          )}
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-x-8 gap-y-2 p-5" data-tour="run-summary">
        <div>
          <div className="label">Status</div>
          <StatusBadge status={run.status} />
        </div>
        <div>
          <div className="label">Duration</div>
          <span className="text-sm">{fmtDuration(run.durationMs)}</span>
        </div>
        <div>
          <div className="label">Triggered by</div>
          <span className="text-sm">{run.triggeredBy || '—'}</span>
        </div>
        <div>
          <div className="label">Started</div>
          <span className="text-sm">{timeAgo(run.startedAt)}</span>
        </div>
        <div>
          <div className="label">Ran on</div>
          <TargetBadge target={run.target} />
        </div>
        {run.dataLabel && (
          <div>
            <div className="label">Test data</div>
            <DataBadge label={run.dataLabel} />
          </div>
        )}
      </div>

      {run.partial && (
        <div className="mt-4 rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-2 text-sm text-purple-700">
          Partial run
          {Number.isInteger(run.fromStep) && run.fromStep > 0 ? ` from step ${run.fromStep + 1}` : ''}
          {Number.isInteger(run.toStep) ? ` up to step ${run.toStep + 1}` : ''} · visual checks skipped.
        </div>
      )}

      {pending && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-700">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-300/40 border-t-blue-300" />
          Waiting for the GitHub Actions runner to pick up and execute this run…
        </div>
      )}

      {run.error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700">
          <div className="font-medium">Run error</div>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs">{run.error}</pre>
        </div>
      )}

      {(run.videoUrl || run.traceUrl) && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {run.videoUrl && (
            <div className="lg:col-span-2">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
                Recording
              </h2>
              <video
                src={run.videoUrl}
                controls
                className="w-full rounded-lg border border-ink-600 bg-black"
              />
            </div>
          )}
          {run.traceUrl && (
            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
                Trace
              </h2>
              <div className="card space-y-2 p-4 text-sm">
                <p className="text-gray-400">
                  Step-by-step Playwright trace with DOM snapshots and network.
                </p>
                <a href={run.traceUrl} download className="btn-ghost block text-center text-xs">
                  Download trace.zip
                </a>
                <a
                  href="https://trace.playwright.dev"
                  target="_blank"
                  rel="noreferrer"
                  className="block text-center text-xs text-brand hover:underline"
                >
                  Open trace.playwright.dev →
                </a>
                <p className="text-xs text-gray-600">
                  Download, then drag the file onto trace.playwright.dev to explore it.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <h2 className="mt-8 mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
        Steps
      </h2>
      <ol className="space-y-2" data-tour="run-steps">
        {(run.steps || []).map((s, i) => {
          const stepFailed = s.status === 'failed' || s.status === 'error';
          const open = isStepOpen(i, s.status);
          return (
            <li
              key={s.stepId || i}
              className={`card overflow-hidden ${stepFailed ? 'ring-1 ring-red-500/30' : ''}`}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleStep(i, s.status)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleStep(i, s.status);
                  }
                }}
                className="flex cursor-pointer items-center gap-3 px-3 py-3 hover:bg-ink-700/30"
              >
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-xs font-semibold ${
                    stepFailed ? 'bg-red-500/15 text-red-700' : 'bg-ink-700 text-gray-500'
                  }`}
                >
                  {i + 1}
                </span>
                <StatusBadge status={s.status} />
                <span className="flex-1 truncate text-sm">
                  {s.fromComponent && (
                    <span className="mr-1 text-xs text-brand" title={`From component: ${s.fromComponent}`}>
                      ↳ {s.fromComponent}:
                    </span>
                  )}
                  {s.label || s.type}
                </span>
                {s.visual?.status === 'changed' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setCompare({
                        label: s.label || s.type,
                        baselineUrl: s.visual.baselineUrl,
                        currentUrl: s.screenshotUrl,
                        diffUrl: s.visual.diffUrl,
                        note: s.visual.note,
                      });
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-500/25"
                    title={s.visual.note || 'Compare baseline vs current to see exactly what changed'}
                  >
                    ⚠ change {Math.round((s.visual.ratio || 0) * 100)}% · compare
                  </button>
                )}
                {(s.visual?.status === 'baseline-created' || s.visual?.status === 'baseline-updated') && (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700">
                    baseline {s.visual.status === 'baseline-updated' ? 'updated' : 'set'}
                  </span>
                )}
                <span className="text-xs text-gray-500">{fmtDuration(s.durationMs)}</span>
                {s.screenshotUrl && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShot(s.screenshotUrl);
                    }}
                    className="btn-ghost py-1 px-2 text-xs"
                    title="View this step's screenshot"
                  >
                    📷
                  </button>
                )}
                <span className={`shrink-0 text-gray-300 transition-transform ${open ? 'rotate-90' : ''}`}>
                  ›
                </span>
              </div>
              {open && (
                <div className="border-t border-ink-600">
                  {stepFailed ? (
                    <pre className="bg-red-50 px-4 py-2.5 font-mono text-xs text-red-700 whitespace-pre-wrap">
                      {s.message || 'No error message was recorded for this step.'}
                      {s.healedWith ? `\nself-healed via: ${s.healedWith}` : ''}
                    </pre>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs text-gray-500">
                      <span>
                        {s.healedWith ? (
                          <>
                            self-healed via: <code>{s.healedWith}</code>
                          </>
                        ) : (
                          'Passed — no issues.'
                        )}
                      </span>
                      {s.screenshotUrl && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setShot(s.screenshotUrl);
                          }}
                          className="text-brand hover:underline"
                        >
                          View screenshot
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {(!run.steps || run.steps.length === 0) && !pending && (
          <li className="card p-6 text-center text-sm text-gray-500">
            No step results recorded.
          </li>
        )}
      </ol>

      {shot && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6"
          onClick={() => setShot(null)}
        >
          <img src={shot} alt="screenshot" className="max-h-[90vh] max-w-full rounded-lg" />
        </div>
      )}

      {compare && (
        <div
          className="fixed inset-0 z-50 overflow-auto bg-black/80 p-4 sm:p-6"
          onClick={() => setCompare(null)}
        >
          <div
            className="mx-auto max-w-6xl rounded-xl bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900">What changed</div>
                <div className="truncate text-xs text-gray-500">{compare.label}</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleRebaseline}
                  disabled={rebaselining}
                  className="btn-ghost py-1.5 px-3 text-xs"
                  title="The change is expected — make the current look the new baseline"
                >
                  {rebaselining ? 'Starting…' : '✓ Looks fine — set as new baseline'}
                </button>
                <button onClick={() => setCompare(null)} className="btn-ghost py-1.5 px-3 text-xs">
                  Close
                </button>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Figure label="Baseline (expected)" src={compare.baselineUrl} />
              <Figure label="Current (this run)" src={compare.currentUrl} />
              <Figure label="Difference — red = changed" src={compare.diffUrl} />
            </div>
            <p className="mt-3 text-xs text-gray-500">
              {compare.note ? (
                <span className="font-medium text-amber-700">{compare.note}. </span>
              ) : null}
              Compare <strong>Baseline</strong> and <strong>Current</strong> to spot the changed
              field; the <strong>Difference</strong> image marks exactly where in red. Click any
              image to open it full-size.
            </p>
          </div>
        </div>
      )}

      {bugOpen && <BugReportModal run={run} onClose={() => setBugOpen(false)} />}
    </div>
  );
}

function Figure({ label, src }) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-xs font-medium text-gray-500">{label}</figcaption>
      {src ? (
        <a href={src} target="_blank" rel="noreferrer">
          <img src={src} alt={label} className="w-full rounded-lg border border-ink-600" />
        </a>
      ) : (
        <div className="grid h-40 place-items-center rounded-lg border border-dashed border-ink-500 text-xs text-gray-400">
          not available
        </div>
      )}
    </figure>
  );
}
