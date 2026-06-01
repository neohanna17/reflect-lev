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
import { triggerRun } from '../lib/triggerRun';
import { DEFAULT_MODULES, moduleOf } from '../lib/schema';
import StatusBadge from '../components/StatusBadge';
import Spinner from '../components/Spinner';
import StepsEditor from '../components/StepsEditor';
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
    status: test.status || 'active',
  };
}

export default function TestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [test, setTest] = useState(null);
  const [runs, setRuns] = useState([]);
  const [components, setComponents] = useState([]);
  const [allTests, setAllTests] = useState([]);
  // Auto-save: 'saved' | 'unsaved' | 'saving'. No manual Save button — edits
  // (including step edits) persist automatically a moment after you stop.
  const [saveState, setSaveState] = useState('saved');
  const [running, setRunning] = useState(false);
  const freshLoad = useRef(true); // skip auto-save right after (re)loading a test

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

  const update = (patch) => {
    setTest((t) => ({ ...t, ...patch }));
    setSaveState('unsaved');
  };

  // Flush any pending edit immediately (used before running).
  async function saveNow() {
    setSaveState('saving');
    await saveTest(id, snapshot(test));
    setSaveState('saved');
  }

  async function handleRun(opts) {
    await saveNow();
    setRunning(true);
    try {
      const runId = await triggerRun(test, opts);
      navigate(`/runs/${runId}`);
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

      <div className="flex flex-wrap items-start justify-between gap-3">
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
          <button onClick={() => handleRun()} disabled={running} className="btn-primary">
            {running ? 'Starting…' : '▶ Run test'}
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
        <section className="lg:col-span-2" data-tour="test-steps">
          <StepsEditor
            steps={test.steps}
            onChange={(steps) => update({ steps })}
            components={components}
            allowComponents
            onRunFrom={(i) => handleRun({ fromStep: i })}
            onRunUntil={(i) => handleRun({ toStep: i })}
          />
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
                  <StatusBadge status={r.status} />
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
