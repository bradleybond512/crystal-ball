#!/usr/bin/env tsx
/**
 * Crystal Ball smoke test — `npm run smoke`
 *
 * Three tiers:
 *   1. Replay   — offline, always runs. Asserts outcomes match committed baseline.
 *   2. Pipeline — offline, always runs. Exercises big-event → ladder invariants.
 *   3. Live     — sidecar health probe (skip with --offline).
 *
 * Exit codes: 0 = green, 1 = warnings only, 2 = any failure.
 */

import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { SidecarRuntimeFiles } from '../tools/mcp-server/sidecar-client.mjs';
import { summarizeSidecarHealth } from './sidecar-health-contract.mjs';

import { runReplay } from '../src/services/ops/replay-harness.ts';
import { buildCatalogReplayFixtures } from '../src/services/ops/replay-fixtures-catalog.ts';
import { compareReplayReportToBaseline, type ReplayBaseline } from '../src/services/ops/replay-baseline.ts';
import { detectBigEvent } from '../src/services/insights/big-event-detector.ts';
import { routeBigEventToLadder, resetNotificationLadderState } from '../src/services/insights/notification-ladder.ts';
import { createNotificationTraceRegistry } from '../src/services/diagnostics/notification-trace.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(root, 'src', 'services', 'ops', 'replay-baseline.json');

// Guard: only run the smoke suite when executed directly (not when imported).
// This lets checkup.mjs import compareReplayBaseline without running the suite.
const isMain = process.argv[1] != null && import.meta.url.endsWith(path.basename(process.argv[1]));
const offline = process.argv.includes('--offline');

// ── Colour helpers ──────────────────────────────────────────────────────
const GREEN  = '[32m';
const YELLOW = '[33m';
const RED    = '[31m';
const BOLD   = '[1m';
const DIM    = '[2m';
const RESET  = '[0m';

const dim  = (s: string) => `${DIM}${s}${RESET}`;
const bold = (s: string) => `${BOLD}${s}${RESET}`;

if (isMain) {
  // ── Shared state ────────────────────────────────────────────────────────
  const issues: { label: string; detail: string }[] = [];
  const warnings: { label: string; detail: string }[] = [];
  const passes: { label: string; detail: string }[] = [];

  function addOk(label: string, detail = '')   { passes.push({ label, detail }); }
  function addWarn(label: string, detail = '') { warnings.push({ label, detail }); }
  function addFail(label: string, detail = '') { issues.push({ label, detail }); }

  // ── Tier 1: Replay baseline ────────────────────────────────────────────
  process.stdout.write(dim('  replay baseline... '));
  try {
    if (!existsSync(BASELINE_PATH)) {
      addFail('smoke:replay', `Baseline file not found: ${BASELINE_PATH}`);
      process.stdout.write(`${RED}✗ (no baseline)${RESET}\n`);
    } else {
      const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as ReplayBaseline;
      const result = runReplay({ fixtures: buildCatalogReplayFixtures(), generatedAt: 0 });
      const { ok, mismatches, fixtureCount } = compareReplayReportToBaseline(result, baseline);
      if (!ok) {
        addFail('smoke:replay', `${mismatches.length} baseline mismatch(es):\n    ${mismatches.join('\n    ')}\nUpdate src/services/ops/replay-baseline.json to acknowledge intentional changes.`);
        process.stdout.write(`${RED}✗ (${mismatches.length} mismatch)${RESET}\n`);
      } else {
        addOk('smoke:replay', `${fixtureCount} fixture(s) match baseline`);
        process.stdout.write(`${GREEN}✓ (${fixtureCount} fixtures)${RESET}\n`);
      }
    }
  } catch (err) {
    addFail('smoke:replay', String(err));
    process.stdout.write(`${RED}✗ (error)${RESET}\n`);
  }

  // ── Tier 2: Pipeline invariants ────────────────────────────────────────
  process.stdout.write(dim('  pipeline invariants... '));
  try {
    resetNotificationLadderState();

    // Invariant (a): safety-critical + quiet hours → still dispatched
    const criticalInput = {
      id: 'smoke-a',
      domain: 'weather' as const,
      severityScore: 95,
      truthScore: 0.9,
      sourceCount: 5,
      hasOfficialSource: true,
      overlappingDomains: ['weather', 'emergency'],
      userExposure: 90,
      potentialImpact: 90,
    };
    const criticalResult = detectBigEvent(criticalInput, { threshold: 40 });
    const registryA = createNotificationTraceRegistry({ now: () => 1_000_000 });
    const decisionA = routeBigEventToLadder(registryA, criticalResult, criticalInput, {
      domain: 'weather',
      quietHoursActive: true,
      quietHoursBypassEnabled: false,
      now: () => 1_000_000,
    });
    assert.equal(decisionA.dispatched, true, 'safety-critical event must be dispatched even during quiet hours');
    assert.equal(decisionA.unsafeSuppression, false, 'dispatched safety-critical must not be unsafeSuppression');

    // Invariant (b): low-tier + dedupe match → suppressed, unsafeSuppression false
    const lowInput = {
      id: 'smoke-b',
      domain: 'weather' as const,
      severityScore: 15,
      truthScore: 0.3,
      sourceCount: 1,
      hasOfficialSource: false,
      overlappingDomains: ['weather'],
      userExposure: 10,
      potentialImpact: 10,
    };
    const lowResult = detectBigEvent(lowInput, { threshold: 40 });
    const registryB = createNotificationTraceRegistry({ now: () => 2_000_000 });
    const decisionB = routeBigEventToLadder(registryB, lowResult, lowInput, {
      domain: 'weather',
      dedupeMatch: true,
      now: () => 2_000_000,
    });
    assert.equal(decisionB.dispatched, false, 'low-tier deduped event must be suppressed');
    assert.equal(decisionB.unsafeSuppression, false, 'low-tier dedupe suppression is not unsafe');

    addOk('smoke:pipeline', 'critical+quiet-hours dispatched, low+dedupe suppressed safely');
    process.stdout.write(`${GREEN}✓${RESET}\n`);
  } catch (err) {
    addFail('smoke:pipeline', String(err));
    process.stdout.write(`${RED}✗ (${String(err).split('\n')[0]})${RESET}\n`);
  }

  // ── Tier 3: Live sidecar probe ─────────────────────────────────────────
  if (offline) {
    process.stdout.write(dim('  sidecar... skipped (--offline)\n'));
  } else {
    process.stdout.write(dim('  sidecar... '));
    await new Promise<void>((resolve_) => {
      const target = SidecarRuntimeFiles.healthRequest();
      if (!target) {
        addWarn('smoke:sidecar', 'no valid published sidecar port — start the app first');
        process.stdout.write(`${YELLOW}–${RESET}\n`);
        resolve_();
        return;
      }
      const req = http.get(target.url, { timeout: 2000, headers: target.headers }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += String(chunk); });
        res.on('end', () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            addWarn('smoke:sidecar', 'responded but returned non-JSON');
            process.stdout.write(`${YELLOW}–${RESET}\n`);
            resolve_();
            return;
          }
          // Assert the health contract, not just "parses as JSON" — a sidecar
          // that responds with the wrong shape is broken, not healthy.
          const summary = res.statusCode === 200 ? summarizeSidecarHealth(parsed) : null;
          if (!summary) {
            addWarn('smoke:sidecar', 'responded but returned an unexpected health schema');
            process.stdout.write(`${YELLOW}–${RESET}\n`);
            resolve_();
            return;
          }
          // Surface up-but-degraded: feeds erroring behind a 200 OK is exactly
          // the "green-when-broken" case a JSON-parse-only check missed.
          if (!summary.authenticated) {
            addWarn('smoke:sidecar', 'process live — authenticated diagnostics pending');
            process.stdout.write(`${YELLOW}–${RESET}\n`);
          } else if (summary.failedFeedCount > 0 || summary.keysMissing > 0) {
            addWarn('smoke:sidecar', `process live — ${summary.failedFeedCount}/${summary.feedCount} tracked feed(s) erroring, ${summary.keysMissing}/${summary.keysTotal} API keys missing`);
            process.stdout.write(`${YELLOW}–${RESET}\n`);
          } else {
            addOk('smoke:sidecar', `process live — ${summary.keysConfigured}/${summary.keysTotal} keys, ${summary.feedCount} tracked feeds`);
            process.stdout.write(`${GREEN}✓${RESET}\n`);
          }
          resolve_();
        });
      });
      req.on('error', () => {
        addWarn('smoke:sidecar', 'not reachable — start the app or run `npm run dev` first');
        process.stdout.write(`${YELLOW}–${RESET}\n`);
        resolve_();
      });
      req.on('timeout', () => {
        req.destroy();
        addWarn('smoke:sidecar', 'connection timed out (2s)');
        process.stdout.write(`${YELLOW}–${RESET}\n`);
        resolve_();
      });
    });
  }

  // ── Report ───────────────────────────────────────────────────────────────
  const exitCode = issues.length > 0 ? 2 : warnings.length > 0 ? 1 : 0;
  const statusColor = exitCode === 0 ? GREEN : exitCode === 1 ? YELLOW : RED;
  const statusLabel = exitCode === 0 ? 'GREEN' : exitCode === 1 ? 'YELLOW' : 'RED';
  console.log(`\n${bold(`─── Crystal Ball Smoke ─── ${statusColor}${statusLabel}${RESET}`)}`);
  for (const p of passes) {
    console.log(`  ${GREEN}✓${RESET} ${p.label}${p.detail ? `  ${DIM}${p.detail}${RESET}` : ''}`);
  }
  for (const w of warnings) {
    console.log(`  ${YELLOW}⚠${RESET} ${w.label}${w.detail ? `  ${DIM}${w.detail}${RESET}` : ''}`);
  }
  for (const f of issues) {
    console.log(`  ${RED}✗${RESET} ${f.label}${f.detail ? `\n    ${f.detail}` : ''}`);
  }
  process.exit(exitCode);
}

/** Re-export for checkup.mjs to call directly without re-running the full smoke. */
export function compareReplayBaseline(): { ok: boolean; mismatches: string[] } {
  if (!existsSync(BASELINE_PATH)) {
    return { ok: false, mismatches: ['Baseline file not found'] };
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as ReplayBaseline;
  const result = runReplay({ fixtures: buildCatalogReplayFixtures(), generatedAt: 0 });
  const { ok, mismatches } = compareReplayReportToBaseline(result, baseline);
  return { ok, mismatches };
}
