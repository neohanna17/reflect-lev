// Content script: captures user interactions while recording and sends them
// to the background service worker as test steps. Shows a small floating
// toolbar. Relies on RLSelector (selector.js, loaded first).

(function () {
  let recording = false;
  let pendingAssert = null; // null | 'text' | 'visible'
  let toolbar = null;
  let keepAlive = null; // interval that re-appends the toolbar if a SPA wipes it

  const TOOLBAR_ID = '__rl_toolbar__';

  function send(step) {
    chrome.runtime.sendMessage({ type: 'STEP', step });
  }

  function inToolbar(el) {
    return el && el.closest && el.closest(`#${TOOLBAR_ID}`);
  }

  function buildStep(type, el, extra = {}) {
    const sel = el ? RLSelector.selectorsFor(el) : [];
    return {
      id: 'id-' + Math.random().toString(36).slice(2, 10),
      type,
      selectors: sel,
      target: el ? { label: RLSelector.labelFor(el) } : { label: '' },
      value: '',
      ...extra,
    };
  }

  function onClick(e) {
    const el = e.target;
    if (inToolbar(el)) return;
    if (pendingAssert) {
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      if (pendingAssert === 'text' && text) {
        send(buildStep('assertText', el, { value: text }));
      } else {
        send(buildStep('assertVisible', el));
      }
      setAssert(null);
      flash(el, '#22c55e');
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    send(buildStep('click', el));
    flash(el, '#2f6df6');
  }

  function onChange(e) {
    const el = e.target;
    if (inToolbar(el)) return;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'select') {
      send(buildStep('select', el, { value: el.value }));
    } else if (
      tag === 'input' &&
      ['checkbox', 'radio'].includes((el.type || '').toLowerCase())
    ) {
      send(buildStep('click', el));
    } else if (tag === 'input' || tag === 'textarea') {
      const type = (el.type || '').toLowerCase();
      if (['button', 'submit', 'file'].includes(type)) return;
      send(buildStep('type', el, { value: el.value }));
    }
  }

  function onKeydown(e) {
    if (inToolbar(e.target)) return;
    if (e.key === 'Enter') send(buildStep('press', e.target, { value: 'Enter' }));
  }

  function flash(el, color) {
    if (!el || !el.style) return;
    const prev = el.style.outline;
    el.style.outline = `2px solid ${color}`;
    setTimeout(() => {
      el.style.outline = prev;
    }, 350);
  }

  function attach() {
    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('keydown', onKeydown, true);
  }
  function detach() {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('keydown', onKeydown, true);
  }

  // ---- toolbar ----
  function buildToolbar() {
    const bar = document.createElement('div');
    bar.id = TOOLBAR_ID;
    bar.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;' +
      'background:#13141b;color:#e7e9f0;border:1px solid #373b4d;border-radius:14px;padding:10px 12px;' +
      'font:13px/1.2 system-ui,-apple-system,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.45)';
    bar.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center">
        <span style="display:flex;align-items:center;gap:7px;font-weight:600;margin-right:4px">
          <span id="__rl_dot" style="width:9px;height:9px;border-radius:50%;background:#ea4d3d;box-shadow:0 0 0 0 rgba(234,77,61,.6);animation:rlpulse 1.2s infinite"></span>
          <span id="__rl_label">Recording</span>
        </span>
        <button id="__rl_assert_text" style="${btn()}">Assert text</button>
        <button id="__rl_assert_vis" style="${btn()}">Assert visible</button>
        <button id="__rl_stop" style="${btn('#ea4d3d','#fff')}">■ Stop</button>
      </div>
      <div id="__rl_hint" style="display:none;font-size:11.5px;color:#fbbc09">
        Now click the element on the page you want to check.
      </div>
      <style>
        @keyframes rlpulse{0%{box-shadow:0 0 0 0 rgba(234,77,61,.5)}70%{box-shadow:0 0 0 7px rgba(234,77,61,0)}100%{box-shadow:0 0 0 0 rgba(234,77,61,0)}}
        #${TOOLBAR_ID} button:hover{filter:brightness(1.15)}
      </style>
    `;
    bar.querySelector('#__rl_assert_text').onclick = () => setAssert(pendingAssert === 'text' ? null : 'text');
    bar.querySelector('#__rl_assert_vis').onclick = () => setAssert(pendingAssert === 'visible' ? null : 'visible');
    bar.querySelector('#__rl_stop').onclick = () => chrome.runtime.sendMessage({ type: 'STOP' });
    return bar;
  }

  function showToolbar() {
    ensureToolbar();
    // Some single-page apps replace large chunks of the DOM on navigation,
    // which can take our toolbar with it. Re-append it if it goes missing.
    if (!keepAlive) {
      keepAlive = setInterval(() => {
        if (recording && !document.getElementById(TOOLBAR_ID)) ensureToolbar();
      }, 1000);
    }
  }
  function ensureToolbar() {
    if (document.getElementById(TOOLBAR_ID)) return;
    toolbar = buildToolbar();
    document.documentElement.appendChild(toolbar);
    refreshAssertUi();
  }
  function btn(bg = '#262936', color = '#e7e9f0') {
    return `background:${bg};color:${color};border:none;border-radius:8px;padding:6px 10px;cursor:pointer;font:12px system-ui;font-weight:600`;
  }
  function setAssert(mode) {
    pendingAssert = mode;
    document.body && (document.body.style.cursor = mode ? 'crosshair' : '');
    refreshAssertUi();
  }
  // Reflect the current assert mode in the toolbar (active button + hint).
  function refreshAssertUi() {
    if (!toolbar) return;
    const dot = toolbar.querySelector('#__rl_dot');
    const label = toolbar.querySelector('#__rl_label');
    const hint = toolbar.querySelector('#__rl_hint');
    const tBtn = toolbar.querySelector('#__rl_assert_text');
    const vBtn = toolbar.querySelector('#__rl_assert_vis');
    if (dot) dot.style.background = pendingAssert ? '#fbbc09' : '#ea4d3d';
    if (label) label.textContent = pendingAssert ? 'Pick element…' : 'Recording';
    if (hint) hint.style.display = pendingAssert ? 'block' : 'none';
    if (tBtn) tBtn.style.background = pendingAssert === 'text' ? '#2f6df6' : '#262936';
    if (vBtn) vBtn.style.background = pendingAssert === 'visible' ? '#2f6df6' : '#262936';
  }
  function hideToolbar() {
    if (keepAlive) {
      clearInterval(keepAlive);
      keepAlive = null;
    }
    const existing = document.getElementById(TOOLBAR_ID);
    if (existing) existing.remove();
    toolbar = null;
    document.body && (document.body.style.cursor = '');
  }

  function start() {
    if (recording) return;
    recording = true;
    attach();
    showToolbar();
  }
  function stop() {
    recording = false;
    detach();
    hideToolbar();
    setAssert(null);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'START') start();
    else if (msg.type === 'STOP_LOCAL') stop();
  });

  // On (re)load, ask whether this tab is being recorded (survives navigation).
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
    if (chrome.runtime.lastError) return;
    if (state && state.active) start();
  });
})();
