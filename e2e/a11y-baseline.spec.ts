/**
 * Accessibility baseline scan using axe-core.
 *
 * Establishes a baseline of known a11y violations per panel/view. New
 * violations should fail CI; existing violations are expected until the
 * full remediation pass (TODO-019 Phase 2).
 *
 * To regenerate the baseline after a panel change:
 *   UPDATE_A11Y_BASELINE=1 VITE_VARIANT=full npx playwright test e2e/a11y-baseline.spec.ts
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// __dirname does not exist in ES-module scope; without this shim the spec
// throws at collection time, which silently aborts every Playwright batch
// that includes this file.
const BASELINE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'a11y-baseline.json');

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

// The baseline is recorded against the full variant. The tech/finance e2e
// sweeps run every spec in e2e/, but their panel sets lack several scan
// targets — the fast-fail below would fail those runs, not skip them.
// Unset VITE_VARIANT resolves to 'full', mirroring src/services/runtime.ts.
test.skip((process.env.VITE_VARIANT ?? 'full') !== 'full', 'a11y baseline is recorded against the full variant');

// Panel ids must exist in FULL_PANELS (src/config/panels.ts) and be reachable
// via cb:navigate-panel. 'dashboard-root' scans the whole page instead.
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Skip the first-run WelcomeFlow modal — its backdrop would sit on top of
    // every panel and pollute the scans.
    localStorage.setItem('cb:onboarding-complete', 'true');
    // This spec exercises the classic UI — opt out of the default-on Home Shell.
    localStorage.setItem('crystalball-classic-view', '1');
  });
});

for (const panelId of PANELS_TO_SCAN) {
  test(`a11y baseline: ${panelId}`, async ({ page }) => {
    if (panelId === 'dashboard-root') test.setTimeout(180_000);
    await page.goto('/');
    // Boot is far enough along once the grid holds a mounted panel — the
    // cb:navigate-panel listener registers earlier in the same createPanels()
    // pass, so dispatching after this point cannot race it.
    await page.waitForSelector('#panelsGrid > [data-panel]', { timeout: 60_000 });

    let builder: AxeBuilder;
    if (panelId === 'dashboard-root') {
      await page.waitForTimeout(1500);
      builder = new AxeBuilder({ page });
    } else {
      // Panels lazy-mount: navigate first (mounts + scrolls into view), then
      // fail fast if the panel never appears — axe's include() would
      // otherwise poll an empty selector for the full 90s test timeout.
      await page.evaluate((key) => {
        document.dispatchEvent(new CustomEvent('cb:navigate-panel', { detail: { panelKey: key } }));
      }, panelId);
      const panelSelector = `#panelsGrid > [data-panel="${panelId}"]`;
      await expect(
        page.locator(panelSelector),
        `panel '${panelId}' never mounted — removed from this variant, renamed, or disabled?`,
      ).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(500);
      builder = new AxeBuilder({ page }).include(panelSelector);
      if (panelId === 'live-news') {
        const embeds = page.locator(`${panelSelector} iframe`);
        for (let index = 0; index < await embeds.count(); index++) {
          await expect(embeds.nth(index)).toHaveAttribute('title', /\S+/);
        }
        builder.exclude({ fromFrames: [`${panelSelector} iframe`, '*'] });
      }
    }

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

    const newViolations = violationIds.filter(id => !previous.violationIds.includes(id));
    const violationDetails = results.violations.map(violation => {
      const targets = violation.nodes
        .flatMap(node => node.target)
        .slice(0, 5)
        .join(', ');
      return `${violation.id} (${violation.impact ?? 'unknown'}): ${targets}`;
    }).join('; ');

    expect(
      newViolations,
      `[a11y] New violation types for ${panelId}: ${newViolations.join(', ')}. Current findings: ${violationDetails}`,
    ).toEqual([]);
    expect(
      entry.violationCount,
      `[a11y] Violation count increased for ${panelId}. Current findings: ${violationDetails}`,
    ).toBeLessThanOrEqual(previous.violationCount);
  });
}
