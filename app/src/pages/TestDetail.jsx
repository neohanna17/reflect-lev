import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getTest, saveTest, deleteTest, watchRunsForTest } from '../lib/db';
import { triggerRun } from '../lib/triggerRun';
import { STEP_TYPES, stepLabel, emptyStep } from '../lib/schema';
import StatusBadge from '../components/StatusBadge';
import Spinner from '../components/Spinner';
import { timeAgo, fmtDuration } from '../lib/format';

export default function TestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [test, setTest] = useState(null);
  const [runs, setRuns] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    getTest(id).then((t) => {
      if (!t) navigate('/');
      else setTest(t);
    });
    const unsub = watchRunsForTest(id, setRuns);
    return () => unsub();
  }, [id]);

  if (!test) return <Spinner label="Loading test…" />;

  const update = (patch) => {
    setTest((t) => ({ ...t, ...patch }));
    setDirty(true);
  };
  const updateStep = (i, patch) => {
    const steps = test.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    update({ steps });
  };
  const addStep = () => update({ steps: [...(test.steps || []), emptyStep()] });
  const removeStep = (i) => update({ steps: test.steps.filter((_, idx) => idx !== i) });
  const moveStep = (i, dir) => {
    const steps = [...test.steps];
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    update({ steps });
  };

  async function handleSave() {
    setSaving(true);
    try {
      await saveTest(id, {
        name: test.name,
        description: test.description || '',
        startUrl: test.startUrl || '',
        steps: test.steps || [],
        status: test.status || 'active',
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleRun() {
    if (dirty) await handleSave();
    setRunning(true);
    try {
      const runId = await triggerRun(test);
      navigate(`/runs/${runId}`);
    } catch (e) {
      alert(e.message);
    } finally {
      setRunning(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${test.name}"? This cannot be undone.`)) return;
    await deleteTest(id);
    navigate('/');
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Link to="/" className="hover:text-gray-300">
          Tests
        </Link>
        <span>/</span>
        <span className="text-gray-300">{test.name}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 space-y-3">
          <input
            className="input text-lg font-semibold"
            value={test.name}
            onChange={(e) => update({ name: e.target.value })}
          />
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
          <button onClick={handleRun} disabled={running} className="btn-primary">
            {running ? 'Starting…' : '▶ Run test'}
          </button>
          <button onClick={handleSave} disabled={!dirty || saving} className="btn-ghost">
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
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
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
              Steps ({test.steps?.length || 0})
            </h2>
            <button onClick={addStep} className="btn-ghost py-1 px-2.5 text-xs">
              + Add step
            </button>
          </div>
          {(!test.steps || test.steps.length === 0) && (
            <div className="card p-6 text-center text-sm text-gray-500">
              No steps. Record with the extension or add steps manually.
            </div>
          )}
          <ol className="space-y-2">
            {(test.steps || []).map((step, i) => (
              <li key={step.id || i} className="card overflow-hidden">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ink-600 text-xs text-gray-400">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate text-sm">{stepLabel(step)}</span>
                  <div className="flex items-center gap-1 text-gray-500">
                    <button onClick={() => moveStep(i, -1)} className="px-1 hover:text-gray-200">
                      ↑
                    </button>
                    <button onClick={() => moveStep(i, 1)} className="px-1 hover:text-gray-200">
                      ↓
                    </button>
                    <button
                      onClick={() => setEditing(editing === i ? null : i)}
                      className="px-1.5 hover:text-gray-200"
                    >
                      ✎
                    </button>
                    <button onClick={() => removeStep(i)} className="px-1.5 hover:text-red-400">
                      ✕
                    </button>
                  </div>
                </div>
                {editing === i && (
                  <StepEditor step={step} onChange={(patch) => updateStep(i, patch)} />
                )}
              </li>
            ))}
          </ol>
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

function StepEditor({ step, onChange }) {
  return (
    <div className="space-y-3 border-t border-ink-600 bg-ink-900/50 px-3 py-3">
      <div>
        <label className="label">Action</label>
        <select
          className="input"
          value={step.type}
          onChange={(e) => onChange({ type: e.target.value })}
        >
          {Object.entries(STEP_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      {['navigate', 'type', 'press', 'select', 'wait', 'assertText', 'assertUrl'].includes(
        step.type,
      ) && (
        <div>
          <label className="label">
            {step.type === 'navigate' || step.type === 'assertUrl'
              ? 'URL'
              : step.type === 'wait'
                ? 'Milliseconds'
                : 'Value'}
          </label>
          <input
            className="input"
            value={step.value || ''}
            onChange={(e) => onChange({ value: e.target.value })}
          />
        </div>
      )}
      {!['navigate', 'wait', 'press', 'assertText', 'assertUrl'].includes(step.type) && (
        <>
          <div>
            <label className="label">Target label</label>
            <input
              className="input"
              placeholder="Human-friendly name, e.g. Donate button"
              value={step.target?.label || ''}
              onChange={(e) => onChange({ target: { ...step.target, label: e.target.value } })}
            />
          </div>
          <div>
            <label className="label">Selectors (one per line, tried in order = self-healing)</label>
            <textarea
              className="input font-mono text-xs"
              rows={3}
              placeholder={'#donate-btn\n[data-testid="donate"]\ntext=Donate'}
              value={(step.selectors || []).join('\n')}
              onChange={(e) =>
                onChange({ selectors: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
