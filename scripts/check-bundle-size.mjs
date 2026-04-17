#!/usr/bin/env node
/**
 * Bundle-size guard. Runs after `vite build` (or any `npm run build*`) and
 * blocks CI when the largest JS chunks exceed policy limits.
 *
 *   node scripts/check-bundle-size.mjs             # default thresholds
 *   node scripts/check-bundle-size.mjs --write     # rewrite bundle-size-baseline.json
 *
 * Thresholds (gzipped):
 *   - Main entry (index-*.js, main-*.js): 350 KB
 *   - Any single non-entry chunk: 800 KB
 *   - Total JS (all chunks): 6 MB
 *
 * Cesium adds ~2.4 MB on its own (documented in the PWA workbox config); a
 * future accidental import of the full deck.gl or xenova/transformers bundle
 * would blow past this and the PR would fail before merging.
 */
import { readdir, stat, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const distJsDir = path.resolve(root, 'dist', 'assets');

const LIMITS = {
  mainEntryGzipBytes: 350 * 1024,
  singleChunkGzipBytes: 800 * 1024,
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
