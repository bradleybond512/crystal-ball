import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
