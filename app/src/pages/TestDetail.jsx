import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  getTest,
  saveTest,
  deleteTest,
  watchRunsForTest,
  watchComponents,
  watchTests,
  createComponent,
  deleteRun,
} from '../lib/db';
import { triggerRun, triggerRunMatrix } from '../lib/triggerRun';
import { DEFAULT_MODULES, DEFAULT_TARGET, moduleOf } from '../lib/schema';
import { useAuth } from '../context/AuthContext';
import { useActiveViewers } from '../lib/usePresence';
import StatusBadge from '../components/StatusBadge';
import TargetBadge from '../components/TargetBadge';
import TargetPicker from '../components/TargetPicker';
import DataBadge from '../components/DataBadge';
import Spinner from '../components/Spinner';
import StepsEditor from '../components/StepsEditor';
import TestDataEditor, { dataRunCount } from '../components/TestDataEditor';
import ModuleCombobox from '../components/ModuleCombobox';
import { timeAgo, fmtDuration } from '../lib/format';

// The persisted shape of a test (kept in one place so auto-save and run-flush
// always write the same fields).
function snapshot(test) {
  return {
    name: test.name,
    description: test.description || '',
    module: test.module || '',
    startUrl: test.startUrl || '',
    steps: test.steps || [],
    data: test.data || null,
    status: test.status || 'active',
  };
}

export default function TestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [test, setTest] = useState(null);
  const [runs, setRuns] = useState([]);
  const [components, setComponents] = useState([]);
  const [allTests, setAllTests] = useState([]);
  // Auto-save: 'saved' | 'unsaved' | 'saving'. No manual Save button — edits
  // (including step edits) persist automatically a moment after you stop.
  const [saveState, setSaveState] = useState('saved');
  const [running, setRunning] = useState(false);
  // Which browsers/devices to run on. Chrome by default; tick more to fan out.
  const [targets, setTargets] = useState([DEFAULT_TARGET]);
  const [editAnyway, setEditAnyway] = useState(false); // override the soft lock
  const freshLoad = useRef(true); // skip auto-save right after (re)loading a test

  // Who else is on this exact test right now (so two people don't clobber each
  // other's edits), and whether a run is currently in progress for it.
  const viewers = useActiveViewers(user);
  const othersHere = viewers.filter((p) => (p.path || '') === `/tests/${id}`);
  const activeRun = runs.find((r) => r.status === 'running' || r.status === 'queued');
  const locked = othersHere.length > 0 && !editAnyway;

  useEffect(() => {
    freshLoad.current = true;
    getTest(id).then((t) => {
      if (!t) navigate('/');
      else setTest(t);
    });
    const unsub = watchRunsForTest(id, setRuns);
    const unsubC = watchComponents(setComponents);
    const unsubT = watchTests(setAllTests);
    return () => {
      unsub();
      unsubC();
      unsubT();
    };
  }, [id]);

  // Modules already in use across all tests, plus the built-in suggestions.
  const moduleOptions = useMemo(
    () =>
      [...new Set([...DEFAULT_MODULES, ...allTests.map((t) => (t.module || '').trim())])]
        .filter(Boolean)
        .sort(),
    [allTests],
  );

  // Debounced auto-save whenever the test changes.
  useEffect(() => {
    if (!test) return;
    if (freshLoad.current) {
      freshLoad.current = false;
      return;
    }
    setSaveState('saving');
    const handle = setTimeout(() => {
      saveTest(id, snapshot(test))
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('unsaved'));
    }, 700);
    return () => clearTimeout(handle);
  }, [test, id]);

  if (!test) return <Spinner label="Loading test…" />;

  // Total runs a normal launch will create: data-variable combinations × browsers.
  const perData = dataRunCount(test.data);
  const totalRuns = perData * (targets.length || 1);
  const runButtonLabel =
    totalRuns > 1 ? `▶ Run ${totalRuns}×` : '▶ Run test';

  const update = (patch) => {
    if (locked) return; // someone else is editing this test — don't clobber
    setTest((t) => ({ ...t, ...patch }));
    setSaveState('unsaved');
  };

  // Flush any pending edit immediately (used before running).
  async function saveNow() {
    setSaveState('saving');
    await saveTest(id, snapshot(test));
    setSaveState('saved');
  }

  async function handleRun(opts = {}) {
    await saveNow();
    setRunning(true);
    try {
      // Partial runs (run-from / run-until) and baseline captures are tied to a
      // single browser and a single value, so they use just the first selected
      // target and no data fan-out. A normal "Run test" fans out across every
      // ticked browser/device AND every data-variable value.
      const single = opts.updateBaselines || Number.isInteger(opts.fromStep) || Number.isInteger(opts.toStep);
      const chosen = targets.length ? targets : [DEFAULT_TARGET];
      if (single) {
        const runId = await triggerRun(test, { ...opts, target: chosen[0] });
        navigate(`/runs/${runId}`);
      } else {
        const { runIds } = await triggerRunMatrix(test, chosen, opts);
        // Open the single run directly; for a matrix, go to the Runs list where
        // the batch shows together.
        navigate(runIds.length === 1 ? `/runs/${runIds[0]}` : '/runs');
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setRunning(false);
    }
  }

  async function handleBaseline() {
    if (
      !confirm(
        'Capture the current look of every step as the visual baseline? Future runs compare against this.',
      )
    )
      return;
    await handleRun({ updateBaselines: true });
  }

  async function handleSaveAsComponent() {
    // Components can't nest, so drop any component-type steps when converting.
    const steps = (test.steps || []).filter((s) => s.type !== 'component');
    if (steps.length === 0) {
      alert('No reusable steps to save (reusable-component steps are skipped).');
      return;
    }
    const name = prompt('Name this reusable component:', `${test.name} steps`);
    if (!name) return;
    await saveNow();
    await createComponent({ name, steps });
    if (confirm(`Saved "${name}" as a reusable component. Open the Components page?`))
      navigate('/components');
  }

  async function handleDelete() {
    if (!confirm(`Delete "${test.name}"? This cannot be undone.`)) return;
    await deleteTest(id);
    navigate('/');
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Link to="/" className="hover:text-gray-700">
          Modules
        </Link>
        <span>/</span>
        <Link
          to={`/modules/${encodeURIComponent(moduleOf(test))}`}
          className="hover:text-gray-700"
        >
          {moduleOf(test)}
        </Link>
        <span>/</span>
        <span className="text-gray-700">{test.name}</span>
      </div>

      {/* Conflict warning: someone else is on this exact test right now. */}
      {othersHere.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
          <span className="text-lg leading-none">⚠️</span>
          <span className="flex-1">
            <span className="font-semibold">
              {othersHere.map((p) => p.name || p.email).join(', ')}
            </span>{' '}
            {othersHere.length === 1 ? 'is' : 'are'} also on this test right now.
            {locked
              ? ' Editing is locked so you don’t overwrite each other.'
              : ' You chose to edit anyway — your changes may overwrite theirs.'}
          </span>
          {locked ? (
            <button onClick={() => setEditAnyway(true)} className="btn-ghost py-1 px-3 text-xs">
              Edit anyway
            </button>
          ) : (
            <button onClick={() => setEditAnyway(false)} className="btn-ghost py-1 px-3 text-xs">
              Re-lock
            </button>
          )}
        </div>
      )}

      {/* A run is currently executing for this test. */}
      {activeRun && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2.5 text-sm text-blue-700">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-300/40 border-t-blue-400" />
          <span className="flex-1">
            A run is in progress for this test
            {activeRun.triggeredBy ? ` (started by ${activeRun.triggeredBy})` : ''} — editing now may
            not match what’s running.
          </span>
          <Link to={`/runs/${activeRun.id}`} className="btn-ghost py-1 px-3 text-xs">
            View run
          </Link>
        </div>
      )}

      <div
        className={`flex flex-wrap items-start justify-between gap-3 ${
          locked ? 'pointer-events-none select-none opacity-60' : ''
        }`}
        aria-disabled={locked}
      >
        <div className="flex-1 space-y-3">
          <input
            className="input text-lg font-semibold"
            value={test.name}
            onChange={(e) => update({ name: e.target.value })}
          />
          <div>
            <label className="label">Module</label>
            <ModuleCombobox
              value={test.module || ''}
              onChange={(module) => update({ module })}
              options={moduleOptions}
              placeholder="e.g. Ecards, Campaigns, Donations"
            />
          </div>
          <input
            className="input"
            placeholder="Start URL (e.g. https://lev.charity)"
            value={test.startUrl || ''}
            onChange={(e) => update({ startUrl: e.target.value })}
          />
          <textarea
            className="input"
            rows={2}
            placeholder="Description (optional)"
            value={test.description || ''}
            onChange={(e) => update({ description: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2" data-tour="test-actions">
          <div className="rounded-lg border border-ink-600 bg-white p-2">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Run on
            </div>
            <TargetPicker value={targets} onChange={setTargets} disabled={running} />
          </div>
          <button onClick={() => handleRun()} disabled={running} className="btn-primary">
            {running ? 'Starting…' : runButtonLabel}
          </button>
          <div
            className="flex items-center justify-center gap-1.5 text-xs text-gray-400"
            title="Changes save automatically"
          >
            {saveState === 'saving' && (
              <>
                <span className="h-2.5 w-2.5 animate-spin rounded-full border border-gray-300 border-t-gray-500" />
                Saving…
              </>
            )}
            {saveState === 'saved' && <>✓ All changes saved</>}
            {saveState === 'unsaved' && <span className="text-amber-600">Unsaved changes…</span>}
          </div>
          <button
            onClick={handleBaseline}
            disabled={running}
            className="btn-ghost text-xs"
            title="Capture the current screenshots as the visual baseline for comparison"
          >
            Set visual baseline
          </button>
          <button
            onClick={handleSaveAsComponent}
            className="btn-ghost text-xs"
            title="Save these steps as a reusable component you can drop into other tests"
          >
            Save as component
          </button>
          <button
            onClick={() =>
              update({ status: test.status === 'archived' ? 'active' : 'archived' })
            }
            className="btn-ghost text-xs"
          >
            {test.status === 'archived' ? 'Unarchive' : 'Archive'}
          </button>
          <button onClick={handleDelete} className="btn-danger text-xs">
            Delete
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        {/* Steps */}
        <section
          className={`lg:col-span-2 ${
            locked ? 'pointer-events-none select-none opacity-60' : ''
          }`}
          aria-disabled={locked}
          data-tour="test-steps"
        >
          <StepsEditor
            steps={test.steps}
            onChange={(steps) => update({ steps })}
            components={components}
            allowComponents
            onRunFrom={(i) => handleRun({ fromStep: i })}
            onRunUntil={(i) => handleRun({ toStep: i })}
          />

          <div className="mt-8">
            <TestDataEditor value={test.data} onChange={(data) => update({ data })} />
          </div>
        </section>

        {/* Run history */}
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Recent runs
          </h2>
          <div className="card divide-y divide-ink-600">
            {runs.length === 0 && (
              <div className="p-5 text-center text-sm text-gray-500">No runs yet</div>
            )}
            {runs.map((r) => (
              <div
                key={r.id}
                className="group flex items-center justify-between px-3 py-2.5 hover:bg-ink-700/50"
              >
                <Link to={`/runs/${r.id}`} className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={r.status} />
                    <TargetBadge target={r.target} />
                    <DataBadge label={r.dataLabel} />
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {timeAgo(r.startedAt)} · {fmtDuration(r.durationMs)}
                  </div>
                </Link>
                <button
                  onClick={() => confirm('Delete this run?') && deleteRun(r.id)}
                  title="Delete run"
                  className="ml-2 rounded-md px-2 py-1 text-xs text-gray-400 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-600 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
