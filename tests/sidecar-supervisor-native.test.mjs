import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('native sidecar supervisor contract executes successfully (R4-BUG-004)', () => {
  const bundlePath = join(root, 'src-tauri', 'sidecar', 's2u-xmpp.bundle.mjs');
  const previousBundle = lstatSync(bundlePath, { throwIfNoEntry: false });
  assert.ok(!previousBundle || previousBundle.isFile(), 'Existing XMPP bundle must be a regular file');
  const frontendDist = mkdtempSync(join(tmpdir(), 'crystalball-supervisor-contract-'));
  let backupDirectory;
  let backupMoved = false;
  let generatedBundle;
  let generatedContent;
  try {
    backupDirectory = mkdtempSync(join(root, 'src-tauri', 'sidecar', '.supervisor-xmpp-contract-'));
    if (previousBundle) {
      renameSync(bundlePath, join(backupDirectory, 'previous.bundle.mjs'));
      backupMoved = true;
      const preserved = lstatSync(join(backupDirectory, 'previous.bundle.mjs'));
      assert.ok(preserved.isFile() && preserved.dev === previousBundle.dev && preserved.ino === previousBundle.ino,
        `Prior XMPP bundle changed while preserving it in ${backupDirectory}`);
    }
    const bundle = spawnSync(process.execPath, ['scripts/build-sidecar-xmpp.mjs'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    });
    generatedBundle = lstatSync(bundlePath, { throwIfNoEntry: false });
    if (generatedBundle?.isFile()) generatedContent = readFileSync(bundlePath);
    const bundleOutput = `${bundle.stdout ?? ''}\n${bundle.stderr ?? ''}`;
    assert.equal(bundle.error, undefined, bundleOutput);
    assert.equal(bundle.signal, null, bundleOutput);
    assert.equal(bundle.status, 0, bundleOutput);
    assert.ok(generatedBundle?.isFile(), 'XMPP build must create a regular bundle');

    const result = spawnSync('cargo', [
      'test', '--manifest-path', 'src-tauri/Cargo.toml', '--test', 'sidecar_supervisor_contract',
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
    try {
      const currentBundle = lstatSync(bundlePath, { throwIfNoEntry: false });
      assert.ok((!currentBundle && !generatedBundle)
        || (currentBundle?.isFile() && generatedBundle?.isFile()
          && currentBundle.dev === generatedBundle.dev && currentBundle.ino === generatedBundle.ino
          && currentBundle.mode === generatedBundle.mode && currentBundle.size === generatedBundle.size
          && currentBundle.mtimeMs === generatedBundle.mtimeMs
          && readFileSync(bundlePath).equals(generatedContent)),
      `XMPP bundle changed unexpectedly; any prior bundle remains in ${backupDirectory}`);
      if (currentBundle) unlinkSync(bundlePath);
      if (backupMoved) {
        const backupPath = join(backupDirectory, 'previous.bundle.mjs');
        const preserved = lstatSync(backupPath);
        assert.ok(preserved.isFile() && preserved.dev === previousBundle.dev && preserved.ino === previousBundle.ino,
          `Prior XMPP bundle changed in ${backupDirectory}`);
        assert.equal(lstatSync(bundlePath, { throwIfNoEntry: false }), undefined,
          `Cannot restore prior XMPP bundle from ${backupDirectory}: output path is occupied`);
        renameSync(backupPath, bundlePath);
      }
      if (backupDirectory) rmdirSync(backupDirectory);
    } finally {
      rmSync(frontendDist, { recursive: true, force: true });
    }
  }
});
