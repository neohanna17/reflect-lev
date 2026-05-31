import { useEffect, useState } from 'react';
import { watchSuites, watchTests, createSuite, saveSuite, deleteSuite } from '../lib/db';
import { triggerRun } from '../lib/triggerRun';
import Spinner from '../components/Spinner';
import {
  FREQUENCIES,
  WEEKDAYS,
  defaultSpec,
  buildCron,
  describeSchedule,
  localTzLabel,
} from '../lib/schedule';

export default function Suites() {
  const [suites, setSuites] = useState(null);
  const [tests, setTests] = useState([]);
  const [running, setRunning] = useState(null);

  useEffect(() => {
    const u1 = watchSuites(setSuites);
    const u2 = watchTests(setTests);
    return () => {
      u1();
      u2();
    };
  }, []);

  if (!suites) return <Spinner label="Loading suites…" />;

  async function handleNew() {
    await createSuite({ name: 'New suite' });
  }

  async function runSuite(suite) {
    setRunning(suite.id);
    try {
      const chosen = tests.filter((t) => (suite.testIds || []).includes(t.id));
      for (const t of chosen) await triggerRun(t);
      alert(`Queued ${chosen.length} run(s).`);
    } catch (e) {
      alert(e.message);
    } finally {
      setRunning(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Suites</h1>
          <p className="text-sm text-gray-400">
            Group tests and run them together — manually or on a schedule.
          </p>
        </div>
        <button onClick={handleNew} className="btn-primary">
          + New suite
        </button>
      </div>

      <div className="mt-6 space-y-4">
        {suites.length === 0 && (
          <div className="card p-10 text-center text-gray-500">No suites yet.</div>
        )}
        {suites.map((s) => (
          <SuiteCard
            key={s.id}
            suite={s}
            tests={tests}
            running={running === s.id}
            onRun={() => runSuite(s)}
          />
        ))}
      </div>
    </div>
  );
}

function SuiteCard({ suite, tests, running, onRun }) {
  const [name, setName] = useState(suite.name);
  const selected = new Set(suite.testIds || []);

  function toggle(id) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    saveSuite(suite.id, { testIds: [...next] });
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="input max-w-xs font-medium"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => saveSuite(suite.id, { name })}
        />
        <div className="ml-auto flex gap-2">
          <button onClick={onRun} disabled={running} className="btn-primary py-1.5 px-3 text-xs">
            {running ? 'Queuing…' : '▶ Run suite'}
          </button>
          <button
            onClick={() => confirm('Delete suite?') && deleteSuite(suite.id)}
            className="btn-danger py-1.5 px-3 text-xs"
          >
            Delete
          </button>
        </div>
      </div>

      <SchedulePicker suite={suite} />

      <div className="mt-3">
        <div className="label">Tests in this suite</div>
        <div className="mt-1 flex flex-wrap gap-2">
          {tests.map((t) => (
            <button
              key={t.id}
              onClick={() => toggle(t.id)}
              className={`rounded-full border px-3 py-1 text-xs ${
                selected.has(t.id)
                  ? 'border-brand bg-brand/15 text-brand'
                  : 'border-ink-500 text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.name}
            </button>
          ))}
          {tests.length === 0 && <span className="text-xs text-gray-500">No tests to add.</span>}
        </div>
      </div>
    </div>
  );
}

function SchedulePicker({ suite }) {
  const [spec, setSpec] = useState({ ...defaultSpec(), ...(suite.scheduleSpec || {}) });

  // Persist both the structured spec (to repopulate this UI) and the UTC cron
  // string the runner evaluates.
  function apply(patch) {
    const next = { ...spec, ...patch };
    setSpec(next);
    saveSuite(suite.id, { scheduleSpec: next, schedule: buildCron(next) });
  }

  const needsTime = ['daily', 'weekdays', 'weekly'].includes(spec.freq);

  return (
    <div className="mt-3 rounded-lg border border-ink-600 bg-ink-900/40 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Run automatically</label>
          <select
            className="input max-w-[220px]"
            value={spec.freq}
            onChange={(e) => apply({ freq: e.target.value })}
          >
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {spec.freq === 'everyN' && (
          <div>
            <label className="label">Every how many hours?</label>
            <input
              type="number"
              min={1}
              max={23}
              className="input max-w-[110px]"
              value={spec.everyHours}
              onChange={(e) => apply({ everyHours: Number(e.target.value) })}
            />
          </div>
        )}

        {spec.freq === 'weekly' && (
          <div>
            <label className="label">Day</label>
            <select
              className="input max-w-[150px]"
              value={spec.weekday}
              onChange={(e) => apply({ weekday: Number(e.target.value) })}
            >
              {WEEKDAYS.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {needsTime && (
          <div>
            <label className="label">Time</label>
            <input
              type="time"
              className="input max-w-[140px]"
              value={spec.time}
              onChange={(e) => apply({ time: e.target.value })}
            />
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-gray-500">
        {describeSchedule(spec)}
        {spec.freq !== 'manual' && ` · times shown in ${localTzLabel()}; scheduled runs fire within the hour.`}
      </p>
    </div>
  );
}
