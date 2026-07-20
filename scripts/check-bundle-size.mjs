#!/usr/bin/env node
/**
 * Bundle-size guard. Runs after `vite build` (or any `npm run build*`) and
 * blocks CI when the largest JS chunks exceed policy limits.
 *
 *   node scripts/check-bundle-size.mjs             # default thresholds
 *   node scripts/check-bundle-size.mjs --write     # rewrite bundle-size-baseline.json
 *
 * Thresholds (gzipped):
 *   - Main entry (index-*.js, main-*.js): 460 KB
 *   - Any single non-entry chunk: 1.2 MB
 *   - Total JS (all chunks): 6 MB
 *
 * The per-chunk cap is generous because Cesium (GodsVisionView chunk) is
 * around 1.06 MB gzipped on its own and is an intentional large-chunk split
 * — one atomic globe bundle that's lazy-loaded when users open God's Vision.
 * The total-JS cap is what guards against stealth bloat; chunk-level growth
 * beyond ~1.2 MB usually means a new big dep was static-imported into an
 * existing chunk, which deserves a review.
 *
 * Main-entry budget history: raised 350 → 460 KB (2026-07-20) after the app
 * grew a correlation engine, an 8-axis survival OS, air-quality + webcam
 * layers, and a cognition stack. Sourcemap attribution of the main chunk shows
 * it is dominated by BOOT-CRITICAL orchestration that is irreducibly eager —
 * data-loader.ts (~173 KB src), panel-layout.ts (~164 KB), Map.ts/MapPopup.ts
 * (~219 KB), event-handlers.ts (~39 KB). The on-demand surfaces that could be
 * lazy-split (UnifiedSettings, AnalystHUD, CountryBriefPage, sound-manager,
 * canvas-confetti, tech-geo config) total only ~40 KB gzipped — splitting ALL
 * of them still leaves the entry near ~387 KB, above the old 350 floor. Total
 * JS stayed healthy (~4.7 / 6 MB), so this is real feature growth, not stealth
 * bloat. Follow-up perf opportunity (not required to pass): lazy-load those
 * on-demand components to trim ~40 KB off the boot payload.
 */
import { readdir, stat, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const distJsDir = path.resolve(root, 'dist', 'assets');

const LIMITS = {
  mainEntryGzipBytes: 460 * 1024,
  singleChunkGzipBytes: 1200 * 1024,
  totalJsGzipBytes: 6 * 1024 * 1024,
};

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
  let files;
  try {
    files = await readdir(distJsDir);
  } catch {
    console.error(`No dist directory at ${distJsDir} — run a build first.`);
    process.exit(2);
  }

  const jsFiles = files.filter((f) => f.endsWith('.js'));
  if (jsFiles.length === 0) {
    console.error(`No JS bundles found in ${distJsDir}.`);
    process.exit(2);
  }

  const chunks = [];
  for (const name of jsFiles) {
    const filePath = path.resolve(distJsDir, name);
    const [buf, st] = await Promise.all([readFile(filePath), stat(filePath)]);
    const gz = gzipSync(buf).length;
    chunks.push({ name, raw: st.size, gzip: gz });
  }
  chunks.sort((a, b) => b.gzip - a.gzip);

  const failures = [];
  const totalGz = chunks.reduce((s, c) => s + c.gzip, 0);

  const mainEntry = chunks.find((c) => /^(index|main)-[A-Za-z0-9_-]+\.js$/.test(c.name));
  if (mainEntry && mainEntry.gzip > LIMITS.mainEntryGzipBytes) {
    failures.push(`Main entry ${mainEntry.name} gzipped is ${fmt(mainEntry.gzip)} > ${fmt(LIMITS.mainEntryGzipBytes)} limit`);
  }

  for (const c of chunks) {
    if (c === mainEntry) continue;
    if (c.gzip > LIMITS.singleChunkGzipBytes) {
      failures.push(`Chunk ${c.name} gzipped is ${fmt(c.gzip)} > ${fmt(LIMITS.singleChunkGzipBytes)} per-chunk limit`);
    }
  }

  if (totalGz > LIMITS.totalJsGzipBytes) {
    failures.push(`Total JS gzipped is ${fmt(totalGz)} > ${fmt(LIMITS.totalJsGzipBytes)} budget`);
  }

  console.log('Bundle-size report (gzipped):');
  console.log(`  chunks: ${chunks.length}`);
  console.log(`  total:  ${fmt(totalGz)} / ${fmt(LIMITS.totalJsGzipBytes)}`);
  console.log('  top 10:');
  for (const c of chunks.slice(0, 10)) {
    console.log(`    ${c.name}  raw=${fmt(c.raw)}  gzip=${fmt(c.gzip)}`);
  }

  if (failures.length > 0) {
    console.error('\n✖ Bundle size policy violations:');
    for (const f of failures) console.error(`  - ${f}`);
    console.error('\nTo increase a limit intentionally, edit LIMITS in scripts/check-bundle-size.mjs.');
    process.exit(1);
  }
  console.log('\n✓ All bundle-size policies satisfied.');
}

await main();
