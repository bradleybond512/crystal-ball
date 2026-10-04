// R4-LOW-008 boundary pins for the calibration evidence journal. These guard
// the properties a refactor could silently drop: auth-gated local-only routes,
// no traffic logging, bundling, no agent write path, append-only storage, and
// the ledger hooks.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(?:mjs|js|ts|json)$/.test(name)) out.push(full);
  }
  return out;
}

test('evidence routes sit behind the sidecar auth gate on the local-only prefix', () => {
  const server = read('src-tauri/sidecar/local-api-server.mjs');
  const gate = server.indexOf('// All routes below require a valid LOCAL_API_TOKEN bearer token.');
  const route = server.indexOf("if (requestUrl.pathname.startsWith('/api/local-evidence/')) {");
  assert.ok(gate > 0 && route > gate, 'route block must follow the auth gate');
  for (const name of ['append', 'missing', 'records', 'summary', 'export']) {
    assert.ok(server.includes(`'/api/local-evidence/${name}'`), name);
  }
  assert.doesNotMatch(server, /'\/api\/evidence\//, 'no unprefixed evidence route can cloud-fallback');
});

test('the renderer fetch patch still treats /api/local-* as local-only', () => {
  const runtime = read('src/services/runtime.ts');
  assert.match(runtime, /return target\.startsWith\('\/api\/local-'\);/);
  const client = read('src/services/intelligence/evidence-journal.ts');
  assert.match(client, /isLoopbackBase\(base\)/);
});

test('evidence requests are skipped by the traffic recorder', () => {
  const server = read('src-tauri/sidecar/local-api-server.mjs');
  const skip = server.slice(server.indexOf('const skipRecord ='), server.indexOf('const skipRecord =') + 600);
  assert.match(skip, /requestUrl\.pathname\.startsWith\('\/api\/local-evidence\/'\)/);
});

test('the store is bundled, ignored by git and opened at startup', () => {
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.ok(conf.bundle.resources.includes('sidecar/evidence-store.mjs'));
  assert.match(read('.gitignore'), /^evidence\.db$/m);
  const server = read('src-tauri/sidecar/local-api-server.mjs');
  assert.match(server, /context\.evidenceStore = new EvidenceStore\(\{ dataDir: context\.dataDir \}\);/);
  assert.match(server, /context\.evidenceStore\?\.close\(\);/);
});

test('no MCP tool can reach the evidence journal', () => {
  for (const file of walk(path.join(root, 'tools/mcp-server'))) {
    assert.equal(readFileSync(file, 'utf8').includes('local-evidence'), false, path.relative(root, file));
  }
});

test('storage is append-only: triggers exist and code never updates or deletes rows', () => {
  const store = read('src-tauri/sidecar/evidence-store.mjs');
  assert.match(store, /CREATE TRIGGER IF NOT EXISTS evidence_no_update BEFORE UPDATE ON evidence/);
  assert.match(store, /CREATE TRIGGER IF NOT EXISTS evidence_no_delete BEFORE DELETE ON evidence/);
  assert.doesNotMatch(store, /DELETE FROM evidence\b/);
  assert.doesNotMatch(store, /UPDATE evidence\b/);
});

test('each ledger announces changes and the app starts the journal', () => {
  for (const file of [
    'src/services/intelligence/outcome-ledger.ts',
    'src/services/intelligence/forecast-calibration-adapter.ts',
    'src/services/forecast-accuracy.ts',
  ]) {
    assert.match(read(file), /notifyEvidenceChanged\('(?:alert-outcome|forecast|ema-forecast)'\)/, file);
  }
  assert.match(read('src/app/panel-layout.ts'), /\n\s*startEvidenceJournal\(\);\n/);
  assert.doesNotMatch(read('src/services/forecast-accuracy.ts'), /JSON\.parse\(raw\) as AccuracyStore/);
});
