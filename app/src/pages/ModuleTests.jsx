import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { watchTests, watchRecentRuns, createTest, getLoginComponent } from '../lib/db';
import { triggerRun } from '../lib/triggerRun';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import Spinner from '../components/Spinner';
import { timeAgo } from '../lib/format';
import { moduleOf, cryptoId } from '../lib/schema';

export default function ModuleTests() {
  const { name } = useParams();
  const moduleName = decodeURIComponent(name);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tests, setTests] = useState(null);
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    const u1 = watchTests(setTests);
    const u2 = watchRecentRuns(setRuns, 200);
    return () => {
      u1();
      u2();
    };
  }, []);

  if (!tests) return <Spinner label="Loading tests…" />;

  const inModule = tests.filter((t) => moduleOf(t) === moduleName);
  const lastRunFor = (testId) => runs.find((r) => r.testId === testId);

  async function handleNew() {
    // Seed every new test with the login component as step 1 (if one exists),
    // so tests start already authenticated. It's a normal step — delete it if
    // a particular test shouldn't log in.
    const login = await getLoginComponent().catch(() => null);
    const steps = login
      ? [
          {
            id: cryptoId(),
            type: 'component',
            componentId: login.id,
            componentName: login.name || 'Login',
            selectors: [],
          },
        ]
      : [];
    const id = await createTest({
      name: 'New test',
      module: moduleName === 'Uncategorized' ? '' : moduleName,
      startUrl: import.meta.env.VITE_DEFAULT_BASE_URL || '',
      createdBy: user?.email || null,
      steps,
    });
    navigate(`/tests/${id}`);
  }

  async function handleRun(test, e) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(test.id);
    try {
      const runId = await triggerRun(test);
      navigate(`/runs/${runId}`);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleRunAll() {
    const active = inModule.filter((t) => t.status !== 'archived');
    if (active.length === 0) return;
    if (!confirm(`Run all ${active.length} test(s) in "${moduleName}"?`)) return;
    setBusy('all');
    try {
      for (const t of active) await triggerRun(t);
      navigate('/runs');
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Link to="/" className="hover:text-gray-700">
          Modules
        </Link>
        <span>/</span>
        <span className="text-gray-700">{moduleName}</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{moduleName}</h1>
        <div className="flex gap-2">
          {inModule.length > 0 && (
            <button onClick={handleRunAll} disabled={busy === 'all'} className="btn-ghost">
              {busy === 'all' ? 'Queuing…' : '▶ Run all'}
            </button>
          )}
          <button onClick={handleNew} className="btn-primary">
            + New test
          </button>
        </div>
      </div>

      {inModule.length === 0 ? (
        <div className="card mt-6 p-10 text-center text-gray-400">
          No tests in this module yet.
        </div>
      ) : (
        <div className="card mt-6 divide-y divide-ink-600">
          {inModule.map((t) => {
            const last = lastRunFor(t.id);
            return (
              <Link
                key={t.id}
                to={`/tests/${t.id}`}
                className="flex items-center gap-4 px-4 py-3.5 hover:bg-ink-700/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{t.name}</span>
                    {t.status === 'archived' && <StatusBadge status="archived" />}
                  </div>
                  <div className="truncate text-xs text-gray-500">
                    {t.startUrl || 'no start URL'} · {t.steps?.length || 0} steps
                  </div>
                </div>
                {last ? (
                  <div className="flex items-center gap-3">
                    <span className="hidden text-xs text-gray-500 sm:inline">
                      {timeAgo(last.startedAt)}
                    </span>
                    <StatusBadge status={last.status} />
                  </div>
                ) : (
                  <span className="text-xs text-gray-600">never run</span>
                )}
                <button
                  onClick={(e) => handleRun(t, e)}
                  disabled={busy === t.id}
                  className="btn-ghost py-1.5 px-3 text-xs"
                >
                  {busy === t.id ? 'Starting…' : 'Run'}
                </button>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
