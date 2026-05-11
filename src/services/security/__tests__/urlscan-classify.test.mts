import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyVerdict,
  parseUrlscanThreats,
  summariseUrlscan,
  validateSubmitUrl,
  verdictColor,
} from '../urlscan-classify';

describe('classifyVerdict', () => {
  it('marks "malicious" verbatim as malicious', () => {
    assert.equal(classifyVerdict('malicious', null), 'malicious');
  });
  it('uses score >= 50 as malicious', () => {
    assert.equal(classifyVerdict(null, 65), 'malicious');
  });
  it('uses score in [10, 50) as suspicious', () => {
    assert.equal(classifyVerdict(null, 30), 'suspicious');
  });
  it('treats clean/benign/zero-or-negative score as clean', () => {
    assert.equal(classifyVerdict('clean', null), 'clean');
    assert.equal(classifyVerdict('benign', null), 'clean');
    assert.equal(classifyVerdict('clean', -5), 'clean');
  });
  it('defaults to unknown when nothing is known', () => {
    assert.equal(classifyVerdict(null, null), 'unknown');
    assert.equal(classifyVerdict('', null), 'unknown');
  });
});

describe('parseUrlscanThreats', () => {
  it('parses a representative search-result row', () => {
    const threats = parseUrlscanThreats({
      results: [
        {
          _id: 'abc-123',
          task: { url: 'http://evil.example.com', time: '2026-05-08T12:00:00Z', uuid: 'abc-123' },
          page: { url: 'http://evil.example.com/redirect', domain: 'evil.example.com', ip: '5.6.7.8', asn: 'AS999', asnname: 'EvilCorp', country: 'RU' },
          verdicts: { overall: { malicious: true, score: 80, categories: ['phishing', 'malware'], brands: ['Office365'] } },
          tags: ['credential-theft', 'fake-login'],
          screenshot: 'https://urlscan.io/screenshots/abc.png',
          result: 'https://urlscan.io/result/abc-123/',
        },
      ],
    });
    assert.equal(threats.length, 1);
    const t = threats[0]!;
    assert.equal(t.verdict, 'malicious');
    assert.equal(t.verdictScore, 80);
    assert.equal(t.domain, 'evil.example.com');
    assert.deepEqual(t.categories, ['phishing', 'malware']);
    assert.deepEqual(t.brands, ['Office365']);
    assert.equal(t.country, 'RU');
    assert.equal(t.screenshotUrl, 'https://urlscan.io/screenshots/abc.png');
  });

  it('skips rows without url or uuid', () => {
    const threats = parseUrlscanThreats({
      results: [
        { _id: 'abc', task: {}, page: {} }, // missing url
        { task: { url: 'http://x' } }, // missing uuid
      ],
    });
    assert.equal(threats.length, 0);
  });

  it('accepts a raw array fallback shape', () => {
    const threats = parseUrlscanThreats([
      { _id: 'a', task: { url: 'http://x', uuid: 'a' }, page: {}, verdicts: { overall: { malicious: false, score: 5 } } },
    ]);
    assert.equal(threats.length, 1);
    assert.equal(threats[0]!.verdict, 'unknown');
  });

  it('returns [] for malformed input', () => {
    assert.deepEqual(parseUrlscanThreats(null), []);
    assert.deepEqual(parseUrlscanThreats({ wrong: 'shape' }), []);
  });
});

describe('summariseUrlscan', () => {
  it('counts verdict buckets and ranks categories / brands', () => {
    const threats = parseUrlscanThreats({
      results: [
        { _id: '1', task: { url: 'http://a', uuid: '1' }, page: {}, verdicts: { overall: { malicious: true, score: 90, categories: ['phishing'], brands: ['Office365'] } } },
        { _id: '2', task: { url: 'http://b', uuid: '2' }, page: {}, verdicts: { overall: { malicious: true, score: 70, categories: ['phishing', 'malware'], brands: ['Office365', 'PayPal'] } } },
        { _id: '3', task: { url: 'http://c', uuid: '3' }, page: {}, verdicts: { overall: { malicious: false, score: 5 } } },
      ],
    });
    const stats = summariseUrlscan(threats);
    assert.equal(stats.total, 3);
    assert.equal(stats.byVerdict.malicious, 2);
    assert.equal(stats.topCategories[0]!.category, 'phishing');
    assert.equal(stats.topCategories[0]!.count, 2);
    assert.equal(stats.topBrands[0]!.brand, 'Office365');
  });
});

describe('validateSubmitUrl', () => {
  it('accepts a normal https URL', () => {
    const r = validateSubmitUrl('https://example.com/path');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.url, 'https://example.com/path');
  });
  it('accepts a bare host and normalises to https', () => {
    const r = validateSubmitUrl('example.com');
    assert.equal(r.ok, true);
    if (r.ok) assert.ok(r.url.startsWith('https://example.com'));
  });
  it('rejects empty input', () => {
    const r = validateSubmitUrl('');
    assert.equal(r.ok, false);
  });
  it('rejects private IP hosts', () => {
    for (const host of ['http://127.0.0.1', 'http://10.0.0.1', 'http://192.168.1.1', 'http://172.16.0.1', 'http://localhost', 'http://service.local']) {
      const r = validateSubmitUrl(host);
      assert.equal(r.ok, false, `expected ${host} to be rejected`);
    }
  });
  it('rejects non-http(s) protocols', () => {
    const r = validateSubmitUrl('ftp://example.com');
    assert.equal(r.ok, false);
  });
});

describe('verdictColor', () => {
  it('returns a distinct hex per verdict', () => {
    const colors = new Set([
      verdictColor('malicious'),
      verdictColor('suspicious'),
      verdictColor('clean'),
      verdictColor('unknown'),
    ]);
    assert.equal(colors.size, 4);
  });
});
