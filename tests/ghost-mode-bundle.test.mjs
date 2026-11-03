import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { SourceTextModule } from 'node:vm';

const dist = resolve('dist');
const assets = join(dist, 'assets');
const safeChunks = [
  'modulepreload-polyfill', 'preload-helper', 'rolldown-runtime',
  'mode-preference', 'ghost-notice-copy', 'GhostModeNotice', 'NotificationStack',
];

// Follow the emitted static imports. Dynamic imports of the application are safe
// here because the entry checks the preference before requesting them.
function assertSafeImports(entry) {
  const queue = [entry];
  const seen = new Set();
  for (const file of queue) {
    if (seen.has(file)) continue;
    seen.add(file);
    const source = new SourceTextModule(readFileSync(file, 'utf8'));
    for (const specifier of source.dependencySpecifiers) {
      const name = basename(specifier);
      assert.ok(safeChunks.some(chunk => name.startsWith(chunk + '-')),
        `${basename(file)} eagerly imports ${name} before the mode choice`);
      queue.push(resolve(dirname(file), specifier));
    }
  }
}

test('the built document can check mode before loading application dependencies', () => {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const entry = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/);
  assert.ok(entry, 'expected a built module entry');
  assertSafeImports(join(dist, entry[1]));
});

test('the built recovery notice can load before storage-dependent panels', () => {
  const entries = readdirSync(assets).filter(file => /^ghost-mode-notice-.+\.js$/.test(file));
  assert.equal(entries.length, 1);
  assertSafeImports(join(assets, entries[0]));
});
