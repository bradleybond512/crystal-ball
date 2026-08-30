import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('focused native gate executes the current-location Rust contract', () => {
  const bundle = spawnSync(process.execPath, [
    'scripts/build-sidecar-xmpp.mjs',
  ], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000,
  });
  const bundleOutput = `${bundle.stdout ?? ''}\n${bundle.stderr ?? ''}`;

  assert.equal(bundle.error, undefined, bundleOutput);
  assert.equal(bundle.signal, null, bundleOutput);
  assert.equal(bundle.status, 0, bundleOutput);
  assert.match(bundleOutput, /build:sidecar-xmpp\s+src-tauri\/sidecar\/s2u-xmpp\.bundle\.mjs/);

  const result = spawnSync('cargo', [
    'test',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--test',
    'current_location_contract',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CARGO_TERM_COLOR: 'never' },
    maxBuffer: 10 * 1024 * 1024,
    timeout: 300_000,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

  assert.equal(result.error, undefined, output);
  assert.equal(result.signal, null, output);
  assert.equal(result.status, 0, output);
  assert.match(output, /test result: ok\. 9 passed; 0 failed;/);
});
