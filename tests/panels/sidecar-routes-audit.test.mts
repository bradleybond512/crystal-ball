/**
 * Sidecar route audit. Two passes:
 *
 *   1) Walk src/ and pull every '/api/<route>' string the renderer references.
 *   2) Walk src-tauri/sidecar/local-api-server.mjs + api/*.js and pull every
 *      route the sidecar exposes (inline pathname checks + per-file handlers
 *      under /api).
 *
 * Anything in (1) but not (2) is a "dangling client call" and most likely
 * a silent feature failure. We report rather than fail so unrelated PRs
 * don't get blocked, but the report is the regression signal we want.
 */

import test from 'node:test';
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.js', '.mjs']);
const RENDERER_ROOTS = ['src'];
const SIDECAR_FILE = path.join(projectRoot, 'src-tauri', 'sidecar', 'local-api-server.mjs');
const API_DIR = path.join(projectRoot, 'api');

const ROUTE_RE = /\/api\/[a-z][a-z0-9_/-]*/gi;

interface FoundRoute {
  route: string;
  files: Set<string>;
}

function* walk(dir: string): Generator<string> {
  for (const ent of readdirSync(dir)) {
    if (ent === 'node_modules' || ent === 'dist' || ent.startsWith('.')) continue;
    const full = path.join(dir, ent);
    let stats;
    try { stats = statSync(full); } catch { continue; }
    if (stats.isDirectory()) yield* walk(full);
    else if (SCAN_EXTENSIONS.has(path.extname(full))) yield full;
  }
}

function normalize(route: string): string {
  // Strip trailing slash and any query/hash fragments that crept in
  const stripped = route.replace(/[?#].*$/, '').replace(/\/$/, '');
  // Discard placeholders so /api/foo/${id} collapses to /api/foo
  const segments = stripped.split('/');
  const out: string[] = [];
  for (const seg of segments) {
    if (seg.includes('${') || seg.includes(':')) break;
    out.push(seg);
  }
  return out.join('/');
}

function collectRendererRoutes(): Map<string, FoundRoute> {
  const found = new Map<string, FoundRoute>();
  for (const root of RENDERER_ROOTS) {
    const abs = path.join(projectRoot, root);
    for (const file of walk(abs)) {
      const content = readFileSync(file, 'utf8');
      const matches = content.match(ROUTE_RE);
      if (!matches) continue;
      for (const raw of matches) {
        const route = normalize(raw);
        if (!route.startsWith('/api/')) continue;
        const idx = content.indexOf(raw);
        if (idx > 0 && content.slice(Math.max(0, idx - 10), idx).includes('://')) continue;
        let entry = found.get(route);
        if (!entry) {
          entry = { route, files: new Set() };
          found.set(route, entry);
        }
        entry.files.add(path.relative(projectRoot, file));
      }
    }
  }
  return found;
}

function collectSidecarRoutes(): Set<string> {
  const routes = new Set<string>();

  try {
    const sidecar = readFileSync(SIDECAR_FILE, 'utf8');
    const inlineRe = /requestUrl\.pathname\s*===\s*'([^']+)'/g;
    for (const m of sidecar.matchAll(inlineRe)) {
      routes.add(normalize(m[1] ?? ''));
    }
    const startsWithRe = /pathname\.startsWith\(\s*'([^']+)'/g;
    for (const m of sidecar.matchAll(startsWithRe)) {
      const value = m[1] ?? '';
      if (value.startsWith('/api/')) routes.add(normalize(value));
    }
  } catch {
    // ignore — sidecar absent in some checkouts
  }

  try {
    for (const file of walk(API_DIR)) {
      const rel = path.relative(API_DIR, file).replace(/\\/g, '/');
      if (rel.startsWith('_')) continue;
      if (rel.includes('__tests__') || rel.endsWith('.test.mjs') || rel.endsWith('.test.js')) continue;
      const noExt = rel.replace(/\.(?:js|mjs|ts|mts)$/, '');
      const cleaned = noExt.replace(/\/index$/, '');
      routes.add(normalize(`/api/${cleaned}`));
    }
  } catch {
    // ignore
  }

  return routes;
}

const rendererRoutes = collectRendererRoutes();
const sidecarRoutes = collectSidecarRoutes();

interface AuditEntry {
  route: string;
  callers: string[];
}

const dangling: AuditEntry[] = [];
const orphaned: string[] = [];

for (const [route, entry] of rendererRoutes) {
  let covered = false;
  for (const known of sidecarRoutes) {
    if (route === known || route.startsWith(`${known}/`)) {
      covered = true;
      break;
    }
  }
  if (!covered) {
    dangling.push({ route, callers: [...entry.files].sort() });
  }
}

for (const route of sidecarRoutes) {
  if (!rendererRoutes.has(route)) {
    orphaned.push(route);
  }
}

dangling.sort((a, b) => a.route.localeCompare(b.route));
orphaned.sort();

function writeReport(): void {
  const outDir = path.join(projectRoot, 'tests', 'panels');
  mkdirSync(outDir, { recursive: true });
  const json = {
    rendererRouteCount: rendererRoutes.size,
    sidecarRouteCount: sidecarRoutes.size,
    danglingClientCalls: dangling,
    sidecarOnlyRoutes: orphaned,
  };
  writeFileSync(path.join(outDir, '.last-routes-audit.json'), JSON.stringify(json, null, 2));

  const lines: string[] = [];
  lines.push('# Sidecar Route Audit');
  lines.push('');
  lines.push(`Renderer route call sites: **${rendererRoutes.size}**`);
  lines.push(`Sidecar route handlers: **${sidecarRoutes.size}**`);
  lines.push('');
  lines.push(`## Dangling client calls (renderer calls a route the sidecar doesn't serve) — ${dangling.length}`);
  if (dangling.length === 0) {
    lines.push('_None._');
  } else {
    lines.push('');
    lines.push('| Route | Callers |');
    lines.push('|---|---|');
    for (const d of dangling) {
      lines.push(`| \`${d.route}\` | ${d.callers.slice(0, 4).map((f) => `\`${f}\``).join(', ')}${d.callers.length > 4 ? ` +${d.callers.length - 4}` : ''} |`);
    }
  }
  lines.push('');
  lines.push(`## Sidecar-only routes (no renderer caller) — ${orphaned.length}`);
  if (orphaned.length === 0) lines.push('_None._');
  else for (const o of orphaned) lines.push(`- \`${o}\``);
  lines.push('');
  writeFileSync(path.join(outDir, '.last-routes-audit.md'), lines.join('\n'));
}

test('sidecar routes — collected', () => {
  if (rendererRoutes.size === 0) {
    throw new Error('renderer route scan returned 0 results — regex regression?');
  }
  if (sidecarRoutes.size === 0) {
    throw new Error('sidecar route scan returned 0 results — regex regression?');
  }
});

test('sidecar routes — report', () => {
  writeReport();
   
  console.log(`\nSidecar audit: ${rendererRoutes.size} renderer call sites, ${sidecarRoutes.size} sidecar handlers, ${dangling.length} dangling, ${orphaned.length} orphan.`);
  if (dangling.length > 0) {
     
    console.log('First 10 dangling:');
    for (const d of dangling.slice(0, 10)) {
       
      console.log(`  ${d.route}  <-  ${d.callers[0]}`);
    }
  }
});
