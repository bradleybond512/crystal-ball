import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(serverRoot));

test('temporary-prefix install exposes both new and existing command names', { timeout: 30_000 }, () => {
  const prefix = mkdtempSync(join(tmpdir(), 'crystalball-install-'));
  const install = spawnSync('npm', [
    'run',
    'mcp:install-local',
    '--',
    '--prefix',
    prefix,
    '--no-monitor',
  ], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.equal(install.status, 0, `${install.stdout}\n${install.stderr}`);

  for (const executable of ['crystalball', 'crystalball-mcp', 'crystalball-monitor']) {
    assert.ok(statSync(join(prefix, 'bin', executable)).mode & 0o111, executable);
  }
  const probe = spawnSync(join(prefix, 'bin', 'crystalball'), ['capabilities', '--json'], {
    encoding: 'utf8',
    timeout: 3_000,
  });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(JSON.parse(probe.stdout).tools.length, 61);
  const doctor = spawnSync(join(prefix, 'bin', 'crystalball'), ['doctor', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'crystalball-doctor-home-')) },
    timeout: 10_000,
  });
  assert.notEqual(doctor.status, null, doctor.error?.message);
  const doctorReport = JSON.parse(doctor.stdout);
  assert.equal(doctorReport.checks.install.status, 'pass');
  assert.equal(doctorReport.checks.mcp.status, 'pass');
  assert.equal(doctorReport.checks.mcp.version, '0.3.0');
  const installedRoot = join(prefix, 'lib', 'node_modules', 'crystalball-mcp');
  for (const file of [
    'local-lock.mjs',
    'weekly-evaluation-report.mjs',
    join('tools', 'evaluation-report.mjs'),
  ]) {
    assert.equal(existsSync(join(installedRoot, file)), true, file);
  }
});
