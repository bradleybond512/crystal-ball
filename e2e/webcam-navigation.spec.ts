import { expect, test, type Page } from '@playwright/test';

const CAMERA_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2NDWQAAAABJRU5ErkJggg==',
  'base64',
);

const browserErrors = new WeakMap<Page, string[]>();
const EXPECTED_HARNESS_ERROR = [
  /^console\.error: Connecting to 'https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\//,
  /^console\.error: Fetch API cannot load https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/terrarium\//,
  /^console\.error: Framing 'http:\/\/127\.0\.0\.1:46123\/' violates/,
  /^console\.error: luma\.gl: This version of luma\.gl has already been initialized$/,
  /^pageerror: Failed to read the 'localStorage' property from 'Window': Access is denied for this document\.$/,
];

test.beforeEach(async ({ page, baseURL }) => {
  const appOrigin = new URL(baseURL ?? 'http://127.0.0.1:4173').origin;
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin && url.pathname.startsWith('/map-styles/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 8,
          sources: {},
          layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#0b0e12' } }],
        }),
      });
      return;
    }
    if (url.origin === appOrigin && !url.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    const resourceType = route.request().resourceType();
    const headers = { 'access-control-allow-origin': '*' };
    if (resourceType === 'image' || url.pathname.endsWith('.png') || url.pathname.includes('/tile/')) {
      await route.fulfill({ status: 200, headers, contentType: 'image/png', body: CAMERA_IMAGE });
      return;
    }
    if (url.pathname.endsWith('/tiles.json')) {
      await route.fulfill({
        status: 200,
        headers,
        contentType: 'application/json',
        body: JSON.stringify({ tilejson: '3.0.0', tiles: [], minzoom: 0, maxzoom: 0 }),
      });
      return;
    }
    if (resourceType === 'document') {
      await route.fulfill({ status: 200, headers, contentType: 'text/html', body: '<!doctype html>' });
      return;
    }
    await route.fulfill({ status: 200, headers, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/webcams*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ updatedAt: 0, feeds: [] }),
    });
  });

  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI__', {
      value: {
        core: { invoke: async () => null },
        event: { listen: async () => () => {} },
      },
      configurable: true,
    });
    localStorage.setItem('crystalball-classic-view', '1');
  });
});

test.afterEach(async ({ page }) => {
  await page.waitForTimeout(250);
  assertNoBrowserErrors(page);
});

function assertNoBrowserErrors(page: Page): void {
  const unexpected = (browserErrors.get(page) ?? []).filter((message) => (
    !EXPECTED_HARNESS_ERROR.some((pattern) => pattern.test(message))
  ));
  expect(unexpected, 'unexpected browser errors').toEqual([]);
}

test('webcam sidebar entries navigate to visible panels', async ({ page }) => {
  await page.goto('/?e2e=ui-only');
  await page.waitForSelector('.mac-sidebar-panel-item[data-panel-key="live-webcams"]', {
    timeout: 30_000,
  });

  for (const key of ['live-webcams', 'unified-webcams', 'pinned-webcams']) {
    const button = page.locator(`.mac-sidebar-panel-item[data-panel-key="${key}"]`);
    const panel = page.locator(`.panel[data-panel="${key}"]`);

    await button.click();
    await expect(panel).toBeVisible();
    await expect.poll(async () => {
      const [mainBox, panelBox] = await Promise.all([
        page.locator('.main-content').boundingBox(),
        panel.boundingBox(),
      ]);
      const viewport = page.viewportSize();
      if (!mainBox || !panelBox || !viewport) return false;
      return panelBox.y < viewport.height && panelBox.y + panelBox.height > mainBox.y;
    }).toBe(true);
  }
});

test('clicking a webcam card opens a rendered viewer', async ({ page }) => {
  await page.route('http://127.0.0.1:46123/api/webcams*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        updatedAt: Math.floor(Date.now() / 1000),
        feeds: [{
          id: 'test-camera',
          source: 'NPS',
          name: 'Release Test Camera',
          lat: 40,
          lon: -105,
          snapshotUrl: 'https://api.weather.gov/e2e-camera.png',
          refreshIntervalSec: 300,
          category: 'nature',
          metadata: { attribution: 'Release test' },
        }],
      }),
    });
  });
  await page.route('https://api.weather.gov/e2e-camera.png*', async (route) => {
    await route.fulfill({ contentType: 'image/png', body: CAMERA_IMAGE });
  });
  await page.goto('/?e2e=ui-only');

  const button = page.locator('.mac-sidebar-panel-item[data-panel-key="unified-webcams"]');
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();

  const card = page.locator('.webcam-card').filter({ hasText: 'Release Test Camera' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();

  const viewer = page.locator('.webcam-viewer');
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText('Release Test Camera');
  await expect.poll(async () => viewer.locator('img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
});
