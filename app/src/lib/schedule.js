// Friendly schedule presets <-> cron. The cron is written as a *wall-clock*
// time in the suite's chosen timezone; the runner evaluates it in that same
// timezone (croner) so a "08:00" stays 08:00 across daylight-saving changes.
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

// Curated timezone choices for the schedule picker. The viewer's own timezone
// is added on top of this list by the picker if it isn't already here.
export const TIMEZONES = [
  { value: 'Europe/Berlin', label: 'Central European — Berlin · Paris · Amsterdam (CET/CEST)' },
  { value: 'Europe/London', label: 'United Kingdom — London (GMT/BST)' },
  { value: 'Africa/Johannesburg', label: 'South Africa — Johannesburg (SAST)' },
  { value: 'America/New_York', label: 'US Eastern — New York (ET)' },
  { value: 'UTC', label: 'UTC' },
];

export const tzLabel = (tz) => TIMEZONES.find((t) => t.value === tz)?.label || tz || 'UTC';

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
  return { freq: 'manual', time: '08:00', everyHours: 4, weekday: 1, tz: 'Europe/Berlin' };
}

// Build a cron string whose time-of-day is the literal wall-clock time. The
// runner evaluates this cron in the suite's `tz`, so no UTC conversion is done
// here — that keeps the time fixed (e.g. 08:00) across daylight-saving shifts.
export function buildCron(spec) {
  const s = { ...defaultSpec(), ...(spec || {}) };
  if (s.freq === 'manual') return '';
  if (s.freq === 'hourly') return '0 * * * *';
  if (s.freq === 'everyN') {
    const n = Math.min(23, Math.max(1, Number(s.everyHours) || 4));
    return `0 */${n} * * *`;
  }

  const [h, m] = String(s.time || '08:00').split(':').map((x) => Number(x) || 0);
  if (s.freq === 'daily') return `${m} ${h} * * *`;
  if (s.freq === 'weekdays') return `${m} ${h} * * 1-5`;
  if (s.freq === 'weekly') return `${m} ${h} * * ${Number(s.weekday)}`;
  return '';
}

// Human-readable. Times are in the suite's chosen timezone.
export function describeSchedule(spec) {
  const s = { ...defaultSpec(), ...(spec || {}) };
  if (s.freq === 'manual') return 'No schedule — runs only when you click Run';
  if (s.freq === 'hourly') return 'Every hour';
  if (s.freq === 'everyN') return `Every ${s.everyHours} hours`;
  const t = s.time || '08:00';
  const where = tzLabel(s.tz).split(' — ')[0]; // short region name
  if (s.freq === 'daily') return `Every day at ${t} (${where})`;
  if (s.freq === 'weekdays') return `Weekdays at ${t} (${where})`;
  if (s.freq === 'weekly') {
    const d = WEEKDAYS.find((w) => w.value === Number(s.weekday));
    return `Every ${d ? d.label : 'week'} at ${t} (${where})`;
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
