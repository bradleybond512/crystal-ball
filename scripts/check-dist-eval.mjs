#!/usr/bin/env node
// R3-SEC-004 build gate: the CSP no longer allows 'unsafe-eval', so no
// main-thread chunk may contain an eval-family construct. Workers that keep a
// guarded fallback are listed below with the reason they are acceptable.
// Runs after every `vite build` (closeBundle hook in vite.config.ts) and as a
// CLI: `node scripts/check-dist-eval.mjs [distDir]`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EVAL_PATTERNS = [
  { name: 'new Function', re: /\bnew\s+Function\s*\(/ },
  // Any call of the global Function constructor, whatever its arguments.
  { name: 'Function(…)', re: /(?<![\w$.])Function\s*\(/ },
  { name: 'Function.apply', re: /(?<![\w$.])Function\.(?:apply|call)\s*\(/ },
  { name: 'indirect eval', re: /\(\s*0\s*,\s*eval\s*\)/ },
  { name: 'eval(', re: /(?<![\w$.])eval\s*\(/ },
  { name: 'global eval', re: /\b(?:globalThis|window|self)\.eval\s*\(/ },
  { name: 'string timer', re: /\bset(?:Timeout|Interval)\s*\(\s*["'`]/ },
];

/**
 * Reviewed main-thread constructs that are present in library code but never
 * reached in a browser, matched by their exact surrounding code so any other
 * eval in the same chunk still fails the gate.
 */
export const GUARDED_MAIN_THREAD = [
  {
    name: 'globalThis polyfill fallback',
    // `typeof globalThis=="object"&&globalThis … ||(function(){return this})()||Function("return this")()`
    re: /typeof globalThis==(["'`])object\1&&globalThis\)[\s\S]{0,200}?\|\|\(function\(\)\{return this\}\)\(\)\|\|Function\((["'`])return this\2\)\(\)/g,
    reason: 'the first operand (globalThis) is always defined in a supported webview',
  },
  {
    name: 'Knockout parseJson fallback',
    // `x&&x.parse?x.parse(e):Function("return "+e)()` — JSON always exists.
    // Bounded identifiers anchored at a word start keep this linear.
    re: /(?<![\w$])([\w$]{1,64})&&\1\.parse\?\1\.parse\(([\w$]{1,64})\):Function\((["'`])return \3\+\2\)\(\)/g,
    reason: 'Knockout uses JSON.parse whenever window.JSON exists, which it always does',
  },
  {
    name: 'Knockout data-bind compiler',
    // `Function("$context","$element",code)` — runs only for data-bind markup.
    re: /Function\((["'`])\$context\1,\s*(["'`])\$element\2,\s*[\w$]+\)/g,
    reason: 'only Cesium widgets apply Knockout bindings, and CesiumGlobe disables every one of them '
      + '(pinned by tests/csp-eval-gate.test.mjs)',
  },
];

/** Reviewed worker exceptions: path pattern (relative to dist, POSIX) + why. */
export const WORKER_ALLOWLIST = [
  { re: /^cesium\/Workers\/[\w.-]+\.js$/, reason: 'Cesium web workers: protobuf `inquire` eval inside try/catch; workers do not run main-document scripts' },
  { re: /^assets\/ml\.worker-[\w-]+\.js$/, reason: 'ML worker: `new Function("return this")` only when globalThis is missing' },
  { re: /^assets\/maplibre-gl-worker-[\w-]+\.js$/, reason: 'MapLibre worker: `globalThis.eval` only if a blob import() of the RTL plugin fails' },
];

export function findEvalConstructs(rawSource) {
  let source = rawSource;
  for (const { re } of GUARDED_MAIN_THREAD) source = source.replace(re, '/*guarded*/');
  const hits = [];
  for (const { name, re } of EVAL_PATTERNS) {
    const match = re.exec(source);
    if (match) {
      const start = Math.max(0, match.index - 40);
      hits.push({ name, snippet: source.slice(start, match.index + 60).replaceAll(/\s+/g, ' ') });
    }
  }
  return hits;
}

export function allowlistedWorker(relativePath) {
  const posix = relativePath.split(path.sep).join('/');
  return WORKER_ALLOWLIST.find(({ re }) => re.test(posix)) ?? null;
}

function* scripts(dir, root = dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* scripts(full, root);
    else if (/\.(?:m?js)$/.test(name)) yield path.relative(root, full);
  }
}

export function checkDist(distDir) {
  const violations = [];
  const allowed = [];
  for (const rel of scripts(distDir)) {
    const hits = findEvalConstructs(readFileSync(path.join(distDir, rel), 'utf8'));
    if (hits.length === 0) continue;
    const exception = allowlistedWorker(rel);
    if (exception) allowed.push({ file: rel, hits, reason: exception.reason });
    else violations.push({ file: rel, hits });
  }
  return { violations, allowed };
}

export function formatReport({ violations, allowed }) {
  const lines = [];
  for (const { file, hits } of violations) {
    lines.push(`✗ ${file}`);
    for (const { name, snippet } of hits) lines.push(`    ${name}: …${snippet}…`);
  }
  if (violations.length > 0) {
    lines.push(
      '',
      "The CSP has no 'unsafe-eval' (R3-SEC-004). Remove the construct, rewrite it at build time",
      '(see cspSafeGlobalThisPlugin), or, for a worker only, add a reviewed WORKER_ALLOWLIST entry.',
    );
  }
  for (const { file, reason } of allowed) lines.push(`· ${file} (allowed worker: ${reason})`);
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const distDir = path.resolve(process.argv[2] ?? 'dist');
  const result = checkDist(distDir);
  const report = formatReport(result);
  if (report) console.log(report);
  if (result.violations.length > 0) process.exit(1);
  console.log(`[check-dist-eval] OK — no eval-family construct in main-thread chunks (${result.allowed.length} reviewed worker exception(s)).`);
}
