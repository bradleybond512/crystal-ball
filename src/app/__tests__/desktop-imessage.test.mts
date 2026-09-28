import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function harness() {
  const calls: unknown[][] = [];
  let hydrated = false;
  const controls = { ghost: false, alertEnabled: true, desktopEnabled: true, threshold: 'critical', enabled: true };
  const document = new EventTarget();
  Object.assign(globalThis, { document });
  const deps: Record<string, unknown> = {
    '@/services/tauri-bridge': { tryInvokeTauri: async (...args: unknown[]) => { calls.push(args); } },
    '@/services/breaking-news-alerts': { getAlertSettings: () => ({ enabled: controls.alertEnabled, desktopNotificationsEnabled: controls.desktopEnabled }) },
    '@/services/mode-manager': { isGhostMode: () => controls.ghost },
    '@/services/imessage-bridge': {
      refreshImessageSettings: async () => { calls.push(['hydrate']); hydrated = true; return { ok: true }; },
      getImessageSettings: () => ({ ready: hydrated, enabled: controls.enabled, recipient: '+15551234567', threshold: controls.threshold }),
      sendImessage: async (...args: unknown[]) => { calls.push(['imessage', ...args]); return { ok: true }; },
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
