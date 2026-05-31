// Content script: captures user interactions while recording and sends them
// to the background service worker as test steps. Shows a small floating
// toolbar. Relies on RLSelector (selector.js, loaded first).

(function () {
  let recording = false;
  let pendingAssert = null; // null | 'text' | 'visible'
  let toolbar = null;

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
    flash(el, '#6d5efc');
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
  function showToolbar() {
    if (toolbar) return;
    toolbar = document.createElement('div');
    toolbar.id = TOOLBAR_ID;
    toolbar.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:2147483647;display:flex;gap:8px;align-items:center;' +
      'background:#13141b;color:#e7e9f0;border:1px solid #373b4d;border-radius:12px;padding:8px 10px;' +
      'font:13px/1.2 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)';
    toolbar.innerHTML = `
      <span style="display:flex;align-items:center;gap:6px;font-weight:600">
        <span id="__rl_dot" style="width:9px;height:9px;border-radius:50%;background:#ef4444;animation:rlpulse 1s infinite"></span>
        Recording
      </span>
      <button id="__rl_assert_text" style="${btn()}">Assert text</button>
      <button id="__rl_assert_vis" style="${btn()}">Assert visible</button>
      <button id="__rl_stop" style="${btn('#ef4444','#fff')}">Stop</button>
      <style>@keyframes rlpulse{0%,100%{opacity:1}50%{opacity:.3}}</style>
    `;
    document.documentElement.appendChild(toolbar);
    toolbar.querySelector('#__rl_assert_text').onclick = () => setAssert('text');
    toolbar.querySelector('#__rl_assert_vis').onclick = () => setAssert('visible');
    toolbar.querySelector('#__rl_stop').onclick = () =>
      chrome.runtime.sendMessage({ type: 'STOP' });
  }
  function btn(bg = '#262936', color = '#e7e9f0') {
    return `background:${bg};color:${color};border:none;border-radius:8px;padding:5px 9px;cursor:pointer;font:12px system-ui`;
  }
  function setAssert(mode) {
    pendingAssert = mode;
    if (!toolbar) return;
    const dot = toolbar.querySelector('#__rl_dot');
    dot.style.background = mode ? '#22c55e' : '#ef4444';
    document.body && (document.body.style.cursor = mode ? 'crosshair' : '');
  }
  function hideToolbar() {
    if (toolbar) toolbar.remove();
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
