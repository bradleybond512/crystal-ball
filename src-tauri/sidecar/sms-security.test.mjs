import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  loadAllowlist,
  saveAllowlist,
  isAllowed,
  isDestructiveCommand,
  checkRateLimit,
  recordRateLimit,
  logCommand,
  normalizePhone,
} from './sms-security.mjs';

describe('normalizePhone', () => {
  it('strips non-digits', () => {
    assert.equal(normalizePhone('+1 (555) 000-1234'), '15550001234');
  });
  it('handles empty / null', () => {
    assert.equal(normalizePhone(''), '');
    assert.equal(normalizePhone(null), '');
  });
});

describe('isAllowed', () => {
  const allowlist = [
    { phoneNumber: '+15550001234', name: 'Admin', tier: 'admin' },
    { phoneNumber: '+15550009999', name: 'Guest', tier: 'readonly' },
  ];

  it('rejects empty allowlist', () => {
    const r = isAllowed('+15550001234', []);
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'not_allowlisted');
  });

  it('matches by normalized digits', () => {
    const r = isAllowed('+1 (555) 000-1234', allowlist);
    assert.equal(r.allowed, true);
    assert.equal(r.entry.name, 'Admin');
  });

  it('returns not_allowlisted for unknown number', () => {
    const r = isAllowed('+19990000000', allowlist);
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'not_allowlisted');
  });

  it('blocks readonly tier from admin command', () => {
    const r = isAllowed('+15550009999', allowlist, 'admin');
    assert.equal(r.allowed, false);
    assert.equal(r.reason, 'tier_required');
    assert.equal(r.entry.tier, 'readonly');
  });

  it('allows admin tier on admin command', () => {
    const r = isAllowed('+15550001234', allowlist, 'admin');
    assert.equal(r.allowed, true);
  });

  it('allows readonly on readonly command by default', () => {
    const r = isAllowed('+15550009999', allowlist);
    assert.equal(r.allowed, true);
  });

  it('upcasts bare string entries to readonly', () => {
    const r = isAllowed('+15550001234', ['+15550001234'], 'readonly');
    assert.equal(r.allowed, true);
    const r2 = isAllowed('+15550001234', ['+15550001234'], 'admin');
    assert.equal(r2.allowed, false);
  });
});

describe('isDestructiveCommand', () => {
  it('classifies WATCH and ALERT as destructive', () => {
    assert.equal(isDestructiveCommand('WATCH'), true);
    assert.equal(isDestructiveCommand('ALERT'), true);
  });
  it('treats read commands as non-destructive', () => {
    for (const c of ['STATUS', 'BRIEF', 'SITREP', 'HELP']) {
      assert.equal(isDestructiveCommand(c), false);
    }
  });
});

describe('checkRateLimit / recordRateLimit', () => {
  let map;
  beforeEach(() => { map = new Map(); });

  it('allows on fresh map', () => {
    const r = checkRateLimit('+15550001234', map);
    assert.equal(r.allowed, true);
    assert.equal(r.remaining, 10);
  });

  it('blocks after 10 records', () => {
    for (let i = 0; i < 10; i++) recordRateLimit('+15550001234', map);
    const r = checkRateLimit('+15550001234', map);
    assert.equal(r.allowed, false);
    assert.equal(r.remaining, 0);
  });

  it('resets after window expires', () => {
    recordRateLimit('+15550001234', map);
    const entry = map.get('15550001234');
    entry.windowStart = Date.now() - 61 * 60 * 1000;
    const r = checkRateLimit('+15550001234', map);
    assert.equal(r.allowed, true);
    assert.equal(r.remaining, 10);
  });

  it('tracks per-number windows independently', () => {
    for (let i = 0; i < 10; i++) recordRateLimit('+15550001234', map);
    const other = checkRateLimit('+15550009999', map);
    assert.equal(other.allowed, true);
  });
});

describe('logCommand', () => {
  it('prepends to log and caps at 50', () => {
    const log = [];
    for (let i = 0; i < 60; i++) {
      logCommand('+15550001234', `cmd${i}`, 'ok', log);
    }
    assert.equal(log.length, 50);
    assert.equal(log[0].command, 'cmd59');
  });

  it('normalizes phone in log entry', () => {
    const log = [];
    logCommand('+1 (555) 000-1234', 'STATUS', 'ok', log);
    assert.equal(log[0].from, '15550001234');
  });

  it('is safe with no log array', () => {
    assert.doesNotThrow(() => logCommand('+15550001234', 'STATUS', 'ok', null));
  });
});

describe('loadAllowlist / saveAllowlist', () => {
  let tmpDir;
  before(() => { tmpDir = mkdtempSync(path.join(tmpdir(), 'sms-allow-')); });

  it('returns empty for missing file', () => {
    assert.deepEqual(loadAllowlist(path.join(tmpDir, 'nope.json')), []);
  });

  it('round-trips structured entries', () => {
    const p = path.join(tmpDir, 'allow.json');
    saveAllowlist([
      { phoneNumber: '+15550001234', name: 'A', tier: 'admin' },
    ], p);
    const list = loadAllowlist(p);
    assert.equal(list.length, 1);
    assert.equal(list[0].tier, 'admin');
  });

  it('accepts wrapper { allowlist: [...] } shape', () => {
    const p = path.join(tmpDir, 'allow-wrapped.json');
    writeFileSync(p, JSON.stringify({ allowlist: [{ phoneNumber: '+15550001234', tier: 'readonly' }] }));
    const list = loadAllowlist(p);
    assert.equal(list.length, 1);
  });

  it('filters out empty phoneNumber entries', () => {
    const p = path.join(tmpDir, 'allow-bad.json');
    saveAllowlist([
      { phoneNumber: '', name: 'X', tier: 'admin' },
      { phoneNumber: '+15550001234', name: 'Y', tier: 'admin' },
    ], p);
    const list = loadAllowlist(p);
    assert.equal(list.length, 1);
  });
});
