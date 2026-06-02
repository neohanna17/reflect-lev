import { targetById } from '../lib/schema';

// A small chip showing which browser/device a run executed on.
export default function TargetBadge({ target, className = '' }) {
  const t = targetById(target || 'chromium');
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-ink-700 px-2 py-0.5 text-xs font-medium text-gray-600 ${className}`}
      title={t.kind === 'mobile' ? `${t.label} (mobile emulation)` : t.label}
    >
      <span aria-hidden>{t.icon}</span>
      {t.short}
    </span>
  );
}
