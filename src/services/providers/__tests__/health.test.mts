import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROVIDERS_BY_DOMAIN,
  registerProvider,
  rebuildProviderIndex,
  type ProviderDefinition,
} from '../registry.ts';
import {
  recordSuccess,
  recordError,
  getHealth,
  getAllHealth,
  resetHealthForTests,
  instrument,
} from '../health.ts';

function clearRegistry(): void {
  for (const k of Object.keys(PROVIDERS_BY_DOMAIN)) {
    PROVIDERS_BY_DOMAIN[k as keyof typeof PROVIDERS_BY_DOMAIN].length = 0;
  }
  rebuildProviderIndex();
}

function fx(overrides: Partial<ProviderDefinition> = {}): ProviderDefinition {
  return {
    id: 'h-' + Math.random().toString(36).slice(2, 8),
    domain: 'aviation',
    name: 'Test',
    auth: 'none',
    baseUrl: 'https://example.test',
    ttlMs: 60_000,
    baselineWeight: 0.7,
    fallbackPriority: 0,
    lifecycle: 'active',
    ...overrides,
  };
}

test('getHealth returns null before any observation', () => {
  clearRegistry(); resetHealthForTests();
  const p = fx({ id: 'never-called' });
  registerProvider(p);
  assert.equal(getHealth(p.id), null);
});

test('recordSuccess flips status to healthy', () => {
  clearRegistry(); resetHealthForTests();
  const p = fx({ id: 'happy' });
  registerProvider(p);
  recordSuccess(p.id, 120);
  const h = getHealth(p.id);
  assert.ok(h);
  assert.equal(h.status, 'healthy');
  assert.equal(h.successCount, 1);
  assert.equal(h.lastLatencyMs, 120);
  assert.equal(h.avgLatencyMs, 120);
});

test('recordError without prior success → down', () => {
  clearRegistry(); resetHealthForTests();
  const p = fx({ id: 'sad' });
  registerProvider(p);
  recordError(p.id, 'boom');
  assert.equal(getHealth(p.id)?.status, 'down');
});

test('error ratio ≥ 25% with ≥4 attempts → degraded', () => {
  clearRegistry(); resetHealthForTests();
  const p = fx({ id: 'ratio' });
  registerProvider(p);
  // 3 successes + 1 error → 1/4 = 25% errors
  recordSuccess(p.id, 100);
  recordSuccess(p.id, 100);
  recordSuccess(p.id, 100);
  recordError(p.id, 'http 502');
  assert.equal(getHealth(p.id)?.status, 'degraded');
});

test('rolling latency window averages last 10 calls', () => {
  clearRegistry(); resetHealthForTests();
  const p = fx({ id: 'latency' });
  registerProvider(p);
  for (let i = 0; i < 12; i++) recordSuccess(p.id, 1000 + i);
  // The last 10 should be 1002..1011 → avg = 1006.5 → rounded 1007.
  assert.equal(getHealth(p.id)?.avgLatencyMs, 1007);
});

test('avg latency ≥ 5000ms → degraded', () => {
  clearRegistry(); resetHealthForTests();
  const p = fx({ id: 'slow' });
  registerProvider(p);
  for (let i = 0; i < 5; i++) recordSuccess(p.id, 6000);
  assert.equal(getHealth(p.id)?.status, 'degraded');
});

test('rateLimited supersedes other statuses while resetsAt is in future', () => {
  clearRegistry(); resetHealthForTests();
  const p = fx({ id: 'rl' });
  registerProvider(p);
  recordSuccess(p.id, 100);
  recordError(p.id, '429 too many requests', { quotaResetsAt: Date.now() + 60_000 });
  assert.equal(getHealth(p.id)?.status, 'rateLimited');
});

test('stale: lastSuccessAt older than 2x ttl', () => {
  clearRegistry(); resetHealthForTests();
  const p = fx({ id: 'stale-one', ttlMs: 1000 });
  registerProvider(p);
  recordSuccess(p.id, 100);
  // Backdate lastSuccessAt to 3 seconds ago (3x ttl).
  const h = getHealth(p.id);
  if (h) {
    h.lastSuccessAt = Date.now() - 3000;
    // Re-trigger derivation by recording another success at the same backdated timestamp,
    // then immediately backdating it again — easier: just call the underlying status check.
    // Since deriveStatus is internal, we trigger via another recordSuccess that doesn't help,
    // so we directly read after manipulating lastSuccessAt — but status was set at recordSuccess.
    // To get a live re-derive, observe after another error keeping lastSuccessAt in the past.
  }
  // Force re-derivation by recording a benign event that runs deriveStatus.
  // Use recordError with a non-quota message so it just bumps errorCount and re-derives.
  recordError(p.id, 'transient');
  assert.equal(getHealth(p.id)?.status, 'stale');
});

test('getAllHealth sorts down→degraded→rateLimited→stale→unknown→healthy', () => {
  clearRegistry(); resetHealthForTests();
  const a = fx({ id: 'good' }); registerProvider(a);
  const b = fx({ id: 'bad' });  registerProvider(b);
  const c = fx({ id: 'meh' });  registerProvider(c);
  recordSuccess(a.id, 100);                       // healthy
  recordError(b.id, 'failed');                    // down
  recordSuccess(c.id, 100); recordSuccess(c.id, 100); recordSuccess(c.id, 100); recordError(c.id, 'oops'); // degraded
  const order = getAllHealth().map((h) => h.providerId);
  assert.equal(order[0], 'bad');                  // down first
  assert.equal(order[1], 'meh');                  // degraded second
  assert.equal(order[order.length - 1], 'good');  // healthy last
});

test('instrument records success with measured latency', async () => {
  clearRegistry(); resetHealthForTests();
  const p = fx({ id: 'inst-ok' });
  registerProvider(p);
  await instrument(p.id, async () => {
    await new Promise((r) => setTimeout(r, 25));
    return 'ok';
  });
  const h = getHealth(p.id);
  assert.ok(h);
  assert.equal(h.status, 'healthy');
  assert.ok((h.lastLatencyMs ?? 0) >= 20);
});

test('instrument records error and rethrows', async () => {
  clearRegistry(); resetHealthForTests();
  const p = fx({ id: 'inst-err' });
  registerProvider(p);
  await assert.rejects(
    instrument(p.id, async () => { throw new Error('bang'); }),
    /bang/,
  );
  assert.equal(getHealth(p.id)?.status, 'down');
});
