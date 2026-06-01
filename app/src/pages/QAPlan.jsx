import { useEffect, useMemo, useState } from 'react';
import { QA_PLAN } from '../lib/qaPlan';
import { watchQaStatus, setQaStatus } from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { timeAgo } from '../lib/format';

// The three states a plan task moves through. Everything starts "In testing"
// (assigned to everyone); "Bugs found" is what counts toward the fail rate.
const STATUSES = [
  {
    value: 'in_testing',
    label: 'In testing',
    chip: 'bg-gray-100 text-gray-600 ring-1 ring-gray-300',
    active: 'bg-gray-700 text-white',
    dot: 'bg-gray-400',
    bar: 'bg-gray-300',
    text: 'text-gray-600',
  },
  {
    value: 'bugs_found',
    label: 'Failed',
    chip: 'bg-red-500/10 text-red-700 ring-1 ring-red-400/40',
    active: 'bg-red-600 text-white',
    dot: 'bg-red-500',
    bar: 'bg-red-500',
    text: 'text-red-600',
  },
  {
    value: 'passed',
    label: 'Passed',
    chip: 'bg-green-500/10 text-green-700 ring-1 ring-green-400/40',
    active: 'bg-green-600 text-white',
    dot: 'bg-green-500',
    bar: 'bg-green-500',
    text: 'text-green-600',
  },
];
const STATUS_BY = Object.fromEntries(STATUSES.map((s) => [s.value, s]));
const DEFAULT_STATUS = 'in_testing';

const PRIORITY_CLASS = {
  P0: 'bg-red-500/15 text-red-700',
  P1: 'bg-orange-500/15 text-orange-700',
  P2: 'bg-blue-500/15 text-blue-700',
  P3: 'bg-gray-200 text-gray-600',
};

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

function tally(tasks, statusMap) {
  const c = { in_testing: 0, bugs_found: 0, passed: 0, total: tasks.length };
  for (const t of tasks) {
    const s = statusMap[t.id]?.status || DEFAULT_STATUS;
    c[s] = (c[s] || 0) + 1;
  }
  return c;
}

// A thin stacked bar: green (passed) · red (bugs) · grey (in testing).
function ProgressBar({ counts, height = 'h-2.5' }) {
  const { passed, bugs_found, in_testing, total } = counts;
  if (!total) return <div className={`${height} w-full rounded-full bg-gray-200`} />;
  const seg = (n, cls) =>
    n > 0 ? <div className={cls} style={{ width: `${(n / total) * 100}%` }} /> : null;
  return (
    <div className={`flex ${height} w-full overflow-hidden rounded-full bg-gray-200`}>
      {seg(passed, 'bg-green-500')}
      {seg(bugs_found, 'bg-red-500')}
      {seg(in_testing, 'bg-gray-300')}
    </div>
  );
}

export default function QAPlan() {
  const { user } = useAuth();
  const [statusMap, setStatusMap] = useState({});
  const [selected, setSelected] = useState(null); // module code
  const [filter, setFilter] = useState('all'); // detail-view status filter
  const [saving, setSaving] = useState(null); // task id currently saving

  useEffect(() => watchQaStatus(setStatusMap), []);

  const overall = useMemo(() => {
    const all = QA_PLAN.flatMap((m) => m.tasks);
    return tally(all, statusMap);
  }, [statusMap]);

  const moduleStats = useMemo(
    () => Object.fromEntries(QA_PLAN.map((m) => [m.code, tally(m.tasks, statusMap)])),
    [statusMap],
  );

  async function mark(taskId, status) {
    setSaving(taskId);
    try {
      await setQaStatus(taskId, status, user);
    } finally {
      setSaving(null);
    }
  }

  const current = selected ? QA_PLAN.find((m) => m.code === selected) : null;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">QA Plan</h1>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700">
              Temporary
            </span>
          </div>
          <p className="text-sm text-gray-500">
            LevCharity 2.0 manual test plan — {QA_PLAN.length} modules ·{' '}
            {overall.total} tasks. Mark each as <b>In testing</b>, <b>Failed</b>, or{' '}
            <b>Passed</b>.
          </p>
        </div>
      </div>

      {/* Overall progress */}
      <div className="card mt-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-700">Overall progress</h2>
          <span className="text-xs text-gray-500">
            {overall.passed + overall.bugs_found} of {overall.total} tested
          </span>
        </div>
        <div className="mt-2">
          <ProgressBar counts={overall} height="h-3" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Pass rate" value={`${pct(overall.passed, overall.total)}%`} sub={`${overall.passed} passed`} tone="text-green-600" />
          <Stat label="Fail rate" value={`${pct(overall.bugs_found, overall.total)}%`} sub={`${overall.bugs_found} failed`} tone="text-red-600" />
          <Stat label="In testing" value={`${overall.in_testing}`} sub="not yet resolved" tone="text-gray-600" />
          <Stat label="Total tasks" value={`${overall.total}`} sub={`${QA_PLAN.length} modules`} tone="text-gray-800" />
        </div>
      </div>

      {!current ? (
        /* ---------- Module cards ---------- */
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {QA_PLAN.map((m) => {
            const c = moduleStats[m.code];
            return (
              <button
                key={m.code}
                onClick={() => {
                  setSelected(m.code);
                  setFilter('all');
                }}
                className="card group p-4 text-left transition hover:border-brand/40 hover:shadow-sm"
              >
                <div className="flex items-start gap-2">
                  <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-xs font-bold text-brand">
                    {m.code}
                  </span>
                  <span className="flex-1 text-sm font-semibold leading-snug text-gray-800 group-hover:text-brand">
                    {m.title}
                  </span>
                </div>
                <div className="mt-3">
                  <ProgressBar counts={c} />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-gray-400">{c.total} tasks</span>
                  <span className="flex items-center gap-2">
                    <span className="text-green-600">{pct(c.passed, c.total)}% pass</span>
                    <span className="text-red-600">{pct(c.bugs_found, c.total)}% fail</span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        /* ---------- Selected module detail ---------- */
        <ModuleDetail
          module={current}
          counts={moduleStats[current.code]}
          statusMap={statusMap}
          filter={filter}
          setFilter={setFilter}
          onBack={() => setSelected(null)}
          onMark={mark}
          saving={saving}
        />
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className="rounded-lg border border-ink-600 bg-gray-50 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      <div className="text-xs text-gray-400">{sub}</div>
    </div>
  );
}

function ModuleDetail({ module, counts, statusMap, filter, setFilter, onBack, onMark, saving }) {
  const tasks = module.tasks.filter((t) => {
    if (filter === 'all') return true;
    return (statusMap[t.id]?.status || DEFAULT_STATUS) === filter;
  });

  const FILTERS = [
    { value: 'all', label: `All (${counts.total})` },
    { value: 'in_testing', label: `In testing (${counts.in_testing})` },
    { value: 'bugs_found', label: `Failed (${counts.bugs_found})` },
    { value: 'passed', label: `Passed (${counts.passed})` },
  ];

  return (
    <div className="mt-6">
      <button onClick={onBack} className="btn-ghost mb-3 py-1 px-2 text-xs">
        ← All modules
      </button>

      <div className="card p-4">
        <div className="flex items-start gap-2">
          <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-sm font-bold text-brand">
            {module.code}
          </span>
          <h2 className="flex-1 text-lg font-semibold text-gray-800">{module.title}</h2>
        </div>
        <div className="mt-3">
          <ProgressBar counts={counts} height="h-3" />
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs">
          <span className="text-green-600">{pct(counts.passed, counts.total)}% pass · {counts.passed}</span>
          <span className="text-red-600">{pct(counts.bugs_found, counts.total)}% fail · {counts.bugs_found}</span>
          <span className="text-gray-500">{counts.in_testing} still in testing</span>
        </div>
      </div>

      {/* Status filter */}
      <div className="mt-4 flex flex-wrap gap-1 rounded-lg border border-ink-600 bg-white p-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.value ? 'bg-brand/10 text-brand' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="card mt-3 divide-y divide-ink-600">
        {tasks.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">No tasks in this view.</div>
        )}
        {tasks.map((t) => {
          const meta = statusMap[t.id];
          const status = meta?.status || DEFAULT_STATUS;
          return (
            <div key={t.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-500">
                    {t.id}
                  </span>
                  {t.priority && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        PRIORITY_CLASS[t.priority] || 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      {t.priority}
                    </span>
                  )}
                  {t.type && <span className="text-xs text-gray-400">{t.type}</span>}
                </div>
                <div className="mt-1 text-sm font-medium text-gray-800">{t.feature}</div>
                {t.verify && <div className="mt-0.5 text-xs text-gray-500">{t.verify}</div>}
                {meta?.updatedBy && (
                  <div className={`mt-1 text-xs ${STATUS_BY[status]?.text || 'text-gray-400'}`}>
                    {STATUS_BY[status]?.label} · {meta.updatedBy}
                    {meta.updatedAt ? ` · ${timeAgo(meta.updatedAt)}` : ''}
                  </div>
                )}
              </div>

              {/* Status control */}
              <div className="flex shrink-0 gap-1 rounded-lg border border-ink-600 bg-gray-50 p-1">
                {STATUSES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => onMark(t.id, s.value)}
                    disabled={saving === t.id}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                      status === s.value ? s.active : 'text-gray-500 hover:bg-white'
                    }`}
                    title={`Mark as ${s.label}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
