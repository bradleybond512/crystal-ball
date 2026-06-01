#!/usr/bin/env node
// Regression guard for a production-boot crash that has shipped twice:
// a sidecar module imported via a STATIC `import ... from './x.mjs'` but
// missing from tauri.conf.json `bundle.resources`. In a packaged build the
// file isn't copied into Resources, so Node throws ERR_MODULE_NOT_FOUND at
// module-load time — before any code runs — and the entire local API server
// fails to start.
//
// We follow only static relative imports from local-api-server.mjs
// transitively. Dynamic `import()` calls (e.g. s2u-xmpp.bundle.mjs) are
// intentionally wrapped in try/catch and degrade gracefully, so they are NOT
// part of this crash class and are deliberately out of scope.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sidecarDir = path.join(repoRoot, 'src-tauri', 'sidecar');
const entry = path.join(sidecarDir, 'local-api-server.mjs');
const tauriConfPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');

// Matches `from './x.mjs'` and `} from "./x.mjs"` (multi-line import tails).
const STATIC_IMPORT_RE = /from\s+["']\.\/([\w.-]+\.mjs)["']/g;

/** Walk the static relative-import graph from the entry file. */
export function collectStaticImports(entryFile, dir) {
  const seen = new Set();
  const stack = [entryFile];
  while (stack.length > 0) {
 const file = stack.pop();
 if (seen.has(file)) continue;
 seen.add(file);
 let src;
 try {
 src = readFileSync(file, 'utf8');
 } catch {
 continue;
 }
 for (const m of src.matchAll(STATIC_IMPORT_RE)) {
 const dep = path.join(dir, m[1]);
 if (existsSync(dep)) stack.push(dep);
 }
  }
  seen.delete(entryFile);
  return [...seen].map((f) => path.basename(f)).sort();
}

export function findUnbundled(importedBasenames, resources) {
  const bundled = new Set(resources.map((r) => r.replace(/^sidecar\//, '')));
  return importedBasenames.filter((f) => !bundled.has(f));
}

function main() {
  if (!existsSync(entry)) {
 console.error(`[check-sidecar-bundle] entry not found: ${entry}`);
 process.exit(1);
  }
  const conf = JSON.parse(readFileSync(tauriConfPath, 'utf8'));
  const resources = conf.bundle?.resources ?? [];
  const imported = collectStaticImports(entry, sidecarDir);
  const missing = findUnbundled(imported, resources);

  if (missing.length > 0) {
 console.error(
 '[check-sidecar-bundle] FAIL — these sidecar modules are statically ' +
 'imported by local-api-server.mjs but missing from tauri.conf.json ' +
 'bundle.resources. The packaged sidecar will crash at boot with ' +
 'ERR_MODULE_NOT_FOUND:\n' +
 missing.map((f) => `  - sidecar/${f}`).join('\n') +
 '\n\nAdd each to bundle.resources in src-tauri/tauri.conf.json.',
 );
 process.exit(1);
  }

  console.log(
 `[check-sidecar-bundle] OK — all ${imported.length} statically-imported ` +
 'sidecar .mjs modules are present in bundle.resources.',
  );
}

if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
