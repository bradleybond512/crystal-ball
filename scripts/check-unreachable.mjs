#!/usr/bin/env node
// Reports frontend source files that no app entry point can reach.
//
// A file can be merged, unit-tested and marked shipped while nothing in the
// running app imports it. Reviews look at the diff and unit tests exercise a
// module in isolation, so neither notices. This walks the import graph from
// the real entry points and compares the unreachable set with a baseline:
//
//   - a file that is unreachable and NOT in the baseline fails the check;
//   - a baseline entry that became reachable, or was deleted, must be removed
//     from the baseline (the baseline can only shrink).
//
// Limits: this is file-level. It cannot see an export that is never called
// from a reachable file, and a type-only import does not count as a use.
//
// Usage:
//   node scripts/check-unreachable.mjs            check against the baseline
//   node scripts/check-unreachable.mjs --list     print the unreachable files
//   node scripts/check-unreachable.mjs --update   rewrite the baseline
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE_FILE = 'scripts/unreachable-baseline.json';
const SOURCE_ROOT = 'src';
const HTML_ENTRIES = ['index.html', 'settings.html', 'live-channels.html'];
const SOURCE_EXT = /\.(ts|tsx|mts)$/;
const SKIPPED_DIRS = new Set(['__tests__', 'generated', 'e2e']);

const TYPE_ONLY_IMPORT = /import\s+type\s[^;]*?from\s*['"][^'"]+['"];?/gs;
const TYPE_ONLY_EXPORT = /export\s+type\s[^;]*?from\s*['"][^'"]+['"];?/gs;
const SPECIFIER = /(?:from\s*|import\s*\(\s*|import\s+|new URL\(\s*|require\(\s*)['"]([^'"]+)['"]/g;

const toPosix = (p) => p.split(path.sep).join('/');

/** Every non-test source file under src/, repo-relative with forward slashes. */
export function listSourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(rel);
      } else if (SOURCE_EXT.test(entry.name) && !entry.name.endsWith('.d.ts') && !entry.name.includes('.test.')) {
        out.push(rel);
      }
    }
  };
  if (existsSync(path.join(root, SOURCE_ROOT))) walk(SOURCE_ROOT);
  return out.sort();
}

function resolveSpecifier(specifier, fromFile, known) {
  let base;
  if (specifier.startsWith('@/')) base = `${SOURCE_ROOT}/${specifier.slice(2)}`;
  else if (specifier.startsWith('.')) base = toPosix(path.posix.normalize(`${path.posix.dirname(fromFile)}/${specifier}`));
  else if (specifier.startsWith(`/${SOURCE_ROOT}/`)) base = specifier.slice(1);
  else return null;
  const query = base.indexOf('?');
  if (query !== -1) base = base.slice(0, query);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}/index.ts`,
    base.replace(/\.(js|mjs)$/, '.ts'),
  ];
  return candidates.find((c) => known.has(c)) ?? null;
}

/** Entry points: the script each HTML page loads, plus every worker module. */
export function findEntries(root, files) {
  const known = new Set(files);
  const entries = new Set(files.filter((f) => f.includes('/workers/')));
  for (const html of HTML_ENTRIES) {
    const file = path.join(root, html);
    if (!existsSync(file)) continue;
    for (const match of readFileSync(file, 'utf8').matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
      const resolved = resolveSpecifier(match[1], html, known);
      if (resolved) entries.add(resolved);
    }
  }
  return [...entries].sort();
}

/** Files under src/ that no entry point reaches through a value import. */
export function findUnreachable(root) {
  const files = listSourceFiles(root);
  const known = new Set(files);
  const edges = new Map();
  for (const file of files) {
    const text = readFileSync(path.join(root, file), 'utf8')
      .replace(TYPE_ONLY_IMPORT, '')
      .replace(TYPE_ONLY_EXPORT, '');
    const targets = new Set();
    for (const match of text.matchAll(SPECIFIER)) {
      const resolved = resolveSpecifier(match[1], file, known);
      if (resolved) targets.add(resolved);
    }
    edges.set(file, targets);
  }
  const entries = findEntries(root, files);
  const seen = new Set();
  const stack = [...entries];
  while (stack.length > 0) {
    const next = stack.pop();
    if (seen.has(next)) continue;
    seen.add(next);
    for (const target of edges.get(next) ?? []) stack.push(target);
  }
  return { files, entries, unreachable: files.filter((f) => !seen.has(f)) };
}

/** Compare the unreachable set with the baseline. Pure. */
export function compareWithBaseline(unreachable, baseline) {
  const current = new Set(unreachable);
  const allowed = new Set(baseline);
  return {
    newlyUnreachable: unreachable.filter((f) => !allowed.has(f)),
    staleBaseline: baseline.filter((f) => !current.has(f)),
  };
}

export function readBaseline(root) {
  const file = path.join(root, BASELINE_FILE);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed.files) ? parsed.files.filter((f) => typeof f === 'string') : [];
}

function main(argv) {
  const root = process.cwd();
  const { files, entries, unreachable } = findUnreachable(root);
  if (entries.length === 0) {
    console.error('[unreachable] no entry points found; refusing to report every file as unreachable.');
    return 2;
  }
  if (argv.includes('--list')) {
    for (const file of unreachable) console.log(file);
    return 0;
  }
  if (argv.includes('--update')) {
    const body = {
      note: 'Source files no app entry point reaches. This list may only shrink: connect a file or delete it, then remove its line. See scripts/check-unreachable.mjs.',
      files: unreachable,
    };
    writeFileSync(path.join(root, BASELINE_FILE), `${JSON.stringify(body, null, 2)}\n`);
    console.log(`[unreachable] baseline written: ${unreachable.length} file(s).`);
    return 0;
  }
  const { newlyUnreachable, staleBaseline } = compareWithBaseline(unreachable, readBaseline(root));
  console.log(`[unreachable] ${files.length} source file(s), ${entries.length} entry point(s), ${unreachable.length} unreachable.`);
  for (const file of newlyUnreachable) {
    console.error(`[unreachable] NEW: ${file} is not reachable from any app entry point. Import it where it is used, or delete it.`);
  }
  for (const file of staleBaseline) {
    console.error(`[unreachable] STALE: ${file} is now reachable or deleted. Remove it from ${BASELINE_FILE}.`);
  }
  return newlyUnreachable.length > 0 || staleBaseline.length > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
