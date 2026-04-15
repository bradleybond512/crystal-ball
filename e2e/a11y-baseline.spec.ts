/**
 * Accessibility baseline scan using axe-core.
 *
 * Establishes a baseline of known a11y violations per panel/view. New
 * violations should fail CI; existing violations are expected until the
 * full remediation pass (TODO-019 Phase 2).
 *
 * To regenerate the baseline after a panel change:
 *   UPDATE_A11Y_BASELINE=1 npm run test:e2e:runtime -- a11y-baseline
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASELINE_PATH = join(__dirname, 'a11y-baseline.json');

interface BaselineEntry {
  panel: string;
  violationCount: number;
  violationIds: string[];
  updatedAt: string;
}

function loadBaseline(): Record<string, BaselineEntry> {
  if (!existsSync(BASELINE_PATH)) return {};
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as Record<string, BaselineEntry>;
}

function saveBaseline(baseline: Record<string, BaselineEntry>): void {
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
}

const PANELS_TO_SCAN = [
  'dashboard-root',
  'insights',
  'alert-center',
  'unified-alert-inbox',
  'correlation-matrix',
  'strike-packages',
  'markets',
  'live-news',
];

for (const panelId of PANELS_TO_SCAN) {
  test(`a11y baseline: ${panelId}`, async ({ page }) => {
    await page.goto('/');
    // Wait for app to bootstrap
    await page.waitForSelector('body', { timeout: 10_000 });
    await page.waitForTimeout(1500);

    const builder = panelId === 'dashboard-root'
      ? new AxeBuilder({ page })
      : new AxeBuilder({ page }).include(`[data-panel-id="${panelId}"], #${panelId}, .panel-${panelId}`);

    const results = await builder.analyze();
    const violationIds = results.violations.map(v => v.id).sort();
    const entry: BaselineEntry = {
      panel: panelId,
      violationCount: results.violations.length,
      violationIds,
      updatedAt: new Date().toISOString(),
    };

    const baseline = loadBaseline();
    const previous = baseline[panelId];

    if (process.env.UPDATE_A11Y_BASELINE === '1') {
      baseline[panelId] = entry;
      saveBaseline(baseline);
      console.log(`[a11y] Updated baseline for ${panelId}: ${entry.violationCount} violations`);
      return;
    }

    if (!previous) {
      console.warn(`[a11y] No baseline for ${panelId}; current: ${entry.violationCount} violations. Set UPDATE_A11Y_BASELINE=1 to record.`);
      return;
    }

    // Fail if violations INCREASED vs baseline (regression)
    expect(entry.violationCount).toBeLessThanOrEqual(previous.violationCount);

    // Log new violation IDs that weren't in the baseline
    const newViolations = violationIds.filter(id => !previous.violationIds.includes(id));
    if (newViolations.length > 0) {
      console.warn(`[a11y] New violation types for ${panelId}: ${newViolations.join(', ')}`);
    }
  });
}
