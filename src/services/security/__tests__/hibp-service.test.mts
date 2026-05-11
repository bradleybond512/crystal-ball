import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseBreachRow,
  parseBreaches,
  classifyBreachSeverity,
  sortByBreachDateDesc,
  filterRecentlyAdded,
  searchBreaches,
  computeBreachStatistics,
  searchCacheKey,
  BREACH_SEVERITY_COLOR,
  type HibpBreach,
} from '../hibp-service.ts';

const NOW = Date.parse('2026-05-09T00:00:00Z');

function rawBreach(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    Name: 'Adobe',
    Title: 'Adobe',
    Domain: 'adobe.com',
    BreachDate: '2013-10-04',
    AddedDate: '2013-12-04T00:00:00Z',
    ModifiedDate: '2022-05-15T00:00:00Z',
    PwnCount: 152_445_165,
    Description: 'desc',
    DataClasses: ['Email addresses', 'Passwords'],
    IsVerified: true,
    IsFabricated: false,
    IsSensitive: false,
    IsRetired: false,
    IsSpamList: false,
    IsMalware: false,
    LogoPath: 'https://x/y.png',
    ...partial,
  };
}

// ── Severity classification ──────────────────────────────────────────

test('classifyBreachSeverity: critical when passwords leaked', () => {
  assert.equal(classifyBreachSeverity(['Email addresses', 'Passwords']), 'critical');
});

test('classifyBreachSeverity: critical for credit cards', () => {
  assert.equal(classifyBreachSeverity(['Credit cards']), 'critical');
});

test('classifyBreachSeverity: high for phone numbers / addresses', () => {
  assert.equal(classifyBreachSeverity(['Names', 'Phone numbers']), 'high');
});

test('classifyBreachSeverity: medium for emails-only', () => {
  assert.equal(classifyBreachSeverity(['Email addresses']), 'medium');
});

test('classifyBreachSeverity: low when nothing recognized', () => {
  assert.equal(classifyBreachSeverity(['Some obscure field']), 'low');
});

// ── Row parsing ──────────────────────────────────────────────────────

test('parseBreachRow: typical row → HibpBreach', () => {
  const b = parseBreachRow(rawBreach({}));
  assert.ok(b);
  assert.equal(b!.name, 'Adobe');
  assert.equal(b!.severity, 'critical');
  assert.equal(b!.pwnCount, 152_445_165);
});

test('parseBreachRow: missing Name or BreachDate → null', () => {
  assert.equal(parseBreachRow(rawBreach({ Name: '' })), null);
  assert.equal(parseBreachRow(rawBreach({ BreachDate: '' })), null);
});

test('parseBreachRow: non-array DataClasses tolerated', () => {
  const b = parseBreachRow(rawBreach({ DataClasses: 'not an array' }));
  assert.ok(b);
  assert.deepEqual(b!.dataClasses, []);
  assert.equal(b!.severity, 'low');
});

test('parseBreaches: skips invalid rows', () => {
  const out = parseBreaches([rawBreach({}), null, { foo: 'bar' }, rawBreach({ Name: 'X', BreachDate: '2020-01-01' })]);
  assert.equal(out.length, 2);
});

// ── Sort / filter / search ───────────────────────────────────────────

test('sortByBreachDateDesc: newest first', () => {
  const breaches = parseBreaches([
    rawBreach({ Name: 'A', BreachDate: '2020-01-01' }),
    rawBreach({ Name: 'B', BreachDate: '2024-06-01' }),
    rawBreach({ Name: 'C', BreachDate: '2022-03-01' }),
  ]);
  const sorted = sortByBreachDateDesc(breaches);
  assert.deepEqual(sorted.map((b) => b.name), ['B', 'C', 'A']);
});

test('filterRecentlyAdded: 90-day window honored', () => {
  const recentDate = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString();
  const oldDate = new Date(NOW - 200 * 24 * 60 * 60 * 1000).toISOString();
  const breaches = parseBreaches([
    rawBreach({ Name: 'recent', AddedDate: recentDate }),
    rawBreach({ Name: 'old', AddedDate: oldDate }),
  ]);
  const recent = filterRecentlyAdded(breaches, 90, NOW);
  assert.equal(recent.length, 1);
  assert.equal(recent[0]!.name, 'recent');
});

test('searchBreaches: case-insensitive substring across name/domain', () => {
  const breaches = parseBreaches([
    rawBreach({ Name: 'LinkedIn', Domain: 'linkedin.com', BreachDate: '2012-05-05' }),
    rawBreach({ Name: 'Yahoo', Domain: 'yahoo.com', BreachDate: '2014-09-22' }),
    rawBreach({ Name: 'LinkedIn-Scrape', Domain: 'linkedin.com', BreachDate: '2021-04-08' }),
  ]);
  const hits = searchBreaches(breaches, 'LINKEDIN');
  assert.equal(hits.length, 2);
});

test('searchBreaches: empty query returns empty', () => {
  const breaches = parseBreaches([rawBreach({})]);
  assert.deepEqual(searchBreaches(breaches, '   '), []);
});

test('searchBreaches: limit caps the result count', () => {
  const breaches = parseBreaches(
    Array.from({ length: 60 }, (_, i) => rawBreach({ Name: `same-${i}`, Domain: 'example.com' })),
  );
  const hits = searchBreaches(breaches, 'example', 10);
  assert.equal(hits.length, 10);
});

// ── Statistics ───────────────────────────────────────────────────────

test('computeBreachStatistics: counts severities, totals, top data classes', () => {
  const breaches = parseBreaches([
    rawBreach({ Name: 'A', PwnCount: 1000, DataClasses: ['Passwords', 'Email addresses'] }),
    rawBreach({ Name: 'B', PwnCount: 500, DataClasses: ['Email addresses'] }),
    rawBreach({ Name: 'C', PwnCount: 250, DataClasses: ['Phone numbers'] }),
  ]);
  const stats = computeBreachStatistics(breaches, NOW);
  assert.equal(stats.totalBreaches, 3);
  assert.equal(stats.totalPwnedAccounts, 1750);
  assert.equal(stats.bySeverity.critical, 1);
  assert.equal(stats.bySeverity.high, 1);
  assert.equal(stats.bySeverity.medium, 1);
  // 'Email addresses' shows up in two breaches → top class
  assert.equal(stats.topDataClasses[0]!.dataClass, 'Email addresses');
  assert.equal(stats.topDataClasses[0]!.count, 2);
});

// ── Cache key + color ramp ───────────────────────────────────────────

test('searchCacheKey: normalizes case + whitespace', () => {
  assert.equal(searchCacheKey('  LinkedIn   ', 50), 'breaches-search:linkedin:50');
  assert.equal(searchCacheKey('linkedin', 50), 'breaches-search:linkedin:50');
});

test('searchCacheKey: enforces positive integer limit', () => {
  assert.equal(searchCacheKey('x', 0), 'breaches-search:x:1');
  assert.equal(searchCacheKey('x', 50.7), 'breaches-search:x:50');
});

test('BREACH_SEVERITY_COLOR: every severity mapped to a hex color', () => {
  for (const s of ['critical', 'high', 'medium', 'low'] as const) {
    assert.match(BREACH_SEVERITY_COLOR[s], /^#[0-9a-f]{6}$/i);
  }
});

// Smoke type check
const _smoke: HibpBreach | null = parseBreachRow(rawBreach({}));
void _smoke;
