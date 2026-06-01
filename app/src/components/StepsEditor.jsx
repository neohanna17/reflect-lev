import { useEffect, useRef, useState } from 'react';
import { STEP_TYPES, stepLabel, emptyStep, cryptoId, isLoginComponentName } from '../lib/schema';
import { useDragSort, moveItem } from '../lib/useDragSort';

// Ordered, editable step list. Used by both the test editor and the reusable
// component editor. Pass `components` + `allowComponents` to enable inserting
// a reusable component as a step (disabled inside a component to avoid nesting).
export default function StepsEditor({
  steps,
  onChange,
  components = [],
  allowComponents = false,
  onRunFrom,
  onRunUntil,
}) {
  // `editing` holds the id of the open step (not its index) so it stays
  // attached to the right step after a drag-reorder.
  const [editing, setEditing] = useState(null);
  const [justAddedId, setJustAddedId] = useState(null);
  const olRef = useRef(null);
  const list = steps || [];
  const toggle = (sid) => setEditing((cur) => (cur === sid ? null : sid));

  const { dragIndex, overIndex, itemProps, handleProps } = useDragSort((from, to) =>
    onChange(moveItem(list, from, to)),
  );

  // A new step is appended at the bottom — scroll it into view and open it so
  // it's obvious where it landed (and the "Move to top" button is right there).
  useEffect(() => {
    if (!justAddedId || !olRef.current) return;
    const el = olRef.current.querySelector(`[data-step-id="${justAddedId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setJustAddedId(null);
  }, [justAddedId]);

  const updateStep = (i, patch) =>
    onChange(list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const openNew = (s) => {
    setEditing(s.id);
    setJustAddedId(s.id);
  };
  const addStep = () => {
    const s = emptyStep();
    onChange([...list, s]);
    openNew(s); // open + scroll to the new step
  };
  const addComponent = () => {
    const s = { id: cryptoId(), type: 'component', componentId: '', componentName: '', selectors: [] };
    onChange([...list, s]);
    openNew(s); // open so they can pick which component
  };
  const removeStep = (i) => onChange(list.filter((_, idx) => idx !== i));
  const moveToTop = (i) => onChange(moveItem(list, i, 0));

  // Offer a one-click "login as step 1" when a login component exists and the
  // first step isn't already it.
  const loginComp = components.find((c) => isLoginComponentName(c.name));
  const hasLoginFirst =
    list[0]?.type === 'component' && list[0]?.componentId === loginComp?.id;
  const addLoginFirst = () => {
    if (!loginComp) return;
    const s = {
      id: cryptoId(),
      type: 'component',
      componentId: loginComp.id,
      componentName: loginComp.name,
      selectors: [],
    };
    onChange([s, ...list]);
    setEditing(s.id);
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
        <div className="flex gap-2">
          {allowComponents && loginComp && !hasLoginFirst && (
            <button
              onClick={addLoginFirst}
              className="btn-ghost py-1 px-2.5 text-xs"
              title={`Insert "${loginComp.name}" as the first step so the test starts logged in`}
            >
              + Login as step 1
            </button>
          )}
          {allowComponents && (
            <button
              onClick={addComponent}
              className="btn-ghost py-1 px-2.5 text-xs"
              title="Insert a saved reusable component (e.g. Log in) as a single step"
            >
              + Add component
            </button>
          )}
          <button onClick={addStep} className="btn-ghost py-1 px-2.5 text-xs">
            + Add step
          </button>
        </div>
      </div>
      {list.length === 0 && (
        <div className="card p-6 text-center text-sm text-gray-500">
          No steps. Record with the extension or add steps manually.
        </div>
      )}
      <ol className="space-y-2" ref={olRef}>
        {list.map((step, i) => {
          const open = editing === step.id;
          const isDragging = dragIndex === i;
          const isOver = overIndex === i && dragIndex != null && dragIndex !== i;
          return (
            <li
              key={step.id || i}
              data-step-id={step.id}
              {...itemProps(i)}
              className={`card overflow-hidden transition ${isDragging ? 'opacity-40' : ''} ${
                isOver ? 'ring-2 ring-brand' : ''
              }`}
            >
              <div className="flex items-center gap-1.5 px-2 py-2.5">
                <span
                  {...handleProps(i)}
                  className="cursor-grab select-none px-1 text-base leading-none text-gray-300 hover:text-gray-500 active:cursor-grabbing"
                  title="Drag to reorder"
                >
                  ⠿
                </span>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ink-600 text-xs text-gray-400">
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => toggle(step.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title={open ? 'Click to close' : 'Click to edit this step'}
                >
                  <span
                    className={`flex-1 truncate text-sm ${step.type === 'component' ? 'text-brand' : ''}`}
                  >
                    {step.type === 'component' && '↳ '}
                    {labelFor(step)}
                  </span>
                  <span
                    className={`shrink-0 text-gray-300 transition-transform ${open ? 'rotate-90' : ''}`}
                  >
                    ›
                  </span>
                </button>
                <div className="flex items-center gap-1">
                  {i > 0 && (
                    <button
                      onClick={() => moveToTop(i)}
                      className="rounded-md px-1.5 py-0.5 text-xs text-gray-400 hover:bg-ink-700 hover:text-gray-800"
                      title="Move this step to the top"
                    >
                      ⤒ top
                    </button>
                  )}
                  {onRunUntil && (
                    <button
                      onClick={() => onRunUntil(i)}
                      className="rounded-md px-1.5 py-0.5 text-xs text-gray-400 hover:bg-ink-700 hover:text-brand"
                      title="Run from the start up to and including this step, then stop"
                    >
                      ▶ to here
                    </button>
                  )}
                  {onRunFrom && (
                    <button
                      onClick={() => onRunFrom(i)}
                      className="rounded-md px-1.5 py-0.5 text-xs text-gray-400 hover:bg-ink-700 hover:text-brand"
                      title="Run from this step to the end"
                    >
                      ▶ from here
                    </button>
                  )}
                  <button
                    onClick={() => removeStep(i)}
                    className="rounded-md px-1.5 py-0.5 text-gray-400 hover:bg-red-500/10 hover:text-red-600"
                    title="Delete this step"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {open && (
                <StepEditor
                  step={step}
                  onChange={(patch) => updateStep(i, patch)}
                  components={components}
                  allowComponents={allowComponents}
                />
              )}
            </li>
          );
        })}
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
    <div className="space-y-3 border-t border-ink-600 bg-gray-50 px-3 py-3">
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
