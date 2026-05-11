import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyRisk,
  classifyType,
  compareRisk,
  parsePulsediveIndicators,
  riskColor,
  summarisePulsedive,
} from '../pulsedive-classify';

describe('classifyRisk', () => {
  it('maps known risk strings to typed values', () => {
    assert.equal(classifyRisk('critical'), 'critical');
    assert.equal(classifyRisk('High'), 'high');
    assert.equal(classifyRisk('MEDIUM'), 'medium');
    assert.equal(classifyRisk('low'), 'low');
    assert.equal(classifyRisk('none'), 'none');
  });
  it('returns unknown for unrecognised values', () => {
    assert.equal(classifyRisk('extreme'), 'unknown');
    assert.equal(classifyRisk(null), 'unknown');
    assert.equal(classifyRisk(42), 'unknown');
  });
});

describe('classifyType', () => {
  it('maps common indicator types', () => {
    assert.equal(classifyType('ip'), 'ip');
    assert.equal(classifyType('domain'), 'domain');
    assert.equal(classifyType('URL'), 'url');
    assert.equal(classifyType('sha256'), 'hash');
  });
  it('returns unknown for unrecognised types', () => {
    assert.equal(classifyType('certificate'), 'unknown');
    assert.equal(classifyType(null), 'unknown');
  });
});

describe('compareRisk', () => {
  it('orders critical > high > medium > low > none/unknown', () => {
    assert.ok(compareRisk('critical', 'high') > 0);
    assert.ok(compareRisk('high', 'medium') > 0);
    assert.ok(compareRisk('low', 'none') > 0);
    assert.equal(compareRisk('high', 'high'), 0);
    assert.equal(compareRisk('none', 'unknown'), 0);
  });
});

describe('parsePulsediveIndicators', () => {
  it('parses an explore.php result row', () => {
    const out = parsePulsediveIndicators({
      results: [
        {
          iid: 42,
          indicator: 'evil.example.com',
          type: 'domain',
          risk: 'high',
          risk_recommended: 'high',
          threats: [{ tid: 1, threat: 'Phishing' }, 'Ransomware'],
          feeds: [{ fid: 1, feed: 'OpenPhish' }, { feed: 'PhishTank' }],
          firstseen: '2026-05-01 00:00:00',
          lastseen: '2026-05-08 12:34:56',
        },
      ],
    });
    assert.equal(out.length, 1);
    const i = out[0]!;
    assert.equal(i.indicator, 'evil.example.com');
    assert.equal(i.type, 'domain');
    assert.equal(i.risk, 'high');
    assert.deepEqual(i.threats, ['Phishing', 'Ransomware']);
    assert.deepEqual(i.feeds, ['OpenPhish', 'PhishTank']);
    assert.equal(i.iid, 42);
    assert.ok(i.firstSeen);
    assert.ok(i.lastSeen);
  });

  it('handles the info.php single-indicator shape', () => {
    const out = parsePulsediveIndicators({
      indicator: '1.2.3.4',
      type: 'ip',
      risk: 'critical',
      threats: [],
      feeds: [],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.risk, 'critical');
  });

  it('accepts a bare array fallback', () => {
    const out = parsePulsediveIndicators([
      { indicator: '5.6.7.8', type: 'ip', risk: 'medium' },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.type, 'ip');
  });

  it('skips rows without an indicator value', () => {
    const out = parsePulsediveIndicators({
      results: [{ type: 'ip', risk: 'high' }, { indicator: '', type: 'ip' }],
    });
    assert.equal(out.length, 0);
  });

  it('returns [] for malformed input', () => {
    assert.deepEqual(parsePulsediveIndicators(null), []);
    assert.deepEqual(parsePulsediveIndicators({ wrong: 'shape' }), []);
  });
});

describe('summarisePulsedive', () => {
  it('counts by risk + type and ranks threats / feeds', () => {
    const inds = parsePulsediveIndicators({
      results: [
        { indicator: '1.1.1.1', type: 'ip', risk: 'high', threats: [{ threat: 'Phishing' }], feeds: [{ feed: 'OpenPhish' }] },
        { indicator: 'evil.example.com', type: 'domain', risk: 'high', threats: [{ threat: 'Phishing' }, { threat: 'Malware' }], feeds: [{ feed: 'OpenPhish' }] },
        { indicator: '2.2.2.2', type: 'ip', risk: 'medium', threats: [], feeds: [] },
      ],
    });
    const stats = summarisePulsedive(inds);
    assert.equal(stats.total, 3);
    assert.equal(stats.byRisk.high, 2);
    assert.equal(stats.byRisk.medium, 1);
    assert.equal(stats.byType.ip, 2);
    assert.equal(stats.byType.domain, 1);
    assert.equal(stats.topThreats[0]!.threat, 'Phishing');
    assert.equal(stats.topThreats[0]!.count, 2);
    assert.equal(stats.topFeeds[0]!.feed, 'OpenPhish');
  });
  it('tracks latestSeen across rows', () => {
    // ISO with Z so Date.parse is timezone-stable across CI machines.
    const inds = parsePulsediveIndicators({
      results: [
        { indicator: 'a', type: 'domain', risk: 'high', lastseen: '2026-05-08T00:00:00Z' },
        { indicator: 'b', type: 'domain', risk: 'high', lastseen: '2026-05-01T00:00:00Z' },
      ],
    });
    const stats = summarisePulsedive(inds);
    assert.equal(stats.latestSeen, Date.parse('2026-05-08T00:00:00Z'));
  });
});

describe('riskColor', () => {
  it('returns a distinct hex per risk', () => {
    const colors = new Set([
      riskColor('none'),
      riskColor('low'),
      riskColor('medium'),
      riskColor('high'),
      riskColor('critical'),
      riskColor('unknown'),
    ]);
    assert.ok(colors.size >= 5);
  });
});
