// Shared test-step vocabulary. The recorder extension produces these; the
// Playwright runner consumes them. Keep this in sync with runner/playback.js
// and extension/recorder.js.

export const STEP_TYPES = {
  navigate: { label: 'Navigate to URL', needs: ['value'] },
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
  'Campaigns',
  'Donations',
  'Page Builder',
  'Ecards',
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

// Browsers / devices a test can run on. Each maps to a Playwright engine and,
// for the mobile presets, a device descriptor. iPhone emulates on WebKit and
// Pixel on Chromium, so installing chromium + webkit in CI covers all four.
// Note: mobile here is Playwright *emulation* (viewport, touch, user-agent) —
// not real Apple/Android hardware (that needs a paid device cloud).
export const TEST_TARGETS = [
  { id: 'chromium', label: 'Chrome', short: 'Chrome', engine: 'chromium', icon: '🖥', kind: 'desktop' },
  { id: 'webkit', label: 'Safari', short: 'Safari', engine: 'webkit', icon: '🧭', kind: 'desktop' },
  { id: 'iphone', label: 'iPhone', short: 'iPhone', engine: 'webkit', icon: '📱', kind: 'mobile', device: 'iPhone 13' },
  { id: 'pixel', label: 'Pixel', short: 'Pixel', engine: 'chromium', icon: '📱', kind: 'mobile', device: 'Pixel 5' },
];

export const DEFAULT_TARGET = 'chromium';

export function targetById(id) {
  return TEST_TARGETS.find((t) => t.id === id) || TEST_TARGETS[0];
}

export function targetLabel(id) {
  return targetById(id).label;
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

// True for component names that look like a login/sign-in step. Used to
// auto-seed new tests with the login component and to offer a quick
// "add login first" button.
export const isLoginComponentName = (name) => /(log|sign)[\s-]*in/i.test(name || '');

export function cryptoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2, 10);
}
