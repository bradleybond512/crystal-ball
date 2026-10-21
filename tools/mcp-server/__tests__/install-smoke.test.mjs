import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { sourceFixture, npmCli } from '../../../tests/helpers/mcp-runtime-fixture.mjs';
import { validateInstalledGraph } from '../../../scripts/install-crystalball-mcp.mjs';
import { verifyLockedCache } from '../../../tests/helpers/mcp-locked-cache.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('genuine offline temporary-prefix installer exposes aliases, doctor and default read stdio', { timeout: 90_000 }, async (t) => {
  const fixture = sourceFixture({ packageOnly: true, prepareTarballs: true });
  t.after(() => fixture.cleanup());
  const prefix = join(fixture.root, 'prefix');
  const manifestBefore = readFileSync(join(fixture.serverRoot, 'package.json'));
  const lockBefore = readFileSync(join(fixture.serverRoot, 'package-lock.json'));
  const resourceManifest = await verifyLockedCache({ destination: fixture.env.npm_config_cache, lockfile: join(fixture.serverRoot, 'package-lock.json') });
  assert.equal(resourceManifest.noNetwork, true);
  assert.equal(resourceManifest.noSourceWrites, true);
  const guard = join(fixture.repo, 'tests/helpers/loopback-only.mjs');
  const install = spawnSync(process.execPath, ['--import', guard, npmCli(), 'run', 'mcp:install-local', '--', '--prefix', prefix, '--no-monitor', '--ignore-scripts'], {
    cwd: fixture.repo, env: fixture.env, encoding: 'utf8', timeout: 60_000,
  });
  if (install.status !== 0 && existsSync(join(fixture.env.npm_config_cache, '_logs'))) {
    for (const file of readdirSync(join(fixture.env.npm_config_cache, '_logs'))) {
      const log = join(fixture.env.npm_config_cache, '_logs', file);
      if (fixture.env.CB_TEST_ARTIFACT_DIR) copyFileSync(log, join(fixture.env.CB_TEST_ARTIFACT_DIR, `${basename(fixture.root)}-${file}`));
      t.diagnostic(`npm raw log ${file}\n${readFileSync(log, 'utf8')}`);
    }
  }
  // A missing local public cache is a real failure, never a skipped smoke.
  assert.equal(install.status, 0, `${install.stdout}\n${install.stderr}\n${install.error?.message ?? ''}`);
  for (const executable of ['crystalball', 'crystalball-mcp', 'crystalball-monitor', 'crystalball-monitor-install']) {
    assert.ok(statSync(join(prefix, 'bin', executable)).mode & 0o111, executable);
  }
  const installedRoot = join(prefix, 'lib/node_modules/crystalball-mcp');
  const installedEnv = { ...fixture.env, CB_TEST_INSTALLED_ROOT: installedRoot };
  const manifest = JSON.parse(manifestBefore);
  const lock = JSON.parse(lockBefore);
  validateInstalledGraph(installedRoot, manifest, lock);
  const hiddenFile = join(installedRoot, 'node_modules/.package-lock.json');
  const hiddenBefore = readFileSync(hiddenFile);
  try {
    const tampered = JSON.parse(hiddenBefore);
    tampered.packages['node_modules/@hono/node-server'].version = '0.0.0';
    writeFileSync(hiddenFile, JSON.stringify(tampered));
    assert.throws(() => validateInstalledGraph(installedRoot, manifest, lock), /Installed lock mismatch/, 'exact locked graph rejects a changed override tuple');
  } finally { writeFileSync(hiddenFile, hiddenBefore); }
  for (const [name, version] of Object.entries({ '@hono/node-server': '2.0.12', 'body-parser': '2.3.0', 'fast-uri': '3.1.8', hono: '4.13.13' })) {
    assert.equal(JSON.parse(readFileSync(join(installedRoot, 'node_modules', name, 'package.json'), 'utf8')).version, version, `actual installed override: ${name}`);
  }
  assert.deepEqual(readFileSync(join(fixture.serverRoot, 'package.json')), manifestBefore);
  assert.deepEqual(readFileSync(join(fixture.serverRoot, 'package-lock.json')), lockBefore);
  assert.deepEqual(readdirSync(join(prefix, 'lib/node_modules')), ['crystalball-mcp'], 'owned staging/backup cleaned');
  assert.equal(existsSync(join(fixture.env.HOME, 'Library/LaunchAgents')), false, '--no-monitor never installs a LaunchAgent');
  const probe = spawnSync(process.execPath, ['--import', guard, join(prefix, 'bin/crystalball'), 'capabilities', '--json'], { encoding: 'utf8', cwd: fixture.repo, env: installedEnv, timeout: 3_000 });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(JSON.parse(probe.stdout).tools.length, 61);
  const doctor = spawnSync(process.execPath, ['--import', guard, join(prefix, 'bin/crystalball'), 'doctor', '--json'], { encoding: 'utf8', cwd: fixture.repo, env: installedEnv, timeout: 10_000 });
  assert.notEqual(doctor.status, null, doctor.error?.message);
  const report = JSON.parse(doctor.stdout);
  assert.equal(report.checks.install.status, 'pass');
  assert.equal(report.checks.mcp.status, 'pass');
  assert.equal(report.checks.mcp.version, '0.3.0');
  for (const file of ['framing.mjs', 'profile.mjs', 'local-lock.mjs', 'weekly-evaluation-report.mjs', 'tools/evaluation-report.mjs']) assert.equal(existsSync(join(installedRoot, file)), true, file);
  const client = new Client({ name: 'genuine-install-smoke', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', guard, join(prefix, 'bin/crystalball-mcp')], cwd: fixture.repo, env: installedEnv, stderr: 'pipe' }));
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 53);
    assert.ok(listed.tools.every((tool) => tool.annotations.readOnlyHint === true));
  } finally { await client.close(); }
});
