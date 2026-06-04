import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { watchRecentRuns, watchTests, deleteRun } from '../lib/db';
import StatusBadge from '../components/StatusBadge';
import TargetBadge from '../components/TargetBadge';
import DataBadge from '../components/DataBadge';
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
const isFail = (s) => s === 'failed' || s === 'error';

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
  if (runs.some((r) => isFail(r.status))) return 'failed';
  if (runs.length && runs.every((r) => r.status === 'passed')) return 'passed';
  return 'failed';
}

// Turn a flat (newest-first) run list into ordered entries: each is either a
// single standalone run or a grouped suite run.
function buildEntries(runs) {
  const entries = [];
  const bySuiteRun = {};
  for (const r of runs) {
    if (r.suiteRunId) {
      let e = bySuiteRun[r.suiteRunId];
      if (!e) {
        e = { kind: 'suite', id: r.suiteRunId, suiteName: r.suiteName || 'Suite', runs: [], sortTs: toMs(r.startedAt) };
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

// All run ids contained in an entry (a single run, or every test of a suite).
const runIdsOf = (e) => (e.kind === 'suite' ? e.runs.map((r) => r.id) : [e.run.id]);

const NCOLS = 7;

export default function Runs() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState(null);
  const [tests, setTests] = useState([]);
  const [status, setStatus] = useState('all');
  const [module, setModule] = useState('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState('time');
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);

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

  const modules = useMemo(() => [...new Set(Object.values(moduleByTest))].sort(), [moduleByTest]);

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

  const statusEntries = useMemo(() => {
    if (status === 'all') return entries;
    return entries.filter((e) => {
      const st = e.kind === 'suite' ? suiteStatus(e.runs) : e.run.status;
      if (status === 'failed') return isFail(st);
      if (status === 'passed') return st === 'passed';
      if (status === 'running') return st === 'running' || st === 'queued';
      return true;
    });
  }, [entries, status]);

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
      if (!map.has(key)) map.set(key, { key, label, isSuite: e.kind === 'suite', entries: [] });
      map.get(key).entries.push(e);
    }
    return [...map.values()].sort((a, b) => {
      if (a.key === '__individual__') return 1;
      if (b.key === '__individual__') return -1;
      return a.label.localeCompare(b.label);
    });
  }, [statusEntries]);

  // Every run id currently visible (used by select-all and cleanup helpers).
  const visibleRunIds = useMemo(() => statusEntries.flatMap(runIdsOf), [statusEntries]);
  const failedVisibleIds = useMemo(
    () =>
      statusEntries.flatMap((e) =>
        (e.kind === 'suite' ? e.runs : [e.run]).filter((r) => isFail(r.status)).map((r) => r.id),
      ),
    [statusEntries],
  );

  if (!runs) return <Spinner label="Loading runs…" />;

  // ----- selection helpers -----
  const toggleIds = (ids, on) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  const toggleOne = (id) => toggleIds([id], !selected.has(id));
  const clearSel = () => setSelected(new Set());
  const allVisibleSelected = visibleRunIds.length > 0 && visibleRunIds.every((id) => selected.has(id));
  const selectFailed = () => setSelected(new Set(failedVisibleIds));

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} run(s)? Their video, trace and screenshots are cleaned up automatically. This cannot be undone.`))
      return;
    setDeleting(true);
    try {
      await Promise.all([...selected].map((id) => deleteRun(id).catch(() => {})));
      clearSel();
    } finally {
      setDeleting(false);
    }
  }

  const groups = view === 'time' ? timeGroups : suiteGroups;
  const shownCount = visibleRunIds.length;

  const rowProps = { moduleByTest, selected, toggleOne, toggleIds, navigate };

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
        <select className="input max-w-[180px]" value={module} onChange={(e) => setModule(e.target.value)}>
          <option value="all">All modules</option>
          {modules.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          className="input max-w-[200px]"
          placeholder="Search test or suite…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="ml-auto text-xs text-gray-500">
          {shownCount} of {runs.length}
        </span>
      </div>

      {/* Cleanup / bulk-delete bar */}
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-ink-600 bg-white px-3 py-2 text-xs">
        {selected.size > 0 ? (
          <>
            <span className="font-medium text-gray-700">{selected.size} selected</span>
            <button onClick={deleteSelected} disabled={deleting} className="btn-danger py-1 px-2.5">
              {deleting ? 'Deleting…' : `Delete ${selected.size} selected`}
            </button>
            <button onClick={clearSel} className="btn-ghost py-1 px-2.5">
              Clear
            </button>
          </>
        ) : (
          <>
            <span className="text-gray-500">Clean up:</span>
            <button
              onClick={selectFailed}
              disabled={failedVisibleIds.length === 0}
              className="btn-ghost py-1 px-2.5"
              title="Select every failed run shown, so you can delete them in one go"
            >
              Select failed ({failedVisibleIds.length})
            </button>
            <span className="text-gray-400">
              or tick rows to select. Selecting a suite row selects all its tests.
            </span>
          </>
        )}
      </div>

      {statusEntries.length === 0 ? (
        <div className="card mt-4 p-10 text-center text-gray-500">No runs match these filters.</div>
      ) : (
        <div className="card mt-4 overflow-x-auto" data-tour="runs-list">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-600 text-left text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="w-8 px-3 py-2">
                  <CheckBox
                    checked={allVisibleSelected}
                    indeterminate={!allVisibleSelected && visibleRunIds.some((id) => selected.has(id))}
                    onChange={(on) => toggleIds(visibleRunIds, on)}
                    title="Select all shown"
                  />
                </th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold">Test</th>
                <th className="hidden px-2 py-2 font-semibold sm:table-cell">Module</th>
                <th className="hidden px-2 py-2 font-semibold lg:table-cell">Triggered by</th>
                <th className="hidden px-2 py-2 text-right font-semibold sm:table-cell">Duration</th>
                <th className="px-2 py-2 text-right font-semibold">When</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.key}>
                <tr className="bg-gray-50">
                  <td colSpan={NCOLS} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    <span className="flex items-center gap-1.5">
                      {g.isSuite && <span className="text-brand">◆</span>}
                      {g.label}
                    </span>
                  </td>
                </tr>
                {g.entries.map((e) =>
                  e.kind === 'suite' ? (
                    <SuiteRows key={e.id} entry={e} {...rowProps} hideName={view === 'suite'} />
                  ) : (
                    <RunRow key={e.id} run={e.run} {...rowProps} />
                  ),
                )}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}

// A checkbox that supports the indeterminate (partial) state.
function CheckBox({ checked, indeterminate, onChange, title }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      title={title}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 accent-brand"
    />
  );
}

// A single run as a table row.
function RunRow({ run, moduleByTest, selected, toggleOne, navigate, nested = false }) {
  const go = () => navigate(`/runs/${run.id}`);
  return (
    <tr
      className={`cursor-pointer border-b border-ink-600 last:border-0 hover:bg-ink-700/40 ${
        nested ? 'bg-brand/[0.02]' : ''
      }`}
      onClick={go}
    >
      <td className={`px-3 py-2.5 ${nested ? 'border-l-2 border-brand/30' : ''}`} onClick={(e) => e.stopPropagation()}>
        <CheckBox checked={selected.has(run.id)} onChange={() => toggleOne(run.id)} title="Select run" />
      </td>
      <td className="px-2 py-2.5">
        <StatusBadge status={run.status} />
      </td>
      <th scope="row" className="max-w-0 px-2 py-2.5 text-left font-medium">
        <span className="flex items-center gap-1.5">
          {nested && <span className="shrink-0 text-brand/40">↳</span>}
          <span className="truncate">{run.testName}</span>
          <TargetBadge target={run.target} className="shrink-0" />
          <DataBadge label={run.dataLabel} className="shrink-0 max-w-[160px]" />
        </span>
      </th>
      <td className="hidden px-2 py-2.5 text-xs text-gray-500 sm:table-cell">
        {moduleByTest[run.testId] || '—'}
      </td>
      <td className="hidden px-2 py-2.5 text-xs text-gray-500 lg:table-cell">
        <span className="block max-w-[180px] truncate">{run.triggeredBy || '—'}</span>
      </td>
      <td className="hidden px-2 py-2.5 text-right text-xs text-gray-500 sm:table-cell">
        {fmtDuration(run.durationMs)}
      </td>
      <td className="px-2 py-2.5 text-right text-xs text-gray-500">{timeAgo(run.startedAt)}</td>
    </tr>
  );
}

// A suite execution: a header row with the rolled-up pass/fail, then (when
// expanded) one indented row per test that ran in it.
function SuiteRows({ entry, moduleByTest, selected, toggleOne, toggleIds, navigate, hideName }) {
  const [open, setOpen] = useState(false);
  const st = suiteStatus(entry.runs);
  const passed = entry.runs.filter((r) => r.status === 'passed').length;
  const total = entry.runs.length;
  const failed = entry.runs.filter((r) => isFail(r.status)).length;
  const totalMs = entry.runs.reduce((sum, r) => sum + (r.durationMs || 0), 0);
  const ids = entry.runs.map((r) => r.id);
  const allSel = ids.every((id) => selected.has(id));
  const someSel = ids.some((id) => selected.has(id));
  const toggleOpen = () => setOpen((o) => !o);

  const pillClass =
    st === 'passed'
      ? 'bg-green-500/15 text-green-700'
      : st === 'running'
        ? 'bg-blue-500/15 text-blue-700'
        : 'bg-red-500/15 text-red-700';

  return (
    <>
      <tr className="border-b border-ink-600 bg-brand/[0.05] hover:bg-brand/[0.09]">
        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <CheckBox
            checked={allSel}
            indeterminate={someSel}
            onChange={(on) => toggleIds(ids, on)}
            title="Select all tests in this suite run"
          />
        </td>
        <td className="px-2 py-2.5 cursor-pointer" onClick={toggleOpen}>
          <StatusBadge status={st} />
        </td>
        {/* Name cell truncates cleanly — the pass/fail pill lives in its own
            column so nothing overlaps. */}
        <th scope="row" className="max-w-0 px-2 py-2.5 text-left cursor-pointer" onClick={toggleOpen}>
          <span className="flex items-center gap-1.5">
            <span className={`shrink-0 text-brand/60 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
            <span className="shrink-0 text-brand">◆</span>
            <span className="truncate font-semibold text-gray-800">
              {hideName ? 'Suite run' : entry.suiteName}
            </span>
          </span>
        </th>
        <td className="hidden px-2 py-2.5 sm:table-cell">
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${pillClass}`}>
            {passed}/{total} passed{failed ? ` · ${failed} failed` : ''}
          </span>
        </td>
        <td className="hidden px-2 py-2.5 text-xs text-gray-400 lg:table-cell">
          Suite · {total} test{total === 1 ? '' : 's'}
        </td>
        <td className="hidden px-2 py-2.5 text-right text-xs text-gray-500 sm:table-cell">
          {fmtDuration(totalMs)}
        </td>
        <td className="px-2 py-2.5 text-right text-xs text-gray-500">{timeAgo(entry.sortTs)}</td>
      </tr>
      {open &&
        entry.runs.map((r) => (
          <RunRow
            key={r.id}
            run={r}
            moduleByTest={moduleByTest}
            selected={selected}
            toggleOne={toggleOne}
            navigate={navigate}
            nested
          />
        ))}
    </>
  );
}
