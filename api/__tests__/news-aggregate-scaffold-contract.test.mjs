/**
 * News-aggregate scaffold contract gate — per
 * docs/CLAUDE_EXTRA_BUG_SECURITY_CHECKS_2026-04-29.md Priority 2.
 *
 * /api/news-aggregate is intentionally a scaffold; it returns a valid
 * shape with `scaffold: true, items: []`. The doc requires:
 *   1. The scaffold response cannot silently count as "has news data."
 *   2. Any future renderer caller must check `scaffold` and degrade.
 *   3. The panel smoke / data smoke must not render scaffold output
 *      as if it were live data.
 *
 * This file enforces (1)+(2) at the contract level. It runs as part
 * of `npm run test:api`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');

test('news-aggregate scaffold response shape exposes scaffold:true', () => {
  // Inspect the source file rather than invoking the edge runtime —
  // this test runs under plain Node and the handler depends on
  // `Ratelimit` / Edge globals. The contract we care about is "the
  // scaffold response shape always carries scaffold:true so callers
  // can branch on it."
  const src = readFileSync(path.join(projectRoot, 'api', 'news-aggregate.js'), 'utf8');
  assert.match(src, /scaffold:\s*true/, 'scaffold flag must be present');
  assert.match(src, /items:\s*\[\]/, 'scaffold items array must be empty');
  assert.match(src, /contractVersion/, 'scaffold response must declare contractVersion for forward-compat');
});

test('no renderer source file silently consumes /api/news-aggregate', () => {
  // Walk src/ for any reference. If a future PR adds a caller, this
  // test will fail unless that caller also carries a "scaffold"
  // branch — see the next test below.
  function* walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) yield* walk(full);
      else if (/\.(?:ts|tsx|mts|js|mjs)$/.test(entry.name)) yield full;
    }
  }
  const srcDir = path.join(projectRoot, 'src');
  const callers = [];
  for (const file of walk(srcDir)) {
    const text = readFileSync(file, 'utf8');
    if (text.includes('/api/news-aggregate')) {
      callers.push(path.relative(projectRoot, file));
    }
  }
  if (callers.length > 0) {
    // If a caller appears, it MUST also reference `scaffold` so the
    // branch on the response is wired. Fail otherwise.
    for (const c of callers) {
      const text = readFileSync(path.join(projectRoot, c), 'utf8');
      assert.match(
        text,
        /scaffold/,
        `Caller ${c} consumes /api/news-aggregate but never branches on the scaffold flag.\n` +
          `Add a check like: if (response.scaffold) { /* fall back to live feeds OR show degraded */ }`,
      );
    }
  }
});

test('scaffold flag name is stable — protects future callers', () => {
  // Belt-and-suspenders: a future refactor that renames `scaffold`
  // to e.g. `placeholder` would silently break the gate above. Pin
  // the literal string name here so a rename forces an explicit
  // update to this test.
  const src = readFileSync(path.join(projectRoot, 'api', 'news-aggregate.js'), 'utf8');
  // The exact key must be "scaffold" (lowercase, no synonyms).
  // Match either object-literal `scaffold:` or quoted form.
  const hasField = /\bscaffold:\s*true/.test(src) || /['"]scaffold['"]:\s*true/.test(src);
  assert.ok(hasField, 'news-aggregate must continue to use the field name "scaffold"');
});
