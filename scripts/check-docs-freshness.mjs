#!/usr/bin/env node
/* eslint-disable sonarjs/cognitive-complexity, sonarjs/no-os-command-from-path, sonarjs/slow-regex, unicorn/prefer-number-properties, unicorn/import-style -- dev-tooling script: git on PATH is intentional, complexity is fine for a one-shot CLI. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  const p = resolve(root, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function countInBlock(src, startRe, endRe, lineRe) {
  const lines = src.split('\n');
  let inside = false;
  let count = 0;
  for (const line of lines) {
    if (!inside && startRe.test(line)) { inside = true; continue; }
    if (inside && endRe.test(line)) break;
    if (inside && lineRe.test(line)) count++;
  }
  return count;
}

function countFullPanels() {
  const src = read('src/config/panels.ts');
  if (!src) return null;
  return countInBlock(src, /^const FULL_PANELS/, /^};/, /enabled:/);
}

function countMapLayers() {
  const src = read('src/config/panels.ts');
  if (!src) return null;
  return countInBlock(src, /^const FULL_MAP_LAYERS/, /^};/, /:\s*(true|false)/);
}

function countVariantPanels(variant) {
  const src = read('src/config/panels.ts');
  if (!src) return null;
  return countInBlock(src, new RegExp(`^const ${variant}`), /^};/, /enabled:/);
}

function countSecretKeys() {
  const src = read('src-tauri/src/main.rs');
  if (!src) return null;
  const match = src.match(/SUPPORTED_SECRET_KEYS:\s*\[&str;\s*(\d+)\]/);
  if (match) return parseInt(match[1], 10);
  const block = src.match(/SUPPORTED_SECRET_KEYS[^[]*\[([\s\S]*?)\]/);
  if (!block) return null;
  return (block[1].match(/"/g) || []).length / 2;
}

function countLocales() {
  try {
    const files = execFileSync('find', [resolve(root, 'src/locales'), '-name', '*.json', '-maxdepth', '1'], {
      encoding: 'utf8',
    });
    return files.split('\n').filter(Boolean).length || null;
  } catch { return null; }
}

function checkReadme() {
  const readme = read('README.md');
  if (!readme) return [];
  const issues = [];

  const panelMatch = readme.match(/Default panel inventory\s*\|\s*`?\s*(\d+)\s*full\s*\/\s*(\d+)\s*tech\s*\/\s*(\d+)\s*finance\s*\/\s*(\d+)\s*happy/);
  if (panelMatch) {
    const stated = { full: +panelMatch[1], tech: +panelMatch[2], finance: +panelMatch[3], happy: +panelMatch[4] };
    const actual = {
      full: countFullPanels(),
      tech: countVariantPanels('TECH_PANELS'),
      finance: countVariantPanels('FINANCE_PANELS'),
      happy: countVariantPanels('HAPPY_PANELS'),
    };
    for (const [k, v] of Object.entries(actual)) {
      if (v != null && stated[k] !== v) {
        issues.push(`README says ${stated[k]} ${k} panels, code has ${v}`);
      }
    }
  }

  const layerMatch = readme.match(/God's Vision map layers\s*\|\s*(\d+)/);
  if (layerMatch) {
    const stated = +layerMatch[1];
    const actual = countMapLayers();
    if (actual != null && stated !== actual) {
      issues.push(`README says ${stated} map layers, code has ${actual}`);
    }
  }

  const keyMatch = readme.match(/Supported secret keys\s*\|\s*(\d+)/);
  if (keyMatch) {
    const stated = +keyMatch[1];
    const actual = countSecretKeys();
    if (actual != null && stated !== actual) {
      issues.push(`README says ${stated} secret keys, main.rs has ${actual}`);
    }
  }

  const localeMatch = readme.match(/Locales\s*\|\s*(\d+)/);
  if (localeMatch) {
    const stated = +localeMatch[1];
    const actual = countLocales();
    if (actual != null && stated !== actual) {
      issues.push(`README says ${stated} locales, src/locales/ has ${actual}`);
    }
  }

  return issues;
}

function secretKeyNames() {
  const src = read('src-tauri/src/main.rs');
  if (!src) return [];
  const block = src.match(/SUPPORTED_SECRET_KEYS[^=]*=\s*\[([\s\S]*?)\];/);
  if (!block) return [];
  return [...block[1].matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]);
}

function checkApiKeysDocs() {
  const issues = [];
  const apiKeysDoc = read('docs/API_KEYS.md');
  if (!apiKeysDoc) return issues;

  const actual = countSecretKeys();
  const docKeyMatch = apiKeysDoc.match(/(\d+)\s*(API|secret)\s*key/i)
    || apiKeysDoc.match(/All\s+(\d+)/i);
  if (docKeyMatch && actual != null) {
    const stated = +docKeyMatch[1];
    if (stated !== actual) {
      issues.push(`docs/API_KEYS.md references ${stated} keys, main.rs has ${actual}`);
    }
  }

  // Coverage: every SUPPORTED_SECRET_KEYS entry must appear somewhere in the doc.
  const undocumented = secretKeyNames().filter((k) => !new RegExp(String.raw`\b${k}\b`).test(apiKeysDoc));
  if (undocumented.length) {
    issues.push(`docs/API_KEYS.md is missing ${undocumented.length} key(s): ${undocumented.join(', ')}`);
  }
  return issues;
}

function checkChangelog() {
  const issues = [];
  const changelog = read('CHANGELOG.md');
  if (!changelog) return issues;

  try {
    const recent = execFileSync('git', ['log', '--oneline', '-10', '--first-parent', 'HEAD'], {
      cwd: root, encoding: 'utf8',
    });
    for (const line of recent.split('\n').filter(Boolean)) {
      // Only the trailing squash-merge suffix "(#1234)" is a real PR number;
      // an in-subject "#8" (e.g. "round-2 #8") is a cross-reference, not a PR.
      const prMatch = line.match(/\(#(\d+)\)\s*$/);
      if (prMatch && !changelog.includes(`#${prMatch[1]}`)) {
        issues.push(`PR #${prMatch[1]} not in CHANGELOG: ${line.trim()}`);
      }
    }
  } catch { /* skip if git fails */ }
  return issues;
}

function detectChangedCategories() {
  let diff;
  try {
    diff = execFileSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], {
      cwd: root, encoding: 'utf8',
    });
  } catch {
    try {
      diff = execFileSync('git', ['diff', '--cached', '--name-only'], {
        cwd: root, encoding: 'utf8',
      });
    } catch { return { categories: [], hints: [] }; }
  }

  const files = diff.split('\n').filter(Boolean);
  const categories = new Set();
  const hints = [];

  for (const f of files) {
    if (f.startsWith('src/services/')) categories.add('services');
    if (f.startsWith('src/components/')) categories.add('components');
    if (f.startsWith('src/config/')) categories.add('config');
    if (f.startsWith('src/types/')) categories.add('types');
    if (f.startsWith('src-tauri/sidecar/')) categories.add('sidecar');
    if (f.startsWith('src-tauri/src/')) categories.add('tauri-core');
    if (f.endsWith('.proto')) categories.add('proto');
    if (f.startsWith('tests/') || f.startsWith('e2e/')) categories.add('tests');

    if (f === 'src/config/panels.ts') hints.push('Panel config changed — check README panel counts');
    if (f === 'src-tauri/src/main.rs') hints.push('main.rs changed — check secret key counts in README + API_KEYS.md');
    if (f.endsWith('.proto')) hints.push('Proto file changed — OpenAPI specs may need regeneration');
    if (f.startsWith('src/types/')) hints.push('Types changed — architecture docs may need review');
    if (/sidecar|main\.rs|capabilities/.test(f)) hints.push(`Security-relevant file changed (${f}) — review SECURITY.md if it exists`);
  }

  return { categories: [...categories], hints: [...new Set(hints)] };
}

// --- Run ---
const readmeIssues = checkReadme();
const apiKeysIssues = checkApiKeysDocs();
const changelogIssues = checkChangelog();
const { categories = [], hints = [] } = detectChangedCategories();

// The CHANGELOG check flags every merged PR whose number is absent from
// CHANGELOG.md. Nothing writes those entries automatically — `release:prepare`
// does not touch CHANGELOG.md — so the backlog belongs to whoever merged those
// PRs, not to the branch running this check, and it was 10 deep on a pristine
// `main`. `--changelog-advisory` still reports it but keeps it out of the exit
// code, so the structural checks below stay blocking on their own merits.
const changelogAdvisory = process.argv.includes('--changelog-advisory');
const advisoryIssues = changelogAdvisory ? changelogIssues : [];
const allIssues = [...readmeIssues, ...apiKeysIssues, ...(changelogAdvisory ? [] : changelogIssues)];
const needsUpdate = allIssues.length > 0;

const result = {
  needsUpdate,
  staleCount: allIssues.length,
  issues: allIssues,
  // Key present only under the flag: bare --json output is a pre-existing
  // contract and must stay byte-shape identical.
  ...(changelogAdvisory ? { advisoryIssues } : {}),
  changedCategories: categories,
  hints,
  summary: needsUpdate
    ? `${allIssues.length} doc(s) may be stale`
    : 'Documentation appears fresh',
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (needsUpdate) {
    console.log('[docs:check] Documentation may be stale:');
    for (const issue of allIssues) console.log(`  - ${issue}`);
  } else {
    console.log('[docs:check] Documentation appears fresh.');
  }
  if (advisoryIssues.length > 0) {
    console.log('[docs:check] Advisory (not blocking) — CHANGELOG entries owed by earlier merges:');
    for (const issue of advisoryIssues) console.log(`  - ${issue}`);
  }
  if (hints.length > 0) {
    console.log('[docs:check] Hints from recent changes:');
    for (const hint of hints) console.log(`  - ${hint}`);
  }
}

process.exit(needsUpdate ? 1 : 0);
