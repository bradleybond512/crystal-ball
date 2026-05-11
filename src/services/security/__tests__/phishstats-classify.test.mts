import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyScore,
  filterByMinScore,
  parsePhishingRecords,
  severityColor,
  summarisePhishing,
  truncateUrl,
} from '../phishstats-classify';

describe('classifyScore', () => {
  it('maps score buckets to severity tiers', () => {
    assert.equal(classifyScore(9.5), 'critical');
    assert.equal(classifyScore(8), 'high');
    assert.equal(classifyScore(6), 'medium');
    assert.equal(classifyScore(2), 'low');
  });
  it('treats non-finite as low', () => {
    assert.equal(classifyScore(Number.NaN), 'low');
    // Infinity is not "finite" per Number.isFinite, so we bucket it as low
    // rather than letting the >= 9 comparison succeed accidentally.
    assert.equal(classifyScore(Infinity), 'low');
  });
});

describe('parsePhishingRecords', () => {
  it('parses a representative PhishStats row', () => {
    const records = parsePhishingRecords([
      {
        id: '42',
        url: 'http://evil.example.com/login',
        score: 8.7,
        title: 'Microsoft',
        ip: '1.2.3.4',
        countrycode: 'NL',
        countryname: 'Netherlands',
        date: '2026-05-08T12:34:56Z',
        asn: 'AS12345',
      },
    ]);
    assert.equal(records.length, 1);
    const r = records[0]!;
    assert.equal(r.url, 'http://evil.example.com/login');
    assert.equal(r.score, 8.7);
    assert.equal(r.severity, 'high');
    assert.equal(r.target, 'Microsoft');
    assert.equal(r.ip, '1.2.3.4');
    assert.equal(r.countryCode, 'NL');
    assert.equal(r.countryName, 'Netherlands');
    assert.equal(r.asn, 'AS12345');
  });

  it('skips rows missing a URL', () => {
    const records = parsePhishingRecords([
      { url: 'http://ok.example.com', score: 7 },
      { score: 6 },
      { url: '   ', score: 7 },
    ]);
    assert.equal(records.length, 1);
  });

  it('tolerates string-encoded numeric score', () => {
    const records = parsePhishingRecords([{ url: 'http://x', score: '6.5' }]);
    assert.equal(records[0]!.score, 6.5);
    assert.equal(records[0]!.severity, 'medium');
  });

  it('defaults score to 0 and severity to low when missing', () => {
    const records = parsePhishingRecords([{ url: 'http://x', score: null }]);
    assert.equal(records[0]!.score, 0);
    assert.equal(records[0]!.severity, 'low');
  });

  it('returns [] for non-array payload', () => {
    assert.deepEqual(parsePhishingRecords(null), []);
    assert.deepEqual(parsePhishingRecords({}), []);
  });
});

describe('summarisePhishing', () => {
  it('aggregates totals, severity buckets, top targets and top countries', () => {
    const records = parsePhishingRecords([
      { url: 'http://a', score: 9, title: 'Microsoft', countrycode: 'US', countryname: 'United States' },
      { url: 'http://b', score: 8, title: 'Microsoft', countrycode: 'US' },
      { url: 'http://c', score: 6, title: 'PayPal', countrycode: 'NL', countryname: 'Netherlands' },
      { url: 'http://d', score: 3, title: null, countrycode: null },
    ]);
    const stats = summarisePhishing(records);
    assert.equal(stats.total, 4);
    assert.equal(stats.bySeverity.critical, 1);
    assert.equal(stats.bySeverity.high, 1);
    assert.equal(stats.bySeverity.medium, 1);
    assert.equal(stats.bySeverity.low, 1);
    assert.equal(stats.topTargets[0]!.target, 'Microsoft');
    assert.equal(stats.topTargets[0]!.count, 2);
    assert.equal(stats.topCountries[0]!.countryCode, 'US');
  });
  it('tracks latestDetectedAt across rows', () => {
    const records = parsePhishingRecords([
      { url: 'http://a', score: 7, date: '2026-05-01T00:00:00Z' },
      { url: 'http://b', score: 7, date: '2026-05-08T00:00:00Z' },
      { url: 'http://c', score: 7, date: '2026-04-25T00:00:00Z' },
    ]);
    const stats = summarisePhishing(records);
    assert.equal(stats.latestDetectedAt, Date.parse('2026-05-08T00:00:00Z'));
  });
});

describe('filterByMinScore', () => {
  it('filters by inclusive lower bound', () => {
    const records = parsePhishingRecords([
      { url: 'http://a', score: 9 },
      { url: 'http://b', score: 6 },
      { url: 'http://c', score: 3 },
    ]);
    assert.equal(filterByMinScore(records, 6).length, 2);
    assert.equal(filterByMinScore(records, 9).length, 1);
  });
});

describe('truncateUrl', () => {
  it('passes short URLs through unchanged', () => {
    assert.equal(truncateUrl('http://x.com'), 'http://x.com');
  });
  it('truncates long URLs with an ellipsis', () => {
    const long = 'http://example.com/' + 'a'.repeat(200);
    const truncated = truncateUrl(long, 30);
    assert.equal(truncated.length, 30);
    assert.ok(truncated.endsWith('…'));
  });
});

describe('severityColor', () => {
  it('returns a distinct hex for each severity', () => {
    const colors = new Set(['low', 'medium', 'high', 'critical'].map((s) =>
      severityColor(s as 'low' | 'medium' | 'high' | 'critical')));
    assert.equal(colors.size, 4);
  });
});
