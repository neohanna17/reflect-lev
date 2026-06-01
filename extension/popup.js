const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const ask = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

// Fixed production dashboard. Baked in so colleagues who install the extension
// can't point it elsewhere and don't need to configure anything.
const DASHBOARD_URL = 'https://lev-charity.netlify.app';

function stepLabel(s) {
  const t = s.target?.label || (s.selectors && s.selectors[0]) || '';
  switch (s.type) {
    case 'navigate': return `Go to ${s.value}`;
    case 'type': return `Type "${s.value}" into ${t}`;
    case 'press': return `Press ${s.value}`;
    case 'select': return `Select "${s.value}" in ${t}`;
    case 'assertText': return `Assert text "${s.value}"`;
    case 'assertVisible': return `Assert visible: ${t}`;
    default: return `${s.type} ${t}`;
  }
}

async function render() {
  const state = await ask({ type: 'GET_RECORDING' });
  const recording = state && state.active;
  const hasSteps = state && state.steps && state.steps.length > 0;

  $('idle').classList.toggle('hidden', recording || hasSteps);
  $('active').classList.toggle('hidden', !recording);
  $('review').classList.toggle('hidden', recording || !hasSteps);

  if (recording) {
    $('liveCount').textContent = `${state.steps.length} steps`;
  } else if (hasSteps) {
    $('name').value = state.name || '';
    const { rl_last_module } = await chrome.storage.local.get('rl_last_module');
    if (rl_last_module && !$('module').value) $('module').value = rl_last_module;
    $('steps').innerHTML = state.steps
      .map((s, i) => `<div class="step">${i + 1}. ${escapeHtml(stepLabel(s))}</div>`)
      .join('');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---- Module combobox ----
// A custom searchable dropdown. The native <datalist> never reliably opened
// inside the extension popup, so we render and filter the list ourselves.
const MODULES = [
  'Ecards', 'Campaigns', 'Donations', 'Page Builder', 'Transactions',
  'Settings', 'Permissions', 'Widgets', 'My Account', 'Receipts', 'CRM',
];

function setupModuleCombo() {
  const input = $('module');
  const listEl = $('moduleList');
  if (!input || !listEl) return;
  let active = -1;

  const visibleOptions = () => {
    const q = input.value.trim().toLowerCase();
    const matches = q ? MODULES.filter((m) => m.toLowerCase().includes(q)) : MODULES.slice();
    const exact = MODULES.some((m) => m.toLowerCase() === q);
    return { matches, showCreate: q && !exact };
  };

  const render = () => {
    const { matches, showCreate } = visibleOptions();
    if (matches.length === 0 && !showCreate) {
      listEl.classList.add('hidden');
      return;
    }
    let html = matches
      .map((m, i) => `<div class="combo-opt${i === active ? ' active' : ''}" data-val="${escapeHtml(m)}">${escapeHtml(m)}</div>`)
      .join('');
    if (showCreate) {
      const v = input.value.trim();
      html += `<div class="combo-opt create" data-val="${escapeHtml(v)}">Use new module “${escapeHtml(v)}”</div>`;
    }
    listEl.innerHTML = html;
    listEl.classList.remove('hidden');
  };

  const choose = (val) => {
    input.value = val;
    listEl.classList.add('hidden');
    active = -1;
  };

  input.addEventListener('focus', () => { active = -1; render(); });
  input.addEventListener('input', () => { active = -1; render(); });
  input.addEventListener('keydown', (e) => {
    const opts = [...listEl.querySelectorAll('.combo-opt')];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (listEl.classList.contains('hidden')) return render();
      active = Math.min(active + 1, opts.length - 1);
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      render();
    } else if (e.key === 'Enter' && active >= 0 && opts[active]) {
      e.preventDefault();
      choose(opts[active].dataset.val);
    } else if (e.key === 'Escape') {
      listEl.classList.add('hidden');
    }
  });
  // mousedown (not click) so it fires before the input blur hides the list.
  listEl.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('.combo-opt');
    if (opt) { e.preventDefault(); choose(opt.dataset.val); }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.combo')) listEl.classList.add('hidden');
  });
}

function buildTest() {
  return new Promise(async (res) => {
    const state = await ask({ type: 'GET_RECORDING' });
    res({
      name: $('name').value || state.name || 'Recorded test',
      module: $('module').value.trim(),
      startUrl: state.startUrl || '',
      steps: state.steps || [],
    });
  });
}

$('start').onclick = async () => {
  await send({ type: 'START' });
  // close popup so the user can interact with the page
  window.close();
};

$('stop').onclick = async () => {
  await ask({ type: 'STOP' });
  render();
};

async function sendToDashboard(kind) {
  const test = await buildTest();
  if (kind) test.kind = kind; // 'component' → imported as a reusable component
  if (test.module) await chrome.storage.local.set({ rl_last_module: test.module });
  const payload = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(test)))));
  const url = DASHBOARD_URL.replace(/\/+$/, '') + '/#import=' + payload;
  chrome.tabs.create({ url });
  await ask({ type: 'CLEAR' });
  window.close();
}

$('send').onclick = () => sendToDashboard();
$('sendComponent').onclick = () => sendToDashboard('component');

$('copy').onclick = async () => {
  const test = await buildTest();
  await navigator.clipboard.writeText(JSON.stringify(test, null, 2));
  $('copy').textContent = 'Copied!';
  setTimeout(() => ($('copy').textContent = 'Copy JSON'), 1200);
};

$('download').onclick = async () => {
  const test = await buildTest();
  const blob = new Blob([JSON.stringify(test, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (test.name || 'test').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.json';
  a.click();
};

$('discard').onclick = async () => {
  if (confirm('Discard this recording?')) {
    await ask({ type: 'CLEAR' });
    render();
  }
};

setupModuleCombo();
render();
