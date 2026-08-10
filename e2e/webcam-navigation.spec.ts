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
    localStorage.setItem('mobile-warning-dismissed', 'true');
    localStorage.setItem('wm-analytics-consent', 'false');
    localStorage.setItem('wm-analytics-consent-prompt-seen', 'true');
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

test('FAA map popup requests and reveals a resolved frame', async ({ page }) => {
  const resolvedImageUrl = 'https://api.weather.gov/e2e-faa-camera.png';
  let imageRequests = 0;

  await page.setViewportSize({ width: 900, height: 420 });

  await page.route('http://127.0.0.1:46123/api/faa-camera-image?cameraId=11914', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ imageUrl: resolvedImageUrl, frames: [] }),
    });
  });
  await page.route(resolvedImageUrl, async (route) => {
    imageRequests += 1;
    await route.fulfill({ contentType: 'image/png', body: CAMERA_IMAGE });
  });
  await page.goto('/?e2e=ui-only');

  await page.evaluate(async () => {
    const modulePath = '/src/components/MapPopup.ts';
    const { MapPopup } = await import(/* @vite-ignore */ modulePath);
    const container = document.createElement('div');
    document.body.append(container);
    const popup = new MapPopup(container);
    popup.show({
      type: 'faaCamera',
      data: {
        id: '11914',
        name: 'Monument Hill/Kelly Air Park - Camera 2',
        lat: 37.5969,
        lon: -105.2035,
        state: 'CO',
        category: 'remote',
        imageUrl: '/api/faa-camera-image?cameraId=11914',
        isOnline: true,
        lastUpdated: '2026-08-10T05:53:28.994Z',
        alertProximityMi: null,
        alertLabel: null,
        relevanceScore: 30,
        aiConditions: null,
      },
      x: 100,
      y: 100,
    });
  });

  const image = page.locator('[data-faa-camera-image]');
  await expect(image).toHaveAttribute('loading', 'eager');
  await expect.poll(() => imageRequests).toBe(1);
  await expect.poll(async () => image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);
  await expect(image).toBeVisible();
  await expect(page.locator('[data-faa-camera-status]')).toHaveCount(0);

  const popup = page.locator('.map-popup.map-popup-faa-camera');
  const body = popup.locator('.faa-camera-popup-body');
  const close = popup.locator('.popup-close');
  await expect(popup).toBeVisible();
  await expect(close).toBeVisible();

  const layout = await popup.evaluate((element) => {
    const popupElement = element as HTMLElement;
    const popupBody = popupElement.querySelector<HTMLElement>('.faa-camera-popup-body');
    const header = popupElement.querySelector<HTMLElement>('.faa-camera-popup-header');
    const frame = popupElement.querySelector<HTMLElement>('.faa-camera-frame');
    const imageElement = popupElement.querySelector<HTMLElement>('.faa-camera-frame-image');
    const probe = document.createElement('span');
    probe.style.color = 'var(--red)';
    document.body.append(probe);
    const criticalRed = getComputedStyle(probe).color;
    probe.remove();
    const popupStyle = getComputedStyle(popupElement);
    const bodyStyle = popupBody ? getComputedStyle(popupBody) : null;
    const popupRect = popupElement.getBoundingClientRect();
    const frameRect = frame?.getBoundingClientRect();
    const imageRect = imageElement?.getBoundingClientRect();

    return {
      viewportHeight: window.innerHeight,
      popupTop: popupRect.top,
      popupBottom: popupRect.bottom,
      popupOverflowY: popupStyle.overflowY,
      popupScrollHeight: popupElement.scrollHeight,
      popupClientHeight: popupElement.clientHeight,
      borderColor: popupStyle.borderTopColor,
      criticalRed,
      borderRadius: Number.parseFloat(popupStyle.borderTopLeftRadius),
      bodyOverflowY: bodyStyle?.overflowY,
      bodyScrollHeight: popupBody?.scrollHeight ?? 0,
      bodyClientHeight: popupBody?.clientHeight ?? 0,
      headerTop: header?.getBoundingClientRect().top ?? 0,
      frameWidth: frameRect?.width ?? 0,
      frameHeight: frameRect?.height ?? 0,
      imageWidth: imageRect?.width ?? 0,
      imageHeight: imageRect?.height ?? 0,
      imageObjectFit: imageElement ? getComputedStyle(imageElement).objectFit : '',
    };
  });

  expect(layout.popupTop).toBeGreaterThanOrEqual(16);
  expect(layout.popupBottom).toBeLessThanOrEqual(layout.viewportHeight - 16);
  expect(layout.popupOverflowY).toBe('hidden');
  expect(layout.popupScrollHeight).toBe(layout.popupClientHeight);
  expect(layout.borderColor).not.toBe(layout.criticalRed);
  expect(layout.borderRadius).toBeGreaterThanOrEqual(8);
  expect(layout.bodyOverflowY).toBe('auto');
  expect(layout.bodyScrollHeight).toBeGreaterThan(layout.bodyClientHeight);
  expect(layout.frameWidth).toBeGreaterThan(0);
  expect(layout.frameHeight).toBeGreaterThan(0);
  expect(layout.imageWidth).toBeLessThanOrEqual(layout.frameWidth);
  expect(layout.imageHeight).toBeLessThanOrEqual(layout.frameHeight);
  expect(layout.imageObjectFit).toBe('contain');

  await close.focus();
  await page.keyboard.press('Tab');
  await expect(body).toBeFocused();
  const focusStyle = await body.evaluate((element) => {
    const style = getComputedStyle(element);
    return { offset: style.outlineOffset, width: style.outlineWidth };
  });
  expect(focusStyle).toEqual({ offset: '-2px', width: '2px' });
  await page.keyboard.press('PageDown');
  await expect.poll(async () => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(close).toBeVisible();
  await expect.poll(async () => popup.locator('.faa-camera-popup-header').evaluate((element) => (
    element.getBoundingClientRect().top
  ))).toBe(layout.headerTop);

  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
});

test('FAA map popup stays usable as a mobile camera sheet', async ({ page }) => {
  const resolvedImageUrl = 'https://api.weather.gov/e2e-faa-camera-mobile.png';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('http://127.0.0.1:46123/api/faa-camera-image?cameraId=11914', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ imageUrl: resolvedImageUrl, frames: [] }),
    });
  });
  await page.route(resolvedImageUrl, async (route) => {
    await route.fulfill({ contentType: 'image/png', body: CAMERA_IMAGE });
  });
  await page.goto('/?e2e=ui-only');

  await page.evaluate(async () => {
    const modulePath = '/src/components/MapPopup.ts';
    const { MapPopup } = await import(/* @vite-ignore */ modulePath);
    const container = document.createElement('div');
    document.body.append(container);
    const popup = new MapPopup(container);
    popup.show({
      type: 'faaCamera',
      data: {
        id: '11914',
        name: 'Monument Hill/Kelly Air Park - Camera 2 With A Long Mobile Title',
        lat: 37.5969,
        lon: -105.2035,
        state: 'CO',
        category: 'remote',
        imageUrl: '/api/faa-camera-image?cameraId=11914',
        isOnline: true,
        lastUpdated: '2026-08-10T05:53:28.994Z',
        alertProximityMi: null,
        alertLabel: null,
        relevanceScore: 30,
        aiConditions: null,
      },
      x: 100,
      y: 100,
    });
  });

  const popup = page.locator('.map-popup.map-popup-faa-camera.map-popup-sheet');
  const image = popup.locator('[data-faa-camera-image]');
  await expect(popup).toBeVisible();
  await expect.poll(async () => image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);
  await expect(image).toBeVisible();

  const layout = await popup.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const frame = element.querySelector<HTMLElement>('.faa-camera-frame')?.getBoundingClientRect();
    const image = element.querySelector<HTMLElement>('.faa-camera-frame-image')?.getBoundingClientRect();
    const title = element.querySelector<HTMLElement>('.popup-title');
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      frameLeft: frame?.left ?? 0,
      frameTop: frame?.top ?? 0,
      frameRight: frame?.right ?? 0,
      frameBottom: frame?.bottom ?? 0,
      frameWidth: frame?.width ?? 0,
      frameHeight: frame?.height ?? 0,
      imageLeft: image?.left ?? 0,
      imageTop: image?.top ?? 0,
      imageRight: image?.right ?? 0,
      imageBottom: image?.bottom ?? 0,
      titleScrollWidth: title?.scrollWidth ?? 0,
      titleClientWidth: title?.clientWidth ?? 0,
    };
  });
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.frameWidth).toBeGreaterThan(0);
  expect(layout.frameHeight).toBeGreaterThan(0);
  expect(layout.frameWidth).toBeLessThanOrEqual(layout.viewportWidth - 32);
  expect(layout.frameWidth / layout.frameHeight).toBeCloseTo(4 / 3, 2);
  expect(layout.imageLeft).toBeGreaterThanOrEqual(layout.frameLeft - 1);
  expect(layout.imageTop).toBeGreaterThanOrEqual(layout.frameTop - 1);
  expect(layout.imageRight).toBeLessThanOrEqual(layout.frameRight + 1);
  expect(layout.imageBottom).toBeLessThanOrEqual(layout.frameBottom + 1);
  expect(layout.titleScrollWidth).toBeLessThanOrEqual(layout.titleClientWidth + 1);

  await popup.locator('.popup-close').click();
  await expect(popup).toHaveCount(0);
});
