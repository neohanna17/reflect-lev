// Replays a recorded test with Playwright. Implements self-healing: each step
// carries an ordered list of candidate selectors; we try them in order and
// report which one actually matched.

const DEFAULT_TIMEOUT = 8000;
const SELECTOR_TIMEOUT = 4000;

function stepLabel(step) {
  const t = step.target?.label || (step.selectors && step.selectors[0]) || 'element';
  switch (step.type) {
    case 'navigate': return `Go to ${step.value}`;
    case 'click': return `Click ${t}`;
    case 'type': return `Type "${step.value}" into ${t}`;
    case 'press': return `Press ${step.value}`;
    case 'select': return `Select "${step.value}" in ${t}`;
    case 'hover': return `Hover ${t}`;
    case 'wait': return `Wait ${step.value}ms`;
    case 'assertText': return `Assert text "${step.value}"`;
    case 'assertVisible': return `Assert visible: ${t}`;
    case 'assertUrl': return `Assert URL contains "${step.value}"`;
    default: return `${step.type} ${t}`;
  }
}

// Try candidate selectors in order; return { locator, selector, index }.
async function resolve(page, selectors) {
  const list = (selectors || []).filter(Boolean);
  if (list.length === 0) throw new Error('No selectors recorded for this step');
  let lastErr;
  for (let i = 0; i < list.length; i++) {
    const sel = list[i];
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: 'visible', timeout: SELECTOR_TIMEOUT });
      return { locator: loc, selector: sel, index: i };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `None of the ${list.length} selector(s) matched a visible element:\n  ` +
      list.join('\n  ') +
      (lastErr ? `\nlast error: ${lastErr.message}` : ''),
  );
}

async function execStep(page, step, result) {
  switch (step.type) {
    case 'navigate':
      await page.goto(step.value, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT * 2 });
      return;
    case 'wait':
      await page.waitForTimeout(Number(step.value) || 0);
      return;
    case 'assertUrl': {
      const url = page.url();
      if (!url.includes(step.value))
        throw new Error(`URL "${url}" does not contain "${step.value}"`);
      return;
    }
    case 'assertText': {
      const loc = page.getByText(step.value, { exact: false }).first();
      await loc.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT });
      return;
    }
    case 'press': {
      // press into the recorded target if present, else send to the page
      if ((step.selectors || []).length) {
        const { locator, selector, index } = await resolve(page, step.selectors);
        if (index > 0) result.healedWith = selector;
        await locator.press(step.value || 'Enter');
      } else {
        await page.keyboard.press(step.value || 'Enter');
      }
      return;
    }
    default: {
      const { locator, selector, index } = await resolve(page, step.selectors);
      if (index > 0) result.healedWith = selector;
      if (step.type === 'click') await locator.click({ timeout: DEFAULT_TIMEOUT });
      else if (step.type === 'type') await locator.fill(step.value ?? '', { timeout: DEFAULT_TIMEOUT });
      else if (step.type === 'select') await locator.selectOption(step.value, { timeout: DEFAULT_TIMEOUT });
      else if (step.type === 'hover') await locator.hover({ timeout: DEFAULT_TIMEOUT });
      else if (step.type === 'assertVisible') {
        /* resolve() already proved it's visible */
      } else throw new Error(`Unknown step type: ${step.type}`);
    }
  }
}

// Runs every step. `onStep(result, page)` is awaited after each step (used to
// capture + upload a screenshot and stream progress). Stops at first failure.
export async function runTest(page, test, onStep) {
  const results = [];
  let overall = 'passed';

  // If the first step isn't a navigate and the test has a startUrl, go there.
  if (test.startUrl && !(test.steps?.[0]?.type === 'navigate')) {
    await page.goto(test.startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }

  for (const step of test.steps || []) {
    const started = Date.now();
    const result = {
      stepId: step.id || null,
      type: step.type,
      label: stepLabel(step),
      fromComponent: step.fromComponent || null,
      status: 'passed',
      message: '',
      healedWith: null,
      screenshotUrl: null,
      durationMs: 0,
    };
    try {
      await execStep(page, step, result);
    } catch (e) {
      result.status = 'failed';
      result.message = e.message;
      overall = 'failed';
    }
    result.durationMs = Date.now() - started;
    await onStep(result, page);
    results.push(result);
    if (result.status === 'failed') break;
  }

  return { status: overall, results };
}

export { stepLabel };
