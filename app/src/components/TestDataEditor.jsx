import { cryptoId } from '../lib/schema';

// Data-driven testing. A test can declare variables (e.g. `size`) each with a
// list of values. At run time the test fans out into one run per combination
// of values, and any `{{name}}` token in a step's value is replaced with that
// run's value. Shape persisted on the test: { variables: [{ id, name, values:[] }] }.

const MAX_RUNS = 25;

// Count how many runs a given data definition will produce (the cross product
// of every variable that has both a name and at least one value).
export function dataRunCount(data) {
  const active = activeVariables(data);
  if (!active.length) return 1;
  return active.reduce((n, v) => n * v.values.filter((x) => x !== '').length, 1);
}

export function activeVariables(data) {
  return (data?.variables || []).filter(
    (v) => (v.name || '').trim() && (v.values || []).some((x) => x !== ''),
  );
}

export default function TestDataEditor({ value, onChange }) {
  const variables = value?.variables || [];
  const setVars = (vars) => onChange({ ...(value || {}), variables: vars });

  const addVar = () => setVars([...variables, { id: cryptoId(), name: '', values: [] }]);
  const updateVar = (id, patch) =>
    setVars(variables.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const removeVar = (id) => setVars(variables.filter((v) => v.id !== id));

  const runs = dataRunCount(value);
  const active = activeVariables(value).length > 0;

  return (
    <div data-tour="test-data">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
          Test data
        </h2>
        <button onClick={addVar} className="btn-ghost py-1 px-2.5 text-xs">
          + Add variable
        </button>
      </div>

      {variables.length === 0 ? (
        <div className="card p-4 text-xs text-gray-500">
          <p className="mb-1">
            Optional. Add a variable (e.g. <code>size</code>) with a list of values, then
            reference it in any step as <code>{'{{size}}'}</code>.
          </p>
          <p>
            The test runs <strong>once per value</strong> — great for trying several inputs
            in one click (clear the field, type <code>{'{{size}}'}</code>, save).
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {variables.map((v) => (
            <div key={v.id} className="card space-y-2 p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{'{{'}</span>
                <input
                  className="input flex-1 py-1 text-sm"
                  placeholder="variable name, e.g. size"
                  value={v.name || ''}
                  onChange={(e) =>
                    updateVar(v.id, { name: e.target.value.replace(/[^\w.-]/g, '') })
                  }
                />
                <span className="text-xs text-gray-400">{'}}'}</span>
                <button
                  onClick={() => removeVar(v.id)}
                  className="rounded-md px-1.5 py-0.5 text-gray-400 hover:bg-red-500/10 hover:text-red-600"
                  title="Remove this variable"
                >
                  ✕
                </button>
              </div>
              <div>
                <label className="label">Values (one per line)</label>
                <textarea
                  className="input text-sm"
                  rows={3}
                  placeholder={'12\n24\n48'}
                  value={(v.values || []).join('\n')}
                  onChange={(e) =>
                    updateVar(v.id, { values: e.target.value.split('\n').map((s) => s.trim()) })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {active && (
        <p
          className={`mt-2 text-xs ${runs > MAX_RUNS ? 'text-amber-600' : 'text-gray-500'}`}
        >
          {runs > MAX_RUNS ? (
            <>
              ⚠ This would create {runs} runs — only the first {MAX_RUNS} will run. Trim some
              values to stay under the cap.
            </>
          ) : (
            <>
              ▶ Running this test will launch <strong>{runs}</strong> run
              {runs === 1 ? '' : 's'} (one per combination of values), per selected browser.
            </>
          )}
        </p>
      )}
    </div>
  );
}

export { MAX_RUNS };
