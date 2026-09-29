import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  COORDINATE_LIST_PARAMS,
  COORDINATE_PARAMS,
  NEUTRAL_PARAMS,
  PERSONAL_PARAMS,
} from '../src/services/cloud-fallback-policy.ts';

// R4-BUG-004: every query parameter the renderer sends to /api/* must be
// consciously classified as coordinate (rounded before any cloud fallback),
// personal (never sent to the cloud) or neutral. A new, unclassified parameter
// fails here. Heuristic by nature; the runtime policy is fail-closed for
// anything this scan misses.

const root = fileURLToPath(new URL('..', import.meta.url));
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') out.push(...sourceFiles(path));
    } else if (/\.ts$/.test(entry) && !/\.(test|spec|d)\.ts$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

function paramNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/\/api\/[A-Za-z0-9_/.${}-]*\?([^'"`\s)]*)/g)) {
    for (const pair of match[1]!.split('&')) {
      const name = pair.split('=')[0]!.replace(/^\$\{[^}]*\}/, '');
      if (NAME.test(name)) names.add(name);
    }
  }
  const vars = [...source.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*new URLSearchParams\(/g)].map((m) => m[1]!);
  for (const variable of vars) {
    for (const match of source.matchAll(new RegExp(`\\b${variable}\\.(?:set|append)\\(\\s*['"]([^'"]+)['"]`, 'g'))) {
      if (NAME.test(match[1]!)) names.add(match[1]!);
    }
  }
  for (const match of source.matchAll(/new URLSearchParams\(\s*\{([^}]*)\}/g)) {
    for (const key of match[1]!.matchAll(/(?:^|,)\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*(?=[:,]|$)/g)) names.add(key[1]!);
  }
  return names;
}

function classified(name: string): boolean {
  const lower = name.toLowerCase();
  return NEUTRAL_PARAMS.has(name) || PERSONAL_PARAMS.has(lower) || COORDINATE_PARAMS.has(lower) || COORDINATE_LIST_PARAMS.has(lower);
}

test('every renderer /api/ query parameter is classified for cloud fallback', () => {
  const unclassified: string[] = [];
  let scanned = 0;
  for (const file of sourceFiles(join(root, 'src'))) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('/api/')) continue;
    for (const name of paramNames(source)) {
      scanned += 1;
      if (!classified(name)) unclassified.push(`${name} (${relative(root, file)})`);
    }
  }
  assert.ok(scanned > 50, `scan found only ${scanned} parameters; the extractor is broken`);
  assert.deepEqual(unclassified, [], 'classify these in src/services/cloud-fallback-policy.ts');
});

test('the scan recognises the parameter forms the renderer uses', () => {
  const names = paramNames(`
    fetch(\`/api/weather/local-forecast?lat=\${lat}&lon=\${lon}\`);
    const params = new URLSearchParams(); params.set('sw_lat', a); params.append("cursor", c);
    const qs = new URLSearchParams({ page_size: '5', region });
  `);
  for (const expected of ['lat', 'lon', 'sw_lat', 'cursor', 'page_size', 'region']) {
    assert.ok(names.has(expected), expected);
  }
});
