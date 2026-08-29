import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  collectLittleSnitchTraffic,
  MAX_LITTLE_SNITCH_CSV_BYTES,
  parseLittleSnitchTrafficCsv,
  writeLittleSnitchSnapshot,
} from './export-little-snitch-traffic.mjs';

const HEADER = 'date,direction,uid,ipAddress,remoteHostname,protocol,port,connectCount,denyCount,byteCountIn,byteCountOut,connectingExecutable,parentAppExecutable';

test('sanitizes and deterministically aggregates documented Little Snitch rows', () => {
  const csv = [
    HEADER,
    '2026-05-04 04:20:00,out,501,93.184.216.34,api.example.org,6,443,4,0,50,1200,/opt/homebrew/bin/node,/Applications/Terminal.app/Contents/MacOS/Terminal',
    '2026-05-04 04:21:00,out,501,93.184.216.34,api.example.org,6,443,2,0,25,300,/opt/homebrew/bin/node,/Applications/Terminal.app/Contents/MacOS/Terminal',
  ].join('\n');

  const entries = parseLittleSnitchTrafficCsv(csv);

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    id: entries[0].id,
    app: 'Terminal',
    remoteHost: 'api.example.org',
    remoteIp: null,
    decision: 'allow',
    direction: 'outbound',
    protocol: 'tcp',
    bytesIn: 75,
    bytesOut: 1500,
    lastSeen: new Date('2026-05-04T04:21:00').toISOString(),
    count: 6,
  });
  assert.match(entries[0].id, /^[a-f0-9]{24}$/);
  assert.doesNotMatch(JSON.stringify(entries), /501|443|93\.184|Applications|homebrew/);
});

test('assigns distinct stable IDs to allow and block entries for the same destination', () => {
  const csv = [
    HEADER,
    '2026-05-04 04:20:00,out,501,93.184.216.34,api.example.org,6,443,1,0,1,1,/bin/node,/Applications/Terminal',
    '2026-05-04 04:21:00,out,501,93.184.216.34,api.example.org,6,443,1,1,1,1,/bin/node,/Applications/Terminal',
  ].join('\n');
  const entries = parseLittleSnitchTrafficCsv(csv);
  assert.equal(entries.length, 2);
  assert.equal(new Set(entries.map(entry => entry.id)).size, 2);
});

test('treats a header-only export as a healthy empty collection', () => {
  assert.deepEqual(parseLittleSnitchTrafficCsv(`${HEADER}\n`), []);
});

test('omits IP-only destinations instead of persisting raw addresses', () => {
  const csv = [
    HEADER,
    '2026-05-04 04:20:00,out,501,93.184.216.34,,6,443,1,0,1,1,/bin/node,/Applications/Terminal',
    '2026-05-04 04:20:30,out,501,93.184.216.35,93.184.216.35,6,443,1,0,1,1,/bin/node,/Applications/Terminal',
    '2026-05-04 04:21:00,out,501,93.184.216.34,api.example.org,6,443,1,0,1,1,/bin/node,/Applications/Terminal',
  ].join('\n');

  const entries = parseLittleSnitchTrafficCsv(csv);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].remoteHost, 'api.example.org');
  assert.doesNotMatch(JSON.stringify(entries), /93\.184\.216\.34/);
});

test('fails closed when an observed traffic row cannot be normalized', () => {
  const invalidDate = `${HEADER}\nnot-a-date,out,501,93.184.216.34,api.example.org,6,443,1,0,1,1,/bin/node,/Applications/Terminal`;
  const shortRow = `${HEADER}\n2026-05-04 04:21:00,out`;
  const malformedIpOnly = `${HEADER}\n2026-05-04 04:21:00,out,501,93.184.216.34,,6,443,1,oops,1,1,/bin/node,/Applications/Terminal`;

  for (const csv of [invalidDate, shortRow, malformedIpOnly]) {
    assert.throws(
      () => parseLittleSnitchTrafficCsv(csv),
      /invalid traffic row/,
    );
  }
});

test('fails closed instead of coercing malformed traffic counters to allowed traffic', () => {
  const rows = [
    '2026-05-04 04:21:00,out,501,93.184.216.34,api.example.org,6,443,1,,1,1,/bin/node,/Applications/Terminal',
    '2026-05-04 04:21:00,out,501,93.184.216.34,api.example.org,6,443,1,oops,1,1,/bin/node,/Applications/Terminal',
    '2026-05-04 04:21:00,out,501,93.184.216.34,api.example.org,6,443,1,-1,1,1,/bin/node,/Applications/Terminal',
    '2026-05-04 04:21:00,out,501,93.184.216.34,api.example.org,6,443,1,0,oops,1,/bin/node,/Applications/Terminal',
  ];

  for (const row of rows) {
    assert.throws(
      () => parseLittleSnitchTrafficCsv(`${HEADER}\n${row}`),
      /invalid traffic row/,
    );
  }
});

test('accepts live byte-activity rows and deny-only blocked rows', () => {
  const csv = [
    HEADER,
    '2026-05-04 04:20:00,out,501,93.184.216.34,api.example.org,6,443,0,0,50,1200,/bin/node,/Applications/Terminal',
    '2026-05-04 04:21:00,out,501,93.184.216.35,blocked.example.org,6,443,0,3,0,0,/bin/node,/Applications/Terminal',
  ].join('\n');

  const entries = parseLittleSnitchTrafficCsv(csv);
  const allowed = entries.find(entry => entry.decision === 'allow');
  const blocked = entries.find(entry => entry.decision === 'block');
  assert.equal(allowed?.count, 1);
  assert.equal(blocked?.count, 3);
});

test('fails closed for malformed, unknown, and oversized CSV', () => {
  assert.throws(
    () => parseLittleSnitchTrafficCsv(`${HEADER},unexpected\n`),
    /schema is not supported/,
  );
  assert.throws(
    () => parseLittleSnitchTrafficCsv(`${HEADER}\n"unterminated`),
    /malformed CSV/,
  );
  assert.throws(
    () => parseLittleSnitchTrafficCsv('x'.repeat(MAX_LITTLE_SNITCH_CSV_BYTES + 1)),
    /exceeded the permitted size/,
  );
});

test('writes a private atomic schema-v1 snapshot including healthy zero rows', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'little-snitch-snapshot-'));
  await chmod(dir, 0o700);
  const output = path.join(dir, 'little-snitch-traffic.json');
  const now = new Date('2026-08-29T12:00:00.000Z');

  await writeLittleSnitchSnapshot([], output, now);

  const snapshot = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(snapshot, {
    schemaVersion: 1,
    available: true,
    generatedAt: now.toISOString(),
    entries: [],
  });
  const outputStat = await stat(output);
  assert.equal(outputStat.mode & 0o777, 0o600);
});

test('bounds collector output and terminates the tracked child', async () => {
  await assert.rejects(
    collectLittleSnitchTraffic({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(2048)); setInterval(() => {}, 1000)'],
      maxBytes: 1024,
      timeoutMs: 2000,
      terminationGraceMs: 50,
    }),
    /exceeded the permitted size/,
  );
});

test('self-expires a collector that ignores SIGTERM without a detached PID killer', async () => {
  const started = Date.now();
  await assert.rejects(
    collectLittleSnitchTraffic({
      command: process.execPath,
      args: ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'],
      timeoutMs: 50,
      terminationGraceMs: 50,
    }),
    /timed out/,
  );
  assert.ok(Date.now() - started < 1000);
});

test('never includes privileged vendor stderr in errors', async () => {
  await assert.rejects(
    collectLittleSnitchTraffic({
      command: process.execPath,
      args: ['-e', 'process.stderr.write("token=super-secret"); process.exit(1)'],
      timeoutMs: 1000,
    }),
    error => error.message === 'Little Snitch collection failed' && !error.message.includes('super-secret'),
  );
});

test('interprets timezone-less vendor timestamps in the local timezone across regions', () => {
  const moduleUrl = new URL('export-little-snitch-traffic.mjs', import.meta.url).href;
  const program = `
    const { parseLittleSnitchTrafficCsv } = await import(${JSON.stringify(moduleUrl)});
    const csv = ${JSON.stringify(`${HEADER}\n2026-05-04 04:21:00,out,501,93.184.216.34,api.example.org,6,443,1,0,1,1,/bin/node,/Applications/Terminal`)};
    process.stdout.write(parseLittleSnitchTrafficCsv(csv)[0].lastSeen);
  `;
  const parseIn = timezone => spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    encoding: 'utf8',
    env: { ...process.env, TZ: timezone },
  });
  const chicago = parseIn('America/Chicago');
  const tokyo = parseIn('Asia/Tokyo');
  assert.equal(chicago.status, 0, chicago.stderr);
  assert.equal(tokyo.status, 0, tokyo.stderr);
  assert.equal(chicago.stdout, '2026-05-04T09:21:00.000Z');
  assert.equal(tokyo.stdout, '2026-05-03T19:21:00.000Z');
});

test('uses the passwd-backed account home when inherited HOME is polluted', () => {
  const moduleUrl = new URL('export-little-snitch-traffic.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { LITTLE_SNITCH_EXPORT_PATH } = await import(${JSON.stringify(moduleUrl)});
    process.stdout.write(LITTLE_SNITCH_EXPORT_PATH);
  `], {
    encoding: 'utf8',
    env: { ...process.env, HOME: '/Users/attacker-controlled-home' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    path.join(os.userInfo().homedir, 'Library/Application Support/Crystal Ball/little-snitch-traffic.json'),
  );
});
