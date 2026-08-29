import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'little-snitch-log-traffic-helper.sh');

test('root helper has a fixed vendor command, no arguments, and an in-process deadline', async () => {
  const source = await readFile(scriptPath, 'utf8');
  assert.match(source, /readonly LITTLE_SNITCH_BIN='\/Library\/PrivilegedHelperTools\/com\.crystalball\.littlesnitch-cli'/);
  assert.match(source, /\[\[ "\$#" -ne 0 \]\]/);
  assert.doesNotMatch(source, /\/Applications\/Little Snitch\.app/);
  assert.match(source, /alarm 30/);
  assert.match(source, /alarm 0/);
  assert.match(source, /kill "TERM", -\$child/);
  assert.match(source, /readonly CALLER_UID="\$\{SUDO_UID:-\}"/);
  assert.match(source, /id -u -- "\$\{CALLER_USER\}"/);
  assert.match(source, /"\$\{LITTLE_SNITCH_BIN\}" -u "\$\{CALLER_UID\}" log-traffic/);
  assert.equal(source.includes('$@'), false);
  assert.equal(source.includes('eval'), false);
  assert.equal(source.includes('nohup'), false);
  assert.equal(source.includes('watchdog'), false);
});

test('root helper is valid bash', () => {
  const result = spawnSync('/bin/bash', ['-n', scriptPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('root helper rejects all caller-controlled arguments before touching the pinned CLI', () => {
  const result = spawnSync('/bin/bash', [scriptPath, '--begin-date', 'attacker controlled'], { encoding: 'utf8' });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /does not accept arguments/);
});

test('root-side limiter stops endless vendor output at 8 MiB plus one byte', async () => {
  const source = await readFile(scriptPath, 'utf8');
  const start = source.indexOf("exec /usr/bin/perl -e '") + "exec /usr/bin/perl -e '".length;
  const end = source.lastIndexOf("' -- \"${LITTLE_SNITCH_BIN}\"");
  assert.ok(start > 0 && end > start, 'embedded limiter program must be extractable');
  const program = source.slice(start, end);
  const result = spawnSync('/usr/bin/perl', [
    '-e', program, '--', process.execPath, '-e',
    'process.stdout.write(Buffer.alloc(20 * 1024 * 1024, 120)); setInterval(() => {}, 1000)',
  ], { maxBuffer: 12 * 1024 * 1024, timeout: 5000 });
  assert.equal(result.status, 74, result.stderr?.toString());
  assert.equal(result.stdout.length, 8 * 1024 * 1024 + 1);
});

test('embedded deadline kills and reaps a vendor process that ignores TERM', async () => {
  const source = await readFile(scriptPath, 'utf8');
  const start = source.indexOf("exec /usr/bin/perl -e '") + "exec /usr/bin/perl -e '".length;
  const end = source.lastIndexOf("' -- \"${LITTLE_SNITCH_BIN}\"");
  const program = source.slice(start, end).replace('alarm 30;', 'alarm 1;');
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'little-snitch-helper-timeout-'));
  const pidPath = path.join(tempDir, 'vendor.pid');
  try {
    const result = spawnSync('/usr/bin/perl', [
      '-e', program, '--', process.execPath, '-e',
      'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)',
      pidPath,
    ], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 124, result.stderr);
    const vendorPid = Number(await readFile(pidPath, 'utf8'));
    assert.throws(() => process.kill(vendorPid, 0), error => error?.code === 'ESRCH');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
