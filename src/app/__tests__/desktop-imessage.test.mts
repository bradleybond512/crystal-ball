import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function harness() {
  const calls: unknown[][] = [];
  let hydrated = false;
  const controls = { ghost: false, alertEnabled: true, desktopEnabled: true, threshold: 'critical', enabled: true, sendResult: { ok: true } as Record<string, unknown> };
  const document = new EventTarget();
  Object.assign(globalThis, { document });
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
  const instance = new exports.DesktopNotifications({ isDesktopApp: true });
  return { calls, controls, instance, alert: (threatLevel: string) => instance.onBreakingNews({ threatLevel, headline: 'Event', source: 'Source' }) };
}
test('desktop lifecycle hydrates native iMessage settings without opening Settings', async () => {
  const h = harness(); h.instance.init(); await h.alert('critical');
  assert.equal(h.calls[0][0], 'hydrate');
  assert.deepEqual(h.calls.at(-1), ['imessage', 'Crystal Ball: [CRITICAL] Event — Source']);
  h.instance.destroy();
});
test('breaking routing preserves Ghost Mode, threshold and desktop notification gates', async () => {
  const h = harness(); h.instance.init(); h.calls.length = 0;
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
  const h = harness(); h.instance.init();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(h.calls.slice(0, 2).map(c => c[0]), ['hydrate', 'paused-notice']);
  h.instance.destroy();
});
test('a relay skipped because iMessage is off is traced, not silent', async () => {
  const h = harness(); h.instance.init(); await new Promise(resolve => setTimeout(resolve, 0));
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
  const h = harness(); h.instance.init(); await new Promise(resolve => setTimeout(resolve, 0));
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
