const dash = document.getElementById('dash');
const ok = document.getElementById('ok');

chrome.storage.local.get('rl_dashboard_url').then(({ rl_dashboard_url }) => {
  if (rl_dashboard_url) dash.value = rl_dashboard_url;
});

document.getElementById('save').onclick = async () => {
  await chrome.storage.local.set({ rl_dashboard_url: dash.value.trim() });
  ok.textContent = 'Saved';
  setTimeout(() => (ok.textContent = ''), 1500);
};
