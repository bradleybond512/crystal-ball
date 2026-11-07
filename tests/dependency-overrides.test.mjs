import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Exercise npm itself, without fetching packages or executing install scripts.
function inspectTree({ direct = manifest.devDependencies.esbuild, override = manifest.overrides.esbuild, version = manifest.devDependencies.esbuild.replace(/^[~^]/, '') } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'esbuild-override-'));
  const root = { name: 'override-fixture', version: '1.0.0', devDependencies: { esbuild: direct, consumer: '1.0.0' } };
  try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ ...root, overrides: { esbuild: override } }));
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({
      name: root.name, version: root.version, lockfileVersion: 3, requires: true,
      packages: {
        '': root,
        'node_modules/esbuild': { version },
        'node_modules/consumer': { version: '1.0.0', dependencies: { esbuild: '^0.24.0' } },
      },
    }));
    const args = ['ls', '--all', '--package-lock-only', '--json', '--offline', '--ignore-scripts'];
    const result = process.env.npm_execpath
      ? spawnSync(process.execPath, [process.env.npm_execpath, ...args], { cwd: directory, encoding: 'utf8', timeout: 30_000 })
      : spawnSync('npm', args, { cwd: directory, encoding: 'utf8', timeout: 30_000 });
    assert.ifError(result.error);
    return { ...result, tree: JSON.parse(result.stdout) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertHealthy(result, version) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.tree.dependencies.esbuild.version, version);
  const transitive = result.tree.dependencies.consumer.dependencies.esbuild;
  assert.equal(transitive.version, version);
  assert.equal(result.tree.dependencies.esbuild.overridden, true, 'older transitive request must use the root override');
}

test('esbuild retains the existing direct floor and constrains older transitive requests', () => {
  const minimum = manifest.devDependencies.esbuild.replace(/^[~^]/, '');
  assert.match(minimum, /^\d+\.\d+\.\d+$/, 'review complex ranges explicitly');
  const [major, minor, patch] = minimum.split('.').map(Number);
  assert.ok(major > 0 || minor > 28 || (minor === 28 && patch >= 1), 'retain security floor 0.28.1 or newer');
  assertHealthy(inspectTree(), minimum);
  const belowFloor = inspectTree({ version: '0.24.2' });
  assert.equal(belowFloor.status, 1);
  assert.equal(belowFloor.tree.error.code, 'ELSPROBLEMS');
  assert.ok(belowFloor.tree.dependencies.consumer.dependencies.esbuild.invalid.includes(minimum));
});

for (const direct of ['0.28.2', '^0.28.2']) {
  test(`esbuild override follows a simulated updater direct spec ${direct}`, () => {
    assertHealthy(inspectTree({ direct, version: '0.28.2' }), '0.28.2');
  });
  test(`npm rejects the former literal override after direct spec changes to ${direct}`, () => {
    const result = inspectTree({ direct, override: '^0.28.1', version: '0.28.2' });
    assert.equal(result.status, 1);
    assert.equal(result.tree.error.code, 'EOVERRIDE');
    assert.match(result.tree.error.summary, /conflicts with direct dependency/);
  });
}
