import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function harness() {
  const storage = new Map<string, string>();
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  const calls: unknown[][] = [];
  let handler = async (_cmd: string, _args?: unknown): Promise<unknown> => ({ enabled: true, recipient: '+15551234567', ready: true, migrationAvailable: false });
  const output: any = {};
  const compiled = ts.transpileModule(readFileSync(new URL('../imessage-bridge.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'exports', compiled)((id: string) => id === './runtime' ? { isDesktopRuntime: () => true } : { hasTauriInvokeBridge: () => true, invokeTauri: (cmd: string, args?: unknown) => { calls.push([cmd, args]); return handler(cmd, args); } }, output);
  return { api: output, storage, calls, respond: (fn: typeof handler) => { handler = fn; } };
}
const KEY = 'crystalball-imessage-settings';
test('legacy enabled state cannot authorize before native hydration', async () => {
  const h = harness(); h.storage.set(KEY, JSON.stringify({ enabled: true, recipient: '+15559999999', threshold: 'high+critical' }));
  assert.equal(h.api.getImessageSettings().enabled, false);
  assert.equal(h.api.getImessageSettings().threshold, 'high+critical');
  assert.equal((await h.api.sendImessage('hello')).ok, false);
  assert.equal(h.calls.length, 0);
});
test('native hydration owns destination and send IPC carries body only', async () => {
  const h = harness(); await h.api.refreshImessageSettings();
  assert.equal(h.api.getImessageSettings().recipient, '+15551234567');
  assert.equal((await h.api.sendImessage('hello')).ok, true);
  assert.deepEqual(h.calls.at(-1), ['send_imessage', { body: 'hello' }]);
});
test('failed or malformed hydration clears cached authorization and never leaks native errors', async () => {
  const h = harness(); await h.api.refreshImessageSettings();
  h.respond(async () => { throw new Error('secret internal path'); });
  const failed = await h.api.refreshImessageSettings();
  assert.equal(h.api.getImessageSettings().enabled, false);
  assert.doesNotMatch(failed.reason, /secret/);
  h.respond(async () => ({ enabled: true, recipient: 12, ready: true, migrationAvailable: false }));
  assert.equal((await h.api.refreshImessageSettings()).ok, false);
});
test('migration suggestions are offered only for genuine native absence and cleanup retains threshold', async () => {
  const h = harness(); h.storage.set(KEY, JSON.stringify({ enabled: true, recipient: '+15559999999', threshold: 'high+critical' }));
  assert.equal(h.api.getLegacyImessageSuggestion(), null);
  h.respond(async () => ({ enabled: false, recipient: null, ready: true, migrationAvailable: true }));
  await h.api.refreshImessageSettings();
  assert.equal(h.api.getLegacyImessageSuggestion().recipient, '+15559999999');
  h.respond(async () => ({ enabled: false, recipient: null, ready: true, migrationAvailable: false }));
  await h.api.refreshImessageSettings();
  assert.equal(h.api.getLegacyImessageSuggestion(), null);
  const stored = JSON.parse(h.storage.get(KEY)!);
  assert.deepEqual(Object.keys(stored).sort(), ['paused', 'threshold']);
  assert.equal(stored.threshold, 'high+critical');
  assert.equal(stored.paused.hint, '…9999');
  assert.doesNotMatch(h.storage.get(KEY)!, /5559999999/);
});
test('disable invalidates late configure and hydration responses immediately', async () => {
  const h = harness(); await h.api.refreshImessageSettings();
  let resolve!: (value: unknown) => void;
  h.respond(async cmd => cmd === 'disable_imessage' ? { enabled: false, recipient: '+15551234567', ready: true, migrationAvailable: false } : new Promise(r => { resolve = r; }));
  const pending = h.api.configureImessage('+15550000000', true);
  const disabled = h.api.disableImessage();
  assert.equal(h.api.getImessageSettings().enabled, false);
  await disabled;
  resolve({ enabled: true, recipient: '+15550000000', ready: true, migrationAvailable: false }); await pending;
  assert.equal(h.api.getImessageSettings().enabled, false);
});
test('canceled configuration refreshes consumed migration without authorizing legacy values', async () => {
  const h = harness(); h.storage.set(KEY, JSON.stringify({ enabled: true, recipient: '+15559999999', threshold: 'high+critical' }));
  h.respond(async cmd => { if (cmd === 'configure_imessage') throw { code: 'canceled' }; return { enabled: false, recipient: null, ready: true, migrationAvailable: false }; });
  assert.equal((await h.api.configureImessage('+15559999999', true)).code, 'canceled');
  assert.deepEqual(h.calls.map(c => c[0]), ['configure_imessage', 'get_imessage_settings']);
  assert.deepEqual(Object.keys(JSON.parse(h.storage.get(KEY)!)).sort(), ['paused', 'threshold']);
  assert.doesNotMatch(h.storage.get(KEY)!, /5559999999/);
  assert.equal(h.api.getImessageSettings().enabled, false);
});
test('late hydration cannot overwrite disable and failed disable remains fail-closed', async () => {
  const h = harness(); await h.api.refreshImessageSettings();
  let resolve!: (value: unknown) => void;
  h.respond(async cmd => { if (cmd === 'disable_imessage') throw { code: 'persistence_failed' }; return new Promise(r => { resolve = r; }); });
  const pending = h.api.refreshImessageSettings();
  assert.equal((await h.api.disableImessage()).code, 'persistence_failed');
  resolve({ enabled: true, recipient: '+15551234567', ready: true, migrationAvailable: false }); await pending;
  assert.equal(h.api.getImessageSettings().enabled, false);
  assert.equal(h.api.getImessageSettings().ready, false);
});
test('native send errors are finite safe copy and revocation clears the cache without retry', async () => {
  const h = harness(); await h.api.refreshImessageSettings();
  h.respond(async () => { throw { code: 'disabled', detail: 'PRIVATE' }; });
  const result = await h.api.sendImessage('hello');
  assert.equal(result.code, 'disabled'); assert.doesNotMatch(result.reason, /PRIVATE/);
  assert.equal(h.api.getImessageSettings().enabled, false);
  assert.equal(h.calls.filter(c => c[0] === 'send_imessage').length, 1);
});
test('blank bodies fail before native invocation and native consent sees exact untrimmed proposal', async () => {
  const h = harness(); await h.api.refreshImessageSettings();
  assert.equal((await h.api.sendImessage('   ')).code, 'invalid_body');
  assert.equal(h.calls.filter(c => c[0] === 'send_imessage').length, 0);
  await h.api.configureImessage(' +15551234567 ', true);
  assert.deepEqual(h.calls.at(-1), ['configure_imessage', { recipient: ' +15551234567 ', enabled: true }]);
});
test('failed replacement preserves native confirmed destination and does not claim it was disabled', async () => {
  const h = harness(); await h.api.refreshImessageSettings();
  h.respond(async cmd => { if (cmd === 'configure_imessage') throw { code: 'persistence_failed' }; return { enabled: true, recipient: '+15551234567', ready: true, migrationAvailable: false }; });
  const result = await h.api.configureImessage('+15550000000', true);
  assert.equal(result.code, 'persistence_failed');
  assert.doesNotMatch(result.reason, /blocked|disabled|restart/);
  assert.equal(h.api.getImessageSettings().enabled, true);
  assert.equal(h.api.getImessageSettings().recipient, '+15551234567');
});
test('failed disable explains that persisted settings may return after restart', async () => {
  const h = harness(); await h.api.refreshImessageSettings();
  h.respond(async () => { throw { code: 'persistence_failed' }; });
  const result = await h.api.disableImessage();
  assert.match(result.reason, /blocked for this session/);
  assert.match(result.reason, /after restart/);
  assert.equal(h.api.getImessageSettings().enabled, false);
});

// ── R4-BUG-001: paused relays stay visible ─────────────────────────────
const MISSING = { enabled: false, recipient: null, ready: true, migrationAvailable: true };
const CONSUMED = { enabled: false, recipient: null, ready: true, migrationAvailable: false };
const LEGACY_ON = JSON.stringify({ enabled: true, recipient: '+15559999999', threshold: 'critical' });

test('legacy enabled with native absence is paused, with only a redacted hint', async () => {
  const h = harness(); h.storage.set(KEY, LEGACY_ON);
  assert.deepEqual(h.api.getImessagePauseState(), { paused: false }, 'unknown before native hydration');
  h.respond(async () => MISSING); await h.api.refreshImessageSettings();
  const state = h.api.getImessagePauseState();
  assert.equal(state.paused, true);
  assert.equal(state.hint, '…9999');
  assert.equal(state.notified, false);
  assert.doesNotMatch(JSON.stringify(state), /5559999999/);
});

test('a stored pause is not reported until native state is known', async () => {
  const h = harness(); h.storage.set(KEY, JSON.stringify({ threshold: 'critical', paused: { hint: '…9999', since: 1 } }));
  assert.deepEqual(h.api.getImessagePauseState(), { paused: false }, 'before hydration');
  h.respond(async () => { throw new Error('native unavailable'); });
  await h.api.refreshImessageSettings();
  assert.deepEqual(h.api.getImessagePauseState(), { paused: false }, 'native state unknown');
  h.respond(async () => CONSUMED); await h.api.refreshImessageSettings();
  assert.equal(h.api.getImessagePauseState().paused, true);
});

test('legacy settings that were off are not paused', async () => {
  const h = harness(); h.storage.set(KEY, JSON.stringify({ enabled: false, recipient: '+15559999999' }));
  h.respond(async () => MISSING); await h.api.refreshImessageSettings();
  assert.deepEqual(h.api.getImessagePauseState(), { paused: false });
  h.respond(async () => CONSUMED); await h.api.refreshImessageSettings();
  assert.deepEqual(h.api.getImessagePauseState(), { paused: false });
});

test('a canceled or timed-out consent stays paused instead of looking never configured', async () => {
  const h = harness(); h.storage.set(KEY, LEGACY_ON);
  h.respond(async () => MISSING); await h.api.refreshImessageSettings();
  h.respond(async cmd => { if (cmd === 'configure_imessage') throw { code: 'canceled' }; return CONSUMED; });
  assert.equal((await h.api.configureImessage('+15559999999', true)).code, 'canceled');
  assert.equal(h.api.getImessagePauseState().paused, true);
  assert.equal(h.api.getImessagePauseState().hint, '…9999');
  await h.api.refreshImessageSettings();
  assert.equal(h.api.getImessagePauseState().paused, true, 'later refreshes keep the pause');
  assert.doesNotMatch(h.storage.get(KEY)!, /5559999999/);
});

test('a pause that began after migration was consumed still records the hint', async () => {
  const h = harness(); h.storage.set(KEY, LEGACY_ON);
  h.respond(async () => CONSUMED); await h.api.refreshImessageSettings();
  assert.equal(h.api.getImessagePauseState().hint, '…9999');
});

for (const [label, command, enabled] of [
  ['confirmed configure (on)', 'configure_imessage', true],
  ['confirmed configure (off)', 'configure_imessage', false],
  ['disable', 'disable_imessage', false],
] as const) {
  test(`an explicit ${label} ends the pause`, async () => {
    const h = harness(); h.storage.set(KEY, LEGACY_ON);
    h.respond(async () => CONSUMED); await h.api.refreshImessageSettings();
    assert.equal(h.api.getImessagePauseState().paused, true);
    h.respond(async cmd => cmd === command
      ? { enabled, recipient: '+15551234567', ready: true, migrationAvailable: false }
      : CONSUMED);
    const result = command === 'disable_imessage' ? await h.api.disableImessage() : await h.api.configureImessage('+15551234567', enabled);
    assert.equal(result.ok, true);
    assert.deepEqual(h.api.getImessagePauseState(), { paused: false });
    assert.equal('paused' in JSON.parse(h.storage.get(KEY)!), false);
    h.respond(async () => CONSUMED); await h.api.refreshImessageSettings();
    assert.deepEqual(h.api.getImessagePauseState(), { paused: false }, 'the pause does not come back');
  });
}

test('a refresh that finds native sending enabled ends the pause', async () => {
  const h = harness(); h.storage.set(KEY, LEGACY_ON);
  h.respond(async () => CONSUMED); await h.api.refreshImessageSettings();
  h.respond(async () => ({ enabled: true, recipient: '+15551234567', ready: true, migrationAvailable: false }));
  await h.api.refreshImessageSettings();
  assert.deepEqual(h.api.getImessagePauseState(), { paused: false });
  assert.equal('paused' in JSON.parse(h.storage.get(KEY)!), false);
});

test('the pause notice is marked seen once and survives refreshes', async () => {
  const h = harness(); h.storage.set(KEY, LEGACY_ON);
  h.respond(async () => CONSUMED); await h.api.refreshImessageSettings();
  h.api.markImessagePauseNotified(123);
  assert.equal(h.api.getImessagePauseState().notified, true);
  h.api.markImessagePauseNotified(456);
  assert.equal(JSON.parse(h.storage.get(KEY)!).paused.notifiedAt, 123);
  await h.api.refreshImessageSettings();
  assert.equal(h.api.getImessagePauseState().notified, true);
});

test('pause changes are announced and tampered markers are ignored', async () => {
  const h = harness(); const document = new EventTarget(); let events = 0;
  document.addEventListener('cb:imessage-pause-changed', () => { events += 1; });
  Object.assign(globalThis, { document });
  h.storage.set(KEY, LEGACY_ON);
  h.respond(async () => CONSUMED); await h.api.refreshImessageSettings();
  assert.equal(events, 1);
  await h.api.refreshImessageSettings();
  assert.equal(events, 1, 'no event without a change');
  h.respond(async () => ({ enabled: true, recipient: '+15551234567', ready: true, migrationAvailable: false }));
  await h.api.refreshImessageSettings();
  assert.equal(events, 2);
  Reflect.deleteProperty(globalThis, 'document');
  for (const paused of [{ hint: '+15559999999', since: 1 }, { hint: '<b>…1234</b>', since: 1 }, { hint: '…1234', since: 'soon' }, { hint: '…1234', since: 1, notifiedAt: Number.NaN }, 'paused']) {
    const t = harness(); t.storage.set(KEY, JSON.stringify({ threshold: 'critical', paused }));
    t.respond(async () => CONSUMED); await t.api.refreshImessageSettings();
    assert.deepEqual(t.api.getImessagePauseState(), { paused: false }, JSON.stringify(paused));
  }
});

test('redacted hints never carry the full destination', () => {
  const { api } = harness();
  assert.equal(api.redactImessageRecipient('+1 (555) 123-4567'), '…4567');
  assert.equal(api.redactImessageRecipient(' bradley@example.com '), 'b…@example.com');
  assert.equal(api.redactImessageRecipient('+12'), '…');
});

test('a well-formed stored hint is accepted', async () => {
  for (const hint of ['…1234', 'b…@example.com', '…']) {
    const h = harness(); h.storage.set(KEY, JSON.stringify({ threshold: 'critical', paused: { hint, since: 1 } }));
    h.respond(async () => CONSUMED); await h.api.refreshImessageSettings();
    assert.equal(h.api.getImessagePauseState().hint, hint);
  }
});
