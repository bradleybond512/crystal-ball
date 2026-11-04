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

function makeLocks() {
  const held = new Set<string>();
  return { async request(name: string, options: { ifAvailable: boolean }, callback: (lock: object | null) => Promise<unknown>) {
    assert.equal(options.ifAvailable, true);
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({}); } finally { held.delete(name); }
  } };
}

function harness(options: {
  leakyNative?: boolean; web?: boolean; base?: string; token?: string;
  reply?: (url: string, init: RequestInit) => Promise<Response>;
  webEntries?: Map<string, string>; isCurrent?: () => boolean;
  share?: { locks: ReturnType<typeof makeLocks> | null; storage: Map<string,string> };
  writeState?: () => { revision: number; pending: number; source: string };
} = {}) {
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
      case 'get_local_api_token': { return options.token ?? 'test-token'; }
      case 'get_secret_write_state': { return options.writeState?.() ?? { revision: 1, pending: 0, source: 'vault' }; }
      default: { throw new Error(`unexpected native command ${command}`); }
    }
  };
  const storage = options.share?.storage ?? new Map<string, string>();
  Object.assign(globalThis, {
    window: { addEventListener: () => {} },
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) },
    fetch: async (url: string, init?: RequestInit) => {
      fetches.push({ url: String(url), body: String(init?.body ?? '') });
      return options.reply?.(url, init ?? {}) ?? Response.json({ outcome: 'verified', reason: 'provider-accepted' });
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
    if (id === './credential-probe' || id === './credential-evidence') {
      const mod = {};
      const nav = { locks: options.share ? options.share.locks : makeLocks() };
      new Function('exports', 'navigator', 'localStorage', compile('.' + id + '.ts'))(mod, nav, globalThis.localStorage);
      return mod;
    }
    if (id === './runtime') return { isDesktopRuntime: () => !options.web, resolveConfirmedLocalApiBase: async () => options.base ?? 'http://127.0.0.1:46123' };
    if (id === './tauri-bridge') return tauri;
    if (id === './keychain') return keychain;
    if (id === '../utils/safe-storage') return { safeSetItem: (k: string, v: string) => storage.set(k, v) };
    if (id === './web-secret-store') return { isVaultUnlocked: () => !!options.webEntries, isStoredValueCurrent: async () => options.isCurrent?.() ?? true, listSecrets: () => new Map(options.webEntries), setSecret: async () => {}, onVaultChange: () => () => {}, isSupported: () => false };
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
  assert.equal(result.outcome, 'verified');
  assert.equal(h.fetches.length, 1);
  assert.match(h.fetches[0]!.url, /\/api\/local-validate-secret$/);
  assert.deepEqual(JSON.parse(h.fetches[0]!.body), { key: 'GROQ_API_KEY', useStored: true, context: {} });
});

test('Test on a saved readable desktop key also sends no value; an unset key sends nothing', async () => {
  const h = harness();
  await h.api.loadDesktopSecretsWhenReady();
  await h.api.verifyStoredSecretWithApi('OLLAMA_MODEL');
  assert.deepEqual(JSON.parse(h.fetches[0]!.body), { key: 'OLLAMA_MODEL', useStored: true, context: {} });
  h.fetches.length = 0;
  assert.equal((await h.api.verifyStoredSecretWithApi('SHODAN_API_KEY')).outcome, 'invalid-format');
  assert.deepEqual(h.fetches, []);
});

test('the keychain service exposes no value reader', () => {
  const source = readFileSync(new URL('../keychain.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /'get_secret'|\basync get\(/);
});

test('browser needs provider-specific evidence; public endpoints, challenges and upstream text cannot certify a key', async () => {
  for (const [status, body, outcome] of [
    [200, { object: 'list', data: [{ object: 'model', id: 'sample' }] }, 'verified'],
    [200, { data: [{ object: 'model', id: 'm' }] }, 'unavailable'],
    [200, { data: [] }, 'unavailable'], [200, { error: 'canary-secret' }, 'unavailable'],
    [401, { error: { code: 'invalid_api_key' } }, 'rejected'],
    [401, { message: 'canary-secret' }, 'unavailable'], [403, { error: { code: 'invalid_api_key' } }, 'unavailable'],
    [429, {}, 'unavailable'], [503, {}, 'unavailable'],
  ] as const) {
    const h = harness({ web: true, reply: async (url, init) => {
      assert.equal(url, 'https://api.groq.com/openai/v1/models');
      assert.equal(init.redirect, 'error');
      return Response.json(body, { status });
    } });
    const result = await h.api.verifySecretWithApi('GROQ_API_KEY', 'canary-secret');
    assert.equal(result.outcome, outcome);
    assert.equal(result.canSave, outcome !== 'rejected');
    assert.doesNotMatch(JSON.stringify(result), /canary-secret/);
    const publicKey = await h.api.verifySecretWithApi('OPENROUTER_API_KEY', 'canary-secret');
    assert.equal(publicKey.outcome, 'not-probed');
    assert.equal(h.fetches.length, 1);
  }
});

test('sidecar trust requires confirmed loopback, bearer and exact outcome agreement', async () => {
  for (const options of [{ base: 'https://example.test' }, { token: '' }]) {
    const h = harness(options);
    assert.equal((await h.api.verifySecretWithApi('GROQ_API_KEY', 'sample')).outcome, 'unavailable');
    assert.equal(h.fetches.length, 0);
  }
  for (const [status, body] of [
    [401, { outcome: 'rejected', reason: 'provider-rejected' }],
    [200, { valid: 'true', message: 'canary-secret' }],
    [200, { outcome: 'verified', reason: 'provider-rejected' }],
    [200, { outcome: 'verified', reason: 'provider-accepted', message: 'canary-secret' }],
  ] as const) {
    const h = harness({ reply: async () => Response.json(body, { status }) });
    const result = await h.api.verifySecretWithApi('GROQ_API_KEY', 'sample', { ACLED_EMAIL: 'canary-secret' });
    assert.equal(result.outcome, 'unavailable');
    assert.doesNotMatch(JSON.stringify([result, h.fetches]), /canary-secret/);
  }
});

test('one in-flight match, two concurrent slots and per-key cooldown, with no queued retry', async () => {
  let finish!: () => void;
  const gate = new Promise<void>(r => { finish = r; });
  const h = harness({ reply: async () => {
    await gate;
    return Response.json({ outcome: 'verified', reason: 'provider-accepted' });
  } });
  const first = h.api.verifySecretWithApi('GROQ_API_KEY', 'one');
  const same = h.api.verifySecretWithApi('GROQ_API_KEY', 'one');
  const second = h.api.verifySecretWithApi('OPENSKY_CLIENT_ID', 'two', { OPENSKY_CLIENT_SECRET: 'partner', ACLED_EMAIL: 'unrelated' });
  assert.equal((await h.api.verifySecretWithApi('GROQ_API_KEY', 'different')).reason, 'cooldown');
  assert.equal((await h.api.verifySecretWithApi('OPENSKY_CLIENT_ID', 'two', { OPENSKY_CLIENT_SECRET: 'different' })).reason, 'cooldown');
  assert.equal((await h.api.verifySecretWithApi('SHODAN_API_KEY', 'three')).reason, 'concurrency-limit');
  finish();
  assert.ok((await Promise.all([first, same, second])).every(r => r.outcome === 'verified'));
  assert.equal((await h.api.verifySecretWithApi('GROQ_API_KEY', 'one')).reason, 'cooldown');
  assert.equal(h.fetches.length, 2);
  assert.deepEqual(JSON.parse(h.fetches[1]!.body).context, { OPENSKY_CLIENT_SECRET: 'partner' });
});

test('oversized or stalled provider streams cannot establish verification', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  const h = harness({ web: true, reply: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1_000_000)); },
    cancel() { cancelled = true; },
  })) });
  assert.equal((await h.api.verifySecretWithApi('GROQ_API_KEY', 'one')).outcome, 'unavailable');
  assert.equal(cancelled, true);
  let signal: AbortSignal | null | undefined;
  const stalled = harness({ web: true, reply: async (_url, init) => {
    signal = init.signal;
    return new Response(new ReadableStream({}));
  } });
  const checking = stalled.api.verifySecretWithApi('GROQ_API_KEY', 'one');
  for (let i = 0; i < 10; i++) await Promise.resolve();
  t.mock.timers.tick(8000);
  assert.equal((await checking).reason, 'timeout');
  assert.equal(signal?.aborted, true);
});

test('stored browser checks require the decrypted window value to match the persisted vault before and after', async () => {
  for (const checks of [[false], [true, false]]) {
    const h = harness({ web: true, webEntries: new Map([['GROQ_API_KEY', 'sample']]), isCurrent: () => checks.shift() ?? false,
      reply: async () => Response.json({ object: 'list', data: [{ object: 'model', id: 'm' }] }) });
    h.api.syncWebVaultIntoConfig();
    const expectedFetches = checks[0] ? 1 : 0;
    assert.equal((await h.api.verifyStoredSecretWithApi('GROQ_API_KEY')).outcome, 'unavailable');
    assert.equal(h.fetches.length, expectedFetches);
  }
});

test('pending or changing native revision cannot verify the saved value', async () => {
  for (const states of [[{ revision: 1, pending: 1 }], [{ revision: 1, pending: 0 }, { revision: 2, pending: 0 }]]) {
    const h = harness({ writeState: () => ({ ...states.shift()!, source: 'vault' }) });
    await h.api.loadDesktopSecrets();
    const expectedFetches = states[0]!.pending ? 0 : 1;
    assert.equal((await h.api.verifyStoredSecretWithApi('GROQ_API_KEY')).outcome, 'unavailable');
    assert.equal(h.fetches.length, expectedFetches);
  }
});

test('a provider rejection cannot be bypassed by a second Save during cooldown', async () => {
  const h = harness({ reply: async () => Response.json({ outcome: 'rejected', reason: 'provider-rejected' }) });
  assert.equal((await h.api.verifySecretWithApi('GROQ_API_KEY', 'sample')).outcome, 'rejected');
  const again = await h.api.verifySecretWithApi('GROQ_API_KEY', 'sample');
  assert.equal(again.canSave, false);
  assert.equal(h.fetches.length, 1);
});

test('unknown key names never read a prototype, reach a validator or write a vault', async () => {
  const h = harness();
  for (const key of ['constructor', '__proto__', 'UNKNOWN_SLOT']) {
    assert.equal((await h.api.verifySecretWithApi(key, 'sample')).outcome, 'invalid-format');
    assert.equal((await h.api.verifyStoredSecretWithApi(key)).outcome, 'invalid-format');
    await assert.rejects(h.api.setSecretValue(key, 'sample'));
  }
  assert.deepEqual(h.fetches, []);
  assert.deepEqual(h.calls, []);
});

test('the encrypted vault must still contain the tested value and belong to the unlocked session', async () => {
  const storage = new Map<string, unknown>();
  const changes: unknown[] = [];
  const api: Record<string, any> = {};
  Object.defineProperty(globalThis, 'indexedDB', { value: {}, configurable: true });
  try {
    new Function('require', 'exports', compile('../web-secret-store.ts'))((id: string) => {
      assert.equal(id, './reasoning-memory');
      return {
        getMemory: async (k: string) => structuredClone(storage.get(k)),
        putMemory: async (k: string, v: unknown) => storage.set(k, structuredClone(v)),
        deleteMemory: async (k: string) => storage.delete(k),
      };
    }, api);
    api.onVaultChange((change: unknown) => changes.push(change));
    await api.createVault('synthetic local test phrase');
    await api.setSecret('GROQ_API_KEY', 'synthetic-sample');
    assert.equal(await api.isStoredValueCurrent('GROQ_API_KEY', 'synthetic-sample'), true);
    assert.equal(await api.isStoredValueCurrent('GROQ_API_KEY', 'replacement'), false);
    const name = 'web-secret-vault/v1';
    const original = storage.get(name) as Record<string, unknown>;
    storage.set(name, { ...original, ct: 'changed' });
    assert.equal(await api.isStoredValueCurrent('GROQ_API_KEY', 'synthetic-sample'), false);
    storage.set(name, original);
    api.lockVault();
    assert.equal(await api.isStoredValueCurrent('GROQ_API_KEY', 'synthetic-sample'), false);
    await api.destroyVault();
    assert.deepEqual(changes, ['reset', { key: 'GROQ_API_KEY' }, 'local', 'local', 'reset']);
    assert.doesNotMatch(JSON.stringify(changes), /synthetic-sample/);
  } finally {
    Reflect.deleteProperty(globalThis, 'indexedDB');
  }
});

test('separate browser windows honor one key lock, two total slots and the full shared cooldown', async t => {
  const share = { locks: makeLocks(), storage: new Map<string,string>() };
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const urls: string[] = [];
  const windowProbe = (key: string, value: string) => {
    const h = harness({ web: true, share, reply: async url => {
      urls.push(url);
      await gate;
      return Response.json({ object: 'list', data: [{ object: 'model', id: 'm' }] });
    } });
    return h.api.verifySecretWithApi(key, value);
  };
  const first = windowProbe('GROQ_API_KEY', 'private-A');
  const duplicate = windowProbe('GROQ_API_KEY', 'private-B');
  const second = windowProbe('ANTHROPIC_API_KEY', 'private-C');
  const third = windowProbe('CESIUM_ION_TOKEN', 'private-D');
  await new Promise(r => setImmediate(r));
  release();
  const results = await Promise.all([first, duplicate, second, third]);
  assert.equal(urls.length, 2);
  assert.equal(results[1].reason, 'cooldown');
  assert.equal(results[3].reason, 'concurrency-limit');
  assert.ok([...share.storage.values()].every(v => /^\d{13}$/.test(v)), 'only timestamps shared');
  now += 59_999;
  assert.equal((await windowProbe('GROQ_API_KEY', 'private-E')).reason, 'cooldown');
  now++;
  assert.equal((await windowProbe('GROQ_API_KEY', 'private-E')).outcome, 'verified');
  assert.equal(urls.length, 3);
});

test('a browser without functioning shared coordination sends no credential', async () => {
  for (const denyStorage of [true, false]) {
    const storage = new Map<string,string>();
    if (denyStorage) storage.set = () => { throw Error('blocked'); };
    const h = harness({ web: true, share: { locks: denyStorage ? makeLocks() : null, storage } });
    assert.equal((await h.api.verifySecretWithApi('GROQ_API_KEY', 'private-A')).outcome, 'unavailable');
    assert.equal(h.fetches.length, 0);
  }
});

test('a second window denied a stored check cannot replace the first window’s attempt identity', async () => {
  const share = { locks: makeLocks(), storage: new Map<string,string>() };
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const options = { web: true, share, webEntries: new Map([['GROQ_API_KEY','private']]), reply: async () => {
    await gate;
    return Response.json({ object: 'list', data: [{ object: 'model', id: 'm' }] });
  } };
  const one = harness(options);
  const two = harness(options);
  one.api.syncWebVaultIntoConfig();
  two.api.syncWebVaultIntoConfig();
  const active = one.api.verifyStoredSecretWithApi('GROQ_API_KEY');
  await new Promise(r => setImmediate(r));
  const denied = await two.api.verifyStoredSecretWithApi('GROQ_API_KEY');
  release();
  assert.equal(denied.reason, 'cooldown');
  assert.equal((await active).outcome, 'verified');
});
