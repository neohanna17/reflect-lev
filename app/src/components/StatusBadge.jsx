const STYLES = {
  passed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  failed: 'bg-red-500/15 text-red-400 border-red-500/30',
  error: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  running: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  queued: 'bg-ink-600 text-gray-300 border-ink-500',
  skipped: 'bg-ink-600 text-gray-400 border-ink-500',
  active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  archived: 'bg-ink-600 text-gray-400 border-ink-500',
};

export default function StatusBadge({ status }) {
  const cls = STYLES[status] || STYLES.queued;
  const dot = status === 'running' || status === 'queued';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${cls}`}
    >
      {dot && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {status || 'unknown'}
    </span>
  );
}
