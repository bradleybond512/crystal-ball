import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const PREFIX = 'src-tauri/sidecar/__tests__/';
const TEST_PATH = /^src-tauri\/sidecar\/__tests__\/[\w./-]+\.test\.(?:mjs|mts)$/;
export const SIDECAR_CI_COMMAND = 'node --test tests/sidecar-ci-inventory.test.mjs tests/sidecar-ci-suite.test.mjs';

// Explicit additions to the existing 18-file sidecar and six-file security
// groups. Discovery checks this list; it never silently enrolls a new test.
export const SIDECAR_REMAINING_NODE_FILES = Object.freeze([
  'src-tauri/sidecar/__tests__/agent-monitor-projection.test.mjs',
  'src-tauri/sidecar/__tests__/analyst-diagnostics-mirror.test.mjs',
  'src-tauri/sidecar/__tests__/biosurveillance-wastewater.test.mjs',
  'src-tauri/sidecar/__tests__/bounded-provider-responses.test.mjs',
  'src-tauri/sidecar/__tests__/dark-vessel-gaps-parity.test.mjs',
  'src-tauri/sidecar/__tests__/event-store-wiring.test.mjs',
  'src-tauri/sidecar/__tests__/event-store.test.mjs',
  'src-tauri/sidecar/__tests__/evidence-routes.test.mjs',
  'src-tauri/sidecar/__tests__/evidence-store.test.mjs',
  'src-tauri/sidecar/__tests__/feed-tracker.test.mjs',
  'src-tauri/sidecar/__tests__/freight-stress-parity.test.mjs',
  'src-tauri/sidecar/__tests__/hrrr-smoke.test.mjs',
  'src-tauri/sidecar/__tests__/key-health.test.mjs',
  'src-tauri/sidecar/__tests__/local-logistics-route.test.mjs',
  'src-tauri/sidecar/__tests__/maritime-vessels-parity.test.mjs',
  'src-tauri/sidecar/__tests__/ofac-cache.test.mjs',
  'src-tauri/sidecar/__tests__/openaq-v3-route.test.mjs',
  'src-tauri/sidecar/__tests__/osrm-route.test.mjs',
  'src-tauri/sidecar/__tests__/q20-sidecar-lows.test.mjs',
  'src-tauri/sidecar/__tests__/rules.test.mjs',
  'src-tauri/sidecar/__tests__/s2-routes.test.mjs',
  'src-tauri/sidecar/__tests__/security-cve-parity.test.mjs',
  'src-tauri/sidecar/__tests__/self-test-classify.test.mjs',
  'src-tauri/sidecar/__tests__/severe-weather-parity.test.mjs',
  'src-tauri/sidecar/__tests__/shakealert-parity.test.mjs',
  'src-tauri/sidecar/__tests__/shortage-overview.test.mjs',
  'src-tauri/sidecar/__tests__/sidecar-logger.test.mjs',
  'src-tauri/sidecar/__tests__/situations.test.mjs',
  'src-tauri/sidecar/__tests__/sms-auth.test.mjs',
  'src-tauri/sidecar/__tests__/ucdp-local-routes.test.mjs',
  'src-tauri/sidecar/__tests__/volcano-monitor-parity.test.mjs',
  'src-tauri/sidecar/__tests__/watchboard-engine.test.mjs',
]);
export const SIDECAR_REMAINING_TSX_FILES = Object.freeze([
  'src-tauri/sidecar/__tests__/notification-integration.test.mts',
  'src-tauri/sidecar/__tests__/spaceweather-imagery-parity.test.mjs',
]);

export function discoverSidecarTests(root) {
  function visit(relative) {
    return readdirSync(join(root, relative), { withFileTypes: true }).flatMap((entry) => {
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) return visit(file);
      if (!entry.name.includes('.test.')) return [];
      if (!entry.isFile()) throw new Error(`Unsupported sidecar test file type: ${file}`);
      return [file];
    });
  }
  return visit(PREFIX.slice(0, -1)).sort();
}

export function sidecarSmokeGroups(scripts, remainingStages) {
  const files = (command) => {
    if (typeof command !== 'string') throw new Error('Missing sidecar test command.');
    return command.split(/\s+/).filter((token) => token.startsWith(PREFIX));
  };
  if (!Array.isArray(remainingStages)) throw new Error('Missing fixed remaining sidecar stages.');
  return {
    sidecar: files(scripts['test:sidecar']),
    security: files(scripts['test:sec-hardening']),
    remaining: remainingStages.flatMap((stage) => stage.filter((token) => token.startsWith(PREFIX))),
  };
}

export function assertSidecarInventory(inventory, groups) {
  if (!Array.isArray(inventory) || inventory.length === 0) throw new Error('Empty sidecar inventory.');
  const entries = Object.entries(groups);
  if (entries.length === 0) throw new Error('No sidecar groups.');
  const assertPath = (file) => {
    if (typeof file !== 'string' || !TEST_PATH.test(file) || file.split('/').includes('..')) {
      throw new Error(`Unsupported sidecar test path: ${file}`);
    }
  };
  inventory.forEach(assertPath);
  const available = new Set(inventory);
  if (available.size !== inventory.length) throw new Error('Duplicate discovered sidecar test.');
  const assigned = new Set();
  for (const [name, declared] of entries) {
    if (!Array.isArray(declared) || declared.length === 0) throw new Error(`Empty sidecar group: ${name}`);
    for (const file of declared) {
      assertPath(file);
      if (!available.has(file)) throw new Error(`Nonexistent sidecar test: ${file}`);
      if (assigned.has(file)) throw new Error(`Duplicate sidecar assignment: ${file}`);
      assigned.add(file);
    }
  }
  const missing = inventory.filter((file) => !assigned.has(file));
  if (missing.length) throw new Error(`Unassigned sidecar tests: ${missing.join(', ')}`);
  return assigned.size;
}

export function assertSidecarSmokeWiring(scripts, workflow) {
  if (scripts['test:sidecar-ci'] !== SIDECAR_CI_COMMAND) throw new Error('Missing fixed plain Node entry for sidecar CI.');
  const lines = workflow.split('\n');
  for (const name of ['test:sidecar', 'test:sec-hardening', 'test:sidecar-ci']) {
    const command = `run: npm run ${name}`;
    const matches = lines.flatMap((line, index) => line.trim().replace(/^- /, '') === command ? [index] : []);
    if (matches.length !== 1 || lines[matches[0]] !== `      - ${command}`) {
      throw new Error(`Missing or duplicate unconditional smoke step: ${name}`);
    }
    for (let index = matches[0] + 1; index < lines.length && !lines[index].startsWith('      - '); index += 1) {
      if (/^\s+if:/.test(lines[index])) throw new Error(`Conditional smoke step: ${name}`);
    }
  }
}
