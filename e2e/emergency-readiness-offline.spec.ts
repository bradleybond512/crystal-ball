import { expect, test, type Page, type TestInfo } from '@playwright/test';

interface SeededReadinessState {
  snapshotKey: string;
  snapshotRaw: string;
  snapshotCapturedAt: string;
  gridExpiresAt: string;
  artifactKey: string;
  artifactRaw: string;
  manifestKey: string;
  manifestRaw: string;
  lifelinesCapturedAt: string;
  lifelinesExpiresAt: string;
  placeLabel: string;
}

function isLoopbackHttp(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
  return url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]';
}

async function seedReadinessState(page: Page): Promise<SeededReadinessState> {
  return page.evaluate(async () => {
    const worldSnapshotPath = '/src/services/survival/world-snapshot.ts';
    const snapshotStorePath = '/src/services/survival/snapshot-store.ts';
    const gridDownPath = '/src/services/survival/grid-down-certify.ts';
    const localLogisticsPath = '/src/services/local-logistics.ts';
    const offlineCachePath = '/src/services/offline-alert-cache.ts';
    const lifelineRuntimePath = '/src/services/lifelines/lifeline-runtime.ts';
    const logisticsTypesPath = '/src/services/local-logistics-types.ts';
    const [
      { buildSnapshot },
      { saveSnapshot },
      { DEFAULT_BLIND_AFTER_MS },
      {
        buildLocalLogisticsFingerprint,
        getLocalLogisticsOfflineCacheServiceId,
      },
      { writeOfflineCacheEntry },
      { createLifelineRuntime },
      { LOCAL_LOGISTICS_CATEGORIES },
    ] = await Promise.all([
      import(/* @vite-ignore */ worldSnapshotPath),
      import(/* @vite-ignore */ snapshotStorePath),
      import(/* @vite-ignore */ gridDownPath),
      import(/* @vite-ignore */ localLogisticsPath),
      import(/* @vite-ignore */ offlineCachePath),
      import(/* @vite-ignore */ lifelineRuntimePath),
      import(/* @vite-ignore */ logisticsTypesPath),
    ]);

    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('cb:onboarding-complete', 'true');
    localStorage.setItem('wm-analytics-consent', 'false');
    localStorage.setItem('wm-analytics-consent-prompt-seen', 'true');
    localStorage.setItem('mobile-warning-dismissed', 'true');
    localStorage.removeItem('crystalball-classic-view');

    Object.defineProperty(window, '__TAURI__', {
      value: {
        core: { invoke: async () => null },
        event: { listen: async () => () => undefined },
      },
      configurable: true,
    });

    const now = Date.now();
    const snapshotCapturedAtMs = now - 2 * 60_000;
    const weatherFetchedAtMs = snapshotCapturedAtMs - 60_000;
    const lat = 41.6111;
    const lon = -86.7225;
    const placeId = 'ux003-home';
    const placeLabel = 'Home <script>window.__ux003Pwned=true</script>';
    const savedPlace = {
      id: placeId,
      name: placeLabel,
      lat,
      lon,
      radiusKm: 50,
      tags: ['home'],
      priority: 10,
      notes: 'Offline E2E primary place',
      offlinePinned: true,
      primary: true,
      source: 'manual',
      sortIndex: 1,
      createdAt: snapshotCapturedAtMs - 60_000,
      updatedAt: snapshotCapturedAtMs,
    };
    localStorage.setItem('wm_saved_places_v1', JSON.stringify([savedPlace]));

    const radius = 0.2;
    const snapshot = buildSnapshot({
      weatherAlerts: [{
        id: 'ux003-tornado-warning',
        event: 'Tornado Warning',
        polygon: {
          rings: [[
            [lon - radius, lat - radius],
            [lon + radius, lat - radius],
            [lon + radius, lat + radius],
            [lon - radius, lat + radius],
            [lon - radius, lat - radius],
          ]],
        },
        sent: new Date(snapshotCapturedAtMs - 60_000).toISOString(),
        expires: new Date(now + 2 * 60 * 60_000).toISOString(),
      }],
      savedPlaces: [{ id: placeId, label: placeLabel, lat, lon, radiusKm: 25 }],
      weatherFetchedAtMs,
    }, { now: snapshotCapturedAtMs });
    await saveSnapshot(snapshot);

    const lifelinesCapturedAtMs = now - 90_000;
    const fingerprint = buildLocalLogisticsFingerprint(
      { lat, lon },
      25,
      [...LOCAL_LOGISTICS_CATEGORIES],
    );
    const lifelinesSnapshot = {
      schemaVersion: 2,
      queryFingerprint: fingerprint,
      placeId,
      placeName: placeLabel,
      effectiveRadiusKm: 25,
      countyFips: '18091',
      categories: [...LOCAL_LOGISTICS_CATEGORIES],
      sites: [{
        id: 'fema:shelter:ux003',
        kind: 'shelter',
        name: 'Offline Readiness Shelter',
        lat: 41.62,
        lon: -86.72,
        sourceRefs: [{ provider: 'fema', recordId: 'ux003' }],
        capabilities: {},
      }],
      observations: [{
        id: 'fema:shelter:ux003:open',
        siteId: 'fema:shelter:ux003',
        provider: 'fema',
        verification: 'official',
        operational: 'open',
        inventory: 'unknown',
        power: 'unknown',
        access: 'unknown',
        observedAt: new Date(lifelinesCapturedAtMs),
        retrievedAt: new Date(lifelinesCapturedAtMs),
        expiresAt: new Date(lifelinesCapturedAtMs + 30 * 60_000),
        confidence: 'high',
        sourceUrl: 'https://gis.fema.gov/example',
      }],
      nodes: [],
      areaConditions: [{
        id: 'ornl-odin:18091:ux003',
        type: 'power_outage',
        coverage: 'reported',
        countyFips: '18091',
        county: 'LaPorte',
        state: 'Indiana',
        customersOut: 12,
        observedAt: new Date(lifelinesCapturedAtMs),
        retrievedAt: new Date(lifelinesCapturedAtMs),
        expiresAt: new Date(lifelinesCapturedAtMs + 30 * 60_000),
        source: 'ornl-odin',
      }],
      providers: [
        { id: 'osm', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: new Date(lifelinesCapturedAtMs), retrievedAt: new Date(lifelinesCapturedAtMs) },
        { id: 'fema-open-shelters', state: 'ok', acceptedRows: 1, droppedRows: 0, observedAt: new Date(lifelinesCapturedAtMs), retrievedAt: new Date(lifelinesCapturedAtMs) },
        { id: 'fema-recovery-centers', state: 'empty', acceptedRows: 0, droppedRows: 0, observedAt: new Date(lifelinesCapturedAtMs), retrievedAt: new Date(lifelinesCapturedAtMs) },
        { id: 'ornl-odin', state: 'ok', acceptedRows: 1, droppedRows: 0, observedAt: new Date(lifelinesCapturedAtMs), retrievedAt: new Date(lifelinesCapturedAtMs) },
      ],
      fetchedAt: new Date(lifelinesCapturedAtMs),
      isStale: false,
      isExpired: false,
      staleAgeMs: 0,
      source: 'network',
    };
    const artifactServiceId = getLocalLogisticsOfflineCacheServiceId(placeId, fingerprint);
    if (!writeOfflineCacheEntry(
      artifactServiceId,
      JSON.parse(JSON.stringify(lifelinesSnapshot)),
    )) {
      throw new Error('exact Lifelines artifact did not persist');
    }
    const runtime = createLifelineRuntime(localStorage, () => now);
    const update = runtime.processSnapshot(lifelinesSnapshot);
    if (update?.pack.status !== 'ready') {
      throw new Error(`exact Lifelines manifest was not ready: ${update?.pack.status ?? 'missing'}`);
    }

    const snapshotKey = 'cb:survival-snapshot/v1';
    const artifactKey = `wm_offline_${artifactServiceId}`;
    const manifestKey = `wm_lifeline_pack_manifest_v1:${placeId}`;
    const snapshotRaw = localStorage.getItem(snapshotKey);
    const artifactRaw = localStorage.getItem(artifactKey);
    const manifestRaw = localStorage.getItem(manifestKey);
    if (!snapshotRaw || !artifactRaw || !manifestRaw) {
      throw new Error('one or more offline readiness artifacts are absent');
    }

    return {
      snapshotKey,
      snapshotRaw,
      snapshotCapturedAt: new Date(snapshotCapturedAtMs).toISOString(),
      gridExpiresAt: new Date(weatherFetchedAtMs + DEFAULT_BLIND_AFTER_MS).toISOString(),
      artifactKey,
      artifactRaw,
      manifestKey,
      manifestRaw,
      lifelinesCapturedAt: new Date(lifelinesCapturedAtMs).toISOString(),
      lifelinesExpiresAt: new Date(lifelinesCapturedAtMs + 24 * 60 * 60_000).toISOString(),
      placeLabel,
    };
  });
}

async function attachExternalAttempts(testInfo: TestInfo, attempts: readonly string[]): Promise<void> {
  const unique = [...new Set(attempts)].sort();
  const report = unique.length === 0 ? '(none)' : unique.join('\n');
  console.log(`[UX-003 offline] blocked external requests (${unique.length} unique):\n${report}`);
  await testInfo.attach('blocked-external-requests.txt', {
    body: Buffer.from(`${report}\n`),
    contentType: 'text/plain',
  });
}

test('Emergency Readiness restores exact local evidence after an external-network-blocked reload', async ({ page }, testInfo) => {
  test.slow();
  const externalAttempts: string[] = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!isLoopbackHttp(url)) {
      externalAttempts.push(`${request.method()} ${url.href}`);
      await route.abort('internetdisconnected');
      return;
    }
    await route.continue();
  });

  try {
    await page.goto('/tests/runtime-harness.html');
    const seeded = await seedReadinessState(page);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const homeShell = page.locator('.home-shell');
    await expect(homeShell).toBeVisible({ timeout: 30_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(homeShell).toBeVisible({ timeout: 30_000 });

    const persisted = await page.evaluate((keys) => ({
      snapshotRaw: localStorage.getItem(keys.snapshotKey),
      artifactRaw: localStorage.getItem(keys.artifactKey),
      manifestRaw: localStorage.getItem(keys.manifestKey),
    }), seeded);
    expect(persisted).toEqual({
      snapshotRaw: seeded.snapshotRaw,
      artifactRaw: seeded.artifactRaw,
      manifestRaw: seeded.manifestRaw,
    });

    await homeShell.locator('.home-shell-library').click();
    const library = page.locator('.library-overlay');
    await expect(library).toBeVisible();
    await library.locator('.library-search').fill('Emergency Readiness');
    const libraryCard = library.locator('[data-panel-key="emergency-readiness"]');
    await expect(libraryCard).toBeVisible();
    await expect(libraryCard).toHaveText(/Emergency Readiness/);
    await libraryCard.click();

    const panel = page.locator('.hs-focus-body .panel[data-panel="emergency-readiness"]');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const cards = panel.locator('[data-readiness-card]');
    await expect(cards).toHaveCount(4);
    expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-readiness-card'))))
      .toEqual(['grid-down', 'offline-playbook', 'comms-fallback', 'lifelines']);

    for (const cardId of ['grid-down', 'offline-playbook', 'comms-fallback', 'lifelines']) {
      const card = panel.locator(`[data-readiness-card="${cardId}"]`);
      await expect(card.locator('dt')).toHaveText(['Status', 'Captured', 'Expiry']);
      await expect(card.locator('dd')).toHaveCount(3);
    }

    const grid = panel.locator('[data-readiness-card="grid-down"]');
    await expect(grid).toContainText('Grid-down certification');
    await expect(grid.locator(`time[datetime="${seeded.snapshotCapturedAt}"]`)).toHaveCount(1);
    await expect(grid.locator(`time[datetime="${seeded.gridExpiresAt}"]`)).toHaveCount(1);

    const playbook = panel.locator('[data-readiness-card="offline-playbook"]');
    await expect(playbook).toContainText('Offline playbook');
    await expect(playbook).toContainText(/staged/i);
    await expect(playbook.locator(`time[datetime="${seeded.snapshotCapturedAt}"]`)).toHaveCount(1);
    await expect(playbook).toContainText('No independent expiry');

    const comms = panel.locator('[data-readiness-card="comms-fallback"]');
    await expect(comms).toContainText('Comms fallback');
    await expect(comms.locator(`time[datetime="${seeded.snapshotCapturedAt}"]`)).toHaveCount(1);
    await expect(comms).toContainText('No independent expiry');

    const lifelines = panel.locator('[data-readiness-card="lifelines"]');
    await expect(lifelines).toContainText('Lifelines snapshot');
    await expect(lifelines).toContainText('Verified exact-place receipt');
    await expect(lifelines).toContainText(`${seeded.placeLabel} Lifelines snapshot receipt.`);
    await expect(lifelines.locator(`time[datetime="${seeded.lifelinesCapturedAt}"]`)).toHaveCount(1);
    await expect(lifelines.locator(`time[datetime="${seeded.lifelinesExpiresAt}"]`)).toHaveCount(1);

    await expect(panel).not.toContainText(/Emergency Pack ready|combined readiness|combined score|overall readiness|aggregate readiness/i);
    await expect(panel.locator('script')).toHaveCount(0);
    expect(await page.evaluate(() => (
      window as typeof window & { __ux003Pwned?: boolean }
    ).__ux003Pwned)).toBeUndefined();
  } finally {
    await attachExternalAttempts(testInfo, externalAttempts);
  }
});
