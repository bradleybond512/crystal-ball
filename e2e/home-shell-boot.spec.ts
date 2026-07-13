import { expect, test } from '@playwright/test';

// Phase 2: the Home Shell is the default opening surface (full variant, desktop).
test.describe('home shell default boot', () => {
  test('boots into the shell and Escape returns to classic', async ({ page }) => {
    await page.goto('/');
    const shell = page.locator('.home-shell');
    await expect(shell).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('body')).toHaveClass(/home-shell-active/);
    await page.keyboard.press('Escape');
    await expect(shell).toBeHidden();
    await expect(page.locator('body')).not.toHaveClass(/home-shell-active/);
  });

  test('classic-view flag boots classic with no shell in DOM', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('crystalball-classic-view', '1'));
    await page.goto('/');
    await expect(page.locator('.mac-sidebar, .header').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.home-shell')).toHaveCount(0);
  });

  test('dossier opens from an injected situation and Escape closes drawer only', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.home-shell')).toBeVisible({ timeout: 30_000 });
    await page.evaluate(async () => {
      const mod = await import('/src/services/insights/insights-state.ts');
      mod.setRecentEvents([
        {
          eventId: 'e2e-sit',
          description: 'E2E synthetic storm',
          domain: 'weather',
          severity: 90,
          at: Date.now(),
          location: { latitude: 41.6, longitude: -86.7 },
        },
      ]);
      mod.setActiveSituation({
        id: 'e2e-sit',
        title: 'E2E synthetic storm',
        category: 'severe_weather',
        severityScore: 90,
        confidence: 'high',
      });
    });
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('cb:open-dossier', { detail: { situationId: 'e2e-sit' } }));
    });
    const drawer = page.locator('.hs-dossier');
    await expect(drawer).toHaveClass(/hs-dossier--open/);
    await expect(page.locator('.hs-dossier .hs-card').first()).toBeVisible();
    await expect(page.locator('.hs-dossier-badge')).toHaveText('ACT SOON · HIGH CONF');
    await page.keyboard.press('Escape');
    await expect(drawer).not.toHaveClass(/hs-dossier--open/);
    await expect(page.locator('.home-shell')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/home-shell-active/);
  });

  test('deck card opens the panel in the focus host and Escape restores it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.home-shell')).toBeVisible({ timeout: 30_000 });
    // Scroll the deck into view and open the first pinned card.
    const firstCard = page.locator('.hs-deck-grid .hs-card').first();
    await firstCard.scrollIntoViewIfNeeded();
    const panelKey = await firstCard.getAttribute('data-panel-key');
    await firstCard.click();
    const focus = page.locator('.hs-focus');
    await expect(focus).toHaveClass(/hs-focus--open/, { timeout: 10_000 });
    // The REAL panel element is inside the host.
    await expect(page.locator(`.hs-focus-body [data-panel="${panelKey}"]`)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(focus).not.toHaveClass(/hs-focus--open/);
    // Panel returned to the classic grid.
    await expect(page.locator(`#panelsGrid [data-panel="${panelKey}"]`)).toHaveCount(1);
    await expect(page.locator('.home-shell')).toBeVisible();
  });
});
