import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  getTest,
  saveTest,
  deleteTest,
  watchRunsForTest,
  watchComponents,
  createComponent,
} from '../lib/db';
import { triggerRun } from '../lib/triggerRun';
import { DEFAULT_MODULES, moduleOf } from '../lib/schema';
import StatusBadge from '../components/StatusBadge';
import Spinner from '../components/Spinner';
import StepsEditor from '../components/StepsEditor';
import { timeAgo, fmtDuration } from '../lib/format';

export default function TestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [test, setTest] = useState(null);
  const [runs, setRuns] = useState([]);
  const [components, setComponents] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    getTest(id).then((t) => {
      if (!t) navigate('/');
      else setTest(t);
    });
    const unsub = watchRunsForTest(id, setRuns);
    const unsubC = watchComponents(setComponents);
    return () => {
      unsub();
      unsubC();
    };
  }, [id]);

  if (!test) return <Spinner label="Loading test…" />;

  const update = (patch) => {
    setTest((t) => ({ ...t, ...patch }));
    setDirty(true);
  };

  async function handleSave() {
    setSaving(true);
    try {
      await saveTest(id, {
        name: test.name,
        description: test.description || '',
        module: test.module || '',
        startUrl: test.startUrl || '',
        steps: test.steps || [],
        status: test.status || 'active',
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleRun(opts) {
    if (dirty) await handleSave();
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
    if (dirty) await handleSave();
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
            <input
              className="input"
              list="module-options"
              placeholder="e.g. Ecards, Campaigns, Donations"
              value={test.module || ''}
              onChange={(e) => update({ module: e.target.value })}
            />
            <datalist id="module-options">
              {DEFAULT_MODULES.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
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
        <div className="flex flex-col gap-2">
          <button onClick={() => handleRun()} disabled={running} className="btn-primary">
            {running ? 'Starting…' : '▶ Run test'}
          </button>
          <button onClick={handleSave} disabled={!dirty || saving} className="btn-ghost">
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
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
        <section className="lg:col-span-2">
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
              <Link
                key={r.id}
                to={`/runs/${r.id}`}
                className="flex items-center justify-between px-3 py-2.5 hover:bg-ink-700/50"
              >
                <div>
                  <StatusBadge status={r.status} />
                  <div className="mt-1 text-xs text-gray-500">
                    {timeAgo(r.startedAt)} · {fmtDuration(r.durationMs)}
                  </div>
                </div>
                <span className="text-gray-600">›</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
