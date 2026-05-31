import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { watchTests, watchRecentRuns, createTest } from '../lib/db';
import { triggerRun } from '../lib/triggerRun';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import Spinner from '../components/Spinner';
import { timeAgo } from '../lib/format';
import { moduleOf, DEFAULT_MODULES } from '../lib/schema';

export default function TestsList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tests, setTests] = useState(null);
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    const u1 = watchTests(setTests);
    const u2 = watchRecentRuns(setRuns, 100);
    return () => {
      u1();
      u2();
    };
  }, []);

  // Import a recording handed off from the Chrome extension via #import=<b64>.
  useEffect(() => {
    const m = window.location.hash.match(/import=([^&]+)/);
    if (!m) return;
    (async () => {
      try {
        const json = decodeURIComponent(escape(atob(decodeURIComponent(m[1]))));
        const rec = JSON.parse(json);
        const id = await createTest({
          name: rec.name || 'Recorded test',
          module: rec.module || '',
          startUrl: rec.startUrl || '',
          steps: rec.steps || [],
          createdBy: user?.email || null,
        });
        window.history.replaceState(null, '', window.location.pathname);
        navigate(`/tests/${id}`);
      } catch (e) {
        alert('Could not import recording: ' + e.message);
        window.history.replaceState(null, '', window.location.pathname);
      }
    })();
  }, [user]);

  const lastRunFor = (testId) => runs.find((r) => r.testId === testId);

  async function handleNew() {
    const id = await createTest({
      name: 'New test',
      startUrl: import.meta.env.VITE_DEFAULT_BASE_URL || '',
      createdBy: user?.email || null,
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

  async function handleRunModule(name, list) {
    const active = list.filter((t) => t.status !== 'archived');
    if (active.length === 0) return;
    if (!confirm(`Run all ${active.length} test(s) in "${name}"?`)) return;
    setBusy('module:' + name);
    try {
      for (const t of active) await triggerRun(t);
      navigate('/runs');
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (!tests) return <Spinner label="Loading tests…" />;

  // Group tests by module. Known modules first (in their defined order),
  // then any other modules alphabetically, with "Uncategorized" last.
  const groups = {};
  for (const t of tests) {
    const m = moduleOf(t);
    (groups[m] ||= []).push(t);
  }
  const names = Object.keys(groups).sort((a, b) => {
    const rank = (n) =>
      n === 'Uncategorized' ? 999 : DEFAULT_MODULES.indexOf(n) === -1 ? 500 : DEFAULT_MODULES.indexOf(n);
    const ra = rank(a);
    const rb = rank(b);
    return ra === rb ? a.localeCompare(b) : ra - rb;
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Tests</h1>
          <p className="text-sm text-gray-400">
            Record with the Lev.Charity QA Chrome extension, or build steps by hand.
          </p>
        </div>
        <button onClick={handleNew} className="btn-primary">
          + New test
        </button>
      </div>

      {tests.length === 0 ? (
        <div className="card mt-6 p-10 text-center text-gray-400">
          No tests yet. Install the recorder extension and capture a flow on{' '}
          <span className="text-gray-200">lev.charity</span>, or create one manually.
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {names.map((name) => (
            <section key={name}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                  {name}{' '}
                  <span className="ml-1 text-gray-600">({groups[name].length})</span>
                </h2>
                <button
                  onClick={() => handleRunModule(name, groups[name])}
                  disabled={busy === 'module:' + name}
                  className="btn-ghost py-1 px-2.5 text-xs"
                >
                  {busy === 'module:' + name ? 'Queuing…' : '▶ Run all'}
                </button>
              </div>
              <div className="card divide-y divide-ink-600">
                {groups[name].map((t) => {
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
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
