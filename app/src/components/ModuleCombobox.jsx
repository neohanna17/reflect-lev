import { useEffect, useRef, useState } from 'react';

// A searchable module picker: type to filter existing modules or enter a brand
// new name. Replaces the native <datalist>, which never reliably popped open a
// dropdown. Free text is always allowed — this is a combobox, not a hard list.
export default function ModuleCombobox({ value, onChange, options = [], placeholder }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);

  // Close when clicking away.
  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const q = (value || '').trim().toLowerCase();
  const all = [...new Set(options.filter(Boolean))];
  const matches = q ? all.filter((m) => m.toLowerCase().includes(q)) : all;
  // Offer creating the typed value if it isn't already an exact option.
  const exact = all.some((m) => m.toLowerCase() === q);
  const showCreate = q && !exact;

  const pick = (m) => {
    onChange(m);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && matches[active]) {
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <input
        className="input"
        placeholder={placeholder}
        value={value || ''}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
      />
      {open && (matches.length > 0 || showCreate) && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-ink-600 bg-white py-1 shadow-lg">
          {matches.map((m, i) => (
            <li key={m}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
                onMouseEnter={() => setActive(i)}
                className={`block w-full px-3 py-1.5 text-left text-sm ${
                  i === active ? 'bg-brand/10 text-brand' : 'text-gray-700 hover:bg-ink-700/50'
                }`}
              >
                {m}
              </button>
            </li>
          ))}
          {showCreate && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick((value || '').trim());
                }}
                className="block w-full border-t border-ink-600 px-3 py-1.5 text-left text-sm text-gray-500 hover:bg-ink-700/50"
              >
                Use new module “<span className="font-medium text-gray-700">{(value || '').trim()}</span>”
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
