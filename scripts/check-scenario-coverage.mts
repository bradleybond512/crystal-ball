#!/usr/bin/env tsx
/**
 * Scenario Coverage Spot-Check — gate for release-doctor and CI.
 *
 * Plan: docs/CLAUDE_POST_PR197_INTEGRATION_HANDOFF_2026-04-28.md item 6.
 *
 * The scenario library underpins replay-fixture testing across the
 * eight mission domains. If a refactor accidentally drops coverage
 * (deletes scenarios, removes a domain), this gate fires before the
 * release goes out.
 *
 * Floors:
 *   - At least one scenario per mission domain (8 domains total).
 *   - At least MIN_TOTAL scenarios overall (so we don't degrade to a
 *     skeleton).
 *
 * Pure read: no DOM, no fetch. Exits 0 on pass, 1 on failure with a
 * plan-readable message.
 */

import { summarizeScenarioCoverage, listScenarios } from '../src/services/scenarios/scenario-library';

const MISSION_DOMAINS = [
  'weather_safety',
  'conflict_escalation',
  'cyber_exposure',
  'food_commodity_shortage',
  'energy_fuel_stress',
  'travel_disruption',
  'market_portfolio_risk',
  'local_infrastructure',
] as const;

/** Minimum total scenarios required. Below this we count it as a regression. */
const MIN_TOTAL = 8;

function main(): void {
  const coverage = summarizeScenarioCoverage();
  const scenarios = listScenarios();

  const issues: string[] = [];

  if (coverage.totalScenarios < MIN_TOTAL) {
    issues.push(
      `total scenarios ${coverage.totalScenarios} < floor ${MIN_TOTAL}`,
    );
  }

  for (const domain of MISSION_DOMAINS) {
    const count = coverage.byDomain[domain] ?? 0;
    if (count < 1) {
      issues.push(`mission domain "${domain}" has 0 scenarios (need ≥1)`);
    }
  }

  // Sanity: ids must be unique. Catches copy-paste regressions early.
  const seen = new Set<string>();
  for (const s of scenarios) {
    if (seen.has(s.id)) {
      issues.push(`duplicate scenario id: ${s.id}`);
    }
    seen.add(s.id);
  }

  if (issues.length > 0) {
    console.error('[scenario-coverage] Blocked:');
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  const summary = MISSION_DOMAINS.map((d) => `${d}=${coverage.byDomain[d] ?? 0}`).join(', ');
  console.log(`[scenario-coverage] OK total=${coverage.totalScenarios} ${summary}`);
}

main();
