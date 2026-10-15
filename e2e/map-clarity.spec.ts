import { expect, test, type Page } from '@playwright/test';

interface Camera { lon: number; lat: number; zoom: number }
interface Item { id?: string; memberIds: string[]; center?: number[]; count?: number; label?: string }
interface Label { id: string; text: string; memberIds: string[]; rect: { left: number; top: number; right: number; bottom: number } }
interface Snapshot {
  sourceCameraIds: string[];
  sourceSituationIds: string[];
  sourceInputsUnchanged: boolean;
  preferencesUnchanged: boolean;
  layerIds: string[];
  cameraItems: Item[];
  forecastRegions: { id: string; radius: number; label: string; geometry?: string }[];
  forecastPoints: Item[];
  labels: Label[];
  features: { id: string; kind?: string; title?: string }[];
  selectedId: string | null;
  warning: { count: number; polygon: number[][]; fill: number[]; stroke: number[]; pickable: boolean; index: number } | null;
  camera: Camera;
  pointerClicks: string[];
  focusMoves: number;
  preferenceSnapshot: string;
  sourceDatacenterIds: string[];
  datacenterItems: Item[];
  contextStyles: { id: string; radiusUnits?: string; radii: number[]; fills: number[][]; sizes: number[]; radiusPixels?: number; opacity?: number; intensity?: number; points: { position: number[]; weight: number }[] }[];
}
interface Harness {
  ready: boolean;
  seedMapClarityScenario(): void;
  seedMapClarityDatacenters(): void;
  enableMapClarityHeatScenario(): void;
  refreshMapClarityScenario(removeSelected?: boolean): void;
  getMapClaritySnapshot(): Snapshot;
  setLayersForSnapshot(layers: string[]): void;
  setCamera(camera: Camera): void;
  projectCoordinate(lon: number, lat: number): { x: number; y: number } | null;
  pickLayerAtCoordinate(lon: number, lat: number): string | null;
  getBaselineSnapshot(): { renderedCountries: string[] } | null;
}
type HarnessWindow = Window & { __mapHarness: Harness };
const cameraImageAttempts = new WeakMap<Page, string[]>();

const snapshot = (page: Page): Promise<Snapshot> => page.evaluate(() => (window as HarnessWindow).__mapHarness.getMapClaritySnapshot());

async function prepare(page: Page, home = true): Promise<void> {
  cameraImageAttempts.set(page, []);
  // Static modules/assets are local. No API, camera image, basemap tile, or
  // provider request may leave the browser fixture's origin.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'fixture.invalid') {
      cameraImageAttempts.get(page)!.push(url.href);
      // Resolve the explicit viewer's fixture image entirely inside Playwright.
      await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') });
      return;
    }
    const origin = new URL(test.info().project.use.baseURL as string).origin;
    if (url.origin === origin && !url.pathname.startsWith('/api/')) await route.continue();
    else await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.goto(`/tests/map-harness.html?map-clarity=1${home ? '&home=1' : ''}`);
  await expect.poll(() => page.evaluate(() => Boolean((window as HarnessWindow).__mapHarness?.ready))).toBe(true);
  await page.evaluate(() => (window as HarnessWindow).__mapHarness.seedMapClarityScenario());
  await expect(page.locator('#deckgl-basemap canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as HarnessWindow).__mapHarness.getBaselineSnapshot()?.renderedCountries.length ?? 0), {
    message: 'checked-in country geography remains visible behind the deterministic overlays',
  }).toBeGreaterThan(0);
  await page.waitForTimeout(500);
}

async function move(page: Page, camera: Camera): Promise<void> {
  await page.evaluate(value => (window as HarnessWindow).__mapHarness.setCamera(value), camera);
  await page.waitForTimeout(200);
}

async function clickCoordinate(page: Page, lon: number, lat: number): Promise<void> {
  const point = await page.evaluate(([x, y]) => (window as HarnessWindow).__mapHarness.projectCoordinate(x!, y!), [lon, lat]);
  expect(point).not.toBeNull();
  await page.mouse.move(point!.x, point!.y);
  await page.waitForTimeout(150);
  await page.mouse.click(point!.x, point!.y, { delay: 80 });
}

function assertCollisionFree(labels: Label[]): void {
  for (let i = 0; i < labels.length; i++) {
    expect(labels[i]!.text.trim(), 'context label has meaningful text').not.toBe('');
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]!.rect;
      const b = labels[j]!.rect;
      expect(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
        `labels ${labels[i]!.text} and ${labels[j]!.text} overlap`).toBe(false);
    }
  }
}

test.describe('Map clarity with actual DeckGL renderer', () => {
  test('reported points stay compact and source identities survive zoom and pan', async ({ page }) => {
    await prepare(page);
    const initial = await snapshot(page);
    const points = initial.forecastRegions.filter(region => region.id.startsWith('sit-'));
    expect(points).toHaveLength(4);
    expect(points.every(region => region.radius === 0 && region.geometry === 'point'), 'reported zero radius never invents a footprint').toBe(true);
    expect(points.every(region => region.label.trim().length > 0)).toBe(true);
    expect(initial.forecastRegions.find(region => region.id === 'ema-north america')).toMatchObject({ radius: 500, geometry: 'radius' });
    const coincident = initial.forecastPoints.find(item => item.center?.[0] === -118.25);
    expect(coincident?.memberIds.sort()).toEqual(initial.sourceSituationIds.filter(id => id.includes('point-0')).sort());
    expect(initial.forecastPoints).toHaveLength(2);
    expect(initial.sourceCameraIds).toHaveLength(514);

    await move(page, { lon: -60, lat: 20, zoom: 1 });
    const world = await snapshot(page);
    expect(world.cameraItems.flatMap(item => item.memberIds).sort(), 'global clusters conserve all cameras including zero coordinates').toEqual(world.sourceCameraIds);
    expect(world.cameraItems.reduce((total, item) => total + item.count!, 0)).toBe(514);
    const allIds = initial.features.map(item => item.id).sort();
    for (const camera of [
      { lon: -101, lat: 39, zoom: 3.3 },
      { lon: -87.63, lat: 41.88, zoom: 6 },
      { lon: -87.63, lat: 41.88, zoom: 10 },
      { lon: -75, lat: 40, zoom: 6 },
    ]) {
      await move(page, camera);
      const state = await snapshot(page);
      const renderedIds = state.cameraItems.flatMap(item => item.memberIds);
      expect(new Set(renderedIds).size).toBe(renderedIds.length);
      expect(renderedIds.every(id => state.sourceCameraIds.includes(id))).toBe(true);
      expect(state.cameraItems.every(item => item.count === item.memberIds.length)).toBe(true);
      expect(state.features.map(item => item.id).sort(), 'all member details remain available outside the viewport').toEqual(allIds);
      expect(state.sourceInputsUnchanged).toBe(true);
      expect(state.preferencesUnchanged).toBe(true);
      assertCollisionFree(state.labels);
      const cameras = state.contextStyles.find(style => style.id === 'faa-cameras')!;
      expect(cameras.radiusUnits).toBe('pixels');
      expect(cameras.radii.every(radius => radius > 0 && radius <= 12), 'camera clusters stay bounded in screen pixels').toBe(true);
      expect(cameras.fills.every(fill => fill[3]! <= 180 && Math.max(...fill.slice(0, 3)) - Math.min(...fill.slice(0, 3)) < 100)).toBe(true);
      const pointsStyle = state.contextStyles.find(style => style.id === 'forecast-overlay-points')!;
      expect(pointsStyle.radiusUnits).toBe('pixels');
      expect(pointsStyle.radii.every(radius => radius <= 6)).toBe(true);
      const regionsStyle = state.contextStyles.find(style => style.id === 'forecast-overlay-layer')!;
      expect(regionsStyle.fills.every(fill => fill[3]! <= 20), 'regional context stays translucent').toBe(true);
      const datacenters = state.contextStyles.find(style => style.id === 'datacenters-layer');
      if (datacenters) expect(datacenters.sizes.every(size => size <= 7), 'routine data centers use compact symbols').toBe(true);
    }
    await page.evaluate(() => (window as HarnessWindow).__mapHarness.enableMapClarityHeatScenario());
    const heat = await snapshot(page);
    const climate = heat.contextStyles.find(style => style.id === 'climate-heatmap-layer')!;
    const threat = heat.contextStyles.find(style => style.id === 'threat-heatmap-layer')!;
    for (const style of [climate, threat]) {
      expect(style.radiusPixels).toBeLessThanOrEqual(30);
      expect(style.opacity).toBeLessThanOrEqual(0.25);
      expect(style.intensity).toBeLessThanOrEqual(0.5);
    }
    expect(climate.points).toEqual([{ position: [-112, 36], weight: 4 }, { position: [-90, 32], weight: 4 }]);
    expect(threat.points).toContainEqual({ position: [-104.99, 39.74], weight: 1.5 });
    expect(heat.sourceInputsUnchanged).toBe(true);
  });

  test('actual pointer selection exposes each coincident forecast and all 205 camera members', async ({ page }) => {
    await prepare(page);
    await page.evaluate(() => (window as HarnessWindow).__mapHarness.setLayersForSnapshot(['forecastOverlay']));
    await move(page, { lon: -118.25, lat: 34.05, zoom: 5 });
    await clickCoordinate(page, -118.25, 34.05);
    expect((await snapshot(page)).pointerClicks, 'actual pointer reaches the forecast layer click handler').toContain('forecast-overlay-points');
    const panel = page.getByRole('region', { name: 'Map features', exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-feature-id]')).toHaveCount(3);
    expect(await panel.locator('[data-feature-id]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.featureId).sort()))
      .toEqual(['forecast:situation:point-035', 'forecast:situation:point-039', 'forecast:situation:point-060']);
    await expect(panel.getByRole('region', { name: 'Selected feature details' })).toContainText('Situation confidence');
    await expect(panel.getByRole('region', { name: 'Selected feature details' })).not.toContainText('Risk');
    await panel.getByRole('button', { name: 'Close map features' }).click();

    await page.evaluate(() => (window as HarnessWindow).__mapHarness.setLayersForSnapshot(['faaWeatherCams']));
    await move(page, { lon: -87.63, lat: 41.88, zoom: 8 });
    await clickCoordinate(page, -87.63, 41.88);
    await expect(panel).toBeVisible();
    const members: string[] = [];
    for (let index = 0; index < 5; index++) {
      members.push(...await panel.locator('[data-feature-id]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.featureId!)));
      if (index < 4) await panel.getByRole('button', { name: 'Next map features page' }).click();
    }
    expect(members.sort()).toEqual(Array.from({ length: 205 }, (_, i) => `camera:coincident-${String(i).padStart(3, '0')}`));
    await expect(panel.getByRole('button', { name: 'Next map features page' })).toBeDisabled();
    await panel.getByRole('button', { name: 'Show all map features' }).click();
    await panel.getByRole('searchbox', { name: 'Search map features' }).fill('camera:zero-longitude');
    await expect(panel.locator('[data-feature-id="camera:zero-longitude"]')).toBeVisible();
    await panel.getByRole('searchbox', { name: 'Search map features' }).fill('camera:isolated');
    await expect(panel.locator('[data-feature-id="camera:isolated"]')).toBeVisible();
    expect((await snapshot(page)).sourceInputsUnchanged).toBe(true);
    expect(await page.locator('img[src*="fixture.invalid"]').count()).toBe(0);
    expect(cameraImageAttempts.get(page), 'local camera details do not request preview images').toEqual([]);

    await panel.getByRole('searchbox', { name: 'Search map features' }).fill('camera:coincident-204');
    await panel.locator('[data-feature-id="camera:coincident-204"]').click();
    const beforeViewer = await snapshot(page);
    expect(beforeViewer.focusMoves).toBe(0);
    const viewCamera = panel.getByRole('button', { name: 'View camera', exact: true });
    await viewCamera.focus();
    await page.keyboard.press('Enter');
    await expect(panel).toBeHidden();
    const cameraViewer = page.locator('.map-popup-from-features.map-popup-faa-camera');
    await expect(cameraViewer.locator('.faa-camera-popup-header .popup-title')).toHaveText('Fixture camera coincident-204');
    await expect(cameraViewer.locator('[data-faa-camera-image]')).toBeVisible();
    const cameraClose = cameraViewer.locator('.popup-close');
    await expect(cameraClose).toBeFocused();
    const cameraCloseBox = await cameraClose.boundingBox();
    expect(cameraCloseBox).not.toBeNull();
    expect(await page.evaluate(box => document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('button')?.classList.contains('popup-close'), cameraCloseBox!)).toBe(true);
    expect((await snapshot(page)).camera).toEqual(beforeViewer.camera);
    expect((await snapshot(page)).preferenceSnapshot).toBe(beforeViewer.preferenceSnapshot);
    expect((await snapshot(page)).focusMoves).toBe(0);
    expect(cameraImageAttempts.get(page)).toEqual(['https://fixture.invalid/camera-image-never-requested.jpg']);
    await page.keyboard.press('Enter');
    await expect(cameraViewer).toHaveCount(0);
    const entry = page.getByRole('button', { name: 'Map features', exact: true });
    await expect(entry).toBeFocused();
    expect((await snapshot(page)).sourceInputsUnchanged).toBe(true);

    const originalDatacenters = (await snapshot(page)).sourceDatacenterIds;
    await page.evaluate(() => (window as HarnessWindow).__mapHarness.seedMapClarityDatacenters());
    await move(page, { lon: -30, lat: 0, zoom: 4 });
    const dcState = await snapshot(page);
    expect(dcState.sourceDatacenterIds.filter(id => !id.includes('fixture-coincident-'))).toEqual(originalDatacenters);
    const dcCluster = dcState.datacenterItems.find(item => item.memberIds.includes('datacenter:fixture-coincident-000'));
    expect(dcCluster?.center?.[0]).toBeCloseTo(-30, 4);
    expect(dcCluster?.center?.[1]).toBeCloseTo(0, 4);
    expect(dcCluster?.count).toBe(205);
    expect(dcCluster?.memberIds).toHaveLength(205);
    await clickCoordinate(page, -30, 0);
    await expect(panel).toBeVisible();
    const dcMembers: string[] = [];
    for (let index = 0; index < 5; index++) {
      dcMembers.push(...await panel.locator('[data-feature-id]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.featureId!)));
      if (index < 4) await panel.getByRole('button', { name: 'Next map features page' }).click();
    }
    expect(dcMembers.sort()).toEqual(Array.from({ length: 205 }, (_, i) => `datacenter:fixture-coincident-${String(i).padStart(3, '0')}`));
    await expect(panel.getByRole('button', { name: 'Next map features page' })).toBeDisabled();
    expect((await snapshot(page)).sourceInputsUnchanged).toBe(true);
    await panel.locator('[data-feature-id="datacenter:fixture-coincident-204"]').click();
    const beforeDataCenterViewer = await snapshot(page);
    const more = panel.getByRole('button', { name: 'More data center details', exact: true });
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(panel).toBeHidden();
    const dcViewer = page.locator('.map-popup-from-features').filter({ has: page.locator('.popup-header.datacenter') });
    await expect(dcViewer.locator('.popup-title')).toContainText('Fixture data center 204');
    await expect(dcViewer.locator('.popup-body')).toContainText('Fixture GPU');
    await expect(dcViewer.locator('.popup-body')).toContainText('12K');
    await expect(dcViewer.locator('.popup-body')).toContainText('42 MW');
    await expect(dcViewer.locator('.popup-body')).toContainText('Fixture research');
    const dcClose = dcViewer.locator('.popup-close');
    await expect(dcClose).toBeFocused();
    const dcCloseBox = await dcClose.boundingBox();
    expect(dcCloseBox).not.toBeNull();
    expect(await page.evaluate(box => document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('button')?.classList.contains('popup-close'), dcCloseBox!)).toBe(true);
    expect((await snapshot(page)).camera).toEqual(beforeDataCenterViewer.camera);
    expect((await snapshot(page)).preferenceSnapshot).toBe(beforeDataCenterViewer.preferenceSnapshot);
    expect((await snapshot(page)).focusMoves).toBe(0);
    expect(cameraImageAttempts.get(page)).toHaveLength(1);
    await page.keyboard.press('Enter');
    await expect(dcViewer).toHaveCount(0);
    await expect(entry).toBeFocused();
    expect((await snapshot(page)).sourceInputsUnchanged).toBe(true);
  });

  test('Home entry, keyboard selection and refresh retain focus, scroll and explicit map navigation', async ({ page }) => {
    await prepare(page);
    const entry = page.getByRole('button', { name: 'Map features', exact: true });
    await expect(page.locator('.home-shell-map .map-controls')).toBeHidden();
    await expect(entry).toBeVisible();
    await entry.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('region', { name: 'Map features', exact: true });
    const search = panel.getByRole('searchbox', { name: 'Search map features' });
    await expect(search).toBeFocused();
    await search.fill('coincident-');
    await page.keyboard.press('Tab');
    const first = panel.locator('[data-feature-id="camera:coincident-000"]');
    await expect(first).toBeFocused();
    const before = await snapshot(page);
    await page.keyboard.press('Enter');
    await expect(first).toBeFocused();
    expect((await snapshot(page)).camera).toEqual(before.camera);
    expect((await snapshot(page)).focusMoves).toBe(0);
    await expect(panel.getByRole('region', { name: 'Selected feature details' })).toContainText('camera:coincident-000');
    await panel.locator('.map-feature-list-content').evaluate(node => { node.scrollTop = 75; });
    const scrollBefore = await panel.locator('.map-feature-list-content').evaluate(node => node.scrollTop);
    expect(scrollBefore).toBeGreaterThan(0);
    await page.evaluate(() => (window as HarnessWindow).__mapHarness.refreshMapClarityScenario());
    await expect(first).toBeFocused();
    expect(await panel.locator('.map-feature-list-content').evaluate(node => node.scrollTop)).toBe(scrollBefore);
    expect((await snapshot(page)).selectedId).toBe('camera:coincident-000');
    expect((await snapshot(page)).focusMoves).toBe(0);
    await move(page, { lon: -90, lat: 40, zoom: 4 });
    await expect(first).toBeFocused();
    expect((await snapshot(page)).selectedId).toBe('camera:coincident-000');
    await panel.getByRole('button', { name: 'Show on map' }).click();
    await expect.poll(async () => (await snapshot(page)).camera.zoom).toBeGreaterThanOrEqual(7);
    expect((await snapshot(page)).focusMoves).toBe(1);
    expect(cameraImageAttempts.get(page), 'explicit map focus does not fetch a camera preview').toEqual([]);
    await search.focus();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(entry).toBeFocused();
    await page.keyboard.press('Enter');
    await page.evaluate(() => (window as HarnessWindow).__mapHarness.refreshMapClarityScenario(true));
    await expect(panel.getByRole('region', { name: 'Selected feature details' })).toContainText('No longer available in the latest map data.');
    await expect(panel.getByRole('button', { name: 'Show on map' })).toBeDisabled();
  });

  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 640, height: 480 }]) {
    test(`urgent geometry stays visible and labels avoid collisions at ${size.width}×${size.height}`, async ({ page }, testInfo) => {
      await page.setViewportSize(size);
      await prepare(page);
      // Capture first so accepted-production mutation runs can retain an honest
      // before image even when the feature APIs/entry point do not yet exist.
      await page.screenshot({ path: testInfo.outputPath(`map-clarity-${size.width}x${size.height}.png`) });
      const initial = await snapshot(page);
      expect(initial.warning).toMatchObject({
        count: 1, fill: [255, 0, 0, 60], stroke: [255, 0, 0, 220], pickable: true,
        polygon: [[-106, 38.7], [-104, 38.7], [-104, 40.7], [-106, 40.7], [-106, 38.7]],
      });
      expect(initial.warning!.index).toBeGreaterThan(initial.layerIds.indexOf('map-context-labels'));
      await expect.poll(() => page.evaluate(() => (window as HarnessWindow).__mapHarness.pickLayerAtCoordinate(-104.99, 39.74)), {
        message: 'the original urgent warning remains pickable above coincident context markers',
      }).toMatch(/^weather-(?:polygons-)?layer$/);
      expect(initial.labels.length).toBeGreaterThan(0);
      assertCollisionFree(initial.labels);
      const point = await page.evaluate(() => (window as HarnessWindow).__mapHarness.projectCoordinate(-104.99, 39.74));
      expect(point).not.toBeNull();
      for (const label of initial.labels) {
        const rect = label.rect;
        expect(rect.left < point!.x + 18 && rect.right > point!.x - 18 && rect.top < point!.y + 18 && rect.bottom > point!.y - 18,
          'context labels leave authoritative warning marker unobscured').toBe(false);
      }
      const entry = page.getByRole('button', { name: 'Map features', exact: true });
      await expect(entry).toBeVisible();
      await entry.click();
      const panel = page.getByRole('region', { name: 'Map features', exact: true });
      const close = panel.getByRole('button', { name: 'Close map features' });
      const closeBox = await close.boundingBox();
      expect(closeBox).not.toBeNull();
      expect(await page.evaluate(box => document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('button')?.getAttribute('aria-label'), closeBox!)).toBe('Close map features');
      await panel.getByRole('searchbox', { name: 'Search map features' }).fill('forecast:situation:point-060');
      await panel.locator('[data-feature-id="forecast:situation:point-060"]').click();
      await panel.getByRole('button', { name: 'Close map features' }).click();
      const selected = await snapshot(page);
      expect(selected.selectedId).toBe('forecast:situation:point-060');
      expect(selected.labels.some(label => label.memberIds.includes('forecast:situation:point-060')), 'selected feature keeps its priority label').toBe(true);
      assertCollisionFree(selected.labels);
      expect(selected.warning).toEqual(initial.warning);
      expect(selected.sourceInputsUnchanged).toBe(true);
      const entryBox = await entry.boundingBox();
      expect(entryBox).not.toBeNull();
      expect(entryBox!.x + entryBox!.width).toBeLessThanOrEqual(size.width);
      expect(entryBox!.y + entryBox!.height).toBeLessThanOrEqual(size.height);
      await page.screenshot({ path: testInfo.outputPath(`map-clarity-selected-${size.width}x${size.height}.png`) });
    });
  }
});
