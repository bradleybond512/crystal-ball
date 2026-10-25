import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('the native update identity policy accepts full and rejects variants and mismatched identities', t => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'updater-identity-contract-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, process.platform === 'win32' ? 'identity-contract.exe' : 'identity-contract');
  const contract = fileURLToPath(new URL('../src-tauri/tests/updater_identity_contract.rs', import.meta.url));
  const compile = spawnSync('rustc', ['--edition=2021', '--test', contract, '-o', output], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.error?.message || compile.stderr);
  const result = spawnSync(output, [], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  assert.match(result.stdout, /1 passed; 0 failed/);
});
