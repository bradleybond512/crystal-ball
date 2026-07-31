import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('CLI exposes stable help and offline capability contracts', () => {
  const help = run(['help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /doctor/);
  assert.match(help.stdout, /safeguard-demo/);
  assert.match(help.stdout, /evidence/);

  const capabilities = run(['capabilities', '--json']);
  assert.equal(capabilities.status, 0, capabilities.stderr);
  const payload = JSON.parse(capabilities.stdout);
  assert.equal(payload.tools.length, 59);
  assert.equal(payload.compatibility.protocol, '2025-03-26');
  assert.ok(payload.tools.every((tool) => tool.permission?.label));
});

test('CLI safeguard demo never depends on local runtime state', () => {
  const result = run(['safeguard-demo', '--json'], {
    HOME: '/definitely/not/a/real/home',
    CRYSTALBALL_DATA_DIR: '/definitely/not/state',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).passed, true);
});

test('CLI exports Evidence Packet v1 with restrictive permissions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'crystalball-cli-evidence-'));
  const input = join(directory, 'input.json');
  const output = join(directory, 'packet.json');
  writeFileSync(input, JSON.stringify({
    generatedAt: '2026-07-31T12:00:00.000Z',
    query: { tool: 'get_sitrep' },
    result: { summary: 'ok', sources: ['/api/health'] },
  }));
  const result = run(['evidence', '--input', input, '--output', output, '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(output, 'utf8')).schemaVersion, 1);
  assert.equal(statSync(output).mode & 0o777, 0o600);
});

test('CLI returns EX_USAGE for unknown commands', () => {
  const result = run(['unknown-command']);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /Unknown command/);
});

test('CLI monitor exits degraded for an old green state whose scheduler stopped', () => {
  const home = mkdtempSync(join(tmpdir(), 'crystalball-cli-monitor-'));
  const monitorDir = join(home, '.crystal-ball', 'monitor');
  mkdirSync(monitorDir, { recursive: true });
  const generationId = 'monitor-generation-v1-1785000000000';
  writeFileSync(join(monitorDir, 'state.json'), JSON.stringify({
    schemaVersion: 1,
    generationId,
    available: true,
    status: 'green',
    lastRunAt: Date.now() - 60 * 60_000,
    summary: 'Old green state.',
    findings: [],
    recovered: [],
    activeIds: [],
    snapshot: { feeds: {}, quarantinedAlgorithms: [] },
  }));
  writeFileSync(join(monitorDir, 'events.json'), JSON.stringify({
    schemaVersion: 1,
    generationId,
    schedule: {
      expectedIntervalMs: 15 * 60_000,
      stoppedGraceMs: 0,
      lastRunAt: Date.now() - 60 * 60_000,
      nextRunAt: Date.now() - 45 * 60_000,
    },
    activeFindings: {},
    cooldowns: {},
    events: [],
  }));
  const result = run(['monitor', '--json'], { HOME: home });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).schedule.status, 'stopped');
});

test('CLI doctor does not treat an unrelated Codex config as Crystal Ball registration', () => {
  const home = mkdtempSync(join(tmpdir(), 'crystalball-cli-doctor-'));
  const codexDir = join(home, '.codex');
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(join(codexDir, 'config.toml'), '[mcp_servers.other]\ncommand = "other-mcp"\n');
  let result = run(['doctor', '--json'], { HOME: home });
  let report = JSON.parse(result.stdout);
  assert.equal(report.checks.clients.configured, 0);

  writeFileSync(join(codexDir, 'config.toml'), '[mcp_servers.crystalball]\ncommand = "crystalball-mcp"\n');
  result = run(['doctor', '--json'], { HOME: home });
  report = JSON.parse(result.stdout);
  assert.equal(report.checks.clients.configured, 1);

  writeFileSync(join(codexDir, 'config.toml'), [
    '[mcp_servers.crystalball]',
    'enabled = false',
    '[mcp_servers.other]',
    'command = "crystalball-mcp"',
  ].join('\n'));
  result = run(['doctor', '--json'], { HOME: home });
  report = JSON.parse(result.stdout);
  assert.equal(report.checks.clients.configured, 0);
});
