import { expect, test } from '@playwright/test';

test.describe("God's Eye Mode", () => {
  test.beforeEach(async ({ page }) => {
 // This spec exercises the classic UI — opt out of the default-on Home Shell.
 await page.addInitScript(() => localStorage.setItem('crystalball-classic-view', '1'));
 await page.goto('/');
 await page.waitForSelector('.mac-sidebar, .header', { timeout: 10000 });
  });

  test("God's Eye button exists in sidebar", async ({ page }) => {
 const btn = page.locator('#godsVisionBtn');
 await expect(btn).toBeVisible();
  });

  test('activates on button click and deactivates on ESC', async ({ page }) => {
 await page.click('#godsVisionBtn');

 const container = page.locator('.gods-vision-container');
 await expect(container).toHaveClass(/gods-vision-active/, { timeout: 5000 });

 await expect(page.locator('#geExitBtn')).toBeVisible();

 await page.keyboard.press('Escape');
 await expect(container).not.toHaveClass(/gods-vision-active/, { timeout: 2000 });
  });

  test('activates on G key press', async ({ page }) => {
 await page.keyboard.press('g');

 const container = page.locator('.gods-vision-container');
 await expect(container).toHaveClass(/gods-vision-active/, { timeout: 5000 });
  });

  test('HUD displays camera information', async ({ page }) => {
 await page.click('#godsVisionBtn');
 await page.waitForSelector('.gods-vision-active', { timeout: 5000 });

 await expect(page.locator('.ge-hud-threat')).toBeVisible();
 await expect(page.locator('.ge-hud-camera')).toBeVisible();
 await expect(page.locator('#geLayerBar')).toBeVisible();
  });

  test('layer toggle bar has expected layers', async ({ page }) => {
 await page.click('#godsVisionBtn');
 await page.waitForSelector('.gods-vision-active', { timeout: 5000 });

 const layerButtons = page.locator('.ge-layer-btn');
 const count = await layerButtons.count();
 expect(count).toBeGreaterThanOrEqual(5);
  });

  test('mode badge is visible and shows PEACE by default', async ({ page }) => {
 await page.click('#godsVisionBtn');
 await page.waitForSelector('.gods-vision-active', { timeout: 5000 });

 const badge = page.locator('.ge-mode-badge');
 await expect(badge).toBeVisible();
 await expect(badge).toHaveText('PEACE');
  });

  test('auto-follow layer button exists', async ({ page }) => {
 await page.click('#godsVisionBtn');
 await page.waitForSelector('.gods-vision-active', { timeout: 5000 });

 const afBtn = page.locator('.ge-layer-btn[data-layer="autoFollow"]');
 await expect(afBtn).toBeVisible();
  });

  test('auto-follow card is hidden by default', async ({ page }) => {
 await page.click('#godsVisionBtn');
 await page.waitForSelector('.gods-vision-active', { timeout: 5000 });

 const card = page.locator('.ge-autofollow-card');
 await expect(card).toHaveClass(/ge-hidden/);
  });
});
