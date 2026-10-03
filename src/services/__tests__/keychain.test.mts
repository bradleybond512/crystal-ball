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

// R4-SEC-001: the renderer reads presence and the readable allowlist only.
test('status() returns presence per key and never asks for a value', async () => {
  reset();
  invokeImpl = (async (command: string) => {
    if (command === 'get_secret_status') return [{ key: 'ANTHROPIC_API_KEY', present: true }, { key: 'GROQ_API_KEY', present: false }, { nope: 1 }, null];
    throw new Error(`unexpected ${command}`);
  }) as InvokeImpl;
  const status = await keychainService.status();
  assert.deepEqual([...status], [['ANTHROPIC_API_KEY', true], ['GROQ_API_KEY', false]]);
  assert.deepEqual(calls.map((c) => c.command), ['get_secret_status']);
});

test('rendererConfig() keeps string values only', async () => {
  reset();
  invokeImpl = (async () => ({ MAPBOX_API_KEY: 'pk.x', OLLAMA_MODEL: 'llama3', BROKEN: 5 })) as InvokeImpl;
  assert.deepEqual(await keychainService.rendererConfig(), { MAPBOX_API_KEY: 'pk.x', OLLAMA_MODEL: 'llama3' });
  invokeImpl = (async () => ['not', 'a', 'map']) as InvokeImpl;
  assert.deepEqual(await keychainService.rendererConfig(), {});
  assert.deepEqual(calls.map((c) => c.command), ['get_renderer_config', 'get_renderer_config']);
});

test('set() and remove() write through to native and read nothing back', async () => {
  reset();
  invokeImpl = (async () => null) as InvokeImpl;
  await keychainService.set('OPENROUTER_API_KEY', 'new-value');
  await keychainService.remove('OTX_API_KEY');
  assert.deepEqual(calls, [
    { command: 'set_secret', payload: { key: 'OPENROUTER_API_KEY', value: 'new-value' } },
    { command: 'delete_secret', payload: { key: 'OTX_API_KEY' } },
  ]);
});

test('listSupportedKeys() memoizes the discovery call until invalidated', async () => {
  reset();
  invokeImpl = (async () => ['A', 'B']) as InvokeImpl;
  await keychainService.listSupportedKeys();
  await keychainService.listSupportedKeys();
  assert.equal(calls.length, 1);
  keychainService.invalidateAll();
  await keychainService.listSupportedKeys();
  assert.equal(calls.length, 2);
});
