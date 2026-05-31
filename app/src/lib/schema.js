// Shared test-step vocabulary. The recorder extension produces these; the
// Playwright runner consumes them. Keep this in sync with runner/playback.js
// and extension/recorder.js.

export const STEP_TYPES = {
  navigate: { label: 'Go to URL', needs: ['value'] },
  click: { label: 'Click', needs: ['target'] },
  type: { label: 'Type text', needs: ['target', 'value'] },
  press: { label: 'Press key', needs: ['value'] },
  select: { label: 'Select option', needs: ['target', 'value'] },
  hover: { label: 'Hover', needs: ['target'] },
  wait: { label: 'Wait (ms)', needs: ['value'] },
  assertText: { label: 'Assert text present', needs: ['value'] },
  assertVisible: { label: 'Assert element visible', needs: ['target'] },
  assertUrl: { label: 'Assert URL contains', needs: ['value'] },
  component: { label: 'Reusable component', needs: ['component'] },
};

// Modules group tests by area of the site. These are just starting
// suggestions — anyone can type a new module name on a test and it will
// show up as a group and a suggestion thereafter.
export const DEFAULT_MODULES = [
  'Ecards',
  'Campaigns',
  'Donations',
  'Page Builder',
  'Transactions',
  'Settings',
  'Permissions',
  'Widgets',
  'My Account',
  'Receipts',
  'CRM',
];

export function moduleOf(test) {
  return (test?.module || '').trim() || 'Uncategorized';
}

export function stepLabel(step) {
  const def = STEP_TYPES[step.type];
  const base = def ? def.label : step.type;
  if (step.type === 'component') return `Component: ${step.componentName || '(pick one)'}`;
  if (step.type === 'navigate' || step.type === 'assertUrl') return `${base}: ${step.value || ''}`;
  if (step.type === 'type') return `${base} "${step.value || ''}" into ${describeTarget(step)}`;
  if (step.type === 'assertText') return `${base}: "${step.value || ''}"`;
  if (step.type === 'wait') return `${base}: ${step.value || 0}ms`;
  if (step.type === 'press') return `${base}: ${step.value || ''}`;
  if (step.target) return `${base} on ${describeTarget(step)}`;
  return base;
}

export function describeTarget(step) {
  const t = step.target || {};
  return t.label || t.text || t.primary || (step.selectors && step.selectors[0]) || 'element';
}

export function emptyStep(type = 'click') {
  return {
    id: cryptoId(),
    type,
    value: '',
    selectors: [],
    target: { label: '' },
  };
}

export function cryptoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2, 10);
}
