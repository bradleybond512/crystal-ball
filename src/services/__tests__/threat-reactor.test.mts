import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';

import type { DeviceFingerprint } from '../device-identity.ts';
import type { NormalizedThreat } from '../threat-reactor.ts';

let now = 1_700_000_000_000;
const clock = () => now;

let fingerprint: DeviceFingerprint = {
  asn: 7922,
  asnOrg: 'COMCAST',
  country: 'US',
  os: 'macos',
  fetchedAt: 0,
};

async function loadModule() {
  (
 globalThis as unknown as {
 __wmReactorFingerprint: () => Promise<DeviceFingerprint>;
 }
  ).__wmReactorFingerprint = async () => fingerprint;
  const mod = await import('../threat-reactor.ts');
  mod.__setClockForTesting(clock);
  mod.__resetForTesting();
  return mod;
}

function makeThreat(over: Partial<NormalizedThreat> = {}): NormalizedThreat {
  return {
 id: 'a',
 source: 'feodo',
 indicator: '1.2.3.4',
 indicatorType: 'ip',
 severity: 'low',
 title: 't',
 body: 'b',
 ...over,
  };
}

beforeEach(() => {
  now = 1_700_000_000_000;
  fingerprint = {
 asn: 7922,
 asnOrg: 'COMCAST',
 country: 'US',
 os: 'macos',
 fetchedAt: 0,
  };
});

afterEach(() => {
  delete (globalThis as Partial<{ __wmReactorFingerprint: unknown }>)
 .__wmReactorFingerprint;
});

test('asn_match scores 100', async () => {
  const mod = await loadModule();
  const r = mod.evaluateThreat(
 makeThreat({ asn: 7922, severity: 'low' }),
 fingerprint,
  );
  assert.equal(r?.score, 100);
  assert.equal(r?.reason, 'asn_match');
});

test('platform_targeted scores 60 for macos tags', async () => {
  const mod = await loadModule();
  const r = mod.evaluateThreat(
 makeThreat({ severity: 'low', tags: ['macos', 'stealer'] }),
 fingerprint,
  );
  assert.equal(r?.score, 60);
  assert.equal(r?.reason, 'platform_targeted');
});

test('country_critical scores 40 for same country + critical', async () => {
  const mod = await loadModule();
  const r = mod.evaluateThreat(
 makeThreat({ country: 'US', severity: 'critical' }),
 { ...fingerprint, asn: null },
  );
  assert.equal(r?.score, 40);
  assert.equal(r?.reason, 'country_critical');
});

test('high_severity catch-all scores 30', async () => {
  const mod = await loadModule();
  const r = mod.evaluateThreat(
 makeThreat({ severity: 'high', country: 'FR' }),
 { ...fingerprint, asn: null, country: 'US' },
  );
  assert.equal(r?.score, 30);
  assert.equal(r?.reason, 'high_severity');
});

test('returns null for low-severity unrelated threat', async () => {
  const mod = await loadModule();
  const r = mod.evaluateThreat(
 makeThreat({ severity: 'low', country: 'FR' }),
 { ...fingerprint, asn: null },
  );
  assert.equal(r, null);
});

test('returns null when device.asn is null and threat is medium with no match', async () => {
  const mod = await loadModule();
  const r = mod.evaluateThreat(
 makeThreat({ severity: 'medium', country: 'FR' }),
 { ...fingerprint, asn: null },
  );
  assert.equal(r, null);
});

test('dedupe: same threat ingested twice yields one alert', async () => {
  const mod = await loadModule();
  const seen: unknown[] = [];
  mod.onAlert((a) => seen.push(a));
  const t = makeThreat({ severity: 'high' });
  await mod.ingest([t]);
  await mod.ingest([t]);
  assert.equal(seen.length, 1);
});

test('dedupe expires after 24h', async () => {
  const mod = await loadModule();
  const seen: unknown[] = [];
  mod.onAlert((a) => seen.push(a));
  const t = makeThreat({ severity: 'high' });
  await mod.ingest([t]);
  now += 24 * 60 * 60 * 1000 + 1;
  await mod.ingest([t]);
  assert.equal(seen.length, 2);
});

test('onAlert unsubscribe stops notifications', async () => {
  const mod = await loadModule();
  const seen: unknown[] = [];
  const off = mod.onAlert((a) => seen.push(a));
  off();
  await mod.ingest([makeThreat({ severity: 'critical' })]);
  assert.equal(seen.length, 0);
});

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test('a subscriber that reports non-delivery releases the threat for the next ingest (R4-BUG-002)', async () => {
  const mod = await loadModule();
  const results = [false, true];
  const seen: unknown[] = [];
  mod.onAlert(async (a) => {
    seen.push(a);
    return results.shift() ?? true;
  });
  const t = makeThreat({ severity: 'high' });
  await mod.ingest([t]);
  await flush();
  now += 60_000;
  await mod.ingest([t]);
  await flush();
  now += 60_000;
  await mod.ingest([t]);
  await flush();
  assert.equal(seen.length, 2, 'retried once after non-delivery, then deduped after delivery');
});

test('a late non-delivery report cannot release a newer emission of the same threat', async () => {
  const mod = await loadModule();
  let reportFirst: (settled: boolean) => void = () => undefined;
  const reports = [
    new Promise<boolean>((resolve) => { reportFirst = resolve; }),
    Promise.resolve(true),
  ];
  const seen: unknown[] = [];
  mod.onAlert((a) => {
    seen.push(a);
    return reports.shift() ?? Promise.resolve(true);
  });
  const t = makeThreat({ severity: 'high' });
  await mod.ingest([t]);
  now += 24 * 60 * 60 * 1000 + 1;
  await mod.ingest([t]);
  reportFirst(false);
  await flush();
  now += 60_000;
  await mod.ingest([t]);
  await flush();
  assert.equal(seen.length, 2, 'the stale report from the expired emission is ignored');
});

test('a subscriber that rejects keeps the 24 h dedupe', async () => {
  const mod = await loadModule();
  const seen: unknown[] = [];
  mod.onAlert(async (a) => {
    seen.push(a);
    throw new Error('subscriber failed');
  });
  const t = makeThreat({ severity: 'high' });
  await mod.ingest([t]);
  await flush();
  now += 60_000;
  await mod.ingest([t]);
  await flush();
  assert.equal(seen.length, 1);
});
