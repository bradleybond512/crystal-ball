// PWA entry point. Three views: sessions, terminal, settings.

import { Api, loadSettings, saveSettings } from './api.js';
import { ansiToHtml } from './ansi.js';

const state = {
  settings: loadSettings(),
  api: null,
  view: 'sessions',
  currentSessionId: null,
  ws: null,
  ansiState: { classes: new Set() },
  pollTimer: null,
};

state.api = new Api(state.settings);

// --- View routing ---------------------------------------------------------

const views = {
  sessions: document.getElementById('view-sessions'),
  terminal: document.getElementById('view-terminal'),
  settings: document.getElementById('view-settings'),
};
const titleEl = document.getElementById('view-title');
const backBtn = document.getElementById('nav-back');
const settingsBtn = document.getElementById('nav-settings');

function showView(name) {
  state.view = name;
  for (const [k, el] of Object.entries(views)) el.hidden = (k !== name);
  titleEl.textContent = { sessions: 'Sessions', terminal: 'Terminal', settings: 'Settings' }[name];
  backBtn.hidden = (name === 'sessions');
  settingsBtn.hidden = (name === 'settings');
  if (name === 'sessions') { stopStream(); refreshSessions(); startPolling(); }
  else stopPolling();
  if (name === 'settings') hydrateSettingsForm();
}

backBtn.addEventListener('click', () => {
  if (state.view === 'terminal') { stopStream(); showView('sessions'); }
  else if (state.view === 'settings') showView('sessions');
});
settingsBtn.addEventListener('click', () => showView('settings'));

// --- Sessions list --------------------------------------------------------

const sessionListEl = document.getElementById('session-list');
const emptyStateEl = document.getElementById('empty-state');

async function refreshSessions() {
  if (!state.settings.token) { renderEmpty('Open Settings and paste the daemon bearer token.'); return; }
  try {
    const { sessions } = await state.api.listSessions();
    renderSessions(sessions);
  } catch (err) {
    renderEmpty('Error: ' + err.message);
  }
}

function renderEmpty(msg) {
  sessionListEl.innerHTML = '';
  emptyStateEl.hidden = false;
  emptyStateEl.textContent = msg;
}

function renderSessions(sessions) {
  sessionListEl.innerHTML = '';
  if (!sessions.length) {
    emptyStateEl.hidden = false;
    emptyStateEl.textContent = 'No sessions yet. Tap + New session or start Claude CLI with the SessionStart hook installed.';
    return;
  }
  emptyStateEl.hidden = true;
  for (const s of sessions) {
    const li = document.createElement('li');
    li.className = 'session-item';
    const isLive = s.live && s.status === 'running';
    const isExternal = s.source === 'external';
    li.innerHTML = `
      <div class="row">
        <span class="label"></span>
        <span class="badge ${isLive ? 'live' : 'ended'}">${isLive ? 'live' : 'ended'}</span>
        ${isExternal ? '<span class="badge external">external</span>' : ''}
      </div>
      <div class="cwd"></div>
      <div class="meta"></div>
    `;
    li.querySelector('.label').textContent = s.label || 'claude';
    li.querySelector('.cwd').textContent = s.cwd;
    li.querySelector('.meta').textContent = `${s.id.slice(0, 8)} · pid ${s.pid ?? '—'} · ${new Date(s.created_at).toLocaleTimeString()}`;
    li.addEventListener('click', () => openTerminal(s.id));
    sessionListEl.appendChild(li);
  }
}

document.getElementById('refresh').addEventListener('click', refreshSessions);

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(refreshSessions, 4000);
}
function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

// --- New session dialog ---------------------------------------------------

const newDialog = document.getElementById('new-session-dialog');
document.getElementById('new-session').addEventListener('click', () => {
  document.getElementById('ns-cwd').value = state.settings.defaultCwd || '';
  newDialog.showModal();
});
newDialog.addEventListener('close', async () => {
  if (newDialog.returnValue !== 'confirm') return;
  const cwd = document.getElementById('ns-cwd').value.trim();
  const label = document.getElementById('ns-label').value.trim();
  const argsRaw = document.getElementById('ns-args').value.trim();
  const args = argsRaw ? argsRaw.split(/\s+/) : [];
  if (!cwd) return;
  try {
    const s = await state.api.spawnSession({ cwd, label, args });
    await refreshSessions();
    openTerminal(s.id);
  } catch (err) { alert('Spawn failed: ' + err.message); }
});

// --- Terminal view --------------------------------------------------------

const termEl = document.getElementById('terminal');
const inputForm = document.getElementById('input-form');
const inputText = document.getElementById('input-text');

function openTerminal(id) {
  state.currentSessionId = id;
  termEl.innerHTML = '';
  state.ansiState.classes = new Set();
  showView('terminal');
  startStream(id);
}

function appendOutput(text) {
  const html = ansiToHtml(text, state.ansiState);
  termEl.insertAdjacentHTML('beforeend', html);
  // keep it bounded
  if (termEl.textContent.length > 500_000) {
    termEl.innerHTML = termEl.innerHTML.slice(termEl.innerHTML.length - 400_000);
  }
  termEl.scrollTop = termEl.scrollHeight;
}

function startStream(id) {
  stopStream();
  try {
    const ws = new WebSocket(state.api.wsUrl(id));
    state.ws = ws;
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'snapshot' || msg.type === 'data') appendOutput(msg.data);
      if (msg.type === 'exit') appendOutput(`\n\n[session exited${msg.exitCode != null ? ' code=' + msg.exitCode : ''}]\n`);
    };
    ws.onclose = () => { /* state.ws cleared on next startStream */ };
    ws.onerror = () => appendOutput('\n[stream error]\n');
  } catch (err) {
    appendOutput('\n[stream failed: ' + err.message + ']\n');
  }
}

function stopStream() {
  if (state.ws) { try { state.ws.close(); } catch {} state.ws = null; }
}

inputForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputText.value;
  if (!state.currentSessionId) return;
  try {
    if (state.ws && state.ws.readyState === 1) {
      state.ws.send(JSON.stringify({ type: 'input', data: text + '\r' }));
    } else {
      await state.api.sendInput(state.currentSessionId, text, true);
    }
    inputText.value = '';
  } catch (err) { alert('Send failed: ' + err.message); }
});

document.getElementById('send-interrupt').addEventListener('click', async () => {
  if (!state.currentSessionId) return;
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'input', data: '\x03' }));
  else await state.api.sendInput(state.currentSessionId, '\x03', false);
});
document.getElementById('send-esc').addEventListener('click', async () => {
  if (!state.currentSessionId) return;
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify({ type: 'input', data: '\x1b' }));
  else await state.api.sendInput(state.currentSessionId, '\x1b', false);
});

// --- Settings -------------------------------------------------------------

const settingsForm = document.getElementById('settings-form');
const serverUrlInput = document.getElementById('server-url');
const tokenInput = document.getElementById('server-token');
const defaultCwdInput = document.getElementById('default-cwd');
const settingsStatus = document.getElementById('settings-status');

function hydrateSettingsForm() {
  serverUrlInput.value = state.settings.serverUrl;
  tokenInput.value = state.settings.token;
  defaultCwdInput.value = state.settings.defaultCwd;
  settingsStatus.textContent = '';
}

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  state.settings = {
    serverUrl: serverUrlInput.value.trim(),
    token: tokenInput.value.trim(),
    defaultCwd: defaultCwdInput.value.trim(),
  };
  saveSettings(state.settings);
  state.api.update(state.settings);
  settingsStatus.className = 'status ok';
  settingsStatus.textContent = 'Saved.';
});

document.getElementById('test-connection').addEventListener('click', async () => {
  const probe = new Api({
    serverUrl: serverUrlInput.value.trim(),
    token: tokenInput.value.trim(),
    defaultCwd: defaultCwdInput.value.trim(),
  });
  settingsStatus.className = 'status';
  settingsStatus.textContent = 'Testing…';
  try {
    await probe.health();
    await probe.listSessions(); // exercises auth
    settingsStatus.className = 'status ok';
    settingsStatus.textContent = 'Connected ✓';
  } catch (err) {
    settingsStatus.className = 'status err';
    settingsStatus.textContent = 'Failed: ' + err.message;
  }
});

// --- Service worker registration -----------------------------------------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* fine */ });
}

// --- Boot -----------------------------------------------------------------

showView('sessions');
if (!state.settings.token) showView('settings');
