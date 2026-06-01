import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { startProductTour } from '../components/ProductTour';

// In-dashboard onboarding guide. Data-driven: each section has a title, a
// short summary, rich explanatory content, and an optional video URL. To add a
// walkthrough video later, just drop a URL into `video` for that section —
// YouTube/Loom/Vimeo links and direct .mp4 files are both supported.
const SECTIONS = [
  {
    id: 'overview',
    title: 'What this dashboard does',
    summary: 'The big picture before you start.',
    body: (
      <>
        <p>
          This is the QA dashboard for <strong>lev.charity</strong>. It runs automated
          browser tests that click through the real site exactly like a person would, then
          tells you what passed, what broke, and shows you a video of each run.
        </p>
        <p>There are three ways a test gets created:</p>
        <ul>
          <li>
            <strong>Record it</strong> with the Chrome extension — click through the site
            once and it writes the steps for you.
          </li>
          <li>
            <strong>Build it by hand</strong> in the dashboard — add steps one at a time.
          </li>
          <li>
            <strong>Reuse a component</strong> — drop a saved building block (like “Log in”)
            into any test.
          </li>
        </ul>
        <p>
          Tests are grouped into <strong>Modules</strong> (Ecards, Donations, Campaigns…)
          and can be bundled into <strong>Suites</strong> that run together on a schedule.
          Every execution shows up under <strong>Runs</strong>, and <strong>Reports</strong>{' '}
          rolls it all up into pass rates and trends.
        </p>
      </>
    ),
  },
  {
    id: 'extension-install',
    title: '1 · Install the Chrome recorder',
    summary: 'Load the extension and point it at this dashboard.',
    body: (
      <>
        <p>The recorder is a small Chrome extension. To install it:</p>
        <ol>
          <li>
            Open Chrome and go to <code>chrome://extensions</code>.
          </li>
          <li>
            Turn on <strong>Developer mode</strong> (toggle, top-right).
          </li>
          <li>
            Click <strong>Load unpacked</strong> and choose the <code>extension</code>{' '}
            folder from this project.
          </li>
          <li>
            The <strong>Lev.Charity QA</strong> tile appears. Pin it so the icon stays in
            your toolbar.
          </li>
        </ol>
        <p>
          <strong>One-time setup:</strong> click the extension icon →{' '}
          <strong>Settings</strong>, and set the <strong>Dashboard URL</strong> to{' '}
          <code>https://lev-charity.netlify.app</code>. This is how “Send to dashboard”
          knows where your recordings should land (saved under your signed-in account).
        </p>
      </>
    ),
  },
  {
    id: 'record',
    title: '2 · Record a test',
    summary: 'Click through the site once; the steps write themselves.',
    body: (
      <>
        <p>
          Open the page on lev.charity where your flow starts, then click the extension
          icon and press <strong>● Start recording</strong>. The popup closes so you can
          use the page normally.
        </p>
        <p>While recording, a small toolbar sits in the bottom-right corner:</p>
        <ul>
          <li>
            Every <strong>click</strong>, <strong>typing</strong>, <strong>dropdown</strong>{' '}
            choice and <strong>Enter</strong> key is captured automatically. Page
            navigations are recorded too.
          </li>
          <li>
            <strong>Assert text</strong> — click this, then click any text on the page to
            add a check that the text is present.
          </li>
          <li>
            <strong>Assert visible</strong> — click this, then click an element to check it
            shows up.
          </li>
          <li>
            <strong>Stop</strong> when you’re done (or use Stop in the popup).
          </li>
        </ul>
        <p>
          After stopping, the popup shows your steps. Give the test a <strong>name</strong>{' '}
          and pick a <strong>Module</strong>, then press{' '}
          <strong>Send to dashboard →</strong>. A new tab opens here with the test pre-filled
          — review and save it. (You can also <strong>Copy JSON</strong> or{' '}
          <strong>Download</strong> if you’d rather import it manually.)
        </p>
        <p>
          Recording something you’ll reuse — like the login flow? Press{' '}
          <strong>Save as reusable component →</strong> instead. It lands on the{' '}
          <Link to="/components">Components</Link> page as a building block you can drop into
          any test.
        </p>
        <p className="tip">
          Tip: don’t type real passwords while recording. Record the login flow, then swap
          the password field for a secure token — see <em>Logging in safely</em> below.
        </p>
      </>
    ),
  },
  {
    id: 'edit',
    title: '3 · Build or edit a test by hand',
    summary: 'Add, reorder and fine-tune steps in the editor.',
    body: (
      <>
        <p>
          Open any test (from a Module, or the one you just recorded) to see its step
          editor. Use <strong>+ Add step</strong> to append a step and choose its action:
        </p>
        <ul>
          <li>
            <strong>Navigate to URL</strong> — go to a page.
          </li>
          <li>
            <strong>Click</strong> / <strong>Type</strong> / <strong>Press</strong> /{' '}
            <strong>Select</strong> / <strong>Hover</strong> — interact with the page.
          </li>
          <li>
            <strong>Wait</strong> — pause for a moment or for something to appear.
          </li>
          <li>
            <strong>Assert text / visible / URL</strong> — checks that make the step (and the
            run) fail if they’re not true.
          </li>
        </ul>
        <p>
          Each interactive step stores one or more <strong>selectors</strong> (ways to find
          the element). The runner tries them in order and can <strong>self-heal</strong> —
          if the first selector no longer matches, it falls back to the others and tells you
          which one worked, so small site changes don’t break your tests.
        </p>
        <p>
          Drag steps to reorder, edit values inline, and <strong>Save</strong> when done.
        </p>
      </>
    ),
  },
  {
    id: 'components',
    title: '4 · Reusable components (incl. Log in)',
    summary: 'Save a flow once, drop it into many tests.',
    body: (
      <>
        <p>
          A <strong>component</strong> is a saved sequence of steps you can reuse — most
          commonly <strong>Log in</strong>. Build it once and every test can start with it.
        </p>
        <p>To create one:</p>
        <ol>
          <li>
            Build the steps in any test, then click <strong>Save as component</strong>{' '}
            (it skips any component steps and asks for a name), <em>or</em>
          </li>
          <li>
            Go to <Link to="/components">Components</Link> and create one from scratch, <em>or</em>
          </li>
          <li>
            In the Chrome recorder, after recording, press{' '}
            <strong>Save as reusable component →</strong>.
          </li>
        </ol>
        <p>
          To use a component inside a test, click <strong>+ Add component</strong> in the
          step editor and pick it. At run time the component’s steps are expanded inline.
        </p>
      </>
    ),
  },
  {
    id: 'login',
    title: '5 · Logging in safely',
    summary: 'Test the real login without exposing your password.',
    body: (
      <>
        <p>
          Tests can log into lev.charity without ever storing the real credentials. The
          email and password live as encrypted <strong>GitHub Actions secrets</strong> and
          are only filled in at the moment of typing — they never touch the saved test, the
          logs, or the database.
        </p>
        <p>In your <strong>Log in</strong> component, set the field values to these tokens:</p>
        <ul>
          <li>
            Email field → <code>{'{{LEV_TEST_EMAIL}}'}</code>
          </li>
          <li>
            Password field → <code>{'{{LEV_TEST_PASSWORD}}'}</code>
          </li>
        </ul>
        <p>
          The runner replaces <code>{'{{LEV_TEST_EMAIL}}'}</code> and{' '}
          <code>{'{{LEV_TEST_PASSWORD}}'}</code> with the real values only as it types them
          into the form. Setup (done once by an admin): create a dedicated test account on
          lev.charity and add <code>LEV_TEST_EMAIL</code> / <code>LEV_TEST_PASSWORD</code> as
          repository secrets in GitHub.
        </p>
      </>
    ),
  },
  {
    id: 'run',
    title: '6 · Run a test',
    summary: 'Run the whole thing, or just part of it.',
    body: (
      <>
        <p>
          From a test, press <strong>Run</strong>. A run is queued, the GitHub Actions
          runner picks it up, drives a real Chrome browser through your steps, and reports
          back here live.
        </p>
        <p>You don’t always have to run the whole test:</p>
        <ul>
          <li>
            <strong>Run from a step</strong> — start partway through (handy when the early
            steps are slow and you’re debugging the end).
          </li>
          <li>
            <strong>Run up to a step</strong> — stop early.
          </li>
        </ul>
        <p className="tip">
          Note: partial runs skip visual baseline checks, because the screenshots wouldn’t
          line up with the full-run baselines.
        </p>
      </>
    ),
  },
  {
    id: 'results',
    title: '7 · Read the results',
    summary: 'Video, trace, screenshots and self-heal notes.',
    body: (
      <>
        <p>
          Open any run under <Link to="/runs">Runs</Link> to see what happened. Each run
          gives you:
        </p>
        <ul>
          <li>
            <strong>Status &amp; duration</strong> — pass, fail, error, or still running.
          </li>
          <li>
            <strong>Recording</strong> — a full video of the browser session.
          </li>
          <li>
            <strong>Trace</strong> — download the Playwright trace and drop it on{' '}
            <code>trace.playwright.dev</code> to step through the DOM and network.
          </li>
          <li>
            <strong>Steps</strong> — each step with its status, a screenshot (📷), the error
            message if it failed, and a note if a step <strong>self-healed</strong> via a
            fallback selector.
          </li>
          <li>
            <strong>Visual changes</strong> — a ⚠ badge with the % of pixels that differ from
            the baseline; click 🔍 to see the diff.
          </li>
        </ul>
        <p>
          Need to run it again? Use <strong>↻ Re-run</strong> — it repeats the same run
          (including any partial range and setup component).
        </p>
      </>
    ),
  },
  {
    id: 'suites',
    title: '8 · Suites &amp; scheduling',
    summary: 'Group tests and run them automatically.',
    body: (
      <>
        <p>
          A <strong>Suite</strong> is a named group of tests. On the{' '}
          <Link to="/suites">Suites</Link> page you can:
        </p>
        <ul>
          <li>Run the whole suite on demand.</li>
          <li>
            Put it on a <strong>schedule</strong> (e.g. hourly, or part of the daily sweep)
            so it runs on its own.
          </li>
          <li>
            Add <strong>before / after components</strong> — e.g. run “Accept cookies” then
            “Log in” before every test, and “Log out” after. They’re applied to every test in
            the suite in order, so you don’t repeat those steps in each test.
          </li>
          <li>
            <strong>Pick tests by module and search</strong> — filter the list down, then tick
            the ones to include (or “Select all”). Each suite collapses to a one-line summary
            so the page stays readable as you add more.
          </li>
        </ul>
        <p>
          The daily sweep runs every active test; the hourly job runs only the suites whose
          schedule is due that hour.
        </p>
        <p className="tip">
          <strong>What is a suite, really?</strong> It’s “a checklist that runs together.”
          Group tests by the user journey they cover, not by who wrote them — so when a
          journey breaks, one suite goes red and tells you exactly which area to look at.
        </p>
        <p>
          <strong>Good suites to start with:</strong>
        </p>
        <ul>
          <li>
            <strong>Critical path (run hourly)</strong> — the handful of tests that must
            never break: log in, open a campaign, make a donation, see the receipt. Setup
            component: <em>Log in</em>. If this suite is green, the site basically works.
          </li>
          <li>
            <strong>Donations (run daily)</strong> — every donation variation: one-off,
            recurring, different amounts, failed-card handling. Setup component:{' '}
            <em>Log in</em>.
          </li>
          <li>
            <strong>Ecards &amp; Campaigns (run daily)</strong> — create / edit / preview /
            send flows for each module, grouped so a content change that breaks previews
            shows up in one place.
          </li>
          <li>
            <strong>Admin &amp; Settings (run daily)</strong> — permissions, account
            settings, CRM. These change less often, so daily is plenty.
          </li>
        </ul>
        <p>
          <strong>Why before/after components matter:</strong> almost every test needs you
          logged in first. Instead of pasting the login steps into 30 tests (and updating all
          30 when the login page changes), add your <em>Log in</em> component to the suite’s
          “Run before each test” list once. It runs before every test in the suite, and you
          maintain the login flow in exactly one place. The “Run after each test” list is the
          mirror image — handy for a <em>Log out</em> or cleanup component.
        </p>
      </>
    ),
  },
  {
    id: 'reports',
    title: '9 · Reports',
    summary: 'Pass rates, flaky tests and trends.',
    body: (
      <>
        <p>
          <Link to="/reports">Reports</Link> rolls up recent runs into a health view: overall
          pass rate, health per module, the tests that fail most, <strong>flaky</strong>{' '}
          tests (ones that both passed and failed in the window), the slowest tests, and a
          list of recent failures. Switch the window between the last 7 days, 30 days, or
          all time.
        </p>
      </>
    ),
  },
  {
    id: 'bugs',
    title: '10 · File a Jira-ready bug',
    summary: 'Turn a failure into a ticket in two clicks.',
    body: (
      <>
        <p>
          On a failed run, click <strong>Create bug report</strong>. It builds a ready-to-paste
          ticket: a summary, the failing step and error, numbered steps to reproduce, and
          links to the screenshot, recording, trace and visual diff (links stay valid for a
          year).
        </p>
        <p>
          Press <strong>Copy ticket</strong> and paste it into your tracker. If you set your
          Jira site and project key (saved in your browser), the{' '}
          <strong>Open Jira create screen</strong> link pre-fills the summary for you.
        </p>
      </>
    ),
  },
];

function Video({ url }) {
  if (!url) return null;
  // Direct video file → <video>. Anything else (YouTube/Loom/Vimeo) → <iframe>.
  const isFile = /\.(mp4|webm|ogg)(\?.*)?$/i.test(url);
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-ink-600 bg-black">
      {isFile ? (
        <video src={url} controls className="w-full" />
      ) : (
        <div className="aspect-video">
          <iframe
            src={url}
            title="Walkthrough"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        </div>
      )}
    </div>
  );
}

export default function Guide() {
  const [openId, setOpenId] = useState(SECTIONS[0].id);

  const toc = useMemo(
    () => SECTIONS.map((s) => ({ id: s.id, title: s.title })),
    [],
  );

  return (
    <div>
      <h1 className="text-xl font-semibold">Onboarding guide</h1>
      <p className="text-sm text-gray-500">
        A step-by-step walkthrough for adding, running and reporting on tests — plus the
        Chrome recorder.
      </p>

      <div className="mt-5 flex flex-col gap-3 rounded-lg border border-brand/30 bg-brand/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-semibold text-gray-900">New here? Take the interactive tour</div>
          <p className="text-sm text-gray-500">
            A guided walkthrough that jumps to every button across the dashboard — Modules,
            Runs, Suites, Components and Reports — and explains exactly what each one does.
          </p>
        </div>
        <button onClick={() => startProductTour()} className="btn-primary shrink-0">
          ▶ Start interactive walkthrough
        </button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr]">
        {/* Table of contents */}
        <nav className="hidden lg:block">
          <div className="sticky top-8 space-y-1">
            {toc.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setOpenId(t.id);
                  // Defer until after the accordion re-renders: opening this
                  // section (and collapsing the previous one above it) changes
                  // the layout, so scrolling synchronously lands in the wrong
                  // place. Two frames guarantees layout has settled.
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() =>
                      document
                        .getElementById(`sec-${t.id}`)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                    ),
                  );
                }}
                className={`block w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                  openId === t.id
                    ? 'bg-brand/10 text-brand'
                    : 'text-gray-500 hover:bg-ink-700 hover:text-gray-800'
                }`}
                dangerouslySetInnerHTML={{ __html: t.title }}
              />
            ))}
          </div>
        </nav>

        {/* Accordion of sections */}
        <div className="space-y-3">
          {SECTIONS.map((s) => {
            const open = openId === s.id;
            return (
              <div key={s.id} id={`sec-${s.id}`} className="card overflow-hidden scroll-mt-8">
                <button
                  onClick={() => setOpenId(open ? null : s.id)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                >
                  <span>
                    <span
                      className="block font-semibold"
                      dangerouslySetInnerHTML={{ __html: s.title }}
                    />
                    <span className="text-sm text-gray-500">{s.summary}</span>
                  </span>
                  <span className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}>
                    ›
                  </span>
                </button>
                {open && (
                  <div className="guide-body border-t border-ink-600 px-5 py-4 text-sm leading-relaxed text-gray-700">
                    {s.body}
                    <Video url={s.video} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
