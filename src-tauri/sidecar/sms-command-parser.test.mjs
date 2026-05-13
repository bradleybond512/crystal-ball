import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseCommand,
  handleSmsCommand,
  loadSmsConfig,
  saveSmsConfig,
} from './sms-command-parser.mjs';

describe('parseCommand', () => {
  it('parses CB STATUS', () => {
    const r = parseCommand('CB STATUS');
    assert.equal(r.isValid, true);
    assert.equal(r.command, 'STATUS');
    assert.deepEqual(r.args, []);
  });

  it('parses CB BRIEF', () => {
    assert.equal(parseCommand('CB BRIEF').command, 'BRIEF');
  });

  it('parses CB SITREP', () => {
    assert.equal(parseCommand('CB SITREP').command, 'SITREP');
  });

  it('parses CB HELP', () => {
    assert.equal(parseCommand('CB HELP').command, 'HELP');
  });

  it('parses CB WATCH with keyword', () => {
    const r = parseCommand('CB WATCH cobalt');
    assert.equal(r.command, 'WATCH');
    assert.deepEqual(r.args, ['cobalt']);
  });

  it('parses CB WATCH with multi-word keyword', () => {
    const r = parseCommand('CB WATCH supply chain');
    assert.deepEqual(r.args, ['supply', 'chain']);
  });

  it('parses CB ALERT with threshold + domain', () => {
    const r = parseCommand('CB ALERT 0.7 cyber');
    assert.equal(r.command, 'ALERT');
    assert.deepEqual(r.args, ['0.7', 'cyber']);
  });

  it('accepts CBall prefix', () => {
    assert.equal(parseCommand('cball status').command, 'STATUS');
  });

  it('accepts crystal ball prefix', () => {
    assert.equal(parseCommand('crystal ball brief').command, 'BRIEF');
  });

  it('is case-insensitive', () => {
    assert.equal(parseCommand('cb status').command, 'STATUS');
    assert.equal(parseCommand('Cb StAtUs').command, 'STATUS');
  });

  it('trims whitespace', () => {
    assert.equal(parseCommand('  CB STATUS  ').command, 'STATUS');
  });

  it('rejects empty', () => {
    const r = parseCommand('');
    assert.equal(r.isValid, false);
    assert.equal(r.error, 'empty');
  });

  it('rejects missing prefix', () => {
    const r = parseCommand('hello world');
    assert.equal(r.isValid, false);
    assert.equal(r.error, 'missing_prefix');
  });

  it('rejects unknown command', () => {
    const r = parseCommand('CB FOOBAR');
    assert.equal(r.isValid, false);
    assert.equal(r.error, 'unknown:FOOBAR');
  });

  it('rejects bare CB', () => {
    const r = parseCommand('CB');
    assert.equal(r.isValid, false);
    assert.equal(r.error, 'missing_command');
  });

  it('returns null command for null input', () => {
    const r = parseCommand(null);
    assert.equal(r.isValid, false);
  });
});

describe('loadSmsConfig and saveSmsConfig', () => {
  let tmpDir;
  before(() => { tmpDir = mkdtempSync(path.join(tmpdir(), 'sms-cfg-')); });

  it('returns defaults for missing files', () => {
    const c = loadSmsConfig(
      path.join(tmpDir, 'none.json'),
      path.join(tmpDir, 'none-allow.json'),
    );
    assert.equal(c.enabled, false);
    assert.deepEqual(c.allowlist, []);
  });

  it('round-trips enabled flag + tier-aware allowlist', () => {
    const cfgPath = path.join(tmpDir, 'cfg.json');
    const alPath = path.join(tmpDir, 'allow.json');
    saveSmsConfig({
      enabled: true,
      allowlist: [
        { phoneNumber: '+15550001234', name: 'Brad', tier: 'admin' },
        { phoneNumber: '+15550009999', name: 'Guest', tier: 'readonly' },
      ],
    }, cfgPath, alPath);
    const loaded = loadSmsConfig(cfgPath, alPath);
    assert.equal(loaded.enabled, true);
    assert.equal(loaded.allowlist.length, 2);
    assert.equal(loaded.allowlist[0].tier, 'admin');
    assert.equal(loaded.allowlist[1].name, 'Guest');
  });

  it('upcasts legacy string allowlist entries to readonly', () => {
    const cfgPath = path.join(tmpDir, 'legacy-cfg.json');
    const alPath = path.join(tmpDir, 'legacy-allow.json');
    saveSmsConfig({ enabled: false, allowlist: ['+15550001234'] }, cfgPath, alPath);
    const loaded = loadSmsConfig(cfgPath, alPath);
    assert.equal(loaded.allowlist[0].tier, 'readonly');
    assert.equal(loaded.allowlist[0].phoneNumber, '+15550001234');
  });
});

describe('handleSmsCommand integration', () => {
  const from = '+15550001234';
  let allowlist;
  let rateLimitMap;
  let commandLog;
  let watchRegistry;
  let alertRegistry;

  beforeEach(() => {
    allowlist = [
      { phoneNumber: from, name: 'Admin', tier: 'admin' },
      { phoneNumber: '+15550009999', name: 'Guest', tier: 'readonly' },
    ];
    rateLimitMap = new Map();
    commandLog = [];
    watchRegistry = [];
    alertRegistry = [];
  });

  it('returns 403 for un-allowlisted number', async () => {
    const r = await handleSmsCommand({
      from: '+19990000000', body: 'CB STATUS',
      analystState: null, feedSnapshots: [],
      allowlist, rateLimitMap, commandLog,
    });
    assert.equal(r.status, 403);
    assert.equal(commandLog[0].outcome, 'denied:not_allowlisted');
  });

  it('returns 403 when WATCH requested by readonly tier', async () => {
    const r = await handleSmsCommand({
      from: '+15550009999', body: 'CB WATCH cobalt',
      analystState: null, feedSnapshots: [],
      allowlist, rateLimitMap, commandLog, watchRegistry,
    });
    assert.equal(r.status, 403);
    assert.equal(watchRegistry.length, 0);
    assert.ok(commandLog[0].outcome.startsWith('denied:tier_required'));
  });

  it('allows readonly tier to run STATUS', async () => {
    const r = await handleSmsCommand({
      from: '+15550009999', body: 'CB STATUS',
      analystState: { posture: 'normal', threads: [] },
      feedSnapshots: [], allowlist, rateLimitMap, commandLog,
    });
    assert.equal(r.status, 200);
    assert.ok(r.text.includes('CB NORMAL'));
  });

  it('admin can register a WATCH', async () => {
    const r = await handleSmsCommand({
      from, body: 'CB WATCH cobalt',
      analystState: null, feedSnapshots: [],
      allowlist, rateLimitMap, commandLog, watchRegistry,
    });
    assert.equal(r.status, 200);
    assert.equal(watchRegistry.length, 1);
    assert.equal(watchRegistry[0].keyword, 'cobalt');
  });

  it('admin can register an ALERT', async () => {
    const r = await handleSmsCommand({
      from, body: 'CB ALERT 0.7 cyber',
      analystState: null, feedSnapshots: [],
      allowlist, rateLimitMap, commandLog, alertRegistry,
    });
    assert.equal(r.status, 200);
    assert.equal(alertRegistry.length, 1);
    assert.equal(alertRegistry[0].threshold, 0.7);
    assert.equal(alertRegistry[0].domain, 'cyber');
  });

  it('rejects ALERT with out-of-range threshold', async () => {
    const r = await handleSmsCommand({
      from, body: 'CB ALERT 5 cyber',
      analystState: null, feedSnapshots: [],
      allowlist, rateLimitMap, commandLog, alertRegistry,
    });
    assert.equal(r.status, 200);
    assert.equal(alertRegistry.length, 0);
    assert.ok(r.text.includes('threshold'));
  });

  it('returns 429 after 10 successful commands', async () => {
    for (let i = 0; i < 10; i++) {
      await handleSmsCommand({
        from, body: 'CB STATUS',
        analystState: null, feedSnapshots: [],
        allowlist, rateLimitMap, commandLog,
      });
    }
    const r = await handleSmsCommand({
      from, body: 'CB STATUS',
      analystState: null, feedSnapshots: [],
      allowlist, rateLimitMap, commandLog,
    });
    assert.equal(r.status, 429);
  });

  it('returns help for invalid body', async () => {
    const r = await handleSmsCommand({
      from, body: 'gibberish',
      analystState: null, feedSnapshots: [],
      allowlist, rateLimitMap, commandLog,
    });
    assert.equal(r.status, 200);
    assert.ok(r.text.toUpperCase().includes('STATUS'));
  });

  it('reports segment count in response', async () => {
    const r = await handleSmsCommand({
      from, body: 'CB HELP',
      analystState: null, feedSnapshots: [],
      allowlist, rateLimitMap, commandLog,
    });
    assert.ok(r.segments >= 1);
  });
});
