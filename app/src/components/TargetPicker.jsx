import { TEST_TARGETS } from '../lib/schema';

// A row of toggle chips for choosing which browsers / devices to run on.
// `value` is an array of target ids; Chrome stays the sensible default and the
// caller falls back to ['chromium'] if everything is unticked.
export default function TargetPicker({ value, onChange, disabled = false }) {
  const selected = new Set(value || []);

  function toggle(id) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange([...next]);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {TEST_TARGETS.map((t) => {
        const on = selected.has(t.id);
        return (
          <button
            key={t.id}
            type="button"
            disabled={disabled}
            onClick={() => toggle(t.id)}
            aria-pressed={on}
            title={t.kind === 'mobile' ? `${t.label} — mobile emulation` : `${t.label} — desktop`}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
              on
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-ink-600 bg-white text-gray-500 hover:bg-ink-700 hover:text-gray-800'
            }`}
          >
            <span aria-hidden>{t.icon}</span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
