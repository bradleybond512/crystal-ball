import assert from 'node:assert/strict';
import test from 'node:test';

interface InvokeCall {
  command: string;
  payload: Record<string, unknown> | undefined;
}

type InvokeImpl = <T>(command: string, payload?: Record<string, unknown>) => Promise<T>;

const calls: InvokeCall[] = [];
let invokeImpl: InvokeImpl = async () => { throw new Error('no impl set'); };

(globalThis as unknown as { window: object }).window = {
  __TAURI__: {
    core: {
      invoke: <T>(command: string, payload?: Record<string, unknown>): Promise<T> => {
        calls.push({ command, payload });
        return invokeImpl<T>(command, payload);
      },
    },
  },
};

const { keychainService } = await import('../keychain.ts');

function reset(): void {
  calls.length = 0;
  keychainService.invalidateAll();
}

test('get() issues exactly one IPC per key, then serves cache', async () => {
  reset();
  invokeImpl = async (_cmd: string, payload?: Record<string, unknown>) => {
    const key = payload?.key as string;
    if (key === 'ANTHROPIC_API_KEY') return 'sk-ant-secret' as never;
    return null as never;
  };

  const first = await keychainService.get('ANTHROPIC_API_KEY');
  const second = await keychainService.get('ANTHROPIC_API_KEY');
  const third = await keychainService.get('ANTHROPIC_API_KEY');

  assert.equal(first, 'sk-ant-secret');
  assert.equal(second, 'sk-ant-secret');
  assert.equal(third, 'sk-ant-secret');
  assert.equal(
    calls.filter((c) => c.command === 'get_secret').length,
    1,
    'three reads should hit IPC exactly once',
  );
});

test('null results are cached (vault has no entry for this key)', async () => {
  reset();
  invokeImpl = async () => null as never;

  const a = await keychainService.get('FRED_API_KEY');
  const b = await keychainService.get('FRED_API_KEY');

  assert.equal(a, null);
  assert.equal(b, null);
  assert.equal(
    calls.filter((c) => c.command === 'get_secret').length,
    1,
    'a cached null is still a cache hit',
  );
});

test('concurrent get() calls for the same key dedupe to one IPC', async () => {
  reset();
  let resolveIpc: ((value: string) => void) | null = null;
  invokeImpl = (() => new Promise<string>((res) => { resolveIpc = res; })) as InvokeImpl;

  const p1 = keychainService.get('GROQ_API_KEY');
  const p2 = keychainService.get('GROQ_API_KEY');
  const p3 = keychainService.get('GROQ_API_KEY');

  assert.ok(resolveIpc, 'IPC should have been kicked off');
  resolveIpc!('gsk-value');

  const [a, b, c] = await Promise.all([p1, p2, p3]);
  assert.equal(a, 'gsk-value');
  assert.equal(b, 'gsk-value');
  assert.equal(c, 'gsk-value');
  assert.equal(
    calls.filter((cc) => cc.command === 'get_secret').length,
    1,
    'three parallel reads should share one in-flight IPC',
  );
});

test('failed get() does not poison the cache — next call retries', async () => {
  reset();
  let attempt = 0;
  invokeImpl = (async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('keychain timeout');
    return 'recovered' as never;
  }) as InvokeImpl;

  await assert.rejects(() => keychainService.get('EIA_API_KEY'), /keychain timeout/);
  const value = await keychainService.get('EIA_API_KEY');

  assert.equal(value, 'recovered');
  assert.equal(attempt, 2, 'failure invalidates in-flight; second call re-issues');
});

test('set() updates the cache without reissuing get()', async () => {
  reset();
  invokeImpl = (async (cmd: string, payload?: Record<string, unknown>) => {
    if (cmd === 'set_secret') return undefined as never;
    if (cmd === 'get_secret') {
      const key = payload?.key as string;
      return key === 'OPENROUTER_API_KEY' ? 'old-value' as never : null as never;
    }
    return null as never;
  }) as InvokeImpl;

  // Prime the cache with the old value.
  const before = await keychainService.get('OPENROUTER_API_KEY');
  assert.equal(before, 'old-value');

  await keychainService.set('OPENROUTER_API_KEY', 'new-value');
  const after = await keychainService.get('OPENROUTER_API_KEY');

  assert.equal(after, 'new-value');
  assert.equal(
    calls.filter((c) => c.command === 'get_secret').length,
    1,
    'set() should not require a re-fetch — cache is updated in place',
  );
  assert.equal(
    calls.filter((c) => c.command === 'set_secret').length,
    1,
  );
});

test('set("") with whitespace-only value caches null', async () => {
  reset();
  invokeImpl = (async () => undefined as never) as InvokeImpl;

  await keychainService.set('URLHAUS_AUTH_KEY', '   ');
  invokeImpl = (async () => { throw new Error('should not be called'); }) as InvokeImpl;

  const value = await keychainService.get('URLHAUS_AUTH_KEY');
  assert.equal(value, null);
});

test('remove() caches null without a follow-up get()', async () => {
  reset();
  invokeImpl = (async (cmd: string) => {
    if (cmd === 'delete_secret') return undefined as never;
    if (cmd === 'get_secret') return 'leftover' as never;
    return null as never;
  }) as InvokeImpl;

  await keychainService.remove('OTX_API_KEY');
  const value = await keychainService.get('OTX_API_KEY');

  assert.equal(value, null);
  assert.equal(
    calls.filter((c) => c.command === 'get_secret').length,
    0,
    'cache should answer directly after remove()',
  );
});

test('invalidate(key) forces a fresh IPC on next get()', async () => {
  reset();
  let counter = 0;
  invokeImpl = (async () => {
    counter += 1;
    return `v${counter}` as never;
  }) as InvokeImpl;

  const a = await keychainService.get('ABUSEIPDB_API_KEY');
  keychainService.invalidate('ABUSEIPDB_API_KEY');
  const b = await keychainService.get('ABUSEIPDB_API_KEY');

  assert.equal(a, 'v1');
  assert.equal(b, 'v2');
});

test('listSupportedKeys() memoizes the discovery call', async () => {
  reset();
  invokeImpl = (async (cmd: string) => {
    if (cmd === 'list_supported_secret_keys') return ['A', 'B', 'C'] as never;
    return null as never;
  }) as InvokeImpl;

  const a = await keychainService.listSupportedKeys();
  const b = await keychainService.listSupportedKeys();

  assert.deepEqual(a, ['A', 'B', 'C']);
  assert.deepEqual(b, ['A', 'B', 'C']);
  assert.equal(
    calls.filter((c) => c.command === 'list_supported_secret_keys').length,
    1,
  );
});
