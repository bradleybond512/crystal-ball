import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildCssManifest, compareCssManifests, discoverCssAssets, parseCssBudgetArgs } from '../../scripts/check-ux025-css-budget.mjs';

test('CSS asset discovery is sorted and sums actual gzip bytes', () => {
  const root = mkdtempSync(join(os.tmpdir(), 'ux025-css-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'z.css'), '.z{color:red}'.repeat(20));
  writeFileSync(join(root, 'assets', 'a.css'), '.a{color:blue}'.repeat(20));
  writeFileSync(join(root, 'assets', 'ignore.js'), 'ignored');
  const assets = discoverCssAssets(root);
  assert.deepEqual(assets.map((asset) => asset.path), ['assets/a.css', 'assets/z.css']);
  const manifest = buildCssManifest(root, { commit: 'abc', capturedAt: '2026-08-31T12:00:00.000Z' });
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, 'ux025-css-budget');
  assert.equal(manifest.totals.gzipBytes, assets.reduce((sum, asset) => sum + asset.gzipBytes, 0));
});

test('CSS comparison fails closed above 10,240 added gzip bytes', () => {
  const baseline = { schemaVersion: 1, kind: 'ux025-css-budget', totals: { gzipBytes: 100 } };
  assert.deepEqual(compareCssManifests(baseline, { ...baseline, totals: { gzipBytes: 10_340 } }), { budgetBytes: 10_240, addedGzipBytes: 10_240, pass: true });
  assert.equal(compareCssManifests(baseline, { ...baseline, totals: { gzipBytes: 10_341 } }).pass, false);
  assert.throws(() => compareCssManifests({}, baseline), /baseline is not/);
});

test('CSS CLI argument validation rejects incomplete commands', () => {
  assert.throws(() => parseCssBudgetArgs([]), /usage/);
  assert.throws(() => parseCssBudgetArgs(['capture', '--dist', 'dist']), /--dist and --output/);
  assert.deepEqual(parseCssBudgetArgs(['compare', '--baseline', 'a.json', '--candidate', 'b.json']), { mode: 'compare', baseline: 'a.json', candidate: 'b.json' });
});
