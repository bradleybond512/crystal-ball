/**
 * Patches satellite.js to remove WASM re-exports.
 *
 * The satellite.js barrel (dist/index.js) re-exports from ./wasm/index.js
 * which uses top-level await — incompatible with IIFE builds (vite-plugin-pwa).
 * We only use the pure-JS SGP4 functions, not the WASM bulk propagator.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const indexPath = path.join(process.cwd(), 'node_modules/satellite.js/dist/index.js');

try {
  const content = readFileSync(indexPath, 'utf8');
  const patched = content.replace(/export \* from ['"]\.\/wasm\/index\.js['"];?\s*\n?/g, '');

  if (patched !== content) {
 writeFileSync(indexPath, patched);
 console.log('[patch-satellite-js] Stripped WASM re-exports from satellite.js');
  }
} catch {
  // satellite.js not installed yet — skip
}
