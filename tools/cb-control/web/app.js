// PWA entry point. Five views: sessions, terminal, compose, search, settings.

import { Api, loadSettings, saveSettings } from './api.js';
import { ansiToHtml } from './ansi.js';
import * as biometric from './biometric.js';

const state = {
  settings: loadSettings(),
  api: null,
  view: 'sessions',
  currentSession: null,     // full row of selected session (for terminal view)
  ws: null,
  ansiState: { classes: new Set() },
  pollTimer: null,
  composeSelection: new Set(),
};

state.api = new Api(state.settings);

// --- View routing ---------------------------------------------------------

const views = {
  sessions: document.getElementById('view-sessions'),
  terminal: document.getElementById('view-terminal'),
  compose:  document.getElementById('view-compose'),
  search:   document.getElementById('view-search'),
  settings: document.getElementById('view-settings'),
};
const titleEl = document.getElementById('view-title');
const backBtn = document.getElementById('nav-back');
const searchBtn = document.getElementById('nav-search');
const composeBtn = document.getElementById('nav-compose');
const settingsBtn = document.getElementById('nav-settings');

function showView(name) {
  state.view = name;
  for (const [k, el] of Object.entries(views)) el.hidden = (k !== name);
  titleEl.textContent = { sessions: 'Sessions', terminal: 'Terminal', compose: 'Compose', search: 'Search', settings: 'Settings' }[name];
  backBtn.hidden = (name === 'sessions');
  searchBtn.hidden = (name !== 'sessions');
  composeBtn.hidden = (name !== 'sessions');
  settingsBtn.hidden = (name === 'settings');

  if (name === 'sessions') { stopStream(); refreshSessions(); startPolling(); }
  else stopPolling();
  if (name === 'compose') loadComposeList();
  if (name === 'settings') hydrateSettingsForm();
}

backBtn.addEventListener('click', () => {
  if (state.view === 'terminal') { stopStream(); showView('sessions'); }
  else showView('sessions');
});
searchBtn.addEventListener('click', () => showView('search'));
composeBtn.addEventListener('click', () => showView('compose'));
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

function bridgeBadge(s) {
  if (!s.live) return '<span class="badge ended">ended</span>';
  if (s.bridge === 'pty') return '<span class="badge live">live · pty</span>';
  if (s.bridge === 'tmux') return '<span class="badge live">live · tmux</span>';
  return '<span class="badge live">live</span>';
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
    const isExternal = s.source === 'external';
    li.innerHTML = `
      <div class="row">
        <span class="label"></span>
        ${bridgeBadge(s)}
        ${isExternal ? '<span class="badge external">external</span>' : ''}
      </div>
      <div class="cwd"></div>
      <div class="meta"></div>
    `;
    li.querySelector('.label').textContent = s.label || 'claude';
    li.querySelector('.cwd').textContent = s.cwd;
    li.querySelector('.meta').textContent = `${s.id.slice(0, 8)} · pid ${s.pid ?? '—'} · ${s.branch ? s.branch + ' · ' : ''}${new Date(s.created_at).toLocaleTimeString()}`;
    li.addEventListener('click', () => openTerminal(s));
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
    await biometric.require();
    const s = await state.api.spawnSession({ cwd, label, args });
    await refreshSessions();
    const full = await state.api.getSession(s.id);
    openTerminal(full);
  } catch (err) { alert('Spawn failed: ' + err.message); }
});

// --- Terminal view --------------------------------------------------------

const termEl = document.getElementById('terminal');
const termMetaEl = document.getElementById('terminal-meta');
const inputForm = document.getElementById('input-form');
const inputText = document.getElementById('input-text');

function openTerminal(s) {
  state.currentSession = s;
  termEl.innerHTML = '';
  state.ansiState.classes = new Set();

  const live = Boolean(s.live);
  const bridge = s.bridge ?? (s.source === 'external' && s.tmux_pane ? 'tmux' : s.source === 'daemon' ? 'pty' : 'none');
  termMetaEl.innerHTML = '';
  const mkChip = (label, value) => {
    const span = document.createElement('span');
    span.textContent = `${label}: ${value}`;
    return span;
  };
  termMetaEl.appendChild(mkChip('id', s.id.slice(0, 8)));
  if (s.cwd) termMetaEl.appendChild(mkChip('cwd', s.cwd));
  if (s.branch) termMetaEl.appendChild(mkChip('branch', s.branch));
  termMetaEl.appendChild(mkChip('bridge', bridge));
  termMetaEl.appendChild(mkChip('status', live ? 'live' : 'ended'));

  showView('terminal');
  startStream(s.id);
}

function appendOutput(text) {
  const html = ansiToHtml(text, state.ansiState);
  termEl.insertAdjacentHTML('beforeend', html);
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
      if (msg.type === 'error') appendOutput(`\n[error: ${msg.error}]\n`);
    };
    ws.onerror = () => appendOutput('\n[stream error]\n');
  } catch (err) {
    appendOutput('\n[stream failed: ' + err.message + ']\n');
  }
}

function stopStream() {
  if (state.ws) { try { state.ws.close(); } catch {} state.ws = null; }
}

async function sendToCurrent(data, enter) {
  if (!state.currentSession) return;
  await biometric.require();
  if (state.ws && state.ws.readyState === 1) {
    state.ws.send(JSON.stringify({ type: 'input', data: enter ? data + '\r' : data }));
  } else {
    await state.api.sendInput(state.currentSession.id, data, !!enter);
  }
}

inputForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputText.value;
  try {
    await sendToCurrent(text, true);
    inputText.value = '';
  } catch (err) { alert('Send failed: ' + err.message); }
});

document.getElementById('send-interrupt').addEventListener('click', async () => {
  try { await sendToCurrent('\x03', false); } catch (err) { alert(err.message); }
});
document.getElementById('send-esc').addEventListener('click', async () => {
  try { await sendToCurrent('\x1b', false); } catch (err) { alert(err.message); }
});
document.getElementById('send-tab').addEventListener('click', async () => {
  try { await sendToCurrent('\t', false); } catch (err) { alert(err.message); }
});

// --- Compose view ---------------------------------------------------------

const composeListEl = document.getElementById('compose-list');
const composeText = document.getElementById('compose-text');
const composeEnter = document.getElementById('compose-enter');
const composeForm = document.getElementById('compose-form');
const composeCount = document.getElementById('compose-count');
const composeStatus = document.getElementById('compose-status');

async function loadComposeList() {
  composeStatus.textContent = '';
  composeListEl.innerHTML = '';
  try {
    const { sessions } = await state.api.listSessions();
    const live = sessions.filter((s) => s.live);
    if (!live.length) {
      composeListEl.innerHTML = '<li class="empty">No live sessions.</li>';
    }
    for (const s of live) {
      const li = document.createElement('li');
      const id = 'compose-cb-' + s.id;
      li.innerHTML = `
        <input type="checkbox" id="${id}" value="${s.id}">
        <label for="${id}" style="flex:1">
          <div><b></b> <span class="meta"></span></div>
          <div class="meta cwd"></div>
        </label>
      `;
      li.querySelector('b').textContent = s.label || 'claude';
      li.querySelector('.meta:not(.cwd)').textContent = `${s.bridge ?? 'none'} · ${s.id.slice(0, 8)}`;
      li.querySelector('.cwd').textContent = s.cwd;
      const cb = li.querySelector('input');
      cb.checked = state.composeSelection.has(s.id);
      cb.addEventListener('change', () => {
        if (cb.checked) state.composeSelection.add(s.id);
        else state.composeSelection.delete(s.id);
        updateComposeCount();
      });
      composeListEl.appendChild(li);
    }
    updateComposeCount();
  } catch (err) {
    composeStatus.className = 'status err';
    composeStatus.textContent = 'Error: ' + err.message;
  }
}
function updateComposeCount() { composeCount.textContent = String(state.composeSelection.size); }

composeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const ids = [...state.composeSelection];
  if (!ids.length) { composeStatus.textContent = 'Select at least one session.'; return; }
  try {
    await biometric.require(true);  // force fresh for broadcast
    const { results } = await state.api.compose(ids, composeText.value, composeEnter.checked);
    const okCount = results.filter((r) => r.ok).length;
    composeStatus.className = 'status ok';
    composeStatus.textContent = `Relayed to ${okCount}/${results.length}.`;
    composeText.value = '';
  } catch (err) {
    composeStatus.className = 'status err';
    composeStatus.textContent = 'Error: ' + err.message;
  }
});

// --- Search view ----------------------------------------------------------

const searchForm = document.getElementById('search-form');
const searchQuery = document.getElementById('search-query');
const searchResultsEl = document.getElementById('search-results');
const searchEmptyEl = document.getElementById('search-empty');

searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = searchQuery.value.trim();
  searchResultsEl.innerHTML = '';
  searchEmptyEl.hidden = true;
  if (!q) return;
  try {
    const { results } = await state.api.search(q, 100);
    if (!results.length) { searchEmptyEl.hidden = false; return; }
    for (const r of results) {
      const li = document.createElement('li');
      const labelSafe = escapeHtml(r.label ?? 'claude');
      const idSafe = escapeHtml(r.session_id.slice(0, 8));
      const when = new Date(r.ts).toLocaleString();
      li.innerHTML = `
        <div class="row">
          <span class="label">${labelSafe}</span>
          <span class="meta">${escapeHtml(r.kind)} · ${idSafe} · ${when}</span>
        </div>
        <div class="snippet">${r.snippet ?? ''}</div>
      `;
      li.addEventListener('click', async () => {
        try {
          const full = await state.api.getSession(r.session_id);
          openTerminal(full);
        } catch (err) { alert('Could not open session: ' + err.message); }
      });
      searchResultsEl.appendChild(li);
    }
  } catch (err) {
    searchResultsEl.innerHTML = `<li class="empty">Error: ${escapeHtml(err.message)}</li>`;
  }
});
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// --- Settings + biometric -------------------------------------------------

const settingsForm = document.getElementById('settings-form');
const serverUrlInput = document.getElementById('server-url');
const tokenInput = document.getElementById('server-token');
const defaultCwdInput = document.getElementById('default-cwd');
const settingsStatus = document.getElementById('settings-status');
const bioStatusEl = document.getElementById('biometric-status');
const bioEnableBtn = document.getElementById('biometric-enable');
const bioDisableBtn = document.getElementById('biometric-disable');

function renderBiometricStatus() {
  if (!biometric.isSupported()) {
    bioStatusEl.textContent = 'Not supported on this device.';
    bioEnableBtn.disabled = true; bioDisableBtn.disabled = true;
    return;
  }
  if (biometric.isEnabled()) {
    bioStatusEl.textContent = 'Enabled. You will be prompted before each relay.';
    bioEnableBtn.hidden = true; bioDisableBtn.hidden = false;
  } else {
    bioStatusEl.textContent = 'Disabled.';
    bioEnableBtn.hidden = false; bioDisableBtn.hidden = true;
  }
}

function hydrateSettingsForm() {
  serverUrlInput.value = state.settings.serverUrl;
  tokenInput.value = state.settings.token;
  defaultCwdInput.value = state.settings.defaultCwd;
  settingsStatus.textContent = '';
  renderBiometricStatus();
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
    await probe.listSessions();
    settingsStatus.className = 'status ok';
    settingsStatus.textContent = 'Connected ✓';
  } catch (err) {
    settingsStatus.className = 'status err';
    settingsStatus.textContent = 'Failed: ' + err.message;
  }
});

bioEnableBtn.addEventListener('click', async () => {
  try { await biometric.enable(); renderBiometricStatus(); }
  catch (err) { alert('Could not enable: ' + err.message); }
});
bioDisableBtn.addEventListener('click', () => { biometric.disable(); renderBiometricStatus(); });

// --- Service worker registration -----------------------------------------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* fine */ });
}

// --- Boot -----------------------------------------------------------------

showView('sessions');
if (!state.settings.token) showView('settings');
