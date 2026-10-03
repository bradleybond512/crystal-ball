// R3-BUG-001 slice B: a save the Keychain has not confirmed yet ("pending")
// finishes in the background; the renderer follows native's value-free write
// state and reloads secret status once nothing is pending.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const SUPPORTED = ['SHODAN_API_KEY', 'MAPBOX_API_KEY'];
const PENDING = 'Waiting for the Keychain to confirm this change.';

function compile(relative: string): string {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } })
    .outputText.replaceAll('import.meta', '({ env: {} })');
}

interface Scenario {
  failSave?: string;
  writeStates?: unknown[];
}

function harness(scenario: Scenario) {
  const calls: string[] = [];
  const vault = new Map<string, string>();
  const writeStates = [...(scenario.writeStates ?? [])];
  const invoke = async (command: string, args?: Record<string, string>): Promise<unknown> => {
    calls.push(command);
    switch (command) {
      case 'secrets_ready': { return true; }
      case 'get_secret_status': { return SUPPORTED.map((key) => ({ key, present: vault.has(key) })); }
      case 'get_renderer_config': { return {}; }
      case 'set_secret': {
        if (scenario.failSave) throw new Error(scenario.failSave);
        vault.set(args!.key!, args!.value!);
        return null;
      }
      case 'get_secret_write_state': {
        const next = writeStates.shift();
        if (next === 'throw') throw new Error('bridge down');
        // The pending write lands once native reports nothing pending.
        if (next && typeof next === 'object' && (next as { pending?: number }).pending === 0) vault.set('SHODAN_API_KEY', 'landed');
        return next;
      }
      default: { throw new Error(`unexpected native command ${command}`); }
    }
  };
  const storage = new Map<string, string>();
  Object.assign(globalThis, {
    window: { addEventListener: () => {} },
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) },
  });
  const tauri = { invokeTauri: invoke, hasTauriInvokeBridge: () => true, tryInvokeTauri: invoke };
  const keychain: Record<string, unknown> = {};
  new Function('require', 'exports', compile('../keychain.ts'))((id: string) => {
    if (id === '@/services/tauri-bridge') return tauri;
    throw new Error(`keychain imports ${id}`);
  }, keychain);
  const api: Record<string, any> = {};
  new Function('require', 'exports', compile('../runtime-config.ts'))((id: string) => {
    if (id === './runtime') return { isDesktopRuntime: () => true, resolveConfirmedLocalApiBase: async () => 'http://127.0.0.1:46123' };
    if (id === './tauri-bridge') return tauri;
    if (id === './keychain') return keychain;
    if (id === '../utils/safe-storage') return { safeSetItem: (k: string, v: string) => storage.set(k, v) };
    if (id === './web-secret-store') return { isVaultUnlocked: () => false, listSecrets: () => ({}), setSecret: async () => {}, onVaultChange: () => () => {}, isSupported: () => false };
    throw new Error(`runtime-config imports ${id}`);
  }, api);
  return { api, calls, storage, keychain: keychain.keychainService as { writeState(): Promise<unknown> } };
}

test('a pending save is followed until it lands, then status reloads and other windows hear it', async () => {
  const h = harness({ failSave: PENDING, writeStates: [{ revision: 0, pending: 1, source: 'vault' }, { revision: 1, pending: 0, source: 'vault' }] });
  await h.api.loadDesktopSecretsWhenReady();
  await assert.rejects(h.api.setSecretValue('SHODAN_API_KEY', 'new'), new RegExp(PENDING));
  assert.equal(h.api.isSecretSet('SHODAN_API_KEY'), false, 'nothing is shown as saved while pending');
  // The failed save itself started the watch (default 2 s polling).
  const deadline = Date.now() + 8000;
  while (!h.api.isSecretSet('SHODAN_API_KEY') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(h.api.isSecretSet('SHODAN_API_KEY'), true, 'status reloaded once nothing was pending');
  assert.equal(h.calls.filter((c) => c === 'get_secret_write_state').length, 2);
  assert.ok(h.storage.has('wm-secrets-updated'));
});

test('one watch at a time, and it stops on a bad or missing write state', async () => {
  const h = harness({ writeStates: ['throw'] });
  const first = h.api.watchPendingSecretWrites(1, 1_000);
  assert.equal(h.api.watchPendingSecretWrites(1, 1_000), first, 'a second call joins the running watch');
  await first;
  assert.equal(h.calls.filter((c) => c === 'get_secret_write_state').length, 1);
  assert.equal(h.storage.has('wm-secrets-updated'), false);

  const malformed = harness({ writeStates: [{ revision: '1', pending: 'none' }] });
  assert.equal(await malformed.keychain.writeState(), null);
});

test('the watch gives up at its deadline while a write stays pending', async () => {
  const stuck = Array.from({ length: 50 }, () => ({ revision: 0, pending: 1, source: 'vault' }));
  const h = harness({ writeStates: stuck });
  await h.api.watchPendingSecretWrites(1, 25);
  assert.ok(h.calls.filter((c) => c === 'get_secret_write_state').length < 50);
  assert.equal(h.storage.has('wm-secrets-updated'), false);
});

test('a successful save does not start a watch', async () => {
  const h = harness({});
  await h.api.setSecretValue('SHODAN_API_KEY', 'ok');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(h.calls.includes('get_secret_write_state'), false);
});
