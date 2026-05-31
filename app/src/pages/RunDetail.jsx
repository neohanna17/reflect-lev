import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { watchRun } from '../lib/db';
import StatusBadge from '../components/StatusBadge';
import Spinner from '../components/Spinner';
import { timeAgo, fmtDuration } from '../lib/format';

export default function RunDetail() {
  const { id } = useParams();
  const [run, setRun] = useState(undefined);
  const [shot, setShot] = useState(null);

  useEffect(() => watchRun(id, setRun), [id]);

  if (run === undefined) return <Spinner label="Loading run…" />;
  if (run === null) return <div className="text-gray-400">Run not found.</div>;

  const pending = run.status === 'queued' || run.status === 'running';

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Link to="/runs" className="hover:text-gray-300">
          Runs
        </Link>
        <span>/</span>
        <Link to={`/tests/${run.testId}`} className="hover:text-gray-300">
          {run.testName}
        </Link>
      </div>

      <div className="card flex flex-wrap items-center gap-x-8 gap-y-2 p-5">
        <div>
          <div className="label">Status</div>
          <StatusBadge status={run.status} />
        </div>
        <div>
          <div className="label">Duration</div>
          <span className="text-sm">{fmtDuration(run.durationMs)}</span>
        </div>
        <div>
          <div className="label">Triggered by</div>
          <span className="text-sm">{run.triggeredBy || '—'}</span>
        </div>
        <div>
          <div className="label">Started</div>
          <span className="text-sm">{timeAgo(run.startedAt)}</span>
        </div>
        <div>
          <div className="label">Browser</div>
          <span className="text-sm capitalize">{run.browser || 'chromium'}</span>
        </div>
      </div>

      {pending && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-300">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-300/40 border-t-blue-300" />
          Waiting for the GitHub Actions runner to pick up and execute this run…
        </div>
      )}

      {run.error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <div className="font-medium">Run error</div>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-xs">{run.error}</pre>
        </div>
      )}

      <h2 className="mt-8 mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
        Steps
      </h2>
      <ol className="space-y-2">
        {(run.steps || []).map((s, i) => (
          <li key={s.stepId || i} className="card overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <StatusBadge status={s.status} />
              <span className="flex-1 truncate text-sm">{s.label || s.type}</span>
              <span className="text-xs text-gray-500">{fmtDuration(s.durationMs)}</span>
              {s.screenshotUrl && (
                <button
                  onClick={() => setShot(s.screenshotUrl)}
                  className="btn-ghost py-1 px-2 text-xs"
                >
                  📷
                </button>
              )}
            </div>
            {s.message && s.status !== 'passed' && (
              <pre className="border-t border-ink-600 bg-ink-900/50 px-4 py-2 font-mono text-xs text-red-300 whitespace-pre-wrap">
                {s.message}
                {s.healedWith ? `\nself-healed via: ${s.healedWith}` : ''}
              </pre>
            )}
            {s.healedWith && s.status === 'passed' && (
              <div className="border-t border-ink-600 bg-amber-500/5 px-4 py-1.5 text-xs text-amber-400">
                self-healed via: <code>{s.healedWith}</code>
              </div>
            )}
          </li>
        ))}
        {(!run.steps || run.steps.length === 0) && !pending && (
          <li className="card p-6 text-center text-sm text-gray-500">
            No step results recorded.
          </li>
        )}
      </ol>

      {shot && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6"
          onClick={() => setShot(null)}
        >
          <img src={shot} alt="screenshot" className="max-h-[90vh] max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
