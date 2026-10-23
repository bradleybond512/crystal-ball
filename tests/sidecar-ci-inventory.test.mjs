import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { deriveScriptIndex, selectScripts } from '../scripts/targeted-tests.mjs';
import { SUITE_STAGES } from './helpers/mcp-suite-entry.mjs';
import {
  assertSidecarInventory, assertSidecarSmokeWiring, discoverSidecarTests,
  sidecarSmokeGroups, SIDECAR_REMAINING_NODE_FILES, SIDECAR_REMAINING_TSX_FILES,
} from './helpers/sidecar-ci-inventory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
const overrides = JSON.parse(readFileSync(new URL('../scripts/targeted-tests-overrides.json', import.meta.url), 'utf8'));
const workflow = readFileSync(new URL('../.github/workflows/smoke.yml', import.meta.url), 'utf8');
const first = 'src-tauri/sidecar/__tests__/first.test.mjs';
const second = 'src-tauri/sidecar/__tests__/second.test.mts';

test('the complete sidecar inventory is assigned once across the three real smoke groups', () => {
  const inventory = discoverSidecarTests(root);
  const groups = sidecarSmokeGroups(scripts, SUITE_STAGES['sidecar-remaining']);
  assert.equal(inventory.length, 58);
  assert.deepEqual(Object.values(groups).map((files) => files.length), [18, 6, 34]);
  assert.equal(assertSidecarInventory(inventory, groups), 58);
  for (const file of ['sms-auth', 'key-health']) {
    assert.ok(groups.remaining.includes(`src-tauri/sidecar/__tests__/${file}.test.mjs`));
  }
});

test('both fixed stages retain every explicit file and the required TypeScript loader', () => {
  assert.equal(SIDECAR_REMAINING_NODE_FILES.length, 32);
  assert.equal(SIDECAR_REMAINING_TSX_FILES.length, 2);
  assert.deepEqual(SUITE_STAGES['sidecar-remaining'], [
    ['--test', ...SIDECAR_REMAINING_NODE_FILES],
    ['--import', 'tsx', '--test', ...SIDECAR_REMAINING_TSX_FILES],
  ]);
});

test('an added test or removed assignment fails rather than silently losing coverage', () => {
  assert.throws(() => assertSidecarInventory([first, second], { existing: [first] }), /Unassigned sidecar tests:.*second/);
});

test('a declared nonexistent file fails even when every real test is assigned', () => {
  assert.throws(() => assertSidecarInventory([first], { existing: [first, second] }), /Nonexistent sidecar test:.*second/);
});

test('duplicate assignment in one group or across groups fails', () => {
  assert.throws(() => assertSidecarInventory([first], { existing: [first, first] }), /Duplicate sidecar assignment/);
  assert.throws(() => assertSidecarInventory([first], { existing: [first], remaining: [first] }), /Duplicate sidecar assignment/);
});

test('empty discovery, absent groups and empty groups cannot certify coverage', () => {
  assert.throws(() => assertSidecarInventory([], { existing: [first] }), /Empty sidecar inventory/);
  assert.throws(() => assertSidecarInventory([first], {}), /No sidecar groups/);
  assert.throws(() => assertSidecarInventory([first], { existing: [first], remaining: [] }), /Empty sidecar group: remaining/);
});

test('unsupported extensions and wildcard paths fail in discovery or declarations', () => {
  const unsupported = 'src-tauri/sidecar/__tests__/new.test.js';
  assert.throws(() => assertSidecarInventory([unsupported], { existing: [unsupported] }), /Unsupported sidecar test path/);
  assert.throws(() => assertSidecarInventory([first], { existing: [first, unsupported] }), /Unsupported sidecar test path/);
  assert.throws(() => assertSidecarInventory([first], { existing: ['src-tauri/sidecar/__tests__/*.test.mjs'] }), /Unsupported sidecar test path/);
});

test('filesystem discovery retains an unsupported test extension so the guard rejects it', (t) => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'sidecar-inventory-'));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const directory = join(temporaryRoot, 'src-tauri/sidecar/__tests__');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'new.test.ts'), '');
  const inventory = discoverSidecarTests(temporaryRoot);
  assert.deepEqual(inventory, ['src-tauri/sidecar/__tests__/new.test.ts']);
  assert.throws(() => assertSidecarInventory(inventory, { existing: inventory }), /Unsupported sidecar test path/);
});

test('removing an actual fixed-stage file is rejected by the repository inventory', () => {
  const stages = SUITE_STAGES['sidecar-remaining'].map((stage) => [...stage]);
  stages[0].splice(stages[0].indexOf('src-tauri/sidecar/__tests__/key-health.test.mjs'), 1);
  assert.throws(() => assertSidecarInventory(discoverSidecarTests(root), sidecarSmokeGroups(scripts, stages)), /Unassigned sidecar tests:.*key-health/);
});

test('the real smoke workflow and plain Node entry execute all required groups', () => {
  assert.doesNotThrow(() => assertSidecarSmokeWiring(scripts, workflow));
  assert.ok(deriveScriptIndex(scripts).has('test:sidecar-ci'));
});

test('missing, duplicate and conditional smoke steps cannot certify execution', () => {
  const step = '      - run: npm run test:sidecar-ci';
  assert.throws(() => assertSidecarSmokeWiring(scripts, workflow.replace(step, '')), /smoke step.*test:sidecar-ci/);
  assert.throws(() => assertSidecarSmokeWiring(scripts, workflow.replace(step, `${step}\n${step}`)), /smoke step.*test:sidecar-ci/);
  assert.throws(() => assertSidecarSmokeWiring(scripts, workflow.replace(step, `${step}\n        if: false`)), /Conditional smoke step.*test:sidecar-ci/);
  assert.throws(() => assertSidecarSmokeWiring({ ...scripts, 'test:sidecar-ci': 'node --test' }, workflow), /plain Node entry/);
});

test('targeted selection includes the isolated suite for every added test and its source boundaries', () => {
  const index = deriveScriptIndex(scripts);
  const files = [
    ...SIDECAR_REMAINING_NODE_FILES, ...SIDECAR_REMAINING_TSX_FILES,
    'src-tauri/sidecar/local-api-server.mjs', 'src-tauri/sidecar/biosurveillance-wastewater.mjs',
    'src-tauri/sidecar/ofac-cache.mjs', 'src-tauri/sidecar/sidecar-logger.mjs',
    'src-tauri/sidecar/event-store.mjs', 'src-tauri/sidecar/evidence-store.mjs',
    'src-tauri/sidecar/watchboard-engine.mjs', 'src-tauri/sidecar/hrrr-smoke.mjs',
    'src-tauri/sidecar/sms-security.mjs', 'src-tauri/sidecar/ipaws-aggregate.mjs',
    'src-tauri/sidecar/gdacs-rss.mjs', 'src-tauri/sidecar/faa-tfrs.mjs',
    'src/services/notifications/notification-producer-registry.ts',
    'src/services/spaceweather/solar-imagery.ts',
    'tests/helpers/sidecar-ci-inventory.mjs', 'tests/helpers/mcp-suite-entry.mjs',
    'tests/helpers/mcp-runtime-fixture.mjs', 'tests/helpers/run-isolated-mcp.mjs',
    'tests/helpers/loopback-only.mjs', '.github/workflows/smoke.yml',
  ];
  for (const file of files) {
    assert.ok(selectScripts([file], index, overrides).scripts.includes('test:sidecar-ci'), file);
  }
});
