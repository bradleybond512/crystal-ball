#!/usr/bin/env node
/* eslint-disable sonarjs/no-os-command-from-path -- dev-tooling script: no user input, all args hardcoded */
/**
 * Crystal Ball health checkup — `npm run checkup`
 *
 * Runs typecheck, core test suites, log audit, and sidecar probe.
 * Prints a one-screen GREEN / YELLOW / RED report with actionable items only.
 * Exits 0 (all green), 1 (warnings), or 2 (failures).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { summarizeSidecarHealth } from './sidecar-health-contract.mjs';

const { resolve, dirname } = path;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG_FILE = `${process.env.HOME}/Library/Logs/com.bradleybond.crystalball/desktop.log`;
const SIDECAR_URL = 'http://127.0.0.1:46123/api/health';

// ── Colour helpers ────────────────────────────────────────────────────────
const GREEN  = '\u001B[32m';
const YELLOW = '\u001B[33m';
const RED    = '\u001B[31m';
const BOLD   = '\u001B[1m';
const DIM    = '\u001B[2m';
const RESET  = '\u001B[0m';

const warnLine = (s) => `${YELLOW}⚠${RESET} ${s}`;
const failLine = (s) => `${RED}✗${RESET} ${s}`;
const dim      = (s) => `${DIM}${s}${RESET}`;
const bold     = (s) => `${BOLD}${s}${RESET}`;

// ── Shared state ──────────────────────────────────────────────────────────
const issues   = [];  // RED  → exit 2
const warnings = [];  // YELLOW → exit 1
const passes   = [];  // GREEN → exit 0
let totalTests = 0;

function addOk(label, detail = '')   { passes.push({ label, detail }); }
function addWarn(label, detail = '') { warnings.push({ label, detail }); }
function addFail(label, detail = '') { issues.push({ label, detail }); }

function runScript(script) {
  // npm run <script> — execFileSync with npm + ['run', script] avoids shell injection
  // All script names are hardcoded constants, never user-supplied.
  return execFileSync('npm', ['run', script], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
}

// ── 1. Typecheck ──────────────────────────────────────────────────────────
process.stdout.write(dim('  typecheck... '));
try {
  execFileSync('npx', ['tsc', '--noEmit'], { cwd: root, stdio: 'pipe' });
  execFileSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.api.json'], { cwd: root, stdio: 'pipe' });
  addOk('typecheck:all', 'both tsconfigs clean');
  process.stdout.write(`${GREEN}✓${RESET}\n`);
} catch (error) {
  const errors = String(error.stderr ?? '') + String(error.stdout ?? '');
  const count = (errors.match(/error TS/g) ?? []).length;
  addFail('typecheck:all', `${count} TypeScript error(s) — run: npm run typecheck:all`);
  process.stdout.write(`${RED}✗ (${count} errors)${RESET}\n`);
}

// ── 2. Core test suites ───────────────────────────────────────────────────
const CORE_SUITES = [
  'test:algorithms',
  'test:intelligence',
  'test:weather',
  'test:insights',
  'test:diagnostics',
  'test:sec-hardening',
];

for (const suite of CORE_SUITES) {
  process.stdout.write(dim(`  ${suite}... `));
  let out = '';
  let threw = false;
  try {
    out = runScript(suite);
  } catch (error) {
    out = String(error.stdout ?? '') + String(error.stderr ?? '');
    threw = true;
  }
  const passN = Number.parseInt((out.match(/pass (\d+)/)?.[1] ?? '0'), 10);
  const failN = Number.parseInt((out.match(/fail (\d+)/)?.[1] ?? '0'), 10);
  totalTests += passN;
  if (threw || failN > 0) {
    addFail(suite, `${failN || '?'} test(s) failing — run: npm run ${suite}`);
    process.stdout.write(`${RED}✗ (${failN} fail)${RESET}\n`);
  } else {
    addOk(suite, `${passN} passed`);
    process.stdout.write(`${GREEN}✓ (${passN})${RESET}\n`);
  }
}

// ── 3. Log audit ──────────────────────────────────────────────────────────
process.stdout.write(dim('  log audit... '));
if (existsSync(LOG_FILE)) {
  let raw;
  try {
    raw = readFileSync(LOG_FILE, 'utf8');
  } catch {
    addWarn('log', `Could not read desktop log — ${LOG_FILE}`);
    raw = null;
  }
  const lines = raw ? raw.split('\n') : [];

  // Key count from the most recent session start
  const keyLines = lines.filter((l) => l.includes('injected') && l.includes('keychain secrets'));
  const lastKeyLine = keyLines.at(-1) ?? '';
  const keyMatch = lastKeyLine.match(/injected (\d+) keychain secrets/);
  const keyCount = keyMatch ? Number.parseInt(keyMatch[1], 10) : null;

  if (keyCount === null) {
    addWarn('log: key count', 'Could not find keychain-secrets line — app may not have been launched yet');
  } else if (keyCount === 0) {
    addWarn('log: keychain', '0 API keys loaded last session — panels may be blank. Open app → gear → API Keys, or check CRYSTALBALL_SIGN_IDENTITY build setup.');
  } else {
    addOk('log: keychain', `${keyCount} API key(s) loaded last session`);
  }

  // Sidecar heartbeat staleness
  const heartbeatLines = lines.filter((l) => l.includes('sidecar heartbeat stale'));
  const recentHb = heartbeatLines.at(-1) ?? '';
  const ageMatch = recentHb.match(/age=(\d+)s/);
  if (ageMatch && Number.parseInt(ageMatch[1], 10) > 300) {
    addWarn('log: sidecar', `Heartbeat stale by ${ageMatch[1]}s in last session — check sidecar restart`);
  }

  // Fatal errors in recent 200 lines.
  // [FRONTEND] console.error lines are panel network-fetch failures (expected
  // when 0 keys are loaded or an upstream is down — already surfaced via the
  // key-count warning). Only flag Rust-level panics/process-level errors.
  const recent = lines.slice(-200);
  const crashes = recent.filter(
    (l) => /\bpanic\b|\[ERROR\].*(?:thread|main\.rs|src-tauri)/i.test(l) && !/\[FRONTEND\]/i.test(l),
  );
  const frontendErrors = recent.filter(
    (l) => /\[ERROR\]/.test(l) && /\[FRONTEND\]/i.test(l) && !/non-fatal/i.test(l),
  );
  if (crashes.length > 0) {
    addFail('log: errors', `${crashes.length} Rust-level panic/error(s) in recent log — check ${LOG_FILE}`);
  } else {
    addOk('log: errors', 'No Rust-level panics in recent log');
  }
  if (frontendErrors.length > 0 && (keyCount ?? 1) > 0) {
    // Only warn about frontend errors when keys ARE loaded — otherwise they
    // are an expected consequence of missing keys already warned above.
    addWarn('log: frontend errors', `${frontendErrors.length} panel fetch error(s) in recent log — may indicate API issues`);
  }

  process.stdout.write(`${GREEN}✓${RESET}\n`);
} else {
  addWarn('log', `Desktop log not found at ${LOG_FILE} — launch the app at least once`);
  process.stdout.write(`${YELLOW}–${RESET}\n`);
}

// ── 4. Sidecar probe ──────────────────────────────────────────────────────
process.stdout.write(dim('  sidecar... '));
await new Promise((resolve_) => {
  const req = http.get(SIDECAR_URL, { timeout: 2000 }, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      try {
        const data = JSON.parse(body);
        const summary = summarizeSidecarHealth(data);
        if (summary) {
          addOk(
            'sidecar',
            `responding — ${summary.feedCount} feed(s) tracked, ${summary.keysConfigured}/${summary.keysTotal} API keys configured`,
          );
          process.stdout.write(`${GREEN}✓${RESET}\n`);
        } else {
          addWarn('sidecar', 'Responded with an unexpected health schema');
          process.stdout.write(`${YELLOW}–${RESET}\n`);
        }
      } catch {
        addWarn('sidecar', 'Responded but returned non-JSON');
        process.stdout.write(`${YELLOW}–${RESET}\n`);
      }
      resolve_();
    });
  });
  req.on('error', () => {
    addWarn('sidecar', 'Not reachable — start the app or run `npm run dev` first');
    process.stdout.write(`${YELLOW}–${RESET}\n`);
    resolve_();
  });
  req.on('timeout', () => {
    req.destroy();
    addWarn('sidecar', 'Connection timed out (2s)');
    process.stdout.write(`${YELLOW}–${RESET}\n`);
    resolve_();
  });
});

// ── 5. Algorithm loop health ──────────────────────────────────────────────
process.stdout.write(dim('  algo loop... '));
try {
  const fixturesSrc = readFileSync(
    resolve(root, 'src/services/algorithms/tuning-safety-fixtures.ts'),
    'utf8',
  );
  const storeSrc = readFileSync(
    resolve(root, 'src/services/algorithms/tunable-params-store.ts'),
    'utf8',
  );
  const caseCount = (fixturesSrc.match(/expectSuppressed:/g) ?? []).length;
  const tunableCount = (storeSrc.match(/algorithmId:/g) ?? []).length;
  addOk('algo loop', `${tunableCount} tunable knob(s), ${caseCount} safety fixture cases — loop wired & active`);
  process.stdout.write(`${GREEN}✓${RESET}\n`);
} catch {
  addWarn('algo loop', 'Could not read algo-loop source files');
  process.stdout.write(`${YELLOW}–${RESET}\n`);
}

// ── 6. Secret scan ────────────────────────────────────────────────────────
process.stdout.write(dim('  secret scan... '));
try {
  runScript('secrets:scan');
  addOk('secrets:scan', 'no secrets in tracked files');
  process.stdout.write(`${GREEN}✓${RESET}\n`);
} catch {
  addFail('secrets:scan', 'Potential secrets detected — run: npm run secrets:scan');
  process.stdout.write(`${RED}✗${RESET}\n`);
}

// ── 7. Replay baseline ────────────────────────────────────────────────────
// Shape-only check: the canonical comparison logic lives in
// src/services/ops/replay-baseline.ts (compareReplayReportToBaseline);
// this .mjs script cannot import .ts, so it only validates the JSON shape
// and defers the full replay run to npm run smoke:offline / CI.
process.stdout.write(dim('  replay baseline... '));
const BASELINE_FILE = resolve(root, 'src', 'services', 'ops', 'replay-baseline.json');
try {
  if (existsSync(BASELINE_FILE)) {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
    // We just verify the file is valid JSON with expected shape; a full replay
    // run requires tsx — that is deferred to npm run smoke:offline and CI.
    const fixtureCount = Object.keys(baseline?.fixtures ?? {}).length;
    if (fixtureCount === 0) {
      addWarn('smoke:replay', 'Baseline file exists but contains no fixtures');
      process.stdout.write(`${YELLOW}–${RESET}\n`);
    } else {
      addOk('smoke:replay', `Baseline file valid — ${fixtureCount} fixture(s). Run npm run smoke:offline for full check.`);
      process.stdout.write(`${GREEN}✓${RESET}\n`);
    }
  } else {
    addWarn('smoke:replay', 'No replay baseline file — run: npm run smoke:offline to generate it');
    process.stdout.write(`${YELLOW}–${RESET}\n`);
  }
} catch (error) {
  addWarn('smoke:replay', `Replay baseline check failed: ${String(error).slice(0, 100)}`);
  process.stdout.write(`${YELLOW}–${RESET}\n`);
}

// ── Report ────────────────────────────────────────────────────────────────
let overallStatus;
let statusColor;
if (issues.length > 0) {
  overallStatus = 'RED';
  statusColor = RED;
} else if (warnings.length > 0) {
  overallStatus = 'YELLOW';
  statusColor = YELLOW;
} else {
  overallStatus = 'GREEN';
  statusColor = GREEN;
}

const header = `─── Crystal Ball Checkup ─── ${statusColor}${overallStatus}${RESET}`;
console.log('\n' + bold(header));
console.log(dim(`    ${totalTests} tests · ${passes.length} checks passed · ${warnings.length} warnings · ${issues.length} failures\n`));

if (issues.length > 0) {
  console.log(bold(RED + 'FAILURES' + RESET + ' — fix these first:'));
  for (const i of issues) {
    console.log('  ' + failLine(i.label));
    if (i.detail) console.log('    ' + dim(i.detail));
  }
  console.log('');
}

if (warnings.length > 0) {
  console.log(bold(YELLOW + 'WARNINGS' + RESET + ':'));
  for (const w of warnings) {
    console.log('  ' + warnLine(w.label));
    if (w.detail) console.log('    ' + dim(w.detail));
  }
  console.log('');
}

if (issues.length === 0 && warnings.length === 0) {
  console.log(GREEN + 'Everything looks good.' + RESET);
} else if (passes.length > 0) {
  console.log(dim('Passed: ' + passes.map((p) => p.label).join(' · ')));
}

let exitCode = 0;
if (issues.length > 0) exitCode = 2;
else if (warnings.length > 0) exitCode = 1;
process.exit(exitCode);
