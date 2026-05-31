// Friendly schedule presets <-> cron. The runner evaluates cron in UTC, so we
// convert the user's local time of day into UTC when building the expression.
// We also keep a structured `spec` on the suite so the picker can repopulate
// without having to reverse-parse cron.

export const FREQUENCIES = [
  { value: 'manual', label: 'Manual only (no schedule)' },
  { value: 'hourly', label: 'Every hour' },
  { value: 'everyN', label: 'Every few hours' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays (Mon–Fri)' },
  { value: 'weekly', label: 'Once a week' },
];

export const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

export function defaultSpec() {
  return { freq: 'manual', time: '09:00', everyHours: 4, weekday: 1 };
}

// Build a UTC cron string from a local-time spec.
export function buildCron(spec) {
  const s = { ...defaultSpec(), ...(spec || {}) };
  if (s.freq === 'manual') return '';
  if (s.freq === 'hourly') return '0 * * * *';
  if (s.freq === 'everyN') {
    const n = Math.min(23, Math.max(1, Number(s.everyHours) || 4));
    return `0 */${n} * * *`;
  }

  const [h, m] = String(s.time || '09:00').split(':').map((x) => Number(x) || 0);
  // Anchor the local time on a real date so we can read the UTC equivalent,
  // accounting for the timezone offset (and any day rollover for weekly).
  const local = new Date();
  local.setHours(h, m, 0, 0);
  if (s.freq === 'weekly') {
    const diff = (Number(s.weekday) - local.getDay() + 7) % 7;
    local.setDate(local.getDate() + diff);
  }
  const um = local.getUTCMinutes();
  const uh = local.getUTCHours();

  if (s.freq === 'daily') return `${um} ${uh} * * *`;
  if (s.freq === 'weekdays') return `${um} ${uh} * * 1-5`;
  if (s.freq === 'weekly') return `${um} ${uh} * * ${local.getUTCDay()}`;
  return '';
}

// Human-readable, in the viewer's local time.
export function describeSchedule(spec) {
  const s = { ...defaultSpec(), ...(spec || {}) };
  if (s.freq === 'manual') return 'No schedule — runs only when you click Run';
  if (s.freq === 'hourly') return 'Every hour';
  if (s.freq === 'everyN') return `Every ${s.everyHours} hours`;
  const t = s.time || '09:00';
  if (s.freq === 'daily') return `Every day at ${t}`;
  if (s.freq === 'weekdays') return `Weekdays at ${t}`;
  if (s.freq === 'weekly') {
    const d = WEEKDAYS.find((w) => w.value === Number(s.weekday));
    return `Every ${d ? d.label : 'week'} at ${t}`;
  }
  return '';
}

export const localTzLabel = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your local time';
  } catch {
    return 'your local time';
  }
};
