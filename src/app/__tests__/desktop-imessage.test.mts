import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function harness(isDesktopApp = true) {
  const calls: unknown[][] = [];
  let hydrated = false;
  const controls = { ghost: false, alertEnabled: true, desktopEnabled: true, threshold: 'critical', enabled: true, sendResult: { ok: true } as Record<string, unknown> };
  const document = new EventTarget();
  const saved = new Map([['cb:onboarding-complete', 'true']]);
  Object.assign(globalThis, { document, localStorage: { getItem: (name: string) => saved.get(name) ?? null } });
  const deps: Record<string, unknown> = {
    '@/services/native-notify': { notifyNative: async (payload: unknown) => { calls.push(['send_notification', payload]); return 'delivered'; } },
    '@/services/breaking-news-alerts': { getAlertSettings: () => ({ enabled: controls.alertEnabled, desktopNotificationsEnabled: controls.desktopEnabled }) },
    '@/services/mode-manager': { isGhostMode: () => controls.ghost },
    '@/services/imessage-bridge': {
      refreshImessageSettings: async () => { calls.push(['hydrate']); hydrated = true; return { ok: true }; },
      getImessageSettings: () => ({ ready: hydrated, enabled: controls.enabled, recipient: '+15551234567', threshold: controls.threshold }),
      sendImessage: async (...args: unknown[]) => { calls.push(['imessage', ...args]); return controls.sendResult; },
    },
    '@/services/notifications/imessage-pause-alerts': {
      recordPausedImessageRelay: (relay: unknown) => { calls.push(['paused-relay', relay]); return true; },
      notifyImessagePausedOnce: async () => { calls.push(['paused-notice']); return 'not_needed'; },
    },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('../desktop-notifications.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  new Function('require', 'exports', compiled)((id: string) => deps[id], exports);
  const instance = new exports.DesktopNotifications({ isDesktopApp });
  const start = () => { instance.init(); instance.openWorkspace(); instance.sourcesSettled(); };
  return { calls, controls, instance, saved, start, alert: (threatLevel: string) => instance.onBreakingNews({ threatLevel, headline: 'Event', source: 'Source' }) };
}
test('desktop lifecycle hydrates native iMessage settings without opening Settings', async () => {
  const h = harness(); h.start(); await h.alert('critical');
  assert.equal(h.calls[0][0], 'hydrate');
  assert.deepEqual(h.calls.at(-1), ['imessage', 'Crystal Ball: [CRITICAL] Event — Source']);
  h.instance.destroy();
});
test('breaking routing preserves Ghost Mode, threshold and desktop notification gates', async () => {
  const h = harness(); h.start(); h.calls.length = 0;
  await h.alert('high'); assert.equal(h.calls.some(c => c[0] === 'imessage'), false);
  h.controls.threshold = 'high+critical'; await h.alert('high'); assert.equal(h.calls.at(-1)?.[0], 'imessage');
  h.calls.length = 0; h.controls.ghost = true; await h.alert('critical'); assert.equal(h.calls.length, 0);
  h.controls.ghost = false; h.controls.desktopEnabled = false; await h.alert('critical'); assert.equal(h.calls.length, 0);
  h.controls.desktopEnabled = true; h.controls.enabled = false; await h.alert('critical'); assert.equal(h.calls.some(c => c[0] === 'imessage'), false);
});
test('breaking alerts cannot route before native settings hydration', async () => {
  const h = harness(); await h.alert('critical');
  assert.equal(h.calls.some(c => c[0] === 'imessage'), false);
});

// ── R4-BUG-001 ──────────────────────────────────────────────────────────
test('startup tells the user once about a paused channel, after hydration', async () => {
  const h = harness(); h.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(h.calls.slice(0, 2).map(c => c[0]), ['hydrate', 'paused-notice']);
  h.instance.destroy();
});
test('a relay skipped because iMessage is off is traced, not silent', async () => {
  const h = harness(); h.start(); await new Promise(resolve => setTimeout(resolve, 0));
  h.controls.enabled = false; h.calls.length = 0;
  await h.alert('critical');
  assert.deepEqual(h.calls.filter(c => c[0] !== 'send_notification'), [
    ['paused-relay', { source: 'breaking-news', urgency: 'critical', headline: 'Event' }],
  ]);
  h.calls.length = 0; await h.alert('high');
  assert.equal(h.calls.some(c => c[0] === 'paused-relay'), false, 'below the threshold is not a skipped relay');
  h.controls.threshold = 'high+critical'; await h.alert('high');
  assert.deepEqual(h.calls.at(-1), ['paused-relay', { source: 'breaking-news', urgency: 'high', headline: 'Event' }]);
  h.instance.destroy();
});
test('a send refused as disabled is traced; other failures are not', async () => {
  const h = harness(); h.start(); await new Promise(resolve => setTimeout(resolve, 0));
  const warn = console.warn; console.warn = () => {};
  try {
    h.controls.sendResult = { ok: false, code: 'disabled', reason: 'iMessage sending is disabled.' }; h.calls.length = 0;
    await h.alert('critical');
    assert.deepEqual(h.calls.at(-1), ['paused-relay', { source: 'breaking-news', urgency: 'critical', headline: 'Event' }]);
    h.controls.sendResult = { ok: false, code: 'send_failed', reason: 'x' }; h.calls.length = 0;
    await h.alert('critical');
    assert.equal(h.calls.some(c => c[0] === 'paused-relay'), false);
  } finally { console.warn = warn; }
  h.instance.destroy();
});

test('passive registration withholds sends until opening, with no queued replay or early relay', async () => {
  const h = harness(); h.instance.init();
  await h.alert('critical');
  assert.deepEqual(h.calls, [], 'registration has no outward effects');
  h.instance.openWorkspace(); h.instance.openWorkspace();
  assert.deepEqual(h.calls, [], 'opening does not replay');
  await h.alert('critical');
  assert.deepEqual(h.calls.map(c => c[0]), ['send_notification']);
  h.instance.sourcesSettled(); h.instance.sourcesSettled(); await Promise.resolve();
  assert.deepEqual(h.calls.map(c => c[0]), ['send_notification', 'hydrate', 'paused-notice']);
});

test('early alerts require completed onboarding and a known non-Ghost preference', async () => {
  const h = harness(); h.instance.init(); h.instance.openWorkspace();
  h.saved.delete('cb:onboarding-complete');
  await h.alert('critical');
  h.saved.set('cb:onboarding-complete', 'true'); h.saved.set('wm-app-mode', 'unknown');
  await h.alert('critical');
  h.saved.set('wm-app-mode', 'ghost');
  await h.alert('critical');
  Object.assign(globalThis, { localStorage: { getItem() { throw new Error('blocked'); } } });
  await h.alert('critical');
  assert.deepEqual(h.calls, []);
});

test('early web breaking alerts cannot prompt; granted users may receive a current alert', async () => {
  const h = harness(false);
  class Capture {
    static permission = 'default';
    static async requestPermission() { h.calls.push(['prompt']); return 'granted'; }
    constructor() { h.calls.push(['banner']); }
  }
  Object.assign(globalThis, { Notification: Capture });
  h.instance.init(); h.instance.openWorkspace();
  await h.alert('critical');
  assert.deepEqual(h.calls, []);
  Capture.permission = 'granted';
  await h.alert('critical');
  assert.deepEqual(h.calls, [['banner']]);
  Capture.permission = 'denied'; await h.alert('critical');
  assert.deepEqual(h.calls, [['banner']]);
});

test('destroy prevents a pending web permission from sending or a late desktop hydration notice', async () => {
  const web = harness(false);
  let resolve!: (value: string) => void;
  class Capture {
    static permission = 'default';
    static requestPermission() { return new Promise<string>(ok => { resolve = ok; }); }
    constructor() { web.calls.push(['banner']); }
  }
  Object.assign(globalThis, { Notification: Capture });
  web.start(); const pending = web.alert('high');
  web.instance.destroy(); resolve('granted'); await pending;
  assert.deepEqual(web.calls, []);
  const desktop = harness(); desktop.start(); desktop.instance.destroy(); await Promise.resolve();
  assert.deepEqual(desktop.calls.map(c => c[0]), ['hydrate']);
});

test('completed acquisition waits for the desktop intro before native settings hydration', async () => {
  const h = harness(); h.instance.init(); h.instance.sourcesSettled(); await h.alert('critical');
  assert.deepEqual(h.calls, []);
  h.instance.openWorkspace(); await Promise.resolve(); h.instance.openWorkspace();
  assert.deepEqual(h.calls.map(c => c[0]), ['hydrate', 'paused-notice']);
});

test('permission and native send continuations honor revoked eligibility', async () => {
  const web = harness(false);
  class Capture {
    static permission = 'default';
    static async requestPermission() { web.controls.ghost = true; return 'granted'; }
    constructor() { web.calls.push(['banner']); }
  }
  Object.assign(globalThis, { Notification: Capture }); web.start(); await web.alert('critical');
  assert.deepEqual(web.calls, []);
  const native = harness(); native.start(); const pending = native.alert('critical');
  native.controls.ghost = true; await pending;
  assert.ok(native.calls.some(c => c[0] === 'send_notification'));
  assert.ok(!native.calls.some(c => c[0] === 'imessage'));
});
