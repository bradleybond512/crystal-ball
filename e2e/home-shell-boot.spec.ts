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
});
