import { expect, test, type Page } from '@playwright/test';
import type { NWSAlert, NWSAlertSnapshot } from '../src/services/nws-alert-snapshot';
import type { UnifiedAlertStore } from '../src/services/unified-alerts';
import type { NWSAlertsPanel } from '../src/components/NWSAlertsPanel';
import type { RefreshScheduler } from '../src/app/refresh-scheduler';

type AcceptanceWindow = Window & {
  ux047Store: UnifiedAlertStore;
  ux047Latest: NWSAlertSnapshot;
  ux047Invalidations: number;
  ux047HydrationWrites: number;
  ux047Panel: NWSAlertsPanel;
  ux047Scheduler: RefreshScheduler;
};

const NOW = Date.parse('2026-11-02T12:00:00Z');
const STORAGE_KEY = 'wm-unified-alerts-v2';

function warning(id: string, expires = NOW + 10_800_000): NWSAlert {
  return {
    id, event: `Fixture warning ${id}`, headline: `Synthetic warning ${id}`,
    description: 'Synthetic browser acceptance fixture', severity: 'Minor', urgency: 'Future',
    areaDesc: 'Fixture area', sent: '2026-11-02T10:00:00Z',
    onset: new Date(Math.min(NOW + 7_200_000, expires - 30_000)).toISOString(),
    expires: new Date(expires).toISOString(), status: 'Actual', messageType: 'Alert',
    centroid: null, geometry: null,
  };
}

function snapshot(alerts: NWSAlert[], observedAt = NOW): NWSAlertSnapshot {
  return { schemaVersion: 1, scope: 'national-active', completeness: 'complete', observedAt, alerts };
}

async function startClock(page: Page): Promise<void> {
  await page.clock.install({ time: NOW - 60_000 });
  await page.goto('/tests/runtime-harness.html');
  await page.clock.pauseAt(NOW);
}

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && !url.pathname.startsWith('/api/')) await route.continue();
    else await route.abort('internetdisconnected');
  });
  await context.routeWebSocket('**/*', socket => socket.close());
});

test('offline expiry and actual reload preserve pinned history and reject stale replay without hydration writes', async ({ page, context }) => {
  await startClock(page);
  const original = snapshot([warning('expires', NOW + 60_000), warning('removed')]);
  const latest = snapshot([warning('expires', NOW + 60_000)], NOW + 1);
  await page.evaluate(async ({ original, latest }) => {
    const path = '/src/services/unified-alerts.ts';
    const { unifiedAlertStore: store, _setNotifyThrottleForTest } = await import(/* @vite-ignore */ path);
    _setNotifyThrottleForTest(0);
    store.reconcileNwsSnapshot(original);
    store.togglePin('nws-expires');
    store.acknowledge('nws-expires');
    store.snooze('nws-expires', 120_000);
    Object.assign(window, { ux047Store: store, ux047Latest: latest, ux047Invalidations: 0 });
  }, { original, latest });
  await page.clock.runFor(1);
  expect(await page.evaluate(() => {
    const state = window as unknown as AcceptanceWindow;
    const result = state.ux047Store.reconcileNwsSnapshot(state.ux047Latest);
    state.ux047Store._flushNowForTest();
    state.ux047Store.subscribe(() => state.ux047Invalidations++);
    return result.disposition;
  })).toBe('applied');
  const persisted = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
  await context.setOffline(true);
  await page.clock.runFor(60_000);
  expect(await page.evaluate(() => {
    const state = window as unknown as AcceptanceWindow;
    return { count: state.ux047Store.getOperationalAlerts().length, invalidations: state.ux047Invalidations };
  })).toEqual({ count: 0, invalidations: 1 });
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(persisted);

  // Restore only test-origin assets for a real reload; all provider requests remain blocked.
  await context.setOffline(false);
  await page.addInitScript(key => {
    const originalSetItem = Storage.prototype.setItem;
    Object.assign(window, { ux047HydrationWrites: 0 });
    Storage.prototype.setItem = function (name, value) {
      if (name === key) (window as unknown as AcceptanceWindow).ux047HydrationWrites++;
      return originalSetItem.call(this, name, value);
    };
  }, STORAGE_KEY);
  await page.reload();
  const restarted = await page.evaluate(async ({ original, key }) => {
    const path = '/src/services/unified-alerts.ts';
    const { unifiedAlertStore: store } = await import(/* @vite-ignore */ path);
    const before = (window as unknown as AcceptanceWindow).ux047HydrationWrites;
    const disposition = store.reconcileNwsSnapshot(original).disposition;
    const normalizerPath = '/src/services/alert-normalizer.ts';
    const { normalizeNWSAlert } = await import(/* @vite-ignore */ normalizerPath);
    store.ingest(original.alerts.map(alert => normalizeNWSAlert(alert, { kind: 'replay', observedAt: original.observedAt })));
    const pinned = store.getAll().find((alert: { id: string }) => alert.id === 'nws-expires');
    return {
      bootWrites: before, disposition, active: store.getOperationalAlerts().length,
      projected: store.getOperationalNwsAlerts(original).length,
      pinned: pinned?.pinned, acknowledged: pinned?.acknowledged, snoozedUntil: pinned?.snoozedUntil,
      persisted: localStorage.getItem(key),
    };
  }, { original, key: STORAGE_KEY });
  expect(restarted).toEqual({ bootWrites: 0, disposition: 'older', active: 0, projected: 0,
    pinned: true, acknowledged: true, snoozedUntil: NOW + 120_000, persisted });
});

test('national membership exceeds retained and rendered caps and shows issued versus starts with honest empty states', async ({ page }) => {
  await startClock(page);
  const national = snapshot(Array.from({ length: 600 }, (_, index) => warning(String(index))));
  const result = await page.evaluate(async national => {
    const storePath = '/src/services/unified-alerts.ts';
    const panelPath = '/src/components/NWSAlertsPanel.ts';
    const { unifiedAlertStore: store } = await import(/* @vite-ignore */ storePath);
    const { NWSAlertsPanel } = await import(/* @vite-ignore */ panelPath);
    const reconciled = store.reconcileNwsSnapshot(national);
    store._flushNowForTest();
    const panel = new NWSAlertsPanel();
    document.getElementById('runtime-harness')!.replaceChildren(panel.getElement());
    panel.updateSnapshot({ alerts: store.getOperationalNwsAlerts(national), state: 'current', observedAt: national.observedAt });
    Object.assign(window, { ux047Panel: panel });
    return { active: reconciled.activeCount, retained: store.getAll().length,
      persistedMembers: JSON.parse(localStorage.getItem('wm-unified-alerts-v2')!).nwsLifecycle.members.length };
  }, national);
  await page.clock.runFor(500);
  expect(result).toEqual({ active: 600, retained: 500, persistedMembers: 600 });
  await expect(page.locator('.panel-count')).toHaveText('600');
  await expect(page.locator('tbody tr')).toHaveCount(80);
  await expect(page.getByRole('columnheader', { name: 'Issued', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Starts', exact: true })).toBeVisible();
  await expect(page.locator('tbody tr').first().locator('td').nth(3)).toContainText('10:00 AM');
  await expect(page.locator('tbody tr').first().locator('td').nth(4)).toContainText('02:00 PM');
  await page.evaluate(now => (window as unknown as AcceptanceWindow).ux047Panel.updateSnapshot({ alerts: [], state: 'stale', observedAt: now }), NOW);
  await page.clock.runFor(500);
  await expect(page.locator('#runtime-harness')).not.toContainText('No active NWS hazard alerts.');
  await expect(page.locator('#runtime-harness')).toContainText(/stale/i);
  await page.evaluate(() => (window as unknown as AcceptanceWindow).ux047Panel.updateSnapshot({ alerts: [], state: 'unavailable', observedAt: null }));
  await page.clock.runFor(500);
  await expect(page.locator('#runtime-harness')).not.toContainText('No active NWS hazard alerts.');
  await expect(page.locator('#runtime-harness')).toContainText(/unavailable/i);
  await page.evaluate(now => (window as unknown as AcceptanceWindow).ux047Panel.updateSnapshot({ alerts: [], state: 'current', observedAt: now }), NOW);
  await page.clock.runFor(500);
  await expect(page.locator('#runtime-harness')).toContainText('No active NWS hazard alerts.');
});

test('actual App registration and scheduler refresh the real NWS loader with no warning panel mounted', async ({ page }) => {
  await startClock(page);
  let requests = 0;
  await page.route('**/api/nws-alerts', async route => {
    requests++;
    await route.fulfill({ json: snapshot([warning(`scheduled-${requests}`)], NOW + 269_000) });
  });
  await page.evaluate(async () => {
    const appPath = '/src/App.ts';
    const loaderPath = '/src/app/data-loader.ts';
    const schedulerPath = '/src/app/refresh-scheduler.ts';
    const [{ App }, { DataLoaderManager }, { RefreshScheduler }] = await Promise.all([
      import(/* @vite-ignore */ appPath), import(/* @vite-ignore */ loaderPath), import(/* @vite-ignore */ schedulerPath),
    ]);
    const state = { isDestroyed: false, inFlight: new Set(), panels: {}, mapLayers: {}, intelligenceCache: {},
      newsSnapshot: { bindScope() {}, getSnapshot() { return {}; } } };
    const loader = new DataLoaderManager(state, {});
    const scheduler = new RefreshScheduler(state);
    const boundedLoaders = new Proxy({}, { get: (_target, key) => key === 'refreshNWSAlerts'
      ? loader.refreshNWSAlerts.bind(loader) : async () => {} });
    App.prototype.setupRefreshIntervals.call({ state, dataLoader: boundedLoaders, refreshScheduler: scheduler });
    Object.assign(window, { ux047Scheduler: scheduler });
  });
  await page.clock.runFor(269_000);
  expect(requests).toBe(0);
  // Jump to the due refresh without consuming its fetch timeout while the fixture crosses processes.
  await page.clock.fastForward(62_000);
  await expect.poll(() => requests).toBe(1);
  await expect.poll(async () => page.evaluate(async () => {
    const path = '/src/services/unified-alerts.ts';
    const { unifiedAlertStore } = await import(/* @vite-ignore */ path);
    return unifiedAlertStore.getOperationalAlerts().map((alert: { id: string }) => alert.id);
  })).toEqual(['nws-scheduled-1']);
  await page.evaluate(() => (window as unknown as AcceptanceWindow).ux047Scheduler.destroy());
});

test('provider outage after reload uses persisted snapshot age and cannot display expired cached warnings as current', async ({ page }) => {
  await startClock(page);
  await page.route('**/api/nws-alerts', route => route.fulfill({ json: snapshot([warning('cached', NOW + 60_000)]) }));
  const mountAndRefresh = async () => page.evaluate(async () => {
    const loaderPath = '/src/app/data-loader.ts';
    const panelPath = '/src/components/NWSAlertsPanel.ts';
    const storePath = '/src/services/unified-alerts.ts';
    const [{ DataLoaderManager }, { NWSAlertsPanel }, { unifiedAlertStore }] = await Promise.all([
      import(/* @vite-ignore */ loaderPath), import(/* @vite-ignore */ panelPath), import(/* @vite-ignore */ storePath),
    ]);
    const panel = new NWSAlertsPanel();
    document.getElementById('runtime-harness')!.replaceChildren(panel.getElement());
    const loader = new DataLoaderManager({ isDestroyed: false, panels: { 'nws-alerts': panel },
      newsSnapshot: { bindScope() {}, getSnapshot() { return {}; } } }, {});
    await loader.refreshNWSAlerts();
    return { observedAt: unifiedAlertStore.getNwsObservedAt(), active: unifiedAlertStore.getOperationalAlerts().length };
  });
  expect(await mountAndRefresh()).toEqual({ observedAt: NOW, active: 1 });
  await page.clock.runFor(500);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.unroute('**/api/nws-alerts');
  await page.clock.runFor(61_000);
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.locator('#runtime-harness')).toContainText(/stale/i);
  await page.reload();
  expect(await mountAndRefresh()).toEqual({ observedAt: NOW, active: 0 });
  await page.clock.runFor(500);
  const cached = await page.evaluate(async () => {
    const path = '/src/services/nws-alert-snapshot-cache.ts';
    const { fetchCachedNwsSnapshot } = await import(/* @vite-ignore */ path);
    const result = await fetchCachedNwsSnapshot();
    return { observedAt: result.data.observedAt, cachedAt: result.cachedAt, age: result.staleDurationMs, source: result.source };
  });
  expect(cached.observedAt).toBe(NOW);
  expect(cached.cachedAt).toBe(NOW);
  expect(cached.age).toBeGreaterThanOrEqual(61_000);
  expect(cached.source).toBe('offline-cache');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.locator('#runtime-harness')).toContainText(/stale/i);
  await expect(page.locator('#runtime-harness')).not.toContainText('No active NWS hazard alerts.');
});
