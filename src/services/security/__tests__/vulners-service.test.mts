import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEpssQueryUrl,
  buildVulnersList,
  enrichCvesWithEpss,
  epssTier,
  parseEpssResponse,
  sortByExploitRisk,
  type EpssScore,
  type VulnersRecord,
} from '../vulners-service.ts';
import type { CveRecord } from '../cve-service.ts';

// ── epssTier ──────────────────────────────────────────────────────────────

test('epssTier ladder: critical > 0.5, elevated 0.1–0.5, low < 0.1', () => {
  assert.equal(epssTier(0.95), 'critical');
  assert.equal(epssTier(0.51), 'critical');
  assert.equal(epssTier(0.5),  'elevated');
  assert.equal(epssTier(0.25), 'elevated');
  assert.equal(epssTier(0.1),  'elevated');
  assert.equal(epssTier(0.099), 'low');
  assert.equal(epssTier(0.001), 'low');
});

test('epssTier returns "unknown" for null / NaN / out-of-range', () => {
  assert.equal(epssTier(null), 'unknown');
  assert.equal(epssTier(undefined), 'unknown');
  assert.equal(epssTier(Number.NaN), 'unknown');
});

// ── parseEpssResponse ──────────────────────────────────────────────────────

test('parseEpssResponse parses well-formed FIRST.org payloads', () => {
  const out = parseEpssResponse({
    status: 'OK',
    data: [
      { cve: 'CVE-2026-1', epss: '0.97', percentile: '0.99', date: '2026-05-09' },
      { cve: 'CVE-2026-2', epss: '0.05', percentile: '0.45' },
    ],
  });
  assert.equal(out.size, 2);
  assert.equal(out.get('CVE-2026-1')?.epss, 0.97);
  assert.equal(out.get('CVE-2026-1')?.percentile, 0.99);
  assert.equal(out.get('CVE-2026-1')?.date, '2026-05-09');
  assert.equal(out.get('CVE-2026-2')?.date, null);
});

test('parseEpssResponse rejects out-of-range or non-numeric scores', () => {
  const out = parseEpssResponse({
    data: [
      { cve: 'CVE-2026-3', epss: 'not a number', percentile: '0.5' },
      { cve: 'CVE-2026-4', epss: '1.5', percentile: '0.5' },   // > 1, rejected
      { cve: 'CVE-2026-5', epss: '-0.1', percentile: '0.5' },  // < 0, rejected
      { cve: 'CVE-2026-6', epss: '0.42' },                     // valid, no percentile
    ],
  });
  assert.equal(out.size, 1);
  assert.equal(out.get('CVE-2026-6')?.epss, 0.42);
  assert.equal(out.get('CVE-2026-6')?.percentile, 0);
});

test('parseEpssResponse returns empty Map for malformed input', () => {
  assert.equal(parseEpssResponse(null).size, 0);
  assert.equal(parseEpssResponse('not an object').size, 0);
  assert.equal(parseEpssResponse({}).size, 0);
});

// ── enrichCvesWithEpss ─────────────────────────────────────────────────────

function cve(id: string, score: number): CveRecord {
  return {
    id, description: '', cvssScore: score, cvssVector: null,
    severity: score >= 9 ? 'critical' : score >= 7 ? 'high' : 'medium',
    publishedAt: null, lastModifiedAt: null, affectedProducts: [],
    nvdUrl: '',
  };
}

test('enrichCvesWithEpss merges scores, leaving unmatched CVEs at unknown tier', () => {
  const cves = [cve('CVE-A', 9.5), cve('CVE-B', 7.5), cve('CVE-C', 6.0)];
  const epss = new Map<string, EpssScore>([
    ['CVE-A', { cve: 'CVE-A', epss: 0.97, percentile: 0.99, date: null }],
    ['CVE-C', { cve: 'CVE-C', epss: 0.05, percentile: 0.30, date: null }],
  ]);
  const out = enrichCvesWithEpss(cves, epss);
  assert.equal(out[0]?.exploitRiskTier, 'critical');
  assert.equal(out[0]?.epssScore, 0.97);
  assert.equal(out[1]?.exploitRiskTier, 'unknown');
  assert.equal(out[1]?.epssScore, null);
  assert.equal(out[2]?.exploitRiskTier, 'low');
});

// ── sortByExploitRisk ──────────────────────────────────────────────────────

test('sortByExploitRisk orders EPSS desc, then CVSS desc, then nulls last', () => {
  const records: VulnersRecord[] = [
    { ...cve('CVE-NULL', 8.0), epssScore: null, epssPercentile: null, epssDate: null,
      exploitRiskTier: 'unknown' },
    { ...cve('CVE-LOW', 6.0), epssScore: 0.05, epssPercentile: 0.10, epssDate: null,
      exploitRiskTier: 'low' },
    { ...cve('CVE-HIGH', 9.5), epssScore: 0.85, epssPercentile: 0.99, epssDate: null,
      exploitRiskTier: 'critical' },
    { ...cve('CVE-MID', 7.5), epssScore: 0.45, epssPercentile: 0.80, epssDate: null,
      exploitRiskTier: 'elevated' },
  ];
  const out = sortByExploitRisk(records);
  assert.deepEqual(out.map((r) => r.id), ['CVE-HIGH', 'CVE-MID', 'CVE-LOW', 'CVE-NULL']);
});

test('sortByExploitRisk uses CVSS as the EPSS tiebreaker', () => {
  const records: VulnersRecord[] = [
    { ...cve('CVE-A', 7.0), epssScore: 0.4, epssPercentile: 0.6, epssDate: null,
      exploitRiskTier: 'elevated' },
    { ...cve('CVE-B', 9.0), epssScore: 0.4, epssPercentile: 0.6, epssDate: null,
      exploitRiskTier: 'elevated' },
  ];
  const out = sortByExploitRisk(records);
  assert.deepEqual(out.map((r) => r.id), ['CVE-B', 'CVE-A']);
});

// ── buildEpssQueryUrl ─────────────────────────────────────────────────────

test('buildEpssQueryUrl filters out malformed CVE ids and caps at 100', () => {
  const ids: string[] = [];
  for (let i = 0; i < 150; i += 1) ids.push(`CVE-2026-${i}`);
  ids.push('not-a-cve', 'CVE-bad-id');
  const url = buildEpssQueryUrl(ids);
  const ces = url.split('cve=')[1]?.split(',') ?? [];
  assert.equal(ces.length, 100);
  for (const ce of ces) {
    assert.match(ce, /^CVE-\d{4}-\d+$/);
  }
});

test('buildEpssQueryUrl returns the bare endpoint when no valid ids', () => {
  assert.equal(buildEpssQueryUrl([]), 'https://api.first.org/data/v1/epss');
  assert.equal(buildEpssQueryUrl(['junk']), 'https://api.first.org/data/v1/epss');
});

// ── buildVulnersList integration ──────────────────────────────────────────

test('buildVulnersList parses NVD + EPSS together and sorts by exploit risk', () => {
  const nvd = {
    vulnerabilities: [
      { cve: { id: 'CVE-2026-X', published: '2026-05-01T00:00:00Z',
        descriptions: [{ lang: 'en', value: 'X-class flaw' }],
        metrics: { cvssMetricV31: [{ cvssData: { baseScore: 9.8, vectorString: 'CVSS:3.1/AV:N' } }] } } },
      { cve: { id: 'CVE-2026-Y', published: '2026-05-02T00:00:00Z',
        descriptions: [{ lang: 'en', value: 'Y-class flaw' }],
        metrics: { cvssMetricV31: [{ cvssData: { baseScore: 7.5, vectorString: 'CVSS:3.1/AV:N' } }] } } },
    ],
  };
  const epss = {
    data: [
      { cve: 'CVE-2026-X', epss: '0.05', percentile: '0.30', date: '2026-05-09' },
      { cve: 'CVE-2026-Y', epss: '0.85', percentile: '0.95', date: '2026-05-09' },
    ],
  };
  const out = buildVulnersList(nvd, epss);
  assert.equal(out.length, 2);
  // Y has higher EPSS, so it should sort first even though X has higher CVSS.
  assert.equal(out[0]?.id, 'CVE-2026-Y');
  assert.equal(out[0]?.exploitRiskTier, 'critical');
  assert.equal(out[1]?.id, 'CVE-2026-X');
  assert.equal(out[1]?.exploitRiskTier, 'low');
});
