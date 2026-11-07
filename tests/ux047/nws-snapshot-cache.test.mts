import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { validateNWSAlertSnapshot } from '../../src/services/nws-alert-snapshot.ts';

const NOW = Date.now();
const snapshot = (observedAt = NOW - 1000) => ({ schemaVersion: 1, scope: 'national-active', completeness: 'complete', observedAt, alerts: [] });
function harness(value: unknown, source = 'network') {
  const text = readFileSync(new URL('../../src/services/nws-alert-snapshot-cache.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('cache.ts', text, ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(s => !ts.isImportDeclaration(s)).map(s => s.getText(ast).replace(/^export /, '')).join('\n');
  const writes: unknown[] = [];
  const keys: string[] = [];
  const bindings = {
    captureNwsObservation: () => () => true,
    fetchNWSAlertsSnapshot: async () => value,
    validateNWSAlertSnapshot,
    withOfflineCache: async (key: string, fetcher: () => Promise<unknown>) => {
      keys.push(key);
      const data = source === 'network' ? await fetcher() : value;
      if (source === 'network') writes.push(data);
      return { data, cachedAt: NOW, expiresAt: NOW + 3600_000, isStale: source !== 'network', staleDurationMs: 0, source };
    },
  };
  const js = ts.transpileModule(`${body}\nreturn fetchCachedNwsSnapshot;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return { run: new Function(...Object.keys(bindings), js)(...Object.values(bindings)), writes, keys };
}

test('new cache namespace preserves the upstream observation time rather than cache write time', async () => {
  const h = harness(snapshot());
  const result = await h.run();
  assert.deepEqual(h.keys, ['nws-alerts-snapshot-v1']);
  assert.equal(result.cachedAt, NOW - 1000);
  assert.equal(result.expiresAt, NOW - 1000 + 3600_000);
  assert.equal(result.isStale, false);
});
test('a backend cache hit cannot promote an old acquisition to fresh', async () => {
  const result = await harness(snapshot(NOW - 300_001)).run();
  assert.equal(result.isStale, true);
  assert.ok(result.staleDurationMs >= 300_001);
});
test('offline replay remains stale and preserves original observation time', async () => {
  const result = await harness(snapshot(), 'offline-cache').run();
  assert.equal(result.isStale, true);
  assert.equal(result.cachedAt, NOW - 1000);
});
test('malformed network success never reaches cache persistence', async () => {
  const h = harness([]);
  await assert.rejects(h.run());
  assert.equal(h.writes.length, 0);
});
test('legacy arrays and malformed cached envelopes cannot certify national completeness', async () => {
  for (const invalid of [[], { ...snapshot(), completeness: 'partial' }, { ...snapshot(), observedAt: NOW + 120_000 }]) {
    await assert.rejects(harness(invalid, 'offline-cache').run());
  }
});

test('critical offline status tracks only the versioned national snapshot key', async () => {
  const { CRITICAL_SOURCE_KEYS } = await import('../../src/services/offline-alert-cache.ts');
  assert.ok(CRITICAL_SOURCE_KEYS.some(key => key === 'nws-alerts-snapshot-v1'));
  assert.equal(CRITICAL_SOURCE_KEYS.some(key => String(key) === 'nws-alerts'), false);
});
