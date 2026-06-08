import { useEffect, useState } from 'react';
import {
  watchComponents,
  createComponent,
  saveComponent,
  deleteComponent,
} from '../lib/db';
import Spinner from '../components/Spinner';
import StepsEditor from '../components/StepsEditor';
import { isLoginComponentName } from '../lib/schema';
import { useAuth } from '../context/AuthContext';

export default function Components() {
  const [components, setComponents] = useState(null);
  const [openId, setOpenId] = useState(null);

  useEffect(() => watchComponents(setComponents), []);

  if (!components) return <Spinner label="Loading components…" />;

  async function handleNew() {
    const id = await createComponent({ name: 'New component' });
    setOpenId(id);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Reusable components</h1>
          <p className="text-sm text-gray-400">
            Save a sequence of steps once (e.g. “Log in”, “Accept cookies”) and drop it into any
            test as a single step. Edit it here and every test that uses it updates.
          </p>
        </div>
        <button onClick={handleNew} data-tour="components-new" className="btn-primary">
          + New component
        </button>
      </div>

      <div className="mt-6 space-y-3" data-tour="components-list">
        {components.length === 0 && (
          <div className="card p-10 text-center text-gray-500">
            No components yet. Create one, then add it as a step inside a test.
          </div>
        )}
        {components.map((c) => (
          <ComponentCard
            key={c.id}
            component={c}
            open={openId === c.id}
            onToggle={() => setOpenId(openId === c.id ? null : c.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ComponentCard({ component, open, onToggle }) {
  const { isOwner } = useAuth();
  const [name, setName] = useState(component.name);
  const [description, setDescription] = useState(component.description || '');

  // The Log in component is protected: only the owner may delete it, so a stray
  // click can't break every test (and every automation) that logs in.
  const isLogin = isLoginComponentName(component.name);
  const canDelete = !isLogin || isOwner;

  async function handleDelete() {
    if (!canDelete) return;
    if (confirm(`Delete component "${component.name}"?`)) await deleteComponent(component.id);
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={onToggle} className="text-gray-500 hover:text-gray-800">
          {open ? '▾' : '▸'}
        </button>
        <span className="flex-1 truncate font-medium">{component.name}</span>
        {isLogin && (
          <span
            className="rounded-full bg-ink-700 px-2 py-0.5 text-xs text-gray-500"
            title="Protected — only the owner can delete the Log in component"
          >
            🔒 protected
          </span>
        )}
        <span className="text-xs text-gray-500">{component.steps?.length || 0} steps</span>
        <button
          onClick={handleDelete}
          disabled={!canDelete}
          className="btn-danger py-1 px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
          title={
            canDelete
              ? 'Delete this component'
              : 'Only the owner can delete the Log in component'
          }
        >
          Delete
        </button>
      </div>

      {open && (
        <div className="space-y-4 border-t border-ink-600 bg-gray-50 p-4" data-tour="component-panel">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => saveComponent(component.id, { name })}
              />
            </div>
            <div>
              <label className="label">Description (optional)</label>
              <input
                className="input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => saveComponent(component.id, { description })}
              />
            </div>
          </div>

          <StepsEditor
            steps={component.steps}
            onChange={(steps) => saveComponent(component.id, { steps })}
          />
          <p className="text-xs text-gray-600">
            Tip: components can’t contain other components (one level only).
          </p>
        </div>
      )}
    </div>
  );
}
