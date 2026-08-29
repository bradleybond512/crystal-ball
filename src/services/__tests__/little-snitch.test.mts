import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getLittleSnitchFreshness,
  sanitizeLittleSnitchEnrichment,
  sanitizeSecurityPostureSnapshot,
  scoreLittleSnitchEntry,
  sanitizeLittleSnitchSnapshot,
  summarizeLittleSnitchSnapshot,
} from '../little-snitch';

const NOW_ISO = '2026-05-03T23:05:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);

test('sanitizes Little Snitch entries and strips URLs to hostnames', () => {
  const snapshot = sanitizeLittleSnitchSnapshot({
    state: 'ready',
    generatedAt: '2026-05-03T23:00:00.000Z',
    entries: [
      {
        app: 'Safari',
        processPath: '/Applications/Safari.app/Contents/MacOS/Safari',
        remote: 'https://example.com/search?q=secret-token',
        direction: 'outbound',
        decision: 'allow',
        protocol: 'tcp',
        remoteIp: '8.8.8.8',
        bytesIn: 1200,
        bytesOut: 340,
        lastSeen: '2026-05-03T23:01:00.000Z',
      },
      {
        app: '<script>alert(1)</script>',
        remote: 'not a host',
        decision: 'allow',
      },
    ],
  }, NOW_MS);

  assert.equal(snapshot.entries.length, 1);
  assert.equal(snapshot.entries[0]?.remoteHost, 'example.com');
  assert.equal(snapshot.entries[0]?.remoteIp, '8.8.8.8');
  assert.equal(snapshot.entries[0]?.remote, undefined);
  assert.equal(snapshot.entries[0]?.processPath, undefined);
  assert.equal(snapshot.entries[0]?.app, 'Safari');
});

test('summarizes top apps, domains, and blocked counts', () => {
  const snapshot = sanitizeLittleSnitchSnapshot({
    state: 'ready',
    generatedAt: NOW_ISO,
    entries: [
      { app: 'Safari', remoteHost: 'example.com', decision: 'allow', bytesOut: 10, bytesIn: 15 },
      { app: 'Safari', remoteHost: 'example.com', decision: 'block', bytesOut: 0, bytesIn: 0 },
      { app: 'Crystal Ball', remoteHost: 'api.example.org', decision: 'allow', bytesOut: 30, bytesIn: 40 },
    ],
  }, NOW_MS);

  const summary = summarizeLittleSnitchSnapshot(snapshot);

  assert.equal(summary.totalConnections, 3);
  assert.equal(summary.allowedConnections, 2);
  assert.equal(summary.blockedConnections, 1);
  assert.equal(summary.newDestinations, 0);
  assert.equal(summary.outboundBytes, 40);
  assert.deepEqual(summary.topApps.map(a => a.name), ['Safari', 'Crystal Ball']);
  assert.deepEqual(summary.topDomains.map(d => d.name), ['example.com', 'api.example.org']);
});

test('saturates displayed traffic aggregates at the safe integer boundary', () => {
  const snapshot = sanitizeLittleSnitchSnapshot({
    state: 'ready',
    generatedAt: NOW_ISO,
    entries: [
      {
        app: 'Safari', remoteHost: 'one.example', decision: 'allow', firstSeen: true,
        count: Number.MAX_SAFE_INTEGER, bytesIn: Number.MAX_SAFE_INTEGER, bytesOut: Number.MAX_SAFE_INTEGER,
      },
      {
        app: 'Safari', remoteHost: 'two.example', decision: 'allow', firstSeen: true,
        count: Number.MAX_SAFE_INTEGER, bytesIn: Number.MAX_SAFE_INTEGER, bytesOut: Number.MAX_SAFE_INTEGER,
      },
    ],
  }, NOW_MS);

  const summary = summarizeLittleSnitchSnapshot(snapshot);
  assert.equal(summary.totalConnections, Number.MAX_SAFE_INTEGER);
  assert.equal(summary.allowedConnections, Number.MAX_SAFE_INTEGER);
  assert.equal(summary.outboundBytes, Number.MAX_SAFE_INTEGER);
  assert.equal(summary.topApps[0]?.count, Number.MAX_SAFE_INTEGER);
  assert.equal(summary.topApps[0]?.bytesIn, Number.MAX_SAFE_INTEGER);
  assert.equal(summary.topApps[0]?.bytesOut, Number.MAX_SAFE_INTEGER);
});

test('scores suspicious developer tool connections to new domains', () => {
  const entry = sanitizeLittleSnitchSnapshot({
    state: 'ready',
    generatedAt: NOW_ISO,
    entries: [
      {
        app: 'node',
        remoteHost: 'new-control.example',
        direction: 'outbound',
        decision: 'allow',
        bytesOut: 2_500_000,
        count: 18,
        firstSeen: true,
      },
    ],
  }, NOW_MS).entries[0];

  assert.ok(entry);
  const score = scoreLittleSnitchEntry(entry);

  assert.equal(score.level, 'high');
  assert.ok(score.reasons.some(reason => reason.includes('developer tool')));
  assert.ok(score.reasons.some(reason => reason.includes('new destination')));
  assert.ok(score.reasons.some(reason => reason.includes('large outbound')));
});

test('downscores known-good destinations but preserves reasons', () => {
  const entry = sanitizeLittleSnitchSnapshot({
    state: 'ready',
    generatedAt: NOW_ISO,
    entries: [
      {
        app: 'Safari',
        remoteHost: 'api.github.com',
        direction: 'outbound',
        decision: 'allow',
        firstSeen: true,
      },
    ],
  }, NOW_MS).entries[0];

  assert.ok(entry);
  assert.equal(entry.risk.level, 'low');
  assert.ok(entry.risk.reasons.some(reason => reason.includes('known-good')));
});

test('reports stale Little Snitch exports', () => {
  const now = new Date('2026-05-04T12:00:00.000Z').getTime();
  const stale = getLittleSnitchFreshness('2026-05-04T11:45:00.000Z', now);
  const fresh = getLittleSnitchFreshness('2026-05-04T11:59:00.000Z', now);

  assert.equal(stale.status, 'stale');
  assert.equal(fresh.status, 'fresh');
});

test('accepts only fresh ready and healthy-empty source states', () => {
  const ready = sanitizeLittleSnitchSnapshot({
    state: 'ready',
    available: false,
    generatedAt: NOW_ISO,
    entries: [{ app: 'Safari', remoteHost: 'example.com' }],
  }, NOW_MS);
  const empty = sanitizeLittleSnitchSnapshot({
    state: 'empty',
    available: false,
    generatedAt: NOW_ISO,
    entries: [{ app: 'Injected', remoteHost: 'should-not-render.example' }],
  }, NOW_MS);

  assert.equal(ready.sourceState, 'ready');
  assert.equal(ready.available, true);
  assert.equal(ready.entries.length, 1);
  assert.equal(empty.sourceState, 'empty');
  assert.equal(empty.available, true);
  assert.deepEqual(empty.entries, []);
});

test('fails closed for missing, invalid, and permission-denied exports', () => {
  for (const state of ['missing', 'invalid', 'permission-denied'] as const) {
    const snapshot = sanitizeLittleSnitchSnapshot({
      state,
      available: true,
      generatedAt: NOW_ISO,
      entries: [{ app: 'Injected', remoteHost: `${state}.example` }],
    }, NOW_MS);

    assert.equal(snapshot.sourceState, state);
    assert.equal(snapshot.available, false);
    assert.deepEqual(snapshot.entries, []);
    assert.equal(snapshot.summary.totalConnections, 0);
  }
});

test('suppresses entries when the exporter marks a snapshot stale', () => {
  const snapshot = sanitizeLittleSnitchSnapshot({
    state: 'stale',
    available: true,
    generatedAt: '2026-05-03T22:00:00.000Z',
    entries: [{ app: 'Safari', remoteHost: 'old.example' }],
  }, NOW_MS);

  assert.equal(snapshot.sourceState, 'stale');
  assert.equal(snapshot.available, false);
  assert.equal(snapshot.freshness.status, 'stale');
  assert.deepEqual(snapshot.entries, []);
});

test('downgrades ready and empty responses that are not fresh', () => {
  for (const generatedAt of [null, '2026-05-03T22:00:00.000Z']) {
    const snapshot = sanitizeLittleSnitchSnapshot({
      state: 'ready',
      generatedAt,
      entries: [{ app: 'Safari', remoteHost: 'old.example' }],
    }, NOW_MS);

    assert.equal(snapshot.sourceState, generatedAt ? 'stale' : 'invalid');
    assert.equal(snapshot.available, false);
    assert.deepEqual(snapshot.entries, []);
  }
});

test('treats unknown source states as invalid instead of trusting available', () => {
  const snapshot = sanitizeLittleSnitchSnapshot({
    state: 'future-state',
    available: true,
    generatedAt: NOW_ISO,
    entries: [{ app: 'Safari', remoteHost: 'example.com' }],
  }, NOW_MS);

  assert.equal(snapshot.sourceState, 'invalid');
  assert.equal(snapshot.available, false);
  assert.deepEqual(snapshot.entries, []);
});

test('sanitizes security posture and enrichment snapshots', () => {
  const posture = sanitizeSecurityPostureSnapshot({
    checks: [{ id: 'firewall', label: 'Firewall', status: 'ok', detail: 'enabled' }],
    persistenceItems: [{ path: '/Library/LaunchDaemons/test.plist', label: 'test', kind: 'LaunchDaemon', command: 'node', risk: 'high' }],
    quarantineCommands: ['sudo firewall on'],
  });
  const enrichment = sanitizeLittleSnitchEnrichment({
    value: 'example.com',
    type: 'domain',
    providers: [{ name: 'MISP', status: 'missing', summary: 'not configured' }],
    signals: ['recent domain'],
  });

  assert.equal(posture.available, true);
  assert.equal(posture.persistenceItems[0]?.risk, 'high');
  assert.equal(enrichment.providers[0]?.name, 'MISP');
  assert.equal(enrichment.signals[0], 'recent domain');
});
