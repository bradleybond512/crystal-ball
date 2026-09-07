/**
 * Per-chunk bundle-size budgets. Acts as a regression gate so a future PR
 * cannot quietly re-inflate the chunks we just split apart.
 *
 * Budgets are set at "current gzipped size + ~10% slack" — the slack lets
 * unrelated PRs add small dependencies without tripping the gate, but a
 * mistakenly-static-imported heavyweight module (the failure mode that
 * brought panels.js to 629 KB) will blow through any of these.
 *
 * Skips automatically when `dist/assets/` is missing so the data tests can
 * run on a fresh clone without first invoking `npm run build`. Builds in
 * CI run `npm run build` before `npm run test:data`, so the check fires
 * there.
 *
 * To tighten budgets after a successful trim: drop the relevant value here
 * to the new current + 10%, never the other direction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveManifestChunkFile } from '../scripts/bundle-budget-policy.mjs';

const projectRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const distAssets = path.join(projectRoot, 'dist', 'assets');
const manifestPath = path.join(projectRoot, 'dist', '.vite', 'manifest.json');

// Budgets in BYTES, gzipped. Comments record the size at the time the
// budget was set (2026-05-12, PR for bundle optimisation).
const BUDGETS = {
  // Main entry — current 431 KB after the feature wave. Budget 475 KB.
  main: 475 * 1024,
  // Catch-all panels chunk — was 1178 KB before analysis split; now 1009 KB. Budget 1155 KB.
  panels: 1155 * 1024,
  // Analysis / cognition panels split from the catch-all. Current 202 KB; budget 225 KB.
  'panels-analysis': 225 * 1024,
  // News / intel-feed panels — was 132 KB; now 157 KB. Budget 175 KB.
  'panels-feeds': 175 * 1024,
  // OSINT / cyber / sanctions — was 41 KB; now 67 KB. Budget 75 KB.
  'panels-security': 75 * 1024,
  // Alert / notification / watchlist / situation — current 95 KB. Budget 105 KB.
  'panels-alerts': 105 * 1024,
  // Quote / wisdom panels — new chunk, 42 KB. Budget 55 KB.
  'panels-wisdom': 55 * 1024,
  // Diagnostic / admin panels — was 36 KB. Budget 50 KB.
  'panels-diagnostic': 50 * 1024,
  // Markets / finance panels — was 19 KB; now 36 KB. Budget 40 KB.
  'panels-markets': 40 * 1024,
  // Hazards / weather / disaster panels — current 44 KB. Budget 48 KB.
  'panels-hazards': 48 * 1024,
  // Military / strike / kill-chain panels — new chunk, 17 KB.
  'panels-military': 30 * 1024,
  // Aviation / maritime / vessel — new chunk, 15 KB.
  'panels-transit': 30 * 1024,
  // Webcam panels — new chunk, 11 KB.
  'panels-webcams': 25 * 1024,
  // DeckGLMap — split out of main, 41 KB. Budget 55 KB.
  DeckGLMap: 55 * 1024,
  // God's Vision globe view — Cesium-heavy, 1119 KB. Budget 1230 KB.
  // Removing more requires either a strict-CSP Cesium build or a non-eval
  // globe library; tracked in docs/CSP_AUDIT.md.
  GodsVisionView: 1230 * 1024,
};

function gzipBytes(relativePath) {
  const raw = readFileSync(path.join(projectRoot, 'dist', relativePath));
  return gzipSync(raw).length;
}

const haveAssets = existsSync(distAssets);
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : null;

test('bundle-size: production build emits a Vite manifest', (t) => {
  if (!haveAssets) {
    t.skip('dist/assets missing — run `npm run build` first');
    return;
  }
  assert.ok(manifest, 'dist/.vite/manifest.json is missing — build must emit exact chunk identities');
});

for (const [chunkName, budget] of Object.entries(BUDGETS)) {
  test(`bundle-size: ${chunkName} ≤ ${(budget / 1024).toFixed(0)} KB gz`, (t) => {
    if (!haveAssets) {
      t.skip('dist/assets missing — run `npm run build` first');
      return;
    }
    if (!manifest) {
      t.skip('dist/.vite/manifest.json missing — manifest assertion reports the build defect');
      return;
    }
    const chunk = resolveManifestChunkFile(manifest, chunkName);
    const gz = gzipBytes(chunk);
    assert.ok(
      gz <= budget,
      `${chunk} is ${(gz / 1024).toFixed(1)} KB gz, over the ${(budget / 1024).toFixed(0)} KB budget. ` +
      `Investigate whether a heavy module was statically imported. If the new size is justified, ` +
      `bump the budget in tests/bundle-size.test.mjs.`,
    );
  });
}

test('bundle-size: total JS gz under 6 MB', (t) => {
  if (!haveAssets) {
    t.skip('dist/assets missing — run `npm run build` first');
    return;
  }
  const files = readdirSync(distAssets).filter((f) => f.endsWith('.js'));
  let total = 0;
  for (const f of files) total += gzipBytes(path.join('assets', f));
  const limit = 6 * 1024 * 1024;
  assert.ok(
    total <= limit,
    `total JS is ${(total / 1024 / 1024).toFixed(2)} MB gz (limit ${(limit / 1024 / 1024).toFixed(0)} MB). ` +
    `Major regression — investigate before bumping.`,
  );
});

test('bundle-size: story renderer is a named chunk statically reachable from main', (t) => {
  if (!haveAssets) {
    t.skip('dist/assets missing — run `npm run build` first');
    return;
  }
  if (!manifest) {
    t.skip('dist/.vite/manifest.json missing — manifest assertion reports the build defect');
    return;
  }
  const rendererFile = resolveManifestChunkFile(manifest, 'story-renderer');
  assert.ok(existsSync(path.join(projectRoot, 'dist', rendererFile)), 'named renderer chunk must exist on disk');
  const mainFile = resolveManifestChunkFile(manifest, 'main');
  const mainKey = Object.keys(manifest).find((key) => manifest[key].file === mainFile);
  const pending = [mainKey];
  const visited = new Set();
  while (pending.length > 0) {
    const key = pending.pop();
    if (visited.has(key)) continue;
    visited.add(key);
    assert.ok(manifest[key], `static import ${key} must resolve in the manifest`);
    if (manifest[key].file === rendererFile) return;
    pending.push(...(manifest[key].imports ?? []));
  }
  assert.fail('main must statically import the story renderer chunk; dynamic-only reachability changes loading behavior');
});
