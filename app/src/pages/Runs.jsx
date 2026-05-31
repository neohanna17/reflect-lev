import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { watchRecentRuns } from '../lib/db';
import StatusBadge from '../components/StatusBadge';
import Spinner from '../components/Spinner';
import { timeAgo, fmtDuration } from '../lib/format';

export default function Runs() {
  const [runs, setRuns] = useState(null);

  useEffect(() => watchRecentRuns(setRuns, 100), []);

  if (!runs) return <Spinner label="Loading runs…" />;

  return (
    <div>
      <h1 className="text-xl font-semibold">Runs</h1>
      <p className="text-sm text-gray-400">Most recent test executions across all tests.</p>
      <div className="card mt-6 divide-y divide-ink-600">
        {runs.length === 0 && (
          <div className="p-10 text-center text-gray-500">No runs yet</div>
        )}
        {runs.map((r) => (
          <Link
            key={r.id}
            to={`/runs/${r.id}`}
            className="flex items-center gap-4 px-4 py-3 hover:bg-ink-700/50"
          >
            <StatusBadge status={r.status} />
            <span className="min-w-0 flex-1 truncate font-medium">{r.testName}</span>
            <span className="hidden text-xs text-gray-500 sm:inline">
              {r.triggeredBy}
            </span>
            <span className="text-xs text-gray-500">{fmtDuration(r.durationMs)}</span>
            <span className="w-20 text-right text-xs text-gray-500">
              {timeAgo(r.startedAt)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
