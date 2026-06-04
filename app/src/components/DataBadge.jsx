// A small chip showing which data-variable values a run used (data-driven
// testing). Renders nothing for ordinary runs that have no data label.
export default function DataBadge({ label, className = '' }) {
  if (!label) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand ${className}`}
      title={`Test data: ${label}`}
    >
      <span aria-hidden>🧪</span>
      <span className="truncate">{label}</span>
    </span>
  );
}
