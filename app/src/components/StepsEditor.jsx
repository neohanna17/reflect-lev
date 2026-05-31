import { useState } from 'react';
import { STEP_TYPES, stepLabel, emptyStep } from '../lib/schema';

// Ordered, editable step list. Used by both the test editor and the reusable
// component editor. Pass `components` + `allowComponents` to enable inserting
// a reusable component as a step (disabled inside a component to avoid nesting).
export default function StepsEditor({ steps, onChange, components = [], allowComponents = false }) {
  const [editing, setEditing] = useState(null);
  const list = steps || [];

  const updateStep = (i, patch) =>
    onChange(list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addStep = () => onChange([...list, emptyStep()]);
  const removeStep = (i) => onChange(list.filter((_, idx) => idx !== i));
  const moveStep = (i, dir) => {
    const next = [...list];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const labelFor = (step) => {
    if (step.type === 'component') {
      const c = components.find((x) => x.id === step.componentId);
      const name = c?.name || step.componentName || '(pick one)';
      const count = c ? `${c.steps?.length || 0} steps` : '';
      return `Component: ${name}${count ? ` · ${count}` : ''}`;
    }
    return stepLabel(step);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
          Steps ({list.length})
        </h2>
        <button onClick={addStep} className="btn-ghost py-1 px-2.5 text-xs">
          + Add step
        </button>
      </div>
      {list.length === 0 && (
        <div className="card p-6 text-center text-sm text-gray-500">
          No steps. Record with the extension or add steps manually.
        </div>
      )}
      <ol className="space-y-2">
        {list.map((step, i) => (
          <li key={step.id || i} className="card overflow-hidden">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ink-600 text-xs text-gray-400">
                {i + 1}
              </span>
              <span
                className={`flex-1 truncate text-sm ${step.type === 'component' ? 'text-brand' : ''}`}
              >
                {step.type === 'component' && '↳ '}
                {labelFor(step)}
              </span>
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
              <StepEditor
                step={step}
                onChange={(patch) => updateStep(i, patch)}
                components={components}
                allowComponents={allowComponents}
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StepEditor({ step, onChange, components, allowComponents }) {
  // The action options: optionally include "Reusable component".
  const typeEntries = Object.entries(STEP_TYPES).filter(
    ([k]) => k !== 'component' || allowComponents,
  );

  return (
    <div className="space-y-3 border-t border-ink-600 bg-ink-900/50 px-3 py-3">
      <div>
        <label className="label">Action</label>
        <select
          className="input"
          value={step.type}
          onChange={(e) => onChange({ type: e.target.value })}
        >
          {typeEntries.map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      {step.type === 'component' && (
        <div>
          <label className="label">Which component?</label>
          <select
            className="input"
            value={step.componentId || ''}
            onChange={(e) => {
              const c = components.find((x) => x.id === e.target.value);
              onChange({ componentId: e.target.value, componentName: c?.name || '' });
            }}
          >
            <option value="">— pick a component —</option>
            {components.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.steps?.length || 0} steps)
              </option>
            ))}
          </select>
          {components.length === 0 && (
            <p className="mt-1 text-xs text-gray-500">
              No components yet — create one on the Components page first.
            </p>
          )}
        </div>
      )}

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
      {['click', 'type', 'select', 'hover', 'assertVisible'].includes(step.type) && (
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
                onChange({
                  selectors: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                })
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
