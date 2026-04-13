// e2e/design-system.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Design System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('tokens are loaded', async ({ page }) => {
    const surfaceBase = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--surface-base').trim()
    );
    expect(surfaceBase).toBe('#0a0a0a');
  });

  test('severity tokens exist', async ({ page }) => {
    const critical = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--severity-critical').trim()
    );
    expect(critical).toBe('#ef4444');
  });

  test('shimmer animation is defined', async ({ page }) => {
    const hasShimmer = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSKeyframesRule && rule.name === 'cb-shimmer') return true;
          }
        } catch { /* cross-origin */ }
      }
      return false;
    });
    expect(hasShimmer).toBe(true);
  });
});
