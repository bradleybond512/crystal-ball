import { expect, test, type Page } from '@playwright/test';

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2NDWQAAAABJRU5ErkJggg==',
  'base64',
);

const expectActive = async (page: Page) => {
  await expect(page.locator('.gods-vision-container')).toHaveClass(/gods-vision-active/, { timeout: 15000 });
};

test.describe("God's Eye Mode", () => {
  test.beforeEach(async ({ page, baseURL }) => {
	const appOrigin = new URL(baseURL ?? 'http://127.0.0.1:4173').origin;
	await page.route('**/*', async (route) => {
	  const url = new URL(route.request().url());
	  if (url.origin === appOrigin && !url.pathname.startsWith('/api/')) {
		await route.continue();
		return;
	  }
	  const headers = { 'access-control-allow-origin': '*' };
	  if (route.request().resourceType() === 'image' || url.pathname.endsWith('.png')) {
		await route.fulfill({ status: 200, headers, contentType: 'image/png', body: PIXEL });
		return;
	  }
	  await route.fulfill({ status: 200, headers, contentType: 'application/json', body: '[]' });
	});

	// This spec exercises the classic UI — opt out of the default-on Home Shell.
	await page.addInitScript(() => {
	  localStorage.setItem('crystalball-classic-view', '1');
	  localStorage.setItem('cb:onboarding-complete', 'true');
	  localStorage.setItem('wm-analytics-consent', 'false');
	  localStorage.setItem('wm-analytics-consent-prompt-seen', 'true');
	});
 await page.goto('/?e2e=ui-only');
 await page.waitForSelector('.mac-sidebar, .header', { timeout: 10000 });
 await page.evaluate(() => import('/src/components/GodsVisionView.ts'));
  });

  test("God's Eye button exists in sidebar", async ({ page }) => {
 const btn = page.locator('#godsVisionBtn');
 await expect(btn).toBeVisible();
  });

  test('activates on button click and deactivates on ESC', async ({ page }) => {
 await page.click('#godsVisionBtn');

 const container = page.locator('.gods-vision-container');
 await expectActive(page);

 await expect(page.locator('#geExitBtn')).toBeVisible();

 await page.keyboard.press('Escape');
 await expect(container).not.toHaveClass(/gods-vision-active/, { timeout: 2000 });
  });

  test('activates on G key press', async ({ page }) => {
 await page.keyboard.press('g');

 await expectActive(page);
  });

 test('HUD displays camera information', async ({ page }) => {
 await page.click('#godsVisionBtn');
 await expectActive(page);

 await expect(page.locator('.ge-hud-threat-card')).toBeVisible();
 await expect(page.locator('.ge-hud-coord')).toBeVisible();
 await expect(page.locator('#geLayerBar')).toBeVisible();
  });

 test('layer toggle bar has expected layers', async ({ page }) => {
 await page.click('#godsVisionBtn');
 await expectActive(page);

 const layerButtons = page.locator('.ge-layer-btn');
 const count = await layerButtons.count();
 expect(count).toBeGreaterThanOrEqual(5);
  });

 test('uses the neutral theme by default', async ({ page }) => {
 await page.click('#godsVisionBtn');
 await expectActive(page);

 const container = page.locator('.gods-vision-container');
 await expect(container).not.toHaveClass(/ge-mode-ghost/);
 await expect(container).not.toHaveClass(/ge-mode-gods-vision/);
  });

 test('auto-follow layer button exists', async ({ page }) => {
 await page.click('#godsVisionBtn');
 await expectActive(page);

 const afBtn = page.locator('.ge-layer-btn[data-layer="autoFollow"]');
 await expect(afBtn).toBeVisible();
  });

 test('auto-follow card is hidden by default', async ({ page }) => {
 await page.click('#godsVisionBtn');
 await expectActive(page);

 const card = page.locator('.ge-autofollow-card');
 await expect(card).toHaveClass(/ge-hidden/);
  });
});
