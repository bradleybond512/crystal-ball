// R4-SEC-001: the main window holds presence for every secret and values only
// for RENDERER_READABLE_KEYS; it never calls get_secret, never relays a value
// to the sidecar, and "Test" on a saved sidecar-only key sends no value.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const NATIVE_ONLY = { ANTHROPIC_API_KEY: 'sk-ant-native-only-value', GROQ_API_KEY: 'gsk-native-only-value' };
const READABLE = { MAPBOX_API_KEY: 'pk.map-value', OLLAMA_MODEL: 'llama3' };
const SUPPORTED = ['CRYSTALBALL_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'MAPBOX_API_KEY', 'OLLAMA_MODEL', 'SHODAN_API_KEY'];

function compile(relative: string): string {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } })
    .outputText.replaceAll('import.meta', '({ env: {} })');
}

function harness(options: { leakyNative?: boolean } = {}) {
  const calls: string[] = [];
  const fetches: { url: string; body: string }[] = [];
  const vault = new Map<string, string>(Object.entries({ ...NATIVE_ONLY, ...READABLE }));
  const invoke = async (command: string, args?: Record<string, string>): Promise<unknown> => {
    calls.push(command);
    switch (command) {
      case 'list_supported_secret_keys': { return SUPPORTED; }
      case 'secrets_ready': { return true; }
      case 'get_secret_status': { return SUPPORTED.map((key) => ({ key, present: vault.has(key) })); }
      case 'get_renderer_config': {
        const out: Record<string, string> = {};
        for (const key of ['MAPBOX_API_KEY', 'OLLAMA_MODEL']) if (vault.has(key)) out[key] = vault.get(key)!;
        // A misbehaving native must still not get a sidecar-only value held here.
        if (options.leakyNative) out.ANTHROPIC_API_KEY = vault.get('ANTHROPIC_API_KEY') ?? '';
        return out;
      }
      case 'set_secret': { vault.set(args!.key!, args!.value!); return null; }
      case 'delete_secret': { vault.delete(args!.key!); return null; }
      case 'get_local_api_token': { return 'test-token'; }
      default: { throw new Error(`unexpected native command ${command}`); }
    }
  };
  const storage = new Map<string, string>();
  Object.assign(globalThis, {
    window: { addEventListener: () => {} },
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) },
    fetch: async (url: string, init?: RequestInit) => {
      fetches.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(JSON.stringify({ valid: true, message: 'Verified' }), { status: 200 });
    },
  });
  const tauri = { invokeTauri: invoke, hasTauriInvokeBridge: () => true, tryInvokeTauri: invoke };
  const keychain: Record<string, unknown> = {};
  new Function('require', 'exports', compile('../keychain.ts'))((id: string) => {
    if (id === '@/services/tauri-bridge') return tauri;
    throw new Error(`keychain imports ${id}`);
  }, keychain);
  const runtimeConfig: Record<string, any> = {};
  new Function('require', 'exports', compile('../runtime-config.ts'))((id: string) => {
    if (id === './runtime') return { isDesktopRuntime: () => true, resolveConfirmedLocalApiBase: async () => 'http://127.0.0.1:46123' };
    if (id === './tauri-bridge') return tauri;
    if (id === './keychain') return keychain;
    if (id === '../utils/safe-storage') return { safeSetItem: (k: string, v: string) => storage.set(k, v) };
    if (id === './web-secret-store') return { isVaultUnlocked: () => false, listSecrets: () => ({}), setSecret: async () => {}, onVaultChange: () => () => {}, isSupported: () => false };
    throw new Error(`runtime-config imports ${id}`);
  }, runtimeConfig);
  return { api: runtimeConfig, calls, fetches, vault };
}

function heldValues(api: Record<string, any>): string {
  return JSON.stringify(api.getRuntimeConfigSnapshot().secrets);
}

test('boot holds presence for every key and values only for readable keys', async () => {
  const h = harness();
  await h.api.loadDesktopSecretsWhenReady();
  const held = h.api.getRuntimeConfigSnapshot().secrets;
  assert.equal(held.MAPBOX_API_KEY?.value, 'pk.map-value');
  assert.equal(held.OLLAMA_MODEL?.value, 'llama3');
  assert.equal(held.ANTHROPIC_API_KEY, undefined);
  assert.doesNotMatch(heldValues(h.api), /native-only/);
  assert.deepEqual(h.api.getSecretState('ANTHROPIC_API_KEY'), { present: true, valid: true, source: 'vault' });
  assert.equal(h.api.isSecretSet('GROQ_API_KEY'), true);
  assert.equal(h.api.isSecretSet('SHODAN_API_KEY'), false);
  assert.ok(!h.calls.includes('get_secret'));
  assert.deepEqual(h.fetches, [], 'boot sends nothing to the sidecar');
});

test('a non-allowlisted value from native is dropped, not held', async () => {
  const h = harness({ leakyNative: true });
  await h.api.loadDesktopSecretsWhenReady();
  assert.doesNotMatch(heldValues(h.api), /native-only/);
  assert.equal(h.api.isSecretSet('ANTHROPIC_API_KEY'), true);
});

test('saving a sidecar-only key keeps presence only and relays nothing', async () => {
  const h = harness();
  await h.api.loadDesktopSecretsWhenReady();
  await h.api.setSecretValue('SHODAN_API_KEY', '  shodan-new-value  ');
  assert.equal(h.vault.get('SHODAN_API_KEY'), 'shodan-new-value');
  assert.equal(h.api.isSecretSet('SHODAN_API_KEY'), true);
  assert.doesNotMatch(heldValues(h.api), /shodan-new-value/);
  await h.api.setSecretValue('MAPBOX_API_KEY', 'pk.new');
  assert.equal(h.api.getRuntimeConfigSnapshot().secrets.MAPBOX_API_KEY?.value, 'pk.new');
  await h.api.setSecretValue('GROQ_API_KEY', '');
  assert.equal(h.vault.has('GROQ_API_KEY'), false);
  assert.equal(h.api.isSecretSet('GROQ_API_KEY'), false);
  assert.deepEqual(h.fetches, [], 'native pushes changes to the sidecar, not this window');
});

test('a reload after another window deletes a readable key forgets its value', async () => {
  const h = harness();
  await h.api.loadDesktopSecretsWhenReady();
  h.vault.delete('MAPBOX_API_KEY');
  await h.api.loadDesktopSecrets();
  assert.equal(h.api.getRuntimeConfigSnapshot().secrets.MAPBOX_API_KEY, undefined);
  assert.equal(h.api.isSecretSet('MAPBOX_API_KEY'), false);
});

test('Test on a saved sidecar-only key sends no value', async () => {
  const h = harness();
  await h.api.loadDesktopSecretsWhenReady();
  const result = await h.api.verifyStoredSecretWithApi('GROQ_API_KEY');
  assert.equal(result.valid, true);
  assert.equal(h.fetches.length, 1);
  assert.match(h.fetches[0]!.url, /\/api\/local-validate-secret$/);
  assert.deepEqual(JSON.parse(h.fetches[0]!.body), { key: 'GROQ_API_KEY', useStored: true, context: {} });
});

test('Test on a readable key uses the value this window holds; an unset key sends nothing', async () => {
  const h = harness();
  await h.api.loadDesktopSecretsWhenReady();
  await h.api.verifyStoredSecretWithApi('OLLAMA_MODEL');
  assert.deepEqual(JSON.parse(h.fetches[0]!.body), { key: 'OLLAMA_MODEL', value: 'llama3', context: {} });
  h.fetches.length = 0;
  assert.deepEqual(await h.api.verifyStoredSecretWithApi('SHODAN_API_KEY'), { valid: false, message: 'No value to test' });
  assert.deepEqual(h.fetches, []);
});

test('the keychain service exposes no value reader', () => {
  const source = readFileSync(new URL('../keychain.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /'get_secret'|\basync get\(/);
});
