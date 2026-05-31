const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const ask = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

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
    const { rl_dashboard_url } = await chrome.storage.local.get('rl_dashboard_url');
    $('noDash').classList.toggle('hidden', !!rl_dashboard_url);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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

$('send').onclick = async () => {
  const { rl_dashboard_url } = await chrome.storage.local.get('rl_dashboard_url');
  if (!rl_dashboard_url) {
    $('noDash').classList.remove('hidden');
    return;
  }
  const test = await buildTest();
  if (test.module) await chrome.storage.local.set({ rl_last_module: test.module });
  const payload = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(test)))));
  const url = rl_dashboard_url.replace(/\/+$/, '') + '/#import=' + payload;
  chrome.tabs.create({ url });
  await ask({ type: 'CLEAR' });
  window.close();
};

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

$('opts').onclick = $('optsLink').onclick = (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
};

render();
