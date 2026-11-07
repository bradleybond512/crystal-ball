import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { Window } from 'happy-dom';

const projectRoot = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const now = Date.now();
const retired = { id: 'retired-nws', source: 'nws', title: 'Retired warning', body: '', severity: 'critical', timestamp: now + 100, relevanceScore: 100, acknowledged: false, pinned: true };
const ordinary = { ...retired, id: 'ordinary-cyber', source: 'cyber', title: 'Current cyber alert', severity: 'high' };
const active = { ...retired, id: 'active-nws', title: 'Active warning', severity: 'medium' };

function fixture(file: string, extra: Record<string, unknown> = {}) {
  const window = new Window({ url: 'http://127.0.0.1/' });
  const listeners: Array<() => void> = [];
  const store = {
    getAll: () => [retired, ordinary, active],
    getUnacknowledgedCount: () => 3,
    getOperationalAlerts: () => [ordinary, active],
    isOperationalAlert: (alert: typeof retired) => alert.id !== retired.id,
    subscribe: (listener: () => void) => { listeners.push(listener); return () => {}; },
  };
  const inputs: Array<typeof retired[]> = [];
  const invocations: Array<{ command: string; payload: unknown }> = [];
  const dependencies: Record<string, unknown> = {
    '@/services/unified-alerts': { unifiedAlertStore: store },
    '@/utils/critical-ui-announcements': { criticalAnnouncementsSuppressed: () => false, watchCriticalAnnouncementSuppression: () => () => {} },
    './unified-alerts': { unifiedAlertStore: store },
    '@/services/alert-routing': {
      rankAlerts: (alerts: typeof retired[]) => { inputs.push(alerts); return []; },
      panelForAlert: () => 'unified-alert-inbox', scoreAlert: () => 100,
    },
    '@/services/alert-stories': { groupIntoStories: () => [] },
    '@/services/cognition/regime-monitor': { getActiveRegimeShifts: () => ({}), REGIME_SHIFT_EVENT: 'regime' },
    '@/components/ui/icons': { icon: () => '' },
    './ui/icons': { icon: () => '' },
    '@/utils/sanitize': { escapeHtml: (value: unknown) => String(value) },
    '@/services/data-freshness': { dataFreshness: { getAllSources: () => [] } },
    '@/services/app-activity': { isAppActive: () => true },
    '@/config/panels': { DEFAULT_PANELS: {} },
    '@/components/AttentionNavigator': {
      AttentionNavigator: class { mount() {} update() {} destroy() {} },
      applyAttentionDecorations: () => {},
    },
    '@/services/panel-attention': {
      loadReviewLedger: () => [],
      projectPanelAttention: (alerts: typeof retired[]) => { inputs.push(alerts); return { panels: [], severityCounts: {}, promotedPanelIds: [] }; },
    },
    '@/services/tauri-bridge': {
      hasTauriInvokeBridge: () => true,
      tryInvokeTauri: async (command: string, payload: unknown) => { invocations.push({ command, payload }); },
    },
    './summarization': { generateSummary: async () => null },
    ...extra,
  };
  const source = readFileSync(resolve(projectRoot, file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as Record<string, any> };
  Object.defineProperty(window, 'setInterval', { configurable: true, value: () => 1 });
  Object.defineProperty(window, 'clearInterval', { configurable: true, value: () => {} });
  let nextTask = 0;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  const flush = (tasks: Map<number, () => void>) => {
    for (const [id, callback] of [...tasks]) { tasks.delete(id); callback(); }
  };
  const context = vm.createContext({
    module, exports: module.exports,
    require: (name: string) => dependencies[name] ?? (name.startsWith('node:') ? require(name) : {}),
    window, document: window.document, localStorage: window.localStorage,
    CustomEvent: window.CustomEvent, HTMLElement: window.HTMLElement,
    setInterval: () => 1, clearInterval: () => {},
    requestAnimationFrame: (callback: () => void) => { frames.set(++nextTask, callback); return nextTask; },
    cancelAnimationFrame: (id: number) => { frames.delete(id); },
    setTimeout: (callback: () => void) => { timers.set(++nextTask, callback); return nextTask; },
    clearTimeout: (id: number) => { timers.delete(id); },
    console, Date: class extends Date { static now() { return now; } },
  });
  vm.runInContext(compiled, context, { filename: file });
  return { exports: module.exports, window, store, inputs, invocations, listeners, frames, timers, flushFrames: () => flush(frames), flushTimers: () => flush(timers) };
}

test('TriageBar ranks operational warnings while preserving ordinary alerts', () => {
  const f = fixture('src/components/TriageBar.ts');
  const bar = new f.exports.TriageBar();
  try {
    bar.mount(f.window.document.body);
    assert.deepEqual(f.inputs[0]?.map((alert) => alert.id), [ordinary.id, active.id]);
  } finally { bar.destroy(); f.window.happyDOM.abort(); }
});

test('SummaryStrip excludes retired NWS alerts from current severity counts', () => {
  const f = fixture('src/components/SummaryStrip.ts');
  const strip = new f.exports.SummaryStrip({ subscribeStatus: () => () => {}, onStatusClick() {}, onAlertsClick() {}, onFreshnessClick() {}, onRegimeClick() {} });
  try {
    const segment = strip.getElement().querySelector('[data-seg="alerts"]');
    assert.match(segment.getAttribute('title'), /^2 unacknowledged alerts/);
    assert.doesNotMatch(segment.textContent, /crit/);
    assert.match(segment.textContent, /high/);
  } finally { strip.destroy(); f.window.happyDOM.abort(); }
});

test('sidebar heat projects current operational warnings, not retained expired history', () => {
  const f = fixture('src/services/sidebar-heat.ts');
  const controller = f.exports.startSidebarHeat(f.window.document.body);
  try {
    assert.deepEqual(f.inputs[0]?.map((alert) => alert.id), [ordinary.id, active.id]);
  } finally { controller.destroy(); f.window.happyDOM.abort(); }
});

test('menubar status ignores retired NWS critical rows while retaining ordinary high alerts', () => {
  const f = fixture('src/services/native/menubar-status.ts');
  try {
    f.exports.startMenubarStatus();
    f.flushFrames();
    assert.equal(f.invocations[0]?.command, 'set_menubar_status');
    assert.equal((f.invocations[0]?.payload as { level: string }).level, 'yellow');
  } finally { f.exports.stopMenubarStatus(); f.window.happyDOM.abort(); }
});

test('notification digest subscribes only to operational warnings', async () => {
  const f = fixture('src/services/notification-digest.ts');
  try {
    f.exports.initNotificationDigest();
    f.listeners[0]!();
    assert.equal(f.exports.getPendingCount(), 2);
    const digest = await f.exports.generateDigest();
    assert.deepEqual(Array.from(digest.groups).flatMap((group: any) => Array.from(group.alerts, (alert: any) => alert.id)).sort(), [active.id, ordinary.id].sort());
  } finally { f.exports.destroyNotificationDigest(); f.window.happyDOM.abort(); }
});

test('notification digest rechecks queued NWS eligibility without dropping other sources or evicted active warnings', async () => {
  const f = fixture('src/services/notification-digest.ts');
  try {
    f.exports.queueAlert(retired);
    f.exports.queueAlert(ordinary);
    f.exports.queueAlert(active);
    f.store.getOperationalAlerts = () => [ordinary];
    const digest = await f.exports.generateDigest();
    assert.equal(digest.totalAlerts, 2);
    assert.deepEqual(Array.from(digest.groups).flatMap((group: any) => Array.from(group.alerts, (alert: any) => alert.id)).sort(), [active.id, ordinary.id].sort());
  } finally { f.exports.destroyNotificationDigest(); f.window.happyDOM.abort(); }
});

test('notification digest removes warnings retired during asynchronous summarization', async () => {
  let completeSummary!: (value: { summary: string; provider: string }) => void;
  const f = fixture('src/services/notification-digest.ts', {
    './summarization': { generateSummary: () => new Promise((resolveSummary) => { completeSummary = resolveSummary; }) },
  });
  try {
    f.store.isOperationalAlert = () => true;
    f.exports.queueAlert(retired);
    f.exports.queueAlert(ordinary);
    f.exports.queueAlert(active);
    const pending = f.exports.generateDigest();
    f.store.isOperationalAlert = (alert) => alert.id !== retired.id;
    completeSummary({ summary: 'Retired warning remains critical', provider: 'ollama' });
    const digest = await pending;
    assert.equal(digest.totalAlerts, 2);
    assert.doesNotMatch(digest.headline, /Retired warning/);
    assert.equal(digest.provider, 'rule-based');
  } finally { f.exports.destroyNotificationDigest(); f.window.happyDOM.abort(); }
});

test('notification digest drops retired queued warnings when lifecycle subscribers refresh', () => {
  const f = fixture('src/services/notification-digest.ts');
  try {
    f.exports.queueAlert(retired);
    f.exports.initNotificationDigest();
    f.listeners[0]!();
    assert.equal(f.exports.getPendingCount(), 2);
  } finally { f.exports.destroyNotificationDigest(); f.window.happyDOM.abort(); }
});

test('notification digest emits nothing when every queued warning retires before delivery', async () => {
  for (const retirement of ['before-summary', 'during-summary']) {
    let completeSummary!: (value: { summary: string; provider: string }) => void;
    let summaries = 0;
    const f = fixture('src/services/notification-digest.ts', {
      './summarization': { generateSummary: () => {
        summaries++;
        if (retirement === 'before-summary') return Promise.resolve({ summary: 'Retired warning remains critical', provider: 'ollama' });
        return new Promise((resolveSummary) => { completeSummary = resolveSummary; });
      } },
    });
    try {
      let delivered = 0;
      f.exports.subscribeDigest(() => { delivered++; });
      f.store.isOperationalAlert = () => retirement === 'during-summary';
      f.exports.queueAlert(retired);
      const pending = f.exports.generateDigest();
      if (retirement === 'during-summary') {
        f.store.isOperationalAlert = () => false;
        completeSummary({ summary: 'Retired warning remains critical', provider: 'ollama' });
      }
      assert.equal(await pending, null);
      assert.equal(delivered, 0);
      assert.equal(f.window.localStorage.length, 0);
      assert.equal(summaries, retirement === 'during-summary' ? 1 : 0);
    } finally { f.exports.destroyNotificationDigest(); f.window.happyDOM.abort(); }
  }
});


test('dock badge excludes retired warnings and acknowledged rows while retaining ordinary alerts', () => {
  const f = fixture('src/services/native/dock-badge.ts');
  try {
    f.store.getOperationalAlerts = () => [ordinary, { ...active, acknowledged: true }];
    f.exports.startDockBadge();
    assert.equal(f.invocations[0]?.command, 'set_dock_badge');
    assert.equal((f.invocations[0]?.payload as { count: number }).count, 1);
    f.store.getOperationalAlerts = () => [];
    f.listeners[0]!();
    assert.equal((f.invocations[1]?.payload as { count: number }).count, 0);
  } finally { f.exports.stopDockBadge(); f.window.happyDOM.abort(); }
});

test('menubar expiry refresh completes without an animation frame or visibility return', () => {
  const f = fixture('src/services/native/menubar-status.ts');
  try {
    f.store.getOperationalAlerts = () => [retired, ordinary];
    f.exports.startMenubarStatus();
    f.flushFrames();
    assert.equal((f.invocations[0]?.payload as { level: string }).level, 'red');
    f.listeners[0]!();
    Object.defineProperty(f.window.document, 'hidden', { value: true });
    f.store.getOperationalAlerts = () => [ordinary];
    f.listeners[0]!();
    f.listeners[0]!();
    assert.equal(f.frames.size, 1);
    f.flushTimers();
    assert.equal(f.invocations.length, 2);
    assert.equal((f.invocations[1]?.payload as { level: string }).level, 'yellow');
    assert.equal(f.window.document.hidden, true);
    assert.equal(f.frames.size, 0);
    assert.equal(f.timers.size, 0);
  } finally { f.exports.stopMenubarStatus(); f.window.happyDOM.abort(); }
});

test('menubar stop cancels queued updates and stale callbacks cannot affect a restarted service', () => {
  const f = fixture('src/services/native/menubar-status.ts');
  try {
    f.exports.startMenubarStatus();
    const stale = [...f.frames.values(), ...f.timers.values()];
    f.exports.stopMenubarStatus();
    assert.equal(f.frames.size, 0);
    assert.equal(f.timers.size, 0);
    f.exports.startMenubarStatus();
    stale.forEach(callback => callback());
    assert.equal(f.invocations.length, 0);
    f.flushTimers();
    assert.equal(f.invocations.length, 1);
    f.flushFrames();
    assert.equal(f.invocations.length, 1);
  } finally { f.exports.stopMenubarStatus(); f.window.happyDOM.abort(); }
});

function reactionsFixture(bootstrap: typeof retired[] = []) {
  const sounds: string[] = [];
  const pulseIds: string[][] = [];
  const delayed: Array<{ delay: number; callback: () => void }> = [];
  const inactive = new Set<string>();
  const state = { alerts: bootstrap, ghost: false, channels: { sound: true, borderFlash: true, mapPulse: true, panelFlash: true, desktopNotif: true } };
  const f = fixture('src/services/alert-reactions.ts', {
    './alert-routing': { panelForAlert: () => 'nws-alerts', scoreAlert: (alert: typeof retired) => alert.severity === 'critical' ? 100 : alert.severity === 'high' ? 75 : 40 },
    './sound-manager': { playAlertPing: () => sounds.push('critical'), playSonarPing: () => sounds.push('sonar') },
    './mode-manager': { isGhostMode: () => state.ghost },
    './alerting-prefs': { getChannels: () => state.channels },
    './alert-debug': { logEvent: () => {} },
  });
  f.store.getAll = () => state.alerts;
  f.store.getOperationalAlerts = () => state.alerts.filter(alert => !inactive.has(alert.id));
  f.store.isOperationalAlert = alert => !inactive.has(alert.id);
  Object.defineProperty(f.window, 'setTimeout', { configurable: true, value: (callback: () => void, delay: number) => { delayed.push({ callback, delay }); return delayed.length; } });
  const panel = f.window.document.createElement('div');
  panel.dataset.panel = 'nws-alerts';
  f.window.document.body.append(panel);
  f.window.document.addEventListener('cb:alert-pulses', (event) => {
    pulseIds.push(Array.from((event as unknown as { detail: Array<{ id: string }> }).detail, alert => alert.id));
  });
  return { ...f, state, sounds, pulseIds, delayed, inactive, panel,
    emit: () => f.listeners[0]!(),
    clearVisuals: () => { panel.className = ''; f.window.document.body.className = ''; },
  };
}

const criticalReactionAlert = (id: string, source = 'nws') => ({ ...retired, id, source, location: { lat: 0, lon: 0 } });

test('alert reactions suppress warnings retired before the coalesced subscriber runs and preserve history seen semantics', () => {
  const bootHistory = criticalReactionAlert('boot-history');
  const f = reactionsFixture([bootHistory]);
  try {
    f.inactive.add(bootHistory.id);
    f.exports.startAlertReactions();
    const warning = criticalReactionAlert('retired-before-notify');
    f.state.alerts = [bootHistory, warning];
    f.inactive.add(warning.id);
    f.emit();
    assert.deepEqual(f.sounds, []);
    assert.deepEqual(f.pulseIds, []);
    assert.equal(f.panel.classList.contains('panel-alert-flash'), false);
    assert.equal(f.window.document.body.classList.contains('window-alert-flash'), false);
    assert.equal(f.delayed.filter(task => task.delay === 300_000).length, 0);
    f.inactive.clear();
    f.emit();
    assert.deepEqual(f.sounds, [], 'history already considered while inactive must not react again');
    assert.deepEqual(f.pulseIds, []);
  } finally { f.window.happyDOM.abort(); }
});

test('critical NWS reminders recheck retirement at execution after five minutes', () => {
  const f = reactionsFixture();
  try {
    f.exports.startAlertReactions();
    const warning = criticalReactionAlert('retires-during-delay');
    f.state.alerts = [warning];
    f.emit();
    assert.deepEqual(f.sounds, ['critical']);
    assert.deepEqual(f.pulseIds, [[warning.id]]);
    const reminders = f.delayed.filter(task => task.delay === 300_000);
    assert.equal(reminders.length, 1);
    f.inactive.add(warning.id);
    f.clearVisuals();
    reminders[0]!.callback();
    assert.deepEqual(f.sounds, ['critical'], 'retired warning cannot sound a second time');
    assert.equal(f.panel.classList.contains('panel-alert-flash'), false);
    assert.equal(f.window.document.body.classList.contains('window-alert-flash'), false);
    assert.deepEqual(f.pulseIds, [[warning.id]]);
  } finally { f.window.happyDOM.abort(); }
});

test('active NWS and other-source critical reactions retain channels, coordinates and five-minute reminders', () => {
  for (const source of ['nws', 'cyber']) {
    const f = reactionsFixture();
    try {
      f.exports.startAlertReactions();
      const warning = criticalReactionAlert(`active-${source}`, source);
      f.state.alerts = [warning]; f.emit();
      assert.deepEqual(f.sounds, ['critical']);
      assert.deepEqual(f.pulseIds, [[warning.id]]);
      assert.equal(f.panel.classList.contains('panel-alert-flash'), true);
      assert.equal(f.window.document.body.classList.contains('window-alert-flash'), true);
      const reminder = f.delayed.find(task => task.delay === 300_000);
      assert.ok(reminder);
      f.clearVisuals(); reminder.callback();
      assert.deepEqual(f.sounds, ['critical', 'critical']);
      assert.equal(f.panel.classList.contains('panel-alert-flash'), true);
      assert.equal(f.window.document.body.classList.contains('window-alert-flash'), true);
      f.emit();
      assert.equal(f.sounds.length, 2, 'unchanged warning must not react again on a subscriber update');
    } finally { f.window.happyDOM.abort(); }
  }
});

test('critical reminders still respect acknowledgement and current sound/border channel settings', () => {
  for (const mode of ['acknowledged', 'silent-channels', 'ghost']) {
    const f = reactionsFixture();
    try {
      f.exports.startAlertReactions();
      const warning = criticalReactionAlert(mode);
      f.state.alerts = [warning]; f.emit();
      const reminder = f.delayed.find(task => task.delay === 300_000);
      assert.ok(reminder);
      if (mode === 'acknowledged') warning.acknowledged = true;
      if (mode === 'silent-channels') { f.state.channels.sound = false; f.state.channels.borderFlash = false; }
      if (mode === 'ghost') f.state.ghost = true;
      f.clearVisuals(); reminder.callback();
      assert.deepEqual(f.sounds, ['critical']);
      assert.equal(f.window.document.body.classList.contains('window-alert-flash'), false);
      assert.equal(f.panel.classList.contains('panel-alert-flash'), mode !== 'acknowledged');
    } finally { f.window.happyDOM.abort(); }
  }
});

test('reaction score threshold and non-critical reminder behavior stay unchanged', () => {
  for (const severity of ['medium', 'high']) {
    const f = reactionsFixture();
    try {
      f.exports.startAlertReactions();
      f.state.alerts = [{ ...criticalReactionAlert(severity), severity }];
      f.emit();
      assert.deepEqual(f.sounds, severity === 'high' ? ['sonar'] : []);
      assert.equal(f.pulseIds.length, severity === 'high' ? 1 : 0);
      assert.equal(f.delayed.filter(task => task.delay === 300_000).length, 0);
    } finally { f.window.happyDOM.abort(); }
  }
});
