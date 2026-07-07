#!/usr/bin/env node
/**
 * lint-colors.mjs — hardcoded-color ratchet.
 *
 * Wave 4 of the 2026-07 design review introduced a semantic token layer
 * (src/styles/tokens.css + docs/DESIGN_SYSTEM.md). A full migration of the
 * ~2.8k pre-existing hardcoded colors is out of scope, so this script is a
 * RATCHET, not a cleanup: every file's current offender count is recorded in
 * scripts/lint-colors-baseline.json, and the lint fails only when a file
 * EXCEEDS its baseline. Counts can only go down over time.
 *
 * What counts as an offender (in src/**\/*.{ts,mts,cts,tsx,css}):
 *   - hex literals    (#abc, #aabbcc, #aabbccdd)
 *   - color functions (rgb/rgba/hsl/hsla)
 *
 * What is allowed (never counted):
 *   - token definition / palette files in ALLOWLIST_FILES
 *   - literals used as var() fallbacks: `var(--sev-high, #ef4444)` — the
 *     house pattern for inline TS styles
 *   - pure-black rgb()/rgba() — box-shadows, scrims, glows: rgba(0, 0, 0, x)
 *   - color functions composed from tokens: rgba(var(--ge-white), 0.5)
 *   - comments
 *
 * Usage:
 *   node scripts/lint-colors.mjs              # full scan vs baseline
 *   node scripts/lint-colors.mjs src/a.ts …   # scan only the given files
 *   node scripts/lint-colors.mjs --update     # rewrite baseline (ratchet
 *                                             # down only; --force to raise)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(repoRoot, 'scripts', 'lint-colors-baseline.json');

const SCAN_ROOT = 'src';
const SCAN_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.tsx', '.css']);

/** Token definition / palette files — colors here ARE the source of truth. */
const ALLOWLIST_FILES = new Set([
  'src/styles/tokens.css',
  'src/styles/visual-semantics.css',
  // Theme palette definition (the "happy" variant's entire look is a palette).
  'src/styles/happy-theme.css',
]);

const SKIP_DIR_NAMES = new Set(['__tests__', 'node_modules']);

const isScannableFile = (relPath) => {
  if (ALLOWLIST_FILES.has(relPath)) return false;
  if (!SCAN_EXTENSIONS.has(path.extname(relPath))) return false;
  if (relPath.endsWith('.d.ts')) return false;
  if (/\.test\.[mc]?tsx?$/u.test(relPath)) return false;
  return true;
};

/** Remove /* … *\/ block comments and whole-line // comments. */
function stripComments(text) {
  let out = '';
  let i = 0;
  for (;;) {
    const start = text.indexOf('/*', i);
    if (start === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, start);
    const end = text.indexOf('*/', start + 2);
    if (end === -1) break; // unterminated comment — drop the rest
    out += ' ';
    i = end + 2;
  }
  return out.replace(/^[ \t]*\/\/.*$/gmu, ' ');
}

/** Remove balanced `var( … )` spans so token fallbacks never count. */
function stripVarCalls(text) {
  let out = '';
  let i = 0;
  for (;;) {
    const start = text.indexOf('var(', i);
    if (start === -1) {
      out += text.slice(i);
      return out;
    }
    out += text.slice(i, start);
    let depth = 0;
    let j = start + 3; // index of '('
    for (; j < text.length; j++) {
      if (text[j] === '(') depth += 1;
      else if (text[j] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out += 'var()';
    i = j >= text.length ? text.length : j + 1;
  }
}

/** Count hardcoded color literals in one file's contents. */
export function countColorLiterals(raw) {
  let text = stripComments(raw);
  // Color functions composed from tokens are fine: rgba(var(--x), 0.4)
  text = text.replace(/\b(?:rgba?|hsla?)\(\s*var\([^)]*\)[^)]*\)/gu, ' ');
  // var() fallbacks are the sanctioned inline-TS pattern.
  text = stripVarCalls(text);
  // Pure-black rgb()/rgba() — shadows, scrims, glows.
  text = text.replace(/\brgba?\(\s*0\s*,\s*0\s*,\s*0\b[^)]*\)/gu, ' ');
  const hex = text.match(/#[0-9a-fA-F]{3,8}\b/gu) ?? [];
  const fn = text.match(/\b(?:rgba?|hsla?)\(/gu) ?? [];
  return hex.length + fn.length;
}

function walk(dirAbs, relBase, found) {
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = relBase === '' ? entry.name : `${relBase}/${entry.name}`;
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR_NAMES.has(entry.name)) walk(abs, rel, found);
    } else if (entry.isFile() && isScannableFile(rel)) {
      found.push(rel);
    }
  }
}

function loadBaseline() {
  if (!fs.existsSync(baselinePath)) return {};
  const parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  return parsed.files ?? {};
}

function collectCounts(fileArgs) {
  let files;
  if (fileArgs.length > 0) {
    files = fileArgs
      .map((f) => path.relative(repoRoot, path.resolve(repoRoot, f)).split(path.sep).join('/'))
      .filter((rel) => isScannableFile(rel) && fs.existsSync(path.join(repoRoot, rel)));
  } else {
    files = [];
    walk(path.join(repoRoot, SCAN_ROOT), SCAN_ROOT, files);
  }
  const counts = new Map();
  for (const rel of files) {
    const n = countColorLiterals(fs.readFileSync(path.join(repoRoot, rel), 'utf8'));
    if (n > 0) counts.set(rel, n);
  }
  return { files, counts };
}

function writeBaseline(baseline, counts, files, partial, force) {
  let raised = 0;
  // Full-scan updates prune deleted/cleaned files; partial (file-arg) updates
  // keep the rest of the baseline untouched.
  const source = partial ? { ...baseline } : {};
  if (partial) for (const rel of files) delete source[rel];
  for (const [rel, n] of counts.entries()) {
    const prev = baseline[rel];
    if (prev !== undefined && n > prev && !force) {
      console.error(`[lint:colors] refusing to raise baseline for ${rel} (${prev} -> ${n}); use --force if intentional.`);
      raised += 1;
      source[rel] = prev;
    } else {
      source[rel] = n;
    }
  }
  const next = {};
  for (const key of Object.keys(source).sort()) next[key] = source[key];
  fs.writeFileSync(
    baselinePath,
    `${JSON.stringify({ note: 'Per-file hardcoded-color counts. Managed by scripts/lint-colors.mjs --update. Counts may only decrease.', files: next }, null, 2)}\n`,
  );
  const total = Object.values(next).reduce((a, b) => a + b, 0);
  console.log(`[lint:colors] Baseline written: ${Object.keys(next).length} files, ${total} literals.`);
  return raised;
}

function runCli() {
  const argv = process.argv.slice(2);
  const update = argv.includes('--update');
  const force = argv.includes('--force');
  const fileArgs = argv.filter((a) => !a.startsWith('--'));
  const { files, counts } = collectCounts(fileArgs);
  const baseline = loadBaseline();

  if (update) {
    const raised = writeBaseline(baseline, counts, files, fileArgs.length > 0, force);
    process.exitCode = raised > 0 ? 1 : 0;
    return;
  }

  const violations = [];
  let improved = 0;
  for (const [rel, n] of counts.entries()) {
    const allowed = baseline[rel] ?? 0;
    if (n > allowed) violations.push({ rel, allowed, n });
    else if (n < allowed) improved += 1;
  }
  if (violations.length > 0) {
    console.error('[lint:colors] New hardcoded colors detected (use tokens from src/styles/tokens.css — see docs/DESIGN_SYSTEM.md):');
    for (const v of violations.sort((a, b) => a.rel.localeCompare(b.rel))) {
      console.error(`  ${v.rel}: ${v.n} literals (baseline ${v.allowed})`);
    }
    console.error('[lint:colors] Prefer var(--token, #fallback); rgba(0,0,0,…) shadows are exempt.');
    console.error('[lint:colors] If a file was legitimately reworked, refresh with: node scripts/lint-colors.mjs --update');
    process.exitCode = 1;
  } else {
    const scannedTotal = [...counts.values()].reduce((a, b) => a + b, 0);
    const suffix = improved > 0 ? ` ${improved} file(s) improved — consider --update to ratchet the baseline down.` : '';
    console.log(`[lint:colors] OK — ${counts.size} files with ${scannedTotal} baselined literals, none exceeded.${suffix}`);
    process.exitCode = 0;
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) runCli();
