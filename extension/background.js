// Background service worker: owns recording state (persisted in storage.local
// so it survives SW restarts and page navigations) and collects steps.

const KEY = 'rl_recording';

async function getState() {
  const o = await chrome.storage.local.get(KEY);
  return o[KEY] || { active: false, tabId: null, steps: [], name: '', startUrl: '', lastUrl: '' };
}
async function setState(s) {
  await chrome.storage.local.set({ [KEY]: s });
}

function navStep(url) {
  return {
    id: 'id-' + Math.random().toString(36).slice(2, 10),
    type: 'navigate',
    value: url,
    selectors: [],
    target: { label: url },
  };
}

async function startRecording() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { error: 'No active tab' };
  const state = {
    active: true,
    tabId: tab.id,
    name: 'Recorded ' + new Date().toLocaleString(),
    startUrl: tab.url,
    lastUrl: tab.url,
    steps: [navStep(tab.url)],
  };
  await setState(state);
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'START' });
  } catch {
    // content script may not be injected yet (e.g. fresh tab); inject it.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['selector.js', 'content.js'],
    });
  }
  return state;
}

async function stopRecording() {
  const state = await getState();
  state.active = false;
  await setState(state);
  if (state.tabId != null) {
    try {
      await chrome.tabs.sendMessage(state.tabId, { type: 'STOP_LOCAL' });
    } catch {
      /* tab gone */
    }
  }
  return state;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const state = await getState();
    switch (msg.type) {
      case 'GET_STATE':
        sendResponse({ active: state.active && sender.tab && sender.tab.id === state.tabId });
        break;
      case 'GET_RECORDING':
        sendResponse(state);
        break;
      case 'STEP':
        if (state.active && sender.tab && sender.tab.id === state.tabId) {
          state.steps.push(msg.step);
          await setState(state);
        }
        sendResponse({ ok: true });
        break;
      case 'START':
        sendResponse(await startRecording());
        break;
      case 'STOP':
        sendResponse(await stopRecording());
        break;
      case 'CLEAR':
        await setState({
          active: false,
          tabId: null,
          steps: [],
          name: '',
          startUrl: '',
          lastUrl: '',
        });
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({});
    }
  })();
  return true; // async response
});

// Capture in-tab navigations as navigate steps (changeInfo.url is only
// present when the tab's URL actually changes).
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  const state = await getState();
  if (!state.active || tabId !== state.tabId) return;
  if (info.url !== state.lastUrl) {
    state.lastUrl = info.url;
    state.steps.push(navStep(info.url));
    await setState(state);
  }
});
