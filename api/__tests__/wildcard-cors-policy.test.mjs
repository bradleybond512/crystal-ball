/**
 * Wildcard-CORS policy test (closes the enforcement gap in R2-SEC-010).
 *
 * Any api/ endpoint that sets a literal `Access-Control-Allow-Origin: *`
 * must carry a `PUBLIC_WILDCARD_CORS` justification comment in the same
 * file (see api/version.js for the canonical annotation). This test walks
 * every source file under api/ and fails when a wildcard appears without
 * the annotation — so a copy-pasted `*` on an endpoint that returns user
 * data or accepts auth becomes a CI failure, not a silent regression.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SOURCE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts']);
const ANNOTATION = 'PUBLIC_WILDCARD_CORS';

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    const dot = entry.lastIndexOf('.');
    if (dot === -1) continue;
    if (entry.includes('.test.')) continue;
    if (SOURCE_EXT.has(entry.slice(dot))) out.push(full);
  }
  return out;
}

// Matches a literal wildcard assignment to the CORS origin header, e.g.
//   'Access-Control-Allow-Origin': '*'
//   setHeader('Access-Control-Allow-Origin', '*')
//   headers.set('Access-Control-Allow-Origin', "*")
const WILDCARD_ORIGIN = /Access-Control-Allow-Origin['"]?\s*[,:]\s*['"`]\*['"`]/;

test('every literal wildcard CORS origin in api/ carries a PUBLIC_WILDCARD_CORS annotation', () => {
  const offenders = [];
  const annotated = [];
  for (const file of sourceFiles(API_ROOT)) {
    const text = readFileSync(file, 'utf8');
    if (!WILDCARD_ORIGIN.test(text)) continue;
    const rel = relative(API_ROOT, file);
    if (text.includes(ANNOTATION)) annotated.push(rel);
    else offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `Wildcard Access-Control-Allow-Origin without a ${ANNOTATION} justification comment in: ` +
      `${offenders.join(', ')}. Either scope the origin or document the exception ` +
      `(see api/version.js).`,
  );
  // Guard the guard: the canonical annotated exception must stay detectable,
  // otherwise a regex drift would silently stop scanning anything.
  assert.ok(
    annotated.includes('version.js'),
    'api/version.js should be detected as the annotated wildcard-CORS exception',
  );
});
