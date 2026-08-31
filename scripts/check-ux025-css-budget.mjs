import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CSS_GZIP_BUDGET_BYTES = 10_240;

export function parseCssBudgetArgs(argv) {
  const [mode, ...rest] = argv;
  if (!['capture', 'compare'].includes(mode)) throw new Error('usage: check-ux025-css-budget.mjs <capture|compare> [options]');
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`missing value for ${key ?? 'option'}`);
    values[key.slice(2)] = value;
  }
  if (mode === 'capture' && (!values.dist || !values.output)) throw new Error('capture requires --dist and --output');
  if (mode === 'compare' && (!values.baseline || !values.candidate)) throw new Error('compare requires --baseline and --candidate');
  return { mode, ...values };
}

export function discoverCssAssets(dist) {
  const root = path.resolve(dist);
  const found = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const assetPath = path.resolve(directory, name);
      const stat = statSync(assetPath);
      if (stat.isDirectory()) visit(assetPath);
      else if (name.endsWith('.css')) found.push(assetPath);
    }
  };
  visit(root);
  return found.sort().map((assetPath) => {
    const bytes = readFileSync(assetPath);
    return { path: path.relative(root, assetPath), bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
  });
}

function currentSha() {
  const result = spawnSync('/usr/bin/git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git rev-parse failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

export function buildCssManifest(dist, metadata = {}) {
  const assets = discoverCssAssets(dist);
  if (assets.length === 0) throw new Error(`no built CSS assets found under ${path.resolve(dist)}`);
  return {
    schemaVersion: 1,
    kind: 'ux025-css-budget',
    commit: metadata.commit ?? currentSha(),
    capturedAt: metadata.capturedAt ?? new Date().toISOString(),
    dist: path.resolve(dist),
    assets,
    totals: {
      bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
      gzipBytes: assets.reduce((sum, asset) => sum + asset.gzipBytes, 0),
    },
  };
}

export function compareCssManifests(baseline, candidate, budgetBytes = CSS_GZIP_BUDGET_BYTES) {
  for (const [label, manifest] of Object.entries({ baseline, candidate })) {
    if (manifest?.schemaVersion !== 1 || manifest?.kind !== 'ux025-css-budget' || !Number.isFinite(manifest?.totals?.gzipBytes)) {
      throw new Error(`${label} is not a UX-025 CSS manifest`);
    }
  }
  const addedGzipBytes = candidate.totals.gzipBytes - baseline.totals.gzipBytes;
  return { budgetBytes, addedGzipBytes, pass: addedGzipBytes <= budgetBytes };
}

function writeJson(outputPath, value) {
  mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  writeFileSync(path.resolve(outputPath), `${JSON.stringify(value, null, 2)}\n`);
}

export function runCssBudgetCli(argv) {
  const args = parseCssBudgetArgs(argv);
  if (args.mode === 'capture') {
    const manifest = buildCssManifest(args.dist);
    writeJson(args.output, manifest);
    return manifest;
  }
  const baseline = JSON.parse(readFileSync(path.resolve(args.baseline), 'utf8'));
  const candidate = JSON.parse(readFileSync(path.resolve(args.candidate), 'utf8'));
  const comparison = compareCssManifests(baseline, candidate);
  if (args.output) writeJson(args.output, { schemaVersion: 1, kind: 'ux025-css-comparison', ...comparison });
  if (!comparison.pass) throw new Error(`CSS gzip budget exceeded: +${comparison.addedGzipBytes} > ${comparison.budgetBytes} bytes`);
  return comparison;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(runCssBudgetCli(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
