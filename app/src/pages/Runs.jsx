import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { watchRecentRuns, watchTests } from '../lib/db';
import StatusBadge from '../components/StatusBadge';
import Spinner from '../components/Spinner';
import { timeAgo, fmtDuration, tsToDate } from '../lib/format';
import { moduleOf } from '../lib/schema';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'failed', label: 'Failed' },
  { value: 'passed', label: 'Passed' },
  { value: 'running', label: 'In progress' },
];

const VIEWS = [
  { value: 'time', label: 'By time' },
  { value: 'suite', label: 'By suite' },
];

const toMs = (t) => tsToDate(t)?.getTime() || 0;

// Bucket a date into a friendly day label relative to today.
function dayBucket(date) {
  if (!date) return { key: 'unknown', label: 'Unknown date', order: -1 };
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d0 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfToday - d0) / 86400000);
  if (diffDays <= 0) return { key: 'today', label: 'Today', order: d0.getTime() };
  if (diffDays === 1) return { key: 'yesterday', label: 'Yesterday', order: d0.getTime() };
  return {
    key: d0.toISOString().slice(0, 10),
    label: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
    order: d0.getTime(),
  };
}

// Roll up a suite-run batch (runs that share a suiteRunId) into one status.
function suiteStatus(runs) {
  if (runs.some((r) => r.status === 'running' || r.status === 'queued')) return 'running';
  if (runs.some((r) => r.status === 'failed' || r.status === 'error')) return 'failed';
  if (runs.length && runs.every((r) => r.status === 'passed')) return 'passed';
  return 'failed';
}

// Turn a flat (newest-first) run list into ordered entries: each is either a
// single standalone run or a grouped suite run (all the tests that ran together
// as one suite execution).
function buildEntries(runs) {
  const entries = [];
  const bySuiteRun = {};
  for (const r of runs) {
    if (r.suiteRunId) {
      let e = bySuiteRun[r.suiteRunId];
      if (!e) {
        e = {
          kind: 'suite',
          id: r.suiteRunId,
          suiteName: r.suiteName || 'Suite',
          runs: [],
          sortTs: toMs(r.startedAt),
        };
        bySuiteRun[r.suiteRunId] = e;
        entries.push(e);
      }
      e.runs.push(r);
      e.sortTs = Math.max(e.sortTs, toMs(r.startedAt));
    } else {
      entries.push({ kind: 'single', id: r.id, run: r, sortTs: toMs(r.startedAt) });
    }
  }
  return entries;
}

export default function Runs() {
  const [runs, setRuns] = useState(null);
  const [tests, setTests] = useState([]);
  const [status, setStatus] = useState('all');
  const [module, setModule] = useState('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState('time');

  useEffect(() => {
    const u1 = watchRecentRuns(setRuns, 200);
    const u2 = watchTests(setTests);
    return () => {
      u1();
      u2();
    };
  }, []);

  const moduleByTest = useMemo(() => {
    const m = {};
    for (const t of tests) m[t.id] = moduleOf(t);
    return m;
  }, [tests]);

  const modules = useMemo(
    () => [...new Set(Object.values(moduleByTest))].sort(),
    [moduleByTest],
  );

  // Module + search filter first (per-run), then we group what survives.
  const baseFiltered = useMemo(() => {
    if (!runs) return [];
    const q = search.trim().toLowerCase();
    return runs.filter((r) => {
      if (module !== 'all' && (moduleByTest[r.testId] || 'Uncategorized') !== module) return false;
      if (q && !(r.testName || '').toLowerCase().includes(q) && !(r.suiteName || '').toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [runs, module, search, moduleByTest]);

  const entries = useMemo(() => buildEntries(baseFiltered), [baseFiltered]);

  // Status filter applies to the *entry*: a single run by its own status, a
  // suite run by its rolled-up pass/fail so "Failed" surfaces failed suites.
  const statusEntries = useMemo(() => {
    if (status === 'all') return entries;
    return entries.filter((e) => {
      const st = e.kind === 'suite' ? suiteStatus(e.runs) : e.run.status;
      if (status === 'failed') return st === 'failed' || st === 'error';
      if (status === 'passed') return st === 'passed';
      if (status === 'running') return st === 'running' || st === 'queued';
      return true;
    });
  }, [entries, status]);

  // ----- grouping for display -----
  const timeGroups = useMemo(() => {
    const map = new Map();
    for (const e of statusEntries) {
      const b = dayBucket(tsToDate(e.sortTs));
      if (!map.has(b.key)) map.set(b.key, { ...b, entries: [] });
      map.get(b.key).entries.push(e);
    }
    return [...map.values()].sort((a, b) => b.order - a.order);
  }, [statusEntries]);

  const suiteGroups = useMemo(() => {
    const map = new Map();
    for (const e of statusEntries) {
      const key = e.kind === 'suite' ? `s:${e.suiteName}` : '__individual__';
      const label = e.kind === 'suite' ? e.suiteName : 'Individual tests';
      if (!map.has(key)) map.set(key, { key, label, isSuite: e.kind === 'suite', entries: [], order: 0 });
      const g = map.get(key);
      g.entries.push(e);
      g.order = Math.max(g.order, e.sortTs);
    }
    // Suites first (alphabetical), individual tests last.
    return [...map.values()].sort((a, b) => {
      if (a.key === '__individual__') return 1;
      if (b.key === '__individual__') return -1;
      return a.label.localeCompare(b.label);
    });
  }, [statusEntries]);

  if (!runs) return <Spinner label="Loading runs…" />;

  const shownCount = statusEntries.reduce((n, e) => n + (e.kind === 'suite' ? e.runs.length : 1), 0);

  return (
    <div>
      <h1 className="text-xl font-semibold">Runs</h1>
      <p className="text-sm text-gray-500">
        Recent test executions, grouped by {view === 'time' ? 'day' : 'suite'}.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2" data-tour="runs-toolbar">
        <div className="flex gap-1 rounded-lg border border-ink-600 bg-white p-1">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              onClick={() => setView(v.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                view === v.value ? 'bg-brand/10 text-brand' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border border-ink-600 bg-white p-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatus(f.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                status === f.value ? 'bg-brand/10 text-brand' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          className="input max-w-[180px]"
          value={module}
          onChange={(e) => setModule(e.target.value)}
        >
          <option value="all">All modules</option>
          {modules.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          className="input max-w-[220px]"
          placeholder="Search test or suite…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="ml-auto text-xs text-gray-500">
          {shownCount} of {runs.length}
        </span>
      </div>

      {statusEntries.length === 0 ? (
        <div className="card mt-4 p-10 text-center text-gray-500">No runs match these filters.</div>
      ) : view === 'time' ? (
        <div className="mt-6 space-y-7" data-tour="runs-list">
          {timeGroups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {g.label}
              </h2>
              <div className="space-y-2">
                {g.entries.map((e) =>
                  e.kind === 'suite' ? (
                    <SuiteRunGroup key={e.id} entry={e} moduleByTest={moduleByTest} />
                  ) : (
                    <div key={e.id} className="card overflow-hidden">
                      <RunRow run={e.run} moduleByTest={moduleByTest} />
                    </div>
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="mt-6 space-y-7" data-tour="runs-list">
          {suiteGroups.map((g) => (
            <section key={g.key}>
              <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {g.isSuite && <span className="text-brand">◆</span>}
                {g.label}
              </h2>
              <div className="space-y-2">
                {g.entries.map((e) =>
                  e.kind === 'suite' ? (
                    <SuiteRunGroup key={e.id} entry={e} moduleByTest={moduleByTest} hideName />
                  ) : (
                    <div key={e.id} className="card overflow-hidden">
                      <RunRow run={e.run} moduleByTest={moduleByTest} />
                    </div>
                  ),
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// A single run as a clickable row.
function RunRow({ run, moduleByTest, nested = false }) {
  return (
    <Link
      to={`/runs/${run.id}`}
      className={`flex items-center gap-4 px-4 py-3 hover:bg-ink-700/50 ${nested ? 'pl-6' : ''}`}
    >
      <StatusBadge status={run.status} />
      <span className="min-w-0 flex-1 truncate font-medium">{run.testName}</span>
      <span className="hidden text-xs text-gray-500 md:inline">
        {moduleByTest[run.testId] || '—'}
      </span>
      {!nested && (
        <span className="hidden text-xs text-gray-500 sm:inline">{run.triggeredBy}</span>
      )}
      <span className="text-xs text-gray-500">{fmtDuration(run.durationMs)}</span>
      <span className="w-20 text-right text-xs text-gray-500">{timeAgo(run.startedAt)}</span>
    </Link>
  );
}

// A suite execution: header with the suite's rolled-up pass/fail, expandable to
// show each test that ran as part of it.
function SuiteRunGroup({ entry, moduleByTest, hideName = false }) {
  const [open, setOpen] = useState(false);
  const st = suiteStatus(entry.runs);
  const passed = entry.runs.filter((r) => r.status === 'passed').length;
  const total = entry.runs.length;

  return (
    <div className="card overflow-hidden ring-1 ring-brand/10">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-700/50"
      >
        <StatusBadge status={st} />
        <span className="flex items-center gap-1.5 truncate font-medium">
          <span className="text-brand">◆</span>
          {hideName ? `Suite run · ${total} test${total === 1 ? '' : 's'}` : entry.suiteName}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            st === 'passed'
              ? 'bg-green-500/15 text-green-700'
              : st === 'running'
                ? 'bg-blue-500/15 text-blue-700'
                : 'bg-red-500/15 text-red-700'
          }`}
        >
          {passed}/{total} passed
        </span>
        <span className="ml-auto text-xs text-gray-500">{timeAgo(entry.sortTs)}</span>
        <span className={`text-gray-300 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && (
        <div className="divide-y divide-ink-600 border-t border-ink-600 bg-gray-50/50">
          {entry.runs.map((r) => (
            <RunRow key={r.id} run={r} moduleByTest={moduleByTest} nested />
          ))}
        </div>
      )}
    </div>
  );
}
