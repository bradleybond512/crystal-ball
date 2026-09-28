import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('native iMessage authorization contract executes successfully', () => {
  const frontendDist = mkdtempSync(join(tmpdir(), 'crystalball-imessage-contract-'));
  try {
    const bundle = spawnSync(process.execPath, ['scripts/build-sidecar-xmpp.mjs'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    });
    const bundleOutput = `${bundle.stdout ?? ''}\n${bundle.stderr ?? ''}`;
    assert.equal(bundle.error, undefined, bundleOutput);
    assert.equal(bundle.signal, null, bundleOutput);
    assert.equal(bundle.status, 0, bundleOutput);

    const result = spawnSync('cargo', [
      'test', '--manifest-path', 'src-tauri/Cargo.toml', '--test', 'imessage_contract',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        CARGO_TERM_COLOR: 'never',
        TAURI_CONFIG: JSON.stringify({ build: { frontendDist } }),
      },
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300_000,
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    assert.equal(result.error, undefined, output);
    assert.equal(result.signal, null, output);
    assert.equal(result.status, 0, output);
    assert.match(output, /test result: ok\. [1-9]\d* passed; 0 failed;/);
  } finally {
    rmSync(frontendDist, { recursive: true, force: true });
  }
});
