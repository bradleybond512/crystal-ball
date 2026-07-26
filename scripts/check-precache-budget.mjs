#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_ENTRIES = 500;
const MAX_BYTES = 25 * 1024 * 1024;
const OBSOLETE_VAULT_ASSET = /(?:^|\/)vault-[^/]*frames[^/]*\.png$/iu;

export function extractPrecacheUrls(serviceWorkerSource) {
  const urls = [];
  const entryPattern = /\{url:"((?:\\.|[^"])*)",revision:/gu;
  for (const match of serviceWorkerSource.matchAll(entryPattern)) {
    urls.push(JSON.parse(`"${match[1]}"`));
  }
  return urls;
}

export function summarizePrecache(urls, sizeOf) {
  return {
    entries: urls.length,
    bytes: urls.reduce((total, url) => total + sizeOf(url), 0),
    forbidden: urls.filter((url) => OBSOLETE_VAULT_ASSET.test(url)),
  };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const distDir = path.resolve(root, 'dist');
  const swPath = path.resolve(distDir, 'sw.js');
  const urls = extractPrecacheUrls(readFileSync(swPath, 'utf8'));
  const summary = summarizePrecache(urls, (url) => statSync(path.resolve(distDir, url)).size);
  const sizeMiB = (summary.bytes / (1024 * 1024)).toFixed(2);

  console.log(`[pwa:budget] ${summary.entries} entries, ${sizeMiB} MiB`);

  const failures = [];
  if (summary.entries > MAX_ENTRIES) {
    failures.push(`${summary.entries} entries exceeds budget ${MAX_ENTRIES}`);
  }
  if (summary.bytes > MAX_BYTES) {
    failures.push(`${sizeMiB} MiB exceeds budget ${MAX_BYTES / (1024 * 1024)} MiB`);
  }
  if (summary.forbidden.length > 0) {
    failures.push(`obsolete vault frame assets found: ${summary.forbidden.join(', ')}`);
  }
  if (failures.length > 0) {
    throw new Error(failures.join('; '));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
