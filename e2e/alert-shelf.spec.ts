import { expect, test, type Page } from '@playwright/test';

const PIXEL = Buffer.from(
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
    const headers = { 'access-control-allow-origin': '*' };
    if (route.request().resourceType() === 'image' || url.pathname.endsWith('.png')) {
      await route.fulfill({ status: 200, headers, contentType: 'image/png', body: PIXEL });
      return;
    }
    await route.fulfill({ status: 200, headers, contentType: 'application/json', body: '[]' });
  });

  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI__', {
      value: {
        core: { invoke: async () => null },
        event: { listen: async () => () => {} },
      },
      configurable: true,
    });
    localStorage.setItem('cb:onboarding-complete', 'true');
    localStorage.setItem('crystalball-classic-view', '1');
    localStorage.setItem('wm-analytics-consent', 'false');
    localStorage.setItem('mobile-warning-dismissed', 'true');
  });
});

test.afterEach(async ({ page }) => {
  await page.waitForTimeout(250);
  const unexpected = (browserErrors.get(page) ?? []).filter((message) => (
    !EXPECTED_HARNESS_ERROR.some((pattern) => pattern.test(message))
  ));
  expect(unexpected, 'unexpected browser errors').toEqual([]);
});

async function showAlertShelf(page: Page): Promise<void> {
  await page.goto('/?e2e=ui-only');
  await page.waitForSelector('.mac-shell', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => ![...document.body.children].some((element) => (
    element instanceof HTMLElement
    && element.style.zIndex === '9999'
    && element.querySelector('canvas') !== null
  )));

  await page.evaluate(async () => {
    const alertStorePath = '/src/services/unified-alerts.ts';
    const notificationStackPath = '/src/components/NotificationStack.ts';
    const stormModePath = '/src/components/PersonalStormMode.ts';
    const triageBarPath = '/src/components/TriageBar.ts';
    const [
      { unifiedAlertStore, _setNotifyThrottleForTest },
      { notificationStack },
      { PersonalStormMode },
      { TriageBar },
    ] = await Promise.all([
      import(/* @vite-ignore */ alertStorePath),
      import(/* @vite-ignore */ notificationStackPath),
      import(/* @vite-ignore */ stormModePath),
      import(/* @vite-ignore */ triageBarPath),
    ]);

    if (!notificationStack.element.isConnected) notificationStack.mount(document.body);
    let stormMount = document.getElementById('cb-storm-mode-mount');
    if (!stormMount) {
      stormMount = document.createElement('div');
      stormMount.id = 'cb-storm-mode-mount';
      notificationStack.element.append(stormMount);
    }
    const stormMode = new PersonalStormMode({ mount: stormMount });
    const triageBar = new TriageBar();
    triageBar.mount(notificationStack.element);
    Object.assign(window, { __e2eStormMode: stormMode, __e2eTriageBar: triageBar });

    _setNotifyThrottleForTest(0);
    unifiedAlertStore.ingest([{
      id: 'e2e-critical-alert',
      source: 'nws',
      severity: 'critical',
      title: 'Damaging wind and large hail near New Carlisle AWS',
      body: 'A destructive storm is moving toward the monitored facility.',
      timestamp: Date.now(),
      relevanceScore: 99,
      acknowledged: false,
      pinned: false,
    }]);

    const now = Date.now();
    stormMode.update({
        alertId: 'e2e-storm-warning',
        matchedPlaceId: 'new-carlisle-aws',
        matchedPlaceLabel: 'New Carlisle AWS',
        match: {
          alertId: 'e2e-storm-warning',
          placeId: 'new-carlisle-aws',
          matchKind: 'inside_polygon',
          isInside: true,
          distanceKm: 0,
          hazardKind: 'severe_thunderstorm',
          event: 'Severe Thunderstorm Warning',
          severity: 'extreme',
          threatLevel: 'emergency',
          msUntilExpires: 30 * 60 * 1000,
          isUpdate: false,
          isCancellation: false,
          reason: 'Inside warning polygon for New Carlisle AWS',
        },
        urgency: {
          alertId: 'e2e-storm-warning',
          placeId: 'new-carlisle-aws',
          hazardKind: 'severe_thunderstorm',
          threatLevel: 'emergency',
          priority: 'persistent_critical',
          persistentInApp: true,
          bypassQuietHours: true,
          minRepeatIntervalMs: 10 * 60 * 1000,
          requiresAcknowledgment: false,
          reason: 'Inside warning polygon for New Carlisle AWS',
        },
        payload: {
          activation: 'critical',
          title: 'Severe Thunderstorm Warning - New Carlisle AWS',
          primaryHazard: 'severe_thunderstorm',
          mainThreatLabel: 'Damaging wind and large hail',
          closestPlaceLabel: 'New Carlisle AWS',
          distanceKm: 0,
          confidenceLabel: 'high',
          threatLevel: 'emergency',
          actions: [{
            id: 'shelter-now',
            label: 'Move away from windows now',
            priority: 1,
            estimatedMinutes: 1,
            rationale: 'Protect personnel from wind-borne debris.',
          }],
          nextUpdateLabel: 'Radar scan in 5 min',
          reason: 'Inside warning polygon for New Carlisle AWS',
          expiresAtMs: now + 30 * 60 * 1000,
          generatedAtMs: now,
        },
        diagnostic: {},
        dispatchActions: ['persistent_strip'],
        shouldSuppress: false,
        reason: 'Inside warning polygon for New Carlisle AWS',
      });
  });

  await expect(page.locator('.cb-storm-mode')).toBeVisible();
  await expect(page.locator('.triage-bar')).toBeVisible();
}

async function expectCalmStalenessRows(page: Page): Promise<void> {
  const visibleRows = page.locator([
    '.cb-offline-staleness-banner[data-status]',
    '.staleness-banner:not(.staleness-banner-hidden)',
  ].join(',')).filter({ visible: true });
  await expect(visibleRows).toHaveCount(1);
  await expect(visibleRows).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(visibleRows).toHaveCSS('background-color', 'rgba(28, 28, 30, 0.94)');
}

async function shelfGeometry(page: Page): Promise<{
  viewportWidth: number;
  documentWidth: number;
  titleColor: string;
  topBorderWidth: string;
  rightBorderWidth: string;
  stormBottom: number;
  triageTop: number;
  shelfRight: number;
  actionRightEdges: number[];
}> {
  return page.evaluate(() => {
    const storm = document.querySelector<HTMLElement>('.cb-storm-mode')!;
    const triage = document.querySelector<HTMLElement>('.triage-bar')!;
    const title = document.querySelector<HTMLElement>('.critical-title')!;
    const shelf = document.querySelector<HTMLElement>('.alert-shelf')!;
    const stormStyle = getComputedStyle(storm);
    const stormRect = storm.getBoundingClientRect();
    const triageRect = triage.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      titleColor: getComputedStyle(title).color,
      topBorderWidth: stormStyle.borderTopWidth,
      rightBorderWidth: stormStyle.borderRightWidth,
      stormBottom: stormRect.bottom,
      triageTop: triageRect.top,
      shelfRight: shelf.getBoundingClientRect().right,
      actionRightEdges: [...storm.querySelectorAll<HTMLElement>('.cb-storm-mode__btn')]
        .map((button) => button.getBoundingClientRect().right),
    };
  });
}

test('desktop alert shelf is calm, compact, and non-overlapping', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await showAlertShelf(page);

  const geometry = await shelfGeometry(page);
  expect(geometry.titleColor).toBe('rgb(255, 255, 255)');
  expect(geometry.topBorderWidth).toBe('0px');
  expect(geometry.rightBorderWidth).toBe('0px');
  expect(geometry.triageTop).toBeGreaterThanOrEqual(geometry.stormBottom - 0.5);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.shelfRight).toBeLessThanOrEqual(geometry.viewportWidth);
  for (const right of geometry.actionRightEdges) expect(right).toBeLessThanOrEqual(geometry.viewportWidth);
  await expectCalmStalenessRows(page);

  await testInfo.attach('alert-shelf-desktop-collapsed', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });

  const category = page.getByLabel('Triage category');
  await category.selectOption('cyber');
  await expect(category).toHaveValue('cyber');

  const details = page.getByRole('button', { name: 'Details' });
  await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('group', { name: 'Storm Mode details' })).toBeVisible();

  await testInfo.attach('alert-shelf-desktop-details', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('mobile alert shelf keeps readable text and reachable controls', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await showAlertShelf(page);

  const geometry = await shelfGeometry(page);
  expect(geometry.titleColor).toBe('rgb(255, 255, 255)');
  expect(geometry.triageTop).toBeGreaterThanOrEqual(geometry.stormBottom - 0.5);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.shelfRight).toBeLessThanOrEqual(geometry.viewportWidth);
  for (const right of geometry.actionRightEdges) expect(right).toBeLessThanOrEqual(geometry.viewportWidth);
  await expectCalmStalenessRows(page);

  const controlHeights = await page.locator([
    '.cb-storm-mode__btn',
    '.triage-bar-facet-select',
    '.triage-bar-ack',
    '.triage-bar-preset',
  ].join(',')).evaluateAll((elements) => elements.map((element) => (
    element.getBoundingClientRect().height
  )));
  expect(controlHeights.length).toBeGreaterThan(0);
  for (const height of controlHeights) expect(height).toBeGreaterThanOrEqual(44);

  await testInfo.attach('alert-shelf-mobile', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
