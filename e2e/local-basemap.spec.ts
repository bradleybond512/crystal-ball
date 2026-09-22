import { expect, test, type Page } from '@playwright/test';

type Camera = { lon: number; lat: number; zoom: number };
type BaselineSnapshot = {
  layers: string[];
  sources: string[];
  renderedCountries: string[];
  landColor: unknown;
  landOpacity: unknown;
  camera: Camera;
  countryClicks: { code?: string; name?: string }[];
};
type HarnessWindow = Window & {
  __mapHarness: {
    ready: boolean;
    setLayersForSnapshot: (layers: string[]) => void;
    setCamera: (camera: Camera) => void;
    getLayerDataCount: (layer: string) => number;
    getBaselineSnapshot: () => BaselineSnapshot | null;
    projectCoordinate: (lon: number, lat: number) => { x: number; y: number } | null;
    pickLayerAtCoordinate: (lon: number, lat: number) => string | null;
  };
};

async function setup(page: Page, theme: 'dark' | 'light' = 'dark', savedBasemap: string = theme): Promise<string[]> {
  const externalBasemaps: string[] = [];
  await page.addInitScript(({ initialTheme, basemap }) => {
    localStorage.setItem('wm-basemap', basemap);
    document.documentElement.dataset.theme = initialTheme;
  }, { initialTheme: theme, basemap: savedBasemap });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      if (['image', 'font'].includes(route.request().resourceType()) || /carto|arcgisonline|basemap|glyph|sprite|terrarium|\.pbf/.test(url.href)) {
        externalBasemaps.push(url.href);
      }
      await route.abort();
      return;
    }
    await route.continue();
  });
  return externalBasemaps;
}

async function openHarness(page: Page): Promise<void> {
  await page.goto('/tests/map-harness.html?local-basemap=1');
  await expect.poll(() => page.evaluate(() => (window as HarnessWindow).__mapHarness?.ready), { timeout: 45_000 }).toBe(true);
}

async function snapshot(page: Page): Promise<BaselineSnapshot> {
  const value = await page.evaluate(() => (window as HarnessWindow).__mapHarness.getBaselineSnapshot());
  expect(value).not.toBeNull();
  return value!;
}

async function point(page: Page, lon: number, lat: number): Promise<{ x: number; y: number }> {
  const value = await page.evaluate(([longitude, latitude]) => (window as HarnessWindow).__mapHarness.projectCoordinate(longitude!, latitude!), [lon, lat]);
  expect(value).not.toBeNull();
  return value!;
}

for (const theme of ['dark', 'light'] as const) {
  test(`local ${theme} geography renders and remains interactive with remote basemaps blocked`, async ({ page }, testInfo) => {
    const externalBasemaps = await setup(page, theme);
    await openHarness(page);
    const status = page.locator('.map-baseline-status');
    await expect(status).toHaveAttribute('data-state', 'basic');
    await expect(status).toContainText(/countr|geograph/i);
    await expect(status).toContainText(/street|terrain/i);
    await expect(page.locator('.map-attribution')).toContainText(/Natural Earth/i);
    await expect(page.locator('.map-attribution')).not.toContainText(/CARTO|OpenStreetMap/);
    const viewport = page.viewportSize()!;
    for (const element of [status, page.locator('.map-attribution')]) {
      const box = await element.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    }
    await page.evaluate(() => (window as HarnessWindow).__mapHarness.setCamera({ lon: -100, lat: 39, zoom: 3 }));
    await expect.poll(async () => (await snapshot(page)).renderedCountries.length).toBeGreaterThan(0);
    const initial = await snapshot(page);
    expect(initial.sources).toContain('country-boundaries');
    expect(initial.layers).toContain('country-baseline-land');
    expect(initial.layers).toContain('country-baseline-border');
    expect(initial.layers.indexOf('country-baseline-land')).toBeLessThan(initial.layers.indexOf('country-interactive'));
    expect(initial.landOpacity ?? 1).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath(`local-${process.env.VITE_VARIANT ?? 'full'}-${theme}.png`) });

    const countryPoint = await point(page, -100, 39);
    await page.mouse.click(countryPoint.x, countryPoint.y);
    await expect.poll(async () => (await snapshot(page)).countryClicks.at(-1)?.code).toBe('US');

    await page.evaluate(() => {
      const harness = (window as HarnessWindow).__mapHarness;
      harness.setLayersForSnapshot(['natural']);
      harness.setCamera({ lon: -90.9, lat: 14.7, zoom: 5 });
    });
    await expect.poll(() => page.evaluate(() => (window as HarnessWindow).__mapHarness.getLayerDataCount('natural-events-layer'))).toBe(1);
    await expect.poll(() => page.evaluate(() => (window as HarnessWindow).__mapHarness.pickLayerAtCoordinate(-90.9, 14.7))).toBe('natural-events-layer');
    const event = await point(page, -90.9, 14.7);
    await page.mouse.click(event.x, event.y);
    await expect(page.locator('.map-popup')).toContainText('Harness Volcano Activity');
    await page.locator('.map-popup .popup-close').click();

    const beforePan = (await snapshot(page)).camera;
    await page.mouse.move(640, 360);
    await page.mouse.down();
    await page.mouse.move(730, 385, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await snapshot(page)).camera.lon - beforePan.lon)).toBeGreaterThan(0.1);
    const beforeZoom = (await snapshot(page)).camera.zoom;
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeGreaterThan(beforeZoom + 0.1);
    await page.evaluate(() => (window as HarnessWindow).__mapHarness.setCamera({ lon: -100, lat: 39, zoom: 3 }));
    const camera = (await snapshot(page)).camera;
    const otherTheme = theme === 'dark' ? 'light' : 'dark';
    await page.evaluate(async (next) => {
      const { setTheme } = await import('/src/utils/theme-manager.ts');
      setTheme(next);
    }, otherTheme);
    await expect(page.locator(`.basemap-btn[data-basemap="${otherTheme}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(status).toHaveAttribute('data-state', 'basic');
    await expect.poll(async () => (await snapshot(page)).landColor).not.toEqual(initial.landColor);
    expect((await snapshot(page)).camera).toEqual(camera);
    await page.locator(`.basemap-btn[data-basemap="${theme}"]`).click();
    await expect(status).toHaveAttribute('data-state', 'basic');
    await expect.poll(async () => (await snapshot(page)).landColor).toEqual(initial.landColor);
    const final = await snapshot(page);
    expect(final.layers.filter((id) => id === 'country-baseline-land')).toHaveLength(1);
    expect(final.layers.filter((id) => id === 'country-baseline-border')).toHaveLength(1);
    expect(final.sources.filter((id) => id === 'country-boundaries')).toHaveLength(1);
    expect(final.camera).toEqual(camera);
    expect(await page.evaluate(() => (window as HarnessWindow).__mapHarness.getLayerDataCount('natural-events-layer'))).toBe(1);
    await expect(page.locator('.map-attribution')).toContainText(/Natural Earth/i);
    expect(externalBasemaps).toEqual([]);
  });
}

test('missing local geography is unavailable while intelligence picking remains usable', async ({ page }) => {
  await setup(page);
  await page.route('**/data/countries.geojson', (route) => route.fulfill({ status: 404, body: 'Missing local asset' }));
  await openHarness(page);
  const status = page.locator('.map-baseline-status');
  await expect(status).toHaveAttribute('data-state', 'unavailable');
  await expect(status).toContainText(/unavailable/i);
  expect((await snapshot(page)).renderedCountries).toEqual([]);
  await page.evaluate(() => {
    (window as HarnessWindow).__mapHarness.setLayersForSnapshot(['natural']);
    (window as HarnessWindow).__mapHarness.setCamera({ lon: -90.9, lat: 14.7, zoom: 5 });
  });
  await expect.poll(() => page.evaluate(() => (window as HarnessWindow).__mapHarness.pickLayerAtCoordinate(-90.9, 14.7))).toBe('natural-events-layer');
  const event = await point(page, -90.9, 14.7);
  await page.mouse.click(event.x, event.y);
  await expect(page.locator('.map-popup')).toContainText('Harness Volcano Activity');
});

test('initial local style failure cannot claim basic geography is ready', async ({ page }) => {
  await setup(page);
  await page.route('**/map-styles/dark.json', (route) => route.fulfill({ status: 500, body: 'Style unavailable' }));
  await page.goto('/tests/map-harness.html?local-basemap=1');
  await expect(page.locator('.map-baseline-status')).toHaveAttribute('data-state', 'unavailable');
  await expect(page.locator('.map-baseline-status')).toContainText(/unavailable/i);
});


test('pending local geometry reports loading before becoming basic', async ({ page }) => {
  await setup(page);
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/data/countries.geojson', async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto('/tests/map-harness.html?local-basemap=1');
    await expect(page.locator('.map-baseline-status')).toHaveAttribute('data-state', 'loading');
    release();
    await expect(page.locator('.map-baseline-status')).toHaveAttribute('data-state', 'basic');
  } finally {
    release();
  }
});

for (const basemap of ['satellite', 'terrain']) {
  test(`saved ${basemap} choice survives a theme change`, async ({ page }) => {
    await setup(page, 'dark', basemap);
    await openHarness(page);
    const selected = page.locator(`.basemap-btn[data-basemap="${basemap}"]`);
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(async () => {
      const { setTheme } = await import('/src/utils/theme-manager.ts');
      setTheme('light');
    });
    await expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('wm-basemap'))).toBe(basemap);
    expect((await snapshot(page)).layers).not.toContain('country-baseline-land');
  });
}

test('rapid theme switches while geography loads settle only the current style', async ({ page }) => {
  await setup(page);
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/data/countries.geojson', async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto('/tests/map-harness.html?local-basemap=1');
    await expect(page.locator('.map-baseline-status')).toHaveAttribute('data-state', 'loading');
    await page.evaluate(async () => {
      const { setTheme } = await import('/src/utils/theme-manager.ts');
      setTheme('light');
      setTheme('dark');
      setTheme('light');
    });
    release();
    await expect(page.locator('.basemap-btn[data-basemap="light"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.map-baseline-status')).toHaveAttribute('data-state', 'basic');
    await expect.poll(async () => (await snapshot(page)).renderedCountries.length).toBeGreaterThan(0);
    const final = await snapshot(page);
    expect(final.layers.filter((id) => id === 'country-baseline-land')).toHaveLength(1);
    expect(final.layers.filter((id) => id === 'country-baseline-border')).toHaveLength(1);
    expect(final.sources.filter((id) => id === 'country-boundaries')).toHaveLength(1);
    await page.locator('.basemap-btn[data-basemap="dark"]').click();
    await expect(page.locator('.map-baseline-status')).toHaveAttribute('data-state', 'basic');
    await expect.poll(async () => (await snapshot(page)).landColor).not.toEqual(final.landColor);
  } finally {
    release();
  }
});


for (const theme of ['dark', 'light'] as const) {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1200, height: 720 }, { width: 800, height: 600 }, { width: 390, height: 844 }]) {
    test(`baseline notice stays visible beside Classic and Home controls in ${theme} at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await setup(page, theme);
      await openHarness(page);
      const status = page.locator('.map-baseline-status');
      await expect(status).toHaveAttribute('data-state', 'basic');
      await page.evaluate(() => (window as HarnessWindow).__mapHarness.setCamera({ lon: -100, lat: 39, zoom: 3 }));
      await expect.poll(async () => (await snapshot(page)).renderedCountries.length).toBeGreaterThan(0);
      const assertPlacement = async (): Promise<void> => {
        const map = await page.locator('.deckgl-map-wrapper').boundingBox();
        expect(map).not.toBeNull();
        for (const element of [status, page.locator('.map-attribution')]) {
          await expect(element).toBeVisible();
          const box = await element.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.width).toBeGreaterThan(0);
          expect(box!.height).toBeGreaterThan(0);
          expect(box!.x).toBeGreaterThanOrEqual(Math.max(0, map!.x));
          expect(box!.y).toBeGreaterThanOrEqual(Math.max(0, map!.y));
          expect(box!.x + box!.width).toBeLessThanOrEqual(Math.min(viewport.width, map!.x + map!.width));
          expect(box!.y + box!.height).toBeLessThanOrEqual(Math.min(viewport.height, map!.y + map!.height));
          const clipping = await element.evaluate((node) => ({ x: node.scrollWidth - node.clientWidth, y: node.scrollHeight - node.clientHeight }));
          expect(clipping).toEqual({ x: 0, y: 0 });
        }
        const overlaps = await page.evaluate(() => {
          const notice = document.querySelector('.map-baseline-status')!.getBoundingClientRect();
          return ['.deckgl-layer-toggles', '.deckgl-legend', '.deckgl-controls', '.deckgl-time-slider', '.deckgl-timestamp', '.map-attribution'].filter((selector) => {
            return [...document.querySelectorAll(selector)].some((node) => {
              const style = getComputedStyle(node);
              if (style.visibility === 'hidden' || style.display === 'none') return false;
              const control = node.getBoundingClientRect();
              return control.width > 0 && control.height > 0 && notice.left < control.right && notice.right > control.left
                && notice.top < control.bottom && notice.bottom > control.top;
            });
          });
        });
        expect(overlaps).toEqual([]);
        const attributionOverlaps = await page.locator('.map-attribution').evaluate((attribution) => {
          const credit = attribution.getBoundingClientRect();
          return [...document.querySelectorAll('.deckgl-legend')].flatMap((legend) => {
            const style = getComputedStyle(legend);
            const box = legend.getBoundingClientRect();
            if (style.visibility === 'hidden' || style.display === 'none' || box.width === 0 || box.height === 0) return [];
            return credit.left < box.right && credit.right > box.left && credit.top < box.bottom && credit.bottom > box.top
              ? [{ legend: legend.className, credit: credit.toJSON(), control: box.toJSON() }]
              : [];
          });
        });
        expect(attributionOverlaps).toEqual([]);
      };
      await assertPlacement();
      await page.screenshot({ path: testInfo.outputPath(`classic-expanded-${theme}-${viewport.width}.png`) });
      if (viewport.width > 768) {
        await page.locator('.toggle-collapse').click();
        await expect(page.locator('.toggle-list')).toBeHidden();
        await assertPlacement();
        await page.screenshot({ path: testInfo.outputPath(`classic-collapsed-${theme}-${viewport.width}.png`) });
      } else {
        await expect(page.locator('.deckgl-layer-toggles')).toBeHidden();
      }
      await page.evaluate(() => document.getElementById('app')!.classList.add('home-shell-map'));
      await expect(page.locator('.deckgl-layer-toggles')).toBeHidden();
      for (const legend of await page.locator('.deckgl-legend').all()) {
        await expect(legend).toBeHidden();
      }
      await expect(page.locator('.deckgl-controls')).toBeHidden();
      await assertPlacement();
      const homeMap = await page.locator('.deckgl-map-wrapper').boundingBox();
      const homeStatus = await status.boundingBox();
      expect(homeStatus!.x - homeMap!.x).toBeCloseTo(8, 2);
      expect(homeMap!.y + homeMap!.height - homeStatus!.y - homeStatus!.height).toBeCloseTo(20, 2);
      await page.screenshot({ path: testInfo.outputPath(`home-map-css-${theme}-${viewport.width}.png`) });
      await page.evaluate(() => document.getElementById('app')!.classList.remove('home-shell-map'));
      await expect(page.locator('.deckgl-controls')).toBeVisible();
      await assertPlacement();
      if (viewport.width > 768) {
        await page.locator('.toggle-collapse').click();
        await expect(page.locator('.toggle-list')).toBeVisible();
        await assertPlacement();
      }
      await page.screenshot({ path: testInfo.outputPath(`classic-return-${theme}-${viewport.width}.png`) });
    });
  }
}
