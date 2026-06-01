import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { getFirstTestId, getFirstRunId } from '../lib/db';

// Interactive product tour. Mounted once inside the Layout (so it can navigate
// via React Router) and started by dispatching a `start-product-tour` window
// event from anywhere (e.g. the Guide page button, or the floating help button).
//
// Steps walk across every main page. `path` switches route before a step; the
// tour waits for the step's target element to appear before highlighting it.
// Elements are matched by `data-tour="…"` anchors placed throughout the app; a
// step with no `element` shows a centred popover. `menu` is the short label
// shown in the jump-to-step dropdown.
const STEPS = [
  {
    path: '/',
    menu: 'Welcome',
    popover: {
      title: '👋 Welcome to Lev.Charity QA',
      description:
        'This quick tour walks through every part of the dashboard and what each button does. Use Next / Back, jump to any step with the “Steps” menu, or press Esc to leave any time.',
    },
  },

  // ---- Sidebar ----
  {
    path: '/',
    element: '[data-tour="nav-modules"]',
    menu: 'Sidebar · Modules',
    popover: {
      title: 'Modules',
      description: 'Home. Your tests grouped by area of the site (Campaigns, Donations…).',
      side: 'right',
    },
  },
  {
    element: '[data-tour="nav-runs"]',
    menu: 'Sidebar · Runs',
    popover: { title: 'Runs', description: 'Every test execution, newest first.', side: 'right' },
  },
  {
    element: '[data-tour="nav-suites"]',
    menu: 'Sidebar · Suites',
    popover: {
      title: 'Suites',
      description: 'Groups of tests you run together — on demand or on a schedule.',
      side: 'right',
    },
  },
  {
    element: '[data-tour="nav-components"]',
    menu: 'Sidebar · Components',
    popover: {
      title: 'Components',
      description: 'Reusable blocks of steps — like “Log in” — that you drop into many tests.',
      side: 'right',
    },
  },
  {
    element: '[data-tour="nav-reports"]',
    menu: 'Sidebar · Reports',
    popover: {
      title: 'Reports',
      description: 'Pass rates, module health, flaky and slowest tests, recent failures.',
      side: 'right',
    },
  },
  {
    element: '[data-tour="nav-guide"]',
    menu: 'Sidebar · Guide',
    popover: {
      title: 'Guide',
      description: 'The written, step-by-step onboarding — and the button to relaunch this tour.',
      side: 'right',
    },
  },
  {
    element: '[data-tour="nav-tech"]',
    menu: 'Sidebar · Tech guide',
    popover: {
      title: 'Tech guide',
      description: 'How it all works under the hood: Playwright, GitHub Actions, Firebase — plus how to add new members.',
      side: 'right',
    },
  },
  {
    element: '[data-tour="nav-feedback"]',
    menu: 'Sidebar · Feature feedback',
    popover: {
      title: 'Feature feedback',
      description: 'Leave a note, feature request or change you’d like — the admin reviews these and marks them planned or done.',
      side: 'right',
    },
  },
  {
    element: '[data-tour="nav-signout"]',
    menu: 'Sidebar · Sign out',
    popover: { title: 'Sign out', description: 'Leave the dashboard. Access is members-only.', side: 'right' },
  },

  // ---- Modules page / creating tests ----
  {
    path: '/',
    menu: 'Creating a test',
    popover: {
      title: '✏️ Two ways to make a test',
      description:
        'There are two ways to create a test. <b>1) Record it</b> with the Chrome extension — click through lev.charity once and it writes the steps for you, then hands them back here. <b>2) Build it by hand</b> with “+ New test”. The next two buttons cover both.',
    },
  },
  {
    path: '/',
    element: '[data-tour="modules-smoke"]',
    menu: 'Modules · Login smoke test',
    popover: {
      title: '+ Login smoke test',
      description:
        'One click creates a starter test that runs your “Log in” component and checks it reached the admin dashboard. The fastest way to confirm login works — a great first test.',
    },
  },
  {
    path: '/',
    element: '[data-tour="modules-new"]',
    menu: 'Modules · New test',
    popover: {
      title: '+ New test',
      description:
        'Create a blank test to build by hand, step by step. Or — better for most flows — record it with the Chrome extension: hit Record, click through the site, then send it here and it lands as a ready-to-run test.',
    },
  },
  {
    path: '/',
    element: '[data-tour="modules-card"]',
    menu: 'Modules · Cards',
    popover: {
      title: 'Module cards',
      description:
        'Each card shows its test count and health — passing / failing / not run. Empty modules are dashed. Click a card to see its tests, then click a test to open the editor where you Run it, Save, set a visual baseline, Save-as-component, archive or delete.',
    },
  },

  // ---- Inside a test (the editor) ----
  {
    resolvePath: async () => {
      const id = await getFirstTestId();
      return id ? `/tests/${id}` : null;
    },
    element: '[data-tour="test-steps"]',
    menu: 'Inside a test · Steps',
    popover: {
      title: 'Building a test, step by step',
      description:
        'This is the test editor — the same screen you land on after recording, or after “+ New test”. Each line is one <b>step</b>. Use <b>+ Add step</b> and pick an action: Navigate, Click, Type, Press, Select, Wait, or an <b>Assert</b> (text / visible / URL). <b>+ Add component</b> drops in a reusable block like “Log in”. Drag to reorder, edit values inline. This is how you build or fine-tune a test by hand.',
      side: 'left',
    },
  },
  {
    element: '[data-tour="test-actions"]',
    menu: 'Inside a test · Run & save',
    popover: {
      title: 'Run, save & more',
      description:
        '<b>▶ Run test</b> queues it on the runner. <b>Save changes</b> stores your edits. <b>Set visual baseline</b> captures the current look so later runs can flag visual changes. <b>Save as component</b> turns these steps into a reusable block. <b>Archive</b> hides a test without deleting it; <b>Delete</b> removes it. The name, module and start-URL fields are just to the left.',
      side: 'left',
    },
  },

  // ---- Runs page ----
  {
    path: '/runs',
    element: '[data-tour="runs-toolbar"]',
    menu: 'Runs · Filters',
    popover: {
      title: 'Filter runs',
      description: 'Narrow by status (all / failed / passed / in progress), module, or test name.',
    },
  },
  {
    path: '/runs',
    element: '[data-tour="runs-list"]',
    menu: 'Runs · History',
    popover: {
      title: 'Run history',
      description:
        'Each row is one execution, newest first — status, test name, module, who triggered it and how long it took. Click any row to open it. Let’s open one now →',
    },
  },
  {
    resolvePath: async () => {
      const id = await getFirstRunId();
      return id ? `/runs/${id}` : null;
    },
    element: '[data-tour="run-summary"]',
    menu: 'A run · Overview',
    popover: {
      title: 'Inside a run',
      description:
        'The top of a run shows <b>status</b>, <b>duration</b>, <b>who triggered it</b>, <b>when</b> and the <b>browser</b>. Up top are <b>↻ Re-run</b>, <b>Delete run</b>, and on failures <b>Create bug report</b> (a ready-to-paste Jira ticket). Below sits the full <b>video recording</b> and a downloadable <b>Playwright trace</b> you can replay on trace.playwright.dev.',
    },
  },
  {
    element: '[data-tour="run-steps"]',
    menu: 'A run · Step results',
    popover: {
      title: 'Step-by-step results',
      description:
        'Every step shows whether it <b>passed or failed</b>, its duration, a <b>📷 screenshot</b>, and — if the look changed — a <b>⚠ visual %</b> badge with a 🔍 diff. A failed step prints its error; a step that <b>self-healed</b> (matched a backup selector) is noted too, so you can see exactly where and why a run broke.',
    },
  },

  // ---- Suites page ----
  {
    path: '/suites',
    element: '[data-tour="suites-new"]',
    menu: 'Suites · New suite',
    popover: { title: '+ New suite', description: 'Create a group of tests that run together.' },
  },
  {
    path: '/suites',
    prepare: () => expandInline('[data-tour="suite-card"]', '[data-tour="suite-panel"]'),
    element: '[data-tour="suite-schedule"]',
    menu: 'A suite · Schedule',
    popover: {
      title: 'Inside a suite',
      description:
        'A suite collapses to a one-line summary; expanding it reveals these settings. Up top you can <b>rename</b> it. Here you set when it <b>runs automatically</b> — manual only, every few hours, daily, weekdays or weekly — and the line below shows the schedule in plain English, in your timezone.',
      side: 'top',
    },
  },
  {
    path: '/suites',
    prepare: () => expandInline('[data-tour="suite-card"]', '[data-tour="suite-panel"]'),
    element: '[data-tour="suite-tests"]',
    menu: 'A suite · Tests & setup',
    popover: {
      title: 'Tests & before/after steps',
      description:
        'Pick which tests belong to the suite — filter by module or search, “Select all”, and remove any with its ✕ chip. Just above this, <b>Run before / after each test</b> let you slot in components like <b>Log in</b> (before) and <b>Log out</b> (after) so you don’t repeat them in every test. <b>▶ Run suite</b> (top-right) runs them all now.',
      side: 'top',
    },
  },

  // ---- Components page ----
  {
    path: '/components',
    element: '[data-tour="components-new"]',
    menu: 'Components · New',
    popover: {
      title: '+ New component',
      description: 'Save a sequence of steps once (like “Log in”) and reuse it across tests.',
    },
  },
  {
    path: '/components',
    prepare: () => expandInline('[data-tour="components-list"]', '[data-tour="component-panel"]'),
    element: '[data-tour="component-panel"]',
    menu: 'Inside a component',
    popover: {
      title: 'Inside a component',
      description:
        'Expanding a component opens its editor. Give it a <b>name</b> and optional description, then build its <b>steps</b> exactly like a test. The key bit: every test that uses this component picks up your edits <b>automatically</b> — fix the login flow here once and all tests get it. (Components can’t contain other components.) You can also create one straight from a recording in the Chrome extension.',
      side: 'top',
    },
  },

  // ---- Reports page ----
  {
    path: '/reports',
    element: '[data-tour="reports-window"]',
    menu: 'Reports · Time window',
    popover: {
      title: 'Time window',
      description: 'Switch between the last 7 days, 30 days, or all time.',
    },
  },
  {
    element: '[data-tour="reports-tiles"]',
    menu: 'Reports · Headline health',
    popover: {
      title: 'Headline health',
      description:
        'Overall pass rate and run counts, then panels for module health, most-failing, flaky and slowest tests, and recent failures. Click any item to jump straight to it.',
    },
  },

  // ---- Finish ----
  {
    path: '/guide',
    element: '[data-tour="nav-guide"]',
    menu: 'Finish',
    popover: {
      title: "🎉 That's the tour!",
      description:
        'Relaunch it any time from the Guide page, or with the floating “Tour” button bottom-right. Read the written guide for more detail. Happy testing!',
      side: 'right',
    },
  },
];

// Resolve once the selector matches (element rendered) or we give up. Pages may
// show a loading spinner first, so we poll generously rather than assume the
// target is present the instant the route changes.
function waitForEl(selector, timeout = 10000) {
  return new Promise((resolve) => {
    if (!selector) return resolve(null);
    const started = Date.now();
    const tick = () => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      if (Date.now() - started > timeout) return resolve(null);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

// Suites and components have no detail route — they expand inline. Wait for the
// first card to render, then click its toggle (the first button inside it) to
// reveal the panel, unless something is already expanded.
async function expandInline(cardSelector, panelSelector) {
  const card = await waitForEl(cardSelector);
  if (!card) return;
  if (!document.querySelector(panelSelector)) {
    card.querySelector('button')?.click();
    await waitForEl(panelSelector, 3000);
  }
}

export default function ProductTour() {
  const navigate = useNavigate();
  const driverRef = useRef(null);
  const navRef = useRef(navigate);
  navRef.current = navigate;

  // Switch route if needed, then wait for the step's target to render.
  // `resolvePath` (async) lets a step drill into a real record — e.g. the first
  // run or test — whose id isn't known ahead of time. If it returns null (no
  // such record yet) we don't navigate; the popover then centres on screen
  // (driver.js falls back gracefully when the element selector isn't found).
  const prepareStep = useCallback(async (step) => {
    let targetPath = step?.path;
    if (step?.resolvePath) {
      try {
        const p = await step.resolvePath();
        if (p) targetPath = p;
      } catch {
        /* keep static path / let the popover centre */
      }
    }
    if (targetPath && targetPath !== window.location.pathname) {
      navRef.current(targetPath);
    }
    // `prepare` runs after navigation — e.g. expand an inline card (suites,
    // components) so the step's target inside it actually renders.
    if (step?.prepare) {
      try {
        await step.prepare();
      } catch {
        /* ignore — the popover will simply centre if nothing expanded */
      }
    }
    await waitForEl(step?.element);
  }, []);

  // Inject a "Steps ▾" jump menu into every popover footer so the user can
  // hop directly to any step.
  const renderJumpMenu = useCallback((popover) => {
    const d = driverRef.current;
    if (!d || !popover?.footerButtons) return;
    const active = d.getActiveIndex();
    const select = document.createElement('select');
    select.className = 'lev-tour-jump';
    select.title = 'Jump to a step';
    STEPS.forEach((s, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${i + 1}. ${s.menu}`;
      if (i === active) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', async (e) => {
      const idx = Number(e.target.value);
      if (idx === d.getActiveIndex()) return;
      await prepareStep(STEPS[idx]);
      d.moveTo(idx);
    });
    // Put the menu on its own full-width row at the top of the footer, above
    // the progress text and the prev/next buttons (styled in index.css).
    const footer = popover.footerButtons.parentElement || popover.footerButtons;
    footer.insertBefore(select, footer.firstChild);
  }, [prepareStep]);

  const start = useCallback(
    async (startIndex = 0) => {
      if (driverRef.current?.isActive?.()) {
        driverRef.current.destroy();
      }
      const d = driver({
        showProgress: true,
        allowClose: true,
        overlayColor: 'rgba(15,23,42,0.55)',
        stagePadding: 6,
        stageRadius: 10,
        popoverClass: 'lev-tour',
        progressText: 'Step {{current}} of {{total}}',
        nextBtnText: 'Next →',
        prevBtnText: '← Back',
        doneBtnText: 'Done',
        steps: STEPS.map((s) => ({ element: s.element, popover: s.popover })),
        onPopoverRender: (popover) => renderJumpMenu(popover),
        onNextClick: async () => {
          const i = d.getActiveIndex();
          const next = STEPS[i + 1];
          if (!next) {
            d.destroy();
            return;
          }
          await prepareStep(next);
          d.moveNext();
        },
        onPrevClick: async () => {
          const i = d.getActiveIndex();
          const prev = STEPS[i - 1];
          if (!prev) {
            d.movePrevious();
            return;
          }
          await prepareStep(prev);
          d.movePrevious();
        },
      });
      driverRef.current = d;
      await prepareStep(STEPS[startIndex]);
      d.drive(startIndex);
    },
    [prepareStep, renderJumpMenu],
  );

  useEffect(() => {
    const handler = (e) => start(e?.detail?.stepIndex || 0);
    window.addEventListener('start-product-tour', handler);
    return () => {
      window.removeEventListener('start-product-tour', handler);
      driverRef.current?.destroy?.();
    };
  }, [start]);

  // Floating "Tour" button — an always-available way back into the walkthrough.
  return (
    <button
      type="button"
      onClick={() => start(0)}
      className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition-transform hover:scale-105 hover:bg-brand-600"
      title="Start the interactive walkthrough"
    >
      <span aria-hidden>🧭</span> Tour
    </button>
  );
}

// Helper any component can import to kick off the tour (optionally at a step).
export function startProductTour(stepIndex = 0) {
  window.dispatchEvent(new CustomEvent('start-product-tour', { detail: { stepIndex } }));
}
