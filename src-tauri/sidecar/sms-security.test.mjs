import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import {
  loadAllowlist,
  saveAllowlist,
  isAllowed,
  isDestructiveCommand,
  checkRateLimit,
  recordRateLimit,
  logCommand,
  normalizePhone,
  validateTwilioSignature,
} from './sms-security.mjs';

// Mirror of Twilio's signing algorithm so tests can sign their own fixtures.
function signTwilio(authToken, url, params) {
  const paramString = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], '');
  return createHmac('sha1', authToken).update(url + paramString).digest('base64');
}

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

describe('validateTwilioSignature', () => {
  const token = 'test_auth_token_0123456789';
  const url = 'https://example.ngrok.app/api/sms/command';
  const params = { From: '+15550001234', Body: 'STATUS', MessageSid: 'SM123' };

  it('accepts a correctly-signed request', () => {
    const sig = signTwilio(token, url, params);
    assert.equal(validateTwilioSignature(token, url, params, sig), true);
  });

  it('is independent of param insertion order (signs in sorted key order)', () => {
    const sig = signTwilio(token, url, params);
    const reordered = { MessageSid: 'SM123', Body: 'STATUS', From: '+15550001234' };
    assert.equal(validateTwilioSignature(token, url, reordered, sig), true);
  });

  it('rejects a tampered body', () => {
    const sig = signTwilio(token, url, params);
    const tampered = { ...params, Body: 'WATCH AAPL' };
    assert.equal(validateTwilioSignature(token, url, tampered, sig), false);
  });

  it('rejects when the URL differs', () => {
    const sig = signTwilio(token, url, params);
    assert.equal(validateTwilioSignature(token, 'https://evil.example/api/sms/command', params, sig), false);
  });

  it('rejects when signed with a different auth token', () => {
    const sig = signTwilio('other_token', url, params);
    assert.equal(validateTwilioSignature(token, url, params, sig), false);
  });

  it('returns false when the auth token is missing', () => {
    const sig = signTwilio(token, url, params);
    assert.equal(validateTwilioSignature('', url, params, sig), false);
  });

  it('returns false when the signature header is missing', () => {
    assert.equal(validateTwilioSignature(token, url, params, ''), false);
    assert.equal(validateTwilioSignature(token, url, params, undefined), false);
  });

  it('returns false (no throw) for a malformed signature', () => {
    assert.doesNotThrow(() => validateTwilioSignature(token, url, params, '!!!not base64!!!'));
    assert.equal(validateTwilioSignature(token, url, params, '!!!not base64!!!'), false);
  });

  it('handles empty params', () => {
    const sig = signTwilio(token, url, {});
    assert.equal(validateTwilioSignature(token, url, {}, sig), true);
  });
});
