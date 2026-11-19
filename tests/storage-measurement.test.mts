import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { stripTypeScriptTypes, syncBuiltinESMExports } from 'node:module';

const source = fs.readFileSync(new URL('../src/services/storage-measurement.ts', import.meta.url), 'utf8');
const javascript = stripTypeScriptTypes(source);
const expectedPlan = ([
  ['persistent-cache-indexeddb', 'owned-cache', false, ['recordCount']],
  ['persistent-cache-file', 'owned-cache', false, ['fileLengthBytes']],
  ['shared-db-snapshots', 'protected-evidence', true, ['recordCount']],
  ['shared-db-baselines', 'protected-unresolved', true, ['recordCount']],
  ['shared-db-reasoning', 'mixed-protected', true, ['recordCount']],
  ['origin-local-storage', 'mixed-protected', true, ['entryCount']],
  ['evidence-sqlite-main', 'protected-evidence', true, ['fileLengthBytes']],
  ['evidence-sqlite-wal', 'protected-evidence', true, ['fileLengthBytes']],
  ['evidence-sqlite-shm', 'protected-evidence', true, ['fileLengthBytes']],
  ['browser-origin-estimate', 'mixed-diagnostic-estimate', true, ['estimatedUsageBytes', 'estimatedQuotaBytes']],
] as const).map(([scopeId, classification, protectedScope, allowedMetrics]) => ({ scopeId, classification, protected: protectedScope, allowedMetrics: [...allowedMetrics] }));

function fixtureObservations() {
  return expectedPlan.map((scope, index) => ({
    scopeId: scope.scopeId,
    status: 'complete',
    metrics: Object.fromEntries(scope.allowedMetrics.map((metric, metricIndex) => [metric, index * 100 + metricIndex])),
  }));
}

async function withoutIo(run: () => Promise<void>) {
  const globals = ['localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'fetch', 'XMLHttpRequest', 'WebSocket', '__TAURI_INTERNALS__'];
  const saved = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const methods = ['readFileSync', 'readFile', 'writeFileSync', 'writeFile', 'openSync', 'open', 'statSync', 'stat', 'readdirSync', 'readdir', 'unlinkSync', 'unlink', 'rmSync', 'rm'] as const;
  const originals = new Map(methods.map((name) => [name, fs[name]]));
  const otherTargets = [
    [fs.promises, ['readFile', 'writeFile', 'open', 'stat', 'readdir', 'unlink', 'rm']],
    [http, ['request', 'get']], [https, ['request', 'get']],
    [net, ['connect', 'createConnection']], [net.Socket.prototype, ['connect']],
  ] as const;
  const otherOriginals: Array<[object, string, PropertyDescriptor]> = [];
  const accesses: string[] = [];
  const deny = (name: string) => { accesses.push(name); throw new Error('Forbidden fixture I/O'); };
  try {
    for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, get: () => deny(key) });
    for (const name of methods) Object.defineProperty(fs, name, { ...Object.getOwnPropertyDescriptor(fs, name), value: () => deny(`fs.${name}`) });
    for (const [target, names] of otherTargets) for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(target, name)!;
      otherOriginals.push([target, name, descriptor]);
      Object.defineProperty(target, name, { ...descriptor, value: () => deny(name) });
    }
    syncBuiltinESMExports();
    await run();
    assert.deepEqual(accesses, [], 'module evaluation and report construction must perform no I/O');
  } finally {
    for (const key of globals) {
      const descriptor = saved.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    for (const [name, value] of originals) Object.defineProperty(fs, name, { ...Object.getOwnPropertyDescriptor(fs, name), value });
    for (const [target, name, descriptor] of otherOriginals) Object.defineProperty(target, name, descriptor);
    syncBuiltinESMExports();
  }
}

let api: typeof import('../src/services/storage-measurement.ts');
test('actual module evaluation and metadata calls have no storage, network or filesystem access', async () => {
  assert.doesNotMatch(javascript, /(?:^|\n)\s*import\b|\bimport\s*\(|\brequire\s*\(/, 'no runtime imports or storage constructors');
  await withoutIo(async () => {
    api = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
    api.getStorageMeasurementPlan();
    api.buildStorageMeasurement([]);
    api.buildStorageMeasurement(fixtureObservations());
  });
});

test('fixed catalog separates ownership and units without granting deletion authority', () => {
  assert.deepEqual(api.getStorageMeasurementPlan(), expectedPlan);
});

test('missing scopes are not-observed with unknown metrics rather than invented zeros', () => {
  assert.deepEqual(api.buildStorageMeasurement([]), {
    schemaVersion: 1, coverage: 'selected-scopes', liveBaselineEstablished: false,
    scopes: expectedPlan.map((scope) => ({ ...scope, status: 'not-observed', metrics: {} })),
  });
});

test('complete synthetic metadata remains per-scope with exact units and no overlapping totals', () => {
  const observations = fixtureObservations();
  observations[9]!.metrics = { estimatedUsageBytes: 5000, estimatedQuotaBytes: 4000 };
  const report = api.buildStorageMeasurement(observations);
  assert.deepEqual(report, {
    schemaVersion: 1, coverage: 'selected-scopes', liveBaselineEstablished: false,
    scopes: expectedPlan.map((scope, index) => ({ ...scope, status: 'complete', metrics: observations[index]!.metrics })),
  });
  assert.deepEqual(Object.keys(report).sort(), ['coverage', 'liveBaselineEstablished', 'schemaVersion', 'scopes']);
  assert.equal(report.scopes[0]!.metrics.recordCount, 0, 'observed zero remains explicit');
  assert.equal(report.scopes[1]!.metrics.fileLengthBytes, 100, 'file length is not allocated disk size');
  assert.equal(report.scopes[5]!.metrics.entryCount, 500, 'entry count does not become bytes');
  assert.deepEqual(report.scopes[9]!.metrics, { estimatedUsageBytes: 5000, estimatedQuotaBytes: 4000 });
});

test('unavailable, unsupported and absent stay distinct from missing and measured zero', () => {
  for (const status of ['unavailable', 'unsupported', 'absent']) {
    for (const metrics of [undefined, {}]) {
      const observation = { scopeId: 'persistent-cache-file', status, ...(metrics === undefined ? {} : { metrics }) };
      const report = api.buildStorageMeasurement([observation]);
      assert.equal(report.scopes[1]!.status, status);
      assert.deepEqual(report.scopes[1]!.metrics, {});
      assert.equal(report.scopes[0]!.status, 'not-observed');
      assert.deepEqual(report.scopes[0]!.metrics, {});
    }
  }
});

test('partial observations preserve missing metrics and never promote even with all metrics', () => {
  for (const metrics of [{}, { estimatedUsageBytes: 0 }, { estimatedQuotaBytes: 123 }, { estimatedUsageBytes: 20, estimatedQuotaBytes: 30 }]) {
    const report = api.buildStorageMeasurement([{ scopeId: 'browser-origin-estimate', status: 'partial', metrics }]);
    assert.equal(report.scopes[9]!.status, 'partial');
    assert.deepEqual(report.scopes[9]!.metrics, metrics);
    assert.equal(report.liveBaselineEstablished, false);
  }
});

const secret = 'SYNTHETIC_SECRET_CANARY_ux056';
const privatePath = '/synthetic-private-home/ux056-canary/profile.sqlite';
const privateKey = 'synthetic-web-secret-vault-key-ux056';
const invalidMessage = 'Invalid storage measurement observations';
function reject(observations: unknown) {
  assert.throws(() => api.buildStorageMeasurement(observations), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, invalidMessage);
    assert.deepEqual(Object.keys(error), [], 'errors cannot carry caller metadata');
    const rendered = String(error) + JSON.stringify(error);
    for (const canary of [secret, privatePath, privateKey]) assert.equal(rendered.includes(canary), false);
    return true;
  });
}

test('complete observations require every permitted metric; nonmeasurement states reject even zero metrics', () => {
  reject([{ scopeId: 'persistent-cache-file', status: 'complete' }]);
  reject([{ scopeId: 'persistent-cache-file', status: 'complete', metrics: {} }]);
  for (const metrics of [{ estimatedUsageBytes: 1 }, { estimatedQuotaBytes: 1 }]) {
    reject([{ scopeId: 'browser-origin-estimate', status: 'complete', metrics }]);
  }
  for (const status of ['absent', 'unavailable', 'unsupported']) {
    reject([{ scopeId: 'persistent-cache-file', status, metrics: { fileLengthBytes: 0 } }]);
  }
});

test('metric names cannot cross record, entry, file-length and origin-estimate boundaries', () => {
  const allMetrics = ['recordCount', 'entryCount', 'fileLengthBytes', 'estimatedUsageBytes', 'estimatedQuotaBytes'];
  for (const scope of expectedPlan) for (const metric of allMetrics) {
    if ((scope.allowedMetrics as string[]).includes(metric)) continue;
    reject([{ scopeId: scope.scopeId, status: 'partial', metrics: { [metric]: 42 } }]);
  }
});

test('counts and byte quantities accept safe-integer endpoints and reject malformed numbers or values', () => {
  for (const value of [0, Number.MAX_SAFE_INTEGER]) {
    const report = api.buildStorageMeasurement([{ scopeId: 'shared-db-snapshots', status: 'complete', metrics: { recordCount: value } }]);
    assert.equal(report.scopes[2]!.metrics.recordCount, value);
  }
  for (const value of [-1, 0.5, Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '12', null, undefined, true, 1n, Symbol(secret), {}, []]) {
    reject([{ scopeId: 'shared-db-snapshots', status: 'complete', metrics: { recordCount: value } }]);
  }
});

test('unknown scopes, duplicates and output-only status cannot forge scope coverage', () => {
  const entry = { scopeId: 'shared-db-reasoning', status: 'complete', metrics: { recordCount: 1 } };
  reject([entry, structuredClone(entry)]);
  reject([entry, { ...entry, status: 'unavailable', metrics: {} }]);
  for (const scopeId of [secret, privatePath, privateKey, '', null, 42]) reject([{ scopeId, status: 'absent' }]);
  for (const status of ['not-observed', 'unknown', '', secret, null, 42]) reject([{ scopeId: 'shared-db-reasoning', status }]);
});

test('caller labels, keys, paths, values, ownership and policy claims are rejected without reflection', () => {
  const base = { scopeId: 'shared-db-reasoning', status: 'partial', metrics: {} };
  for (const [key, value] of Object.entries({ label: secret, key: privateKey, filename: privatePath, path: privatePath, value: secret, error: secret, classification: 'owned-cache', protected: false, deletable: true, totalBytes: 123 })) {
    reject([{ ...base, [key]: value }]);
  }
  reject([{ ...base, [secret]: true }]);
  reject([{ ...base, metrics: { [privateKey]: 1 } }]);
  reject([{ ...base, [Symbol(secret)]: privatePath }]);
  reject([{ ...base, metrics: { [Symbol(secret)]: 1 } }]);
});

test('oversized input is rejected before inspecting any observation descriptors', () => {
  let inspected = 0;
  const observations = new Proxy(Array.from({ length: 33 }, () => ({ scopeId: 'persistent-cache-file', status: 'absent' })), {
    getOwnPropertyDescriptor(target, key) {
      if (key !== 'length') inspected++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  reject(observations);
  assert.equal(inspected, 0, 'bound must precede observation processing');
});

test('malformed containers and accessors cannot execute field getters or escape sanitized errors', () => {
  for (const value of [null, undefined, {}, secret, 42, new Map(), new Set(), new Uint8Array(1), new Array(1)]) reject(value);
  for (const entry of [null, [], new Date(), new Map(), Object.assign(Object.create({ inherited: true }), { scopeId: 'persistent-cache-file', status: 'absent' })]) reject([entry]);
  let getterCalls = 0;
  const getter = () => { getterCalls++; throw new Error(secret); };
  const observation = { scopeId: 'persistent-cache-file', status: 'complete', metrics: { fileLengthBytes: 1 } };
  for (const field of ['scopeId', 'status', 'metrics']) {
    reject([Object.defineProperty({ ...observation }, field, { enumerable: true, get: getter })]);
  }
  reject([{ ...observation, metrics: Object.defineProperty({}, 'fileLengthBytes', { enumerable: true, get: getter }) }]);
  reject(Object.defineProperty([observation], '0', { enumerable: true, get: getter }));
  assert.equal(getterCalls, 0);
  reject([new Proxy(observation, { ownKeys() { throw new Error(secret); } })]);
  reject(new Proxy([], { getOwnPropertyDescriptor() { throw new Error(privatePath); } }));
});

test('frozen inputs are unchanged and report order is independent of observation order', () => {
  const observations = fixtureObservations().reverse();
  const before = structuredClone(observations);
  for (const entry of observations) { Object.freeze(entry.metrics); Object.freeze(entry); }
  Object.freeze(observations);
  const report = api.buildStorageMeasurement(observations);
  assert.deepEqual(observations, before);
  assert.deepEqual(report, api.buildStorageMeasurement([...before].reverse()));
  assert.deepEqual(report.scopes.map((scope) => scope.scopeId), expectedPlan.map((scope) => scope.scopeId));
});

test('mutating returned nested metadata cannot affect inputs, later plans or reports', () => {
  const input = fixtureObservations();
  const before = structuredClone(input);
  const plan = api.getStorageMeasurementPlan();
  const report = api.buildStorageMeasurement(input);
  Reflect.set(plan[4]!, 'protected', false);
  Reflect.set(plan[4]!.allowedMetrics, '0', 'fileLengthBytes');
  Reflect.set(report.scopes[4]!.metrics, 'recordCount', 999999);
  Reflect.set(report.scopes[4]!, 'classification', 'owned-cache');
  Reflect.set(report.scopes[4]!.allowedMetrics, '0', 'fileLengthBytes');
  assert.deepEqual(input, before);
  assert.deepEqual(api.getStorageMeasurementPlan(), expectedPlan);
  const next = api.buildStorageMeasurement(input);
  assert.equal(next.scopes[4]!.protected, true);
  assert.equal(next.scopes[4]!.classification, 'mixed-protected');
  assert.deepEqual(next.scopes[4]!.allowedMetrics, ['recordCount']);
  assert.deepEqual(next.scopes[4]!.metrics, before[4]!.metrics);
  assert.notEqual(next.scopes[4], report.scopes[4]);
  assert.notEqual(next.scopes[4]!.metrics, report.scopes[4]!.metrics);
});
