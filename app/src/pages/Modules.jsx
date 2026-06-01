import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  watchTests,
  watchRecentRuns,
  watchComponents,
  createTest,
  createComponent,
} from '../lib/db';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';
import { moduleOf, DEFAULT_MODULES, cryptoId } from '../lib/schema';

export default function Modules() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tests, setTests] = useState(null);
  const [runs, setRuns] = useState([]);
  const [components, setComponents] = useState([]);
  const [creatingSmoke, setCreatingSmoke] = useState(false);

  useEffect(() => {
    const u1 = watchTests(setTests);
    const u2 = watchRecentRuns(setRuns, 200);
    const u3 = watchComponents(setComponents);
    return () => {
      u1();
      u2();
      u3();
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
        window.history.replaceState(null, '', window.location.pathname);
        if (rec.kind === 'component') {
          await createComponent({
            name: rec.name || 'Recorded component',
            steps: rec.steps || [],
          });
          navigate('/components');
          return;
        }
        const id = await createTest({
          name: rec.name || 'Recorded test',
          module: rec.module || '',
          startUrl: rec.startUrl || '',
          steps: rec.steps || [],
          createdBy: user?.email || null,
        });
        navigate(`/tests/${id}`);
      } catch (e) {
        alert('Could not import recording: ' + e.message);
        window.history.replaceState(null, '', window.location.pathname);
      }
    })();
  }, [user]);

  async function handleNew() {
    const id = await createTest({
      name: 'New test',
      startUrl: import.meta.env.VITE_DEFAULT_BASE_URL || '',
      createdBy: user?.email || null,
    });
    navigate(`/tests/${id}`);
  }

  // One-click starter test that runs the Log in component, then checks the
  // login actually succeeded. Picks the first component whose name looks like a
  // login flow; the user fills in the success check on the test page.
  async function handleLoginSmoke() {
    const login = components.find((c) => /log\s*in|sign\s*in/i.test(c.name || ''));
    if (!login) {
      alert(
        'No login component found. Create a component named “Log in” first (Components page), then try again.',
      );
      return;
    }
    setCreatingSmoke(true);
    try {
      const id = await createTest({
        name: 'Login smoke test',
        module: 'Smoke',
        description:
          'Runs the Log in component, then verifies login landed on the admin dashboard. If your post-login URL changes, update the "Assert URL contains" step.',
        steps: [
          { id: cryptoId(), type: 'component', componentId: login.id, componentName: login.name, selectors: [] },
          { id: cryptoId(), type: 'assertUrl', value: '/admin/dashboard', selectors: [], target: { label: '' } },
        ],
        createdBy: user?.email || null,
      });
      navigate(`/tests/${id}`);
    } finally {
      setCreatingSmoke(false);
    }
  }

  if (!tests) return <Spinner label="Loading modules…" />;

  const lastRunFor = (testId) => runs.find((r) => r.testId === testId);

  // Group tests by module, then summarise health from each test's last run.
  const groups = {};
  for (const t of tests) {
    const m = moduleOf(t);
    (groups[m] ||= []).push(t);
  }
  // Show every default module as a card (even empty ones) plus any custom
  // modules that tests have been filed under.
  const names = [...new Set([...DEFAULT_MODULES, ...Object.keys(groups)])]
    .filter((n) => n !== 'Uncategorized' || (groups[n] && groups[n].length))
    .sort((a, b) => {
    const rank = (n) =>
      n === 'Uncategorized'
        ? 999
        : DEFAULT_MODULES.indexOf(n) === -1
          ? 500
          : DEFAULT_MODULES.indexOf(n);
    const ra = rank(a);
    const rb = rank(b);
    return ra === rb ? a.localeCompare(b) : ra - rb;
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Modules</h1>
          <p className="text-sm text-gray-400">
            Pick a module to see its tests. Record with the Lev.Charity QA extension or add
            tests by hand.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleLoginSmoke}
            disabled={creatingSmoke}
            data-tour="modules-smoke"
            className="btn-ghost"
            title="Create a starter test that logs in and checks it worked"
          >
            {creatingSmoke ? 'Creating…' : '+ Login smoke test'}
          </button>
          <button onClick={handleNew} data-tour="modules-new" className="btn-primary">
            + New test
          </button>
        </div>
      </div>

      {tests.length === 0 && (
        <div className="mt-6 rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 text-sm text-brand">
          No tests yet. Install the recorder extension and capture a flow on{' '}
          <span className="font-medium">lev.charity</span>, or create one manually — every
          module below is empty and ready to fill.
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {names.map((name, idx) => {
          const list = groups[name] || [];
          const empty = list.length === 0;
          let passed = 0;
          let failed = 0;
          let never = 0;
          let needsSteps = 0;
          for (const t of list) {
            if ((t.steps?.length || 0) === 0) {
              needsSteps += 1;
              continue;
            }
            const last = lastRunFor(t.id);
            if (!last) never += 1;
            else if (last.status === 'passed') passed += 1;
            else if (last.status === 'failed' || last.status === 'error') failed += 1;
          }
          return (
            <button
              key={name}
              data-tour={idx === 0 ? 'modules-card' : undefined}
              onClick={() => navigate(`/modules/${encodeURIComponent(name)}`)}
              className={`card p-5 text-left transition-colors hover:bg-ink-700/50 ${
                empty ? 'border-dashed opacity-70' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{name}</span>
                <span className="text-xs text-gray-500">
                  {list.length} test{list.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {empty && (
                  <span className="rounded-full bg-ink-700 px-2 py-0.5 text-gray-500">
                    No tests yet
                  </span>
                )}
                {passed > 0 && (
                  <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-green-700">
                    {passed} passing
                  </span>
                )}
                {failed > 0 && (
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-700">
                    {failed} failing
                  </span>
                )}
                {never > 0 && (
                  <span className="rounded-full bg-ink-700 px-2 py-0.5 text-gray-500">
                    {never} not run
                  </span>
                )}
                {needsSteps > 0 && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-700">
                    {needsSteps} need steps
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
