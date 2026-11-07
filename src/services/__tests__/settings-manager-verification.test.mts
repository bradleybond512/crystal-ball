import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../settings-manager.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
const outage = { outcome: 'unavailable', canSave: true, message: 'Could not verify' };
function fixture(verify = async (..._args: any[]) => outage, write = async (..._args: any[]) => {}) {
  const writes: string[] = [];
  const api: Record<string, any> = {};
  const config = {
    validateSecret: () => ({ valid: true }),
    verifySecretWithApi: verify,
    setSecretValue: async (key: string, value: string) => { await write(key, value); writes.push(key); },
  };
  new Function('require', 'exports', outputText)((id: string) => {
    if (id === './runtime-config') return config;
    if (id === './settings-constants') return { PLAINTEXT_KEYS: new Set(), MASKED_SENTINEL: '••••' };
    throw new Error(id);
  }, api);
  return { manager: new api.SettingsManager(), writes };
}

test('unavailable explicit validation allows saving, a provider rejection retains the draft', async () => {
  const { manager, writes } = fixture(async key => key === 'GROQ_API_KEY' ? outage : { outcome: 'rejected', message: 'Provider rejected', canSave: false });
  manager.setPending('GROQ_API_KEY', 'sample-a');
  assert.deepEqual(await manager.verifyPendingSecrets(), []);
  await manager.commitVerifiedSecrets();
  manager.setPending('ANTHROPIC_API_KEY', 'sample-b');
  assert.deepEqual(await manager.verifyPendingSecrets(), ['ANTHROPIC_API_KEY: Provider rejected']);
  await manager.commitVerifiedSecrets();
  assert.deepEqual(writes, ['GROQ_API_KEY']);
  assert.equal(manager.getPending('ANTHROPIC_API_KEY'), 'sample-b');
});

test('a check gets only the companion value for its own key', async () => {
  const contexts = new Map();
  const { manager } = fixture(async (key, _value, context) => { contexts.set(key, context); return outage; });
  manager.setPending('GROQ_API_KEY', 'sample-unrelated');
  manager.setPending('OPENSKY_CLIENT_ID', 'sample-id');
  manager.setPending('OPENSKY_CLIENT_SECRET', 'sample-secret');
  await manager.verifyPendingSecrets();
  assert.deepEqual(contexts.get('GROQ_API_KEY'), {});
  assert.deepEqual(contexts.get('OPENSKY_CLIENT_ID'), { OPENSKY_CLIENT_SECRET: 'sample-secret' });
  assert.deepEqual(contexts.get('OPENSKY_CLIENT_SECRET'), { OPENSKY_CLIENT_ID: 'sample-id' });
});

test('editing and restoring text during verification invalidates the batch', async () => {
  let finish!: () => void;
  const { manager, writes } = fixture(async () => { await new Promise<void>(r => { finish = r; }); return outage; });
  manager.setPending('GROQ_API_KEY', 'sample-a');
  const checking = manager.verifyPendingSecrets();
  manager.setPending('GROQ_API_KEY', 'sample-b');
  manager.setPending('GROQ_API_KEY', 'sample-a');
  finish();
  assert.ok((await checking).length);
  await manager.commitVerifiedSecrets();
  assert.deepEqual(writes, []);
});

test('an edit during a vault write survives and unchecked later keys are never written', async () => {
  let finish!: () => void;
  const { manager, writes } = fixture(undefined, async () => { await new Promise<void>(r => { finish = r; }); });
  manager.setPending('GROQ_API_KEY', 'sample-a');
  await manager.verifyPendingSecrets();
  const saving = manager.commitVerifiedSecrets();
  manager.setPending('GROQ_API_KEY', 'sample-b');
  manager.setPending('ANTHROPIC_API_KEY', 'sample-c');
  finish();
  await saving;
  assert.equal(manager.getPending('GROQ_API_KEY'), 'sample-b');
  assert.deepEqual(writes, ['GROQ_API_KEY']);
});
