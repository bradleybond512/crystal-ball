import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateByDomain,
  aggregateOverallStatus,
} from '../self-test-aggregator.ts';
import type { SidecarSelfTestResult } from '../sidecar-self-test.ts';

function probe(
  route: string,
  domain: string,
  verdict: SidecarSelfTestResult['verdict'],
  latencyMs = 100,
  error?: string,
): SidecarSelfTestResult {
  return {
    route,
    domain,
    ok: verdict === 'ok',
    verdict,
    status: verdict === 'ok' ? 200 : 500,
    latencyMs,
    error,
  };
}

test('aggregateByDomain: one row per domain with worst verdict bubbling up', () => {
  const rows = aggregateByDomain([
    probe('/firms-modis', 'fire', 'ok'),
    probe('/firms-viirs', 'fire', 'degraded'),
    probe('/opensky', 'aviation', 'ok'),
  ]);
  const fire = rows.find((r) => r.domain === 'fire');
  const aviation = rows.find((r) => r.domain === 'aviation');
  assert.equal(fire?.verdict, 'degraded'); // worst of ok+degraded
  assert.equal(fire?.probeCount, 2);
  assert.equal(aviation?.verdict, 'ok');
});

test('aggregateByDomain: any FAIL wins over any DEGRADED in the same domain', () => {
  const rows = aggregateByDomain([
    probe('/a', 'energy', 'degraded'),
    probe('/b', 'energy', 'fail'),
    probe('/c', 'energy', 'ok'),
  ]);
  assert.equal(rows[0]?.verdict, 'fail');
});

test('aggregateByDomain: median latency on three values picks the middle one', () => {
  const rows = aggregateByDomain([
    probe('/a', 'fire', 'ok', 100),
    probe('/b', 'fire', 'ok', 200),
    probe('/c', 'fire', 'ok', 800),
  ]);
  assert.equal(rows[0]?.medianLatencyMs, 200);
});

test('aggregateByDomain: median latency on even count averages the two middles', () => {
  const rows = aggregateByDomain([
    probe('/a', 'fire', 'ok', 100),
    probe('/b', 'fire', 'ok', 200),
    probe('/c', 'fire', 'ok', 300),
    probe('/d', 'fire', 'ok', 400),
  ]);
  assert.equal(rows[0]?.medianLatencyMs, 250); // (200 + 300) / 2
});

test('aggregateByDomain: surfaces the most recent error for the domain', () => {
  const rows = aggregateByDomain([
    probe('/a', 'cyber', 'fail', 50, 'older error'),
    probe('/b', 'cyber', 'fail', 60, 'most recent error'),
  ]);
  assert.equal(rows[0]?.lastError, 'most recent error');
});

test('aggregateByDomain: no error string when everything is ok', () => {
  const rows = aggregateByDomain([probe('/a', 'fire', 'ok')]);
  assert.equal(rows[0]?.lastError, undefined);
});

test('aggregateByDomain: rows sort worst → best then alpha', () => {
  const rows = aggregateByDomain([
    probe('/a', 'aviation', 'ok'),
    probe('/b', 'natural', 'fail'),
    probe('/c', 'fire', 'degraded'),
    probe('/d', 'maritime', 'ok'),
  ]);
  assert.deepEqual(rows.map((r) => r.domain), ['natural', 'fire', 'aviation', 'maritime']);
});

test('aggregateByDomain: empty input returns empty rows array', () => {
  assert.deepEqual(aggregateByDomain([]), []);
});

test('aggregateOverallStatus: any FAIL → FAIL', () => {
  assert.equal(
    aggregateOverallStatus([
      { domain: 'a', verdict: 'fail', medianLatencyMs: 100, probeCount: 1 },
      { domain: 'b', verdict: 'ok', medianLatencyMs: 100, probeCount: 1 },
    ]),
    'FAIL',
  );
});

test('aggregateOverallStatus: no FAIL but any DEGRADED → WARN', () => {
  assert.equal(
    aggregateOverallStatus([
      { domain: 'a', verdict: 'degraded', medianLatencyMs: 100, probeCount: 1 },
      { domain: 'b', verdict: 'ok', medianLatencyMs: 100, probeCount: 1 },
    ]),
    'WARN',
  );
});

test('aggregateOverallStatus: all OK → PASS', () => {
  assert.equal(
    aggregateOverallStatus([
      { domain: 'a', verdict: 'ok', medianLatencyMs: 100, probeCount: 1 },
      { domain: 'b', verdict: 'ok', medianLatencyMs: 100, probeCount: 1 },
    ]),
    'PASS',
  );
});

test('aggregateOverallStatus: empty rows → PASS (nothing wrong observed)', () => {
  assert.equal(aggregateOverallStatus([]), 'PASS');
});
