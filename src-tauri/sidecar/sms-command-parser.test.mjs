import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseCommand,
  isAllowed,
  checkRateLimit,
  recordRateLimit,
  formatStatusResponse,
  formatBriefResponse,
  formatAlertsResponse,
  formatFeedsResponse,
  formatHelpResponse,
  handleSmsCommand,
  loadSmsConfig,
  saveSmsConfig,
} from './sms-command-parser.mjs';

// ── parseCommand ─────────────────────────────────────────────────────────────

describe('parseCommand', () => {
  it('parses CB STATUS', () => {
    assert.deepEqual(parseCommand('CB STATUS'), { cmd: 'STATUS', domain: null });
  });

  it('parses CB BRIEF', () => {
    assert.deepEqual(parseCommand('CB BRIEF'), { cmd: 'BRIEF', domain: null });
  });

  it('parses CB FEEDS', () => {
    assert.deepEqual(parseCommand('CB FEEDS'), { cmd: 'FEEDS', domain: null });
  });

  it('parses CB HELP', () => {
    assert.deepEqual(parseCommand('CB HELP'), { cmd: 'HELP', domain: null });
  });

  it('parses CB ALERTS without domain', () => {
    assert.deepEqual(parseCommand('CB ALERTS'), { cmd: 'ALERTS', domain: null });
  });

  it('parses CB ALERTS with valid domain', () => {
    assert.deepEqual(parseCommand('CB ALERTS earthquake'), { cmd: 'ALERTS', domain: 'earthquake' });
  });

  it('parses CB ALERTS with unknown domain', () => {
    const result = parseCommand('CB ALERTS foobar');
    assert.equal(result?.cmd, 'ALERTS');
    assert.equal(result?.domain, 'unknown:foobar');
  });

  it('is case-insensitive', () => {
    assert.deepEqual(parseCommand('cb status'), { cmd: 'STATUS', domain: null });
  });

  it('trims whitespace', () => {
    assert.deepEqual(parseCommand('  CB STATUS  '), { cmd: 'STATUS', domain: null });
  });

  it('returns null for non-CB body', () => {
    assert.equal(parseCommand('hello world'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(parseCommand(''), null);
  });

  it('returns null for null', () => {
    assert.equal(parseCommand(null), null);
  });
});

// ── isAllowed ────────────────────────────────────────────────────────────────

describe('isAllowed', () => {
  it('returns false for empty allowlist', () => {
    assert.equal(isAllowed('+15550001234', []), false);
  });

  it('returns true for exact digit match', () => {
    assert.equal(isAllowed('15550001234', ['15550001234']), true);
  });

  it('normalizes phone digits when matching', () => {
    assert.equal(isAllowed('+1 (555) 000-1234', ['+15550001234']), true);
  });

  it('returns false when number not in list', () => {
    assert.equal(isAllowed('+15550009999', ['+15550001234']), false);
  });
});

// ── checkRateLimit / recordRateLimit ─────────────────────────────────────────

describe('checkRateLimit and recordRateLimit', () => {
  let map;
  beforeEach(() => { map = new Map(); });

  it('allows on fresh map', () => {
    const result = checkRateLimit('+15550001234', map);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 10);
  });

  it('blocks after 10 calls', () => {
    for (let i = 0; i < 10; i++) recordRateLimit('+15550001234', map);
    const result = checkRateLimit('+15550001234', map);
    assert.equal(result.allowed, false);
    assert.equal(result.remaining, 0);
  });

  it('resets after window expiry', () => {
    recordRateLimit('+15550001234', map);
    const entry = map.get('15550001234');
    entry.windowStart = Date.now() - 61 * 60 * 1000;
    const result = checkRateLimit('+15550001234', map);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 10);
  });
});

// ── formatStatusResponse ─────────────────────────────────────────────────────

describe('formatStatusResponse', () => {
  it('handles null state', () => {
    const text = formatStatusResponse(null);
    assert.ok(text.includes('No analyst state'));
  });

  it('includes posture and entity count', () => {
    const text = formatStatusResponse({ posture: 'elevated', entities: [1, 2, 3], threads: [] });
    assert.ok(text.includes('ELEVATED'));
    assert.ok(text.includes('3'));
  });

  it('shows top 3 threads', () => {
    const threads = [
      { id: 't1', label: 'Thread A', confidence: 0.9 },
      { id: 't2', label: 'Thread B', confidence: 0.8 },
      { id: 't3', label: 'Thread C', confidence: 0.7 },
      { id: 't4', label: 'Thread D', confidence: 0.6 },
    ];
    const text = formatStatusResponse({ posture: 'normal', entities: [], threads });
    assert.ok(text.includes('Thread A'));
    assert.ok(text.includes('Thread C'));
    assert.ok(!text.includes('Thread D'));
  });
});

// ── formatBriefResponse ──────────────────────────────────────────────────────

describe('formatBriefResponse', () => {
  it('handles null state', () => {
    const text = formatBriefResponse(null);
    assert.ok(text.includes('No analyst data'));
  });

  it('uses debugLog entry when present', () => {
    const text = formatBriefResponse({ threads: [{ id: 't1' }], debugLog: ['Debug entry here'] });
    assert.ok(text.includes('Debug entry here'));
  });

  it('falls back to top thread when no debugLog', () => {
    const text = formatBriefResponse({ threads: [{ id: 't1', label: 'MyThread', confidence: 0.85 }] });
    assert.ok(text.includes('MyThread'));
    assert.ok(text.includes('0.85'));
  });
});

// ── formatAlertsResponse ─────────────────────────────────────────────────────

describe('formatAlertsResponse', () => {
  it('handles empty threads', () => {
    const text = formatAlertsResponse([], null);
    assert.ok(text.includes('No active alerts'));
  });

  it('filters by domain', () => {
    const threads = [
      { id: 't1', label: 'Quake A', domain: 'earthquake' },
      { id: 't2', label: 'Fire B', domain: 'wildfire' },
    ];
    const text = formatAlertsResponse(threads, 'earthquake');
    assert.ok(text.includes('Quake A'));
    assert.ok(!text.includes('Fire B'));
  });

  it('caps at 5 entries', () => {
    const threads = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, label: `Thread ${i}`, domain: 'cyber' }));
    const text = formatAlertsResponse(threads, null);
    const matches = text.match(/Thread/g);
    assert.equal(matches?.length, 5);
  });
});

// ── formatFeedsResponse ──────────────────────────────────────────────────────

describe('formatFeedsResponse', () => {
  it('handles empty snapshot list', () => {
    const text = formatFeedsResponse([]);
    assert.ok(text.includes('No feed data'));
  });

  it('counts stale and errored feeds', () => {
    const now = Date.now();
    const snapshots = [
      { key: 'a', lastSuccessAt: now - 40 * 60 * 1000, lastError: null },
      { key: 'b', lastSuccessAt: now - 10 * 60 * 1000, lastError: null },
      { key: 'c', lastSuccessAt: null, lastError: 'timeout' },
    ];
    const text = formatFeedsResponse(snapshots);
    assert.ok(text.includes('3 tracked'));
    assert.ok(text.includes('Stale (>30m): 1'));
    assert.ok(text.includes('Errored: 1'));
  });
});

// ── formatHelpResponse ───────────────────────────────────────────────────────

describe('formatHelpResponse', () => {
  it('includes all 5 commands', () => {
    const text = formatHelpResponse();
    assert.ok(text.includes('CB STATUS'));
    assert.ok(text.includes('CB BRIEF'));
    assert.ok(text.includes('CB ALERTS'));
    assert.ok(text.includes('CB FEEDS'));
    assert.ok(text.includes('CB HELP'));
  });
});

// ── handleSmsCommand integration ─────────────────────────────────────────────

describe('handleSmsCommand', () => {
  const from = '+15550001234';
  const allowlist = ['+15550001234'];

  it('returns 403 for unauthorized number and does not log', async () => {
    const commandLog = [];
    const result = await handleSmsCommand({ from: '+19990000000', body: 'CB HELP', analystState: null, feedSnapshots: [], allowlist, rateLimitMap: new Map(), commandLog });
    assert.equal(result.status, 403);
    assert.equal(commandLog.length, 0);
  });

  it('returns 429 when rate limit exceeded', async () => {
    const map = new Map();
    for (let i = 0; i < 10; i++) recordRateLimit(from, map);
    const result = await handleSmsCommand({ from, body: 'CB HELP', analystState: null, feedSnapshots: [], allowlist, rateLimitMap: map, commandLog: [] });
    assert.equal(result.status, 429);
  });

  it('returns 200 for CB HELP and logs the command', async () => {
    const commandLog = [];
    const result = await handleSmsCommand({ from, body: 'CB HELP', analystState: null, feedSnapshots: [], allowlist, rateLimitMap: new Map(), commandLog });
    assert.equal(result.status, 200);
    assert.ok(result.text.includes('CB Commands'));
    assert.equal(commandLog.length, 1);
    assert.equal(commandLog[0].from, '15550001234');
  });

  it('caps command log at 20', async () => {
    const commandLog = Array.from({ length: 20 }, (_, i) => ({ from, body: `cmd${i}`, response: '', at: 0 }));
    await handleSmsCommand({ from, body: 'CB HELP', analystState: null, feedSnapshots: [], allowlist, rateLimitMap: new Map(), commandLog });
    assert.equal(commandLog.length, 20);
  });

  it('returns unknown response for non-CB body', async () => {
    const result = await handleSmsCommand({ from, body: 'hello there', analystState: null, feedSnapshots: [], allowlist, rateLimitMap: new Map(), commandLog: [] });
    assert.equal(result.status, 200);
    assert.ok(result.text.includes('Unknown command'));
  });

  it('handles CB FEEDS with feedSnapshots', async () => {
    const snapshots = [{ key: 'x', lastSuccessAt: Date.now(), lastError: null }];
    const result = await handleSmsCommand({ from, body: 'CB FEEDS', analystState: null, feedSnapshots: snapshots, allowlist, rateLimitMap: new Map(), commandLog: [] });
    assert.equal(result.status, 200);
    assert.ok(result.text.includes('1 tracked'));
  });

  it('handles CB ALERTS with unknown domain', async () => {
    const state = { threads: [{ id: 't1', label: 'T', domain: 'earthquake' }] };
    const result = await handleSmsCommand({ from, body: 'CB ALERTS foobar', analystState: state, feedSnapshots: [], allowlist, rateLimitMap: new Map(), commandLog: [] });
    assert.equal(result.status, 200);
    assert.ok(result.text.length > 0);
  });
});

// ── loadSmsConfig / saveSmsConfig ─────────────────────────────────────────────

describe('loadSmsConfig and saveSmsConfig', () => {
  let tmpDir;
  before(() => { tmpDir = mkdtempSync(path.join(tmpdir(), 'sms-test-')); });

  it('returns defaults for missing file', () => {
    const config = loadSmsConfig(path.join(tmpDir, 'nonexistent.json'));
    assert.equal(config.enabled, false);
    assert.deepEqual(config.allowlist, []);
  });

  it('round-trips config through save/load', () => {
    const configPath = path.join(tmpDir, 'sms-config.json');
    const config = { enabled: true, allowlist: ['+15550001234'] };
    saveSmsConfig(config, configPath);
    const loaded = loadSmsConfig(configPath);
    assert.equal(loaded.enabled, true);
    assert.deepEqual(loaded.allowlist, ['+15550001234']);
  });
});
