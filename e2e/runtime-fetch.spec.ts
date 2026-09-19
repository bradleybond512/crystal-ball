import { expect, test } from '@playwright/test';

test.describe('desktop runtime routing guardrails', () => {
  test('detectDesktopRuntime covers packaged tauri hosts', async ({ page }) => {
 await page.goto('/tests/runtime-harness.html');

 const result = await page.evaluate(async () => {
 const runtime = await import('/src/services/runtime.ts');
 return {
 tauriHost: runtime.detectDesktopRuntime({
 hasTauriGlobals: false,
 userAgent: 'Mozilla/5.0',
 locationProtocol: 'https:',
 locationHost: 'tauri.localhost',
 locationOrigin: 'https://tauri.localhost',
 }),
 tauriScheme: runtime.detectDesktopRuntime({
 hasTauriGlobals: false,
 userAgent: 'Mozilla/5.0',
 locationProtocol: 'tauri:',
 locationHost: '',
 locationOrigin: 'tauri://localhost',
 }),
 tauriUa: runtime.detectDesktopRuntime({
 hasTauriGlobals: false,
 userAgent: 'Mozilla/5.0 Tauri/2.0',
 locationProtocol: 'https:',
 locationHost: 'example.com',
 locationOrigin: 'https://example.com',
 }),
 tauriGlobal: runtime.detectDesktopRuntime({
 hasTauriGlobals: true,
 userAgent: 'Mozilla/5.0',
 locationProtocol: 'https:',
 locationHost: 'example.com',
 locationOrigin: 'https://example.com',
 }),
 secureLoopback: runtime.detectDesktopRuntime({
 hasTauriGlobals: false,
 userAgent: 'Mozilla/5.0',
 locationProtocol: 'https:',
 locationHost: '127.0.0.1',
 locationOrigin: 'https://127.0.0.1',
 }),
 secureLocalhost: runtime.detectDesktopRuntime({
 hasTauriGlobals: false,
 userAgent: 'Mozilla/5.0',
 locationProtocol: 'https:',
 locationHost: 'localhost',
 locationOrigin: 'https://localhost',
 }),
 insecureLocalhost: runtime.detectDesktopRuntime({
 hasTauriGlobals: false,
 userAgent: 'Mozilla/5.0',
 locationProtocol: 'http:',
 locationHost: 'localhost:5173',
 locationOrigin: 'http://localhost:5173',
 }),
 webHost: runtime.detectDesktopRuntime({
 hasTauriGlobals: false,
 userAgent: 'Mozilla/5.0',
 locationProtocol: 'https:',
 locationHost: 'crystalball.app',
 locationOrigin: 'https://crystalball.app',
 }),
 };
 });

 expect(result.tauriHost).toBe(true);
 expect(result.tauriScheme).toBe(true);
 expect(result.tauriUa).toBe(true);
 expect(result.tauriGlobal).toBe(true);
 expect(result.secureLoopback).toBe(true);
 expect(result.secureLocalhost).toBe(false);
 expect(result.insecureLocalhost).toBe(false);
 expect(result.webHost).toBe(false);
  });

  test('runtime fetch patch falls back to cloud for local failures', async ({ page }) => {
 await page.goto('/tests/runtime-harness.html');

 const result = await page.evaluate(async () => {
 const runtime = await import('/src/services/runtime.ts');
 const runtimeConfig = await import('/src/services/runtime-config.ts');
 const webSecretStore = await import('/src/services/web-secret-store.ts');
 const globalWindow = window as unknown as Record<string, unknown>;
 const originalFetch = window.fetch.bind(window);

	const calls: Array<{
	  pathname: string;
	  search: string;
	  isLocal: boolean;
	  cloudApiKey: string | null;
	}> = [];
 const responseJson = (body: unknown, status = 200) =>
 new Response(JSON.stringify(body), {
 status,
 headers: { 'content-type': 'application/json' },
 });

	window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	  const rawUrl =
		typeof input === 'string'
		  ? input
		  : input instanceof URL
			? input.toString()
			: input.url;
	  const url = new URL(rawUrl, location.origin);
	  const isLocal = url.hostname === '127.0.0.1' && url.port === '46123';
	  calls.push({
		pathname: url.pathname,
		search: url.search,
		isLocal,
		cloudApiKey: new Headers(init?.headers).get('X-CrystalBall-Key'),
	  });

	  if (isLocal && url.pathname === '/api/fred-data') {
		return responseJson({ error: 'missing local api key' }, 500);
	  }
	  if (!isLocal && url.pathname === '/api/fred-data') {
		return responseJson({ observations: [{ value: '321.5' }] }, 200);
	  }

	  if (isLocal && url.pathname === '/api/stablecoin-markets') {
		return responseJson({ error: 'local sidecar unavailable' }, 503);
	  }
	  if (!isLocal && url.pathname === '/api/stablecoin-markets') {
		return responseJson({ stablecoins: [{ symbol: 'USDT' }] }, 200);
 }

 return responseJson({ ok: true }, 200);
 }) as typeof window.fetch;

 const previousTauri = globalWindow.__TAURI__;
 globalWindow.__TAURI__ = { core: { invoke: () => Promise.resolve(null) } };
 delete globalWindow.__wmFetchPatched;

	const testKey = 'wm_test_key_1234567890abcdef';
	await webSecretStore.createVault('runtime-e2e-vault-passphrase');
	await runtimeConfig.setSecretValue('CRYSTALBALL_API_KEY' as import('/src/services/runtime-config.ts').RuntimeSecretKey, testKey);

 try {
 runtime.installRuntimeFetchPatch();

 const fredResponse = await window.fetch('/api/fred-data?series_id=CPIAUCSL');
 const fredBody = await fredResponse.json() as { observations?: Array<{ value: string }> };

 const stableResponse = await window.fetch('/api/stablecoin-markets');
 const stableBody = await stableResponse.json() as { stablecoins?: Array<{ symbol: string }> };

 return {
 fredStatus: fredResponse.status,
 fredValue: fredBody.observations?.[0]?.value ?? null,
 stableStatus: stableResponse.status,
 stableSymbol: stableBody.stablecoins?.[0]?.symbol ?? null,
 calls,
 };
 } finally {
 window.fetch = originalFetch;
 delete globalWindow.__wmFetchPatched;
 if (previousTauri === undefined) {
 delete globalWindow.__TAURI__;
 } else {
 globalWindow.__TAURI__ = previousTauri;
 }
 await runtimeConfig.setSecretValue('CRYSTALBALL_API_KEY' as import('/src/services/runtime-config.ts').RuntimeSecretKey, '');
 await webSecretStore.destroyVault();
 }
 });

 expect(result.fredStatus).toBe(200);
 expect(result.fredValue).toBe('321.5');
 expect(result.stableStatus).toBe(200);
 expect(result.stableSymbol).toBe('USDT');

	const fredCalls = result.calls.filter((call) => call.pathname === '/api/fred-data');
	expect(fredCalls.filter((call) => call.isLocal)).toHaveLength(1);
	expect(fredCalls.filter((call) => !call.isLocal)).toHaveLength(1);
	expect(fredCalls[0]?.search).toBe('?series_id=CPIAUCSL');
	expect(fredCalls.find((call) => !call.isLocal)?.cloudApiKey).toBe('wm_test_key_1234567890abcdef');

	const stableCalls = result.calls.filter((call) => call.pathname === '/api/stablecoin-markets');
	expect(stableCalls.filter((call) => call.isLocal)).toHaveLength(1);
	expect(stableCalls.filter((call) => !call.isLocal)).toHaveLength(1);
	expect(stableCalls.find((call) => !call.isLocal)?.cloudApiKey).toBe('wm_test_key_1234567890abcdef');
  });

  test('runtime fetch patch never sends local-only endpoints to cloud', async ({ page }) => {
 await page.goto('/tests/runtime-harness.html');

 const result = await page.evaluate(async () => {
 const runtime = await import('/src/services/runtime.ts');
 const globalWindow = window as unknown as Record<string, unknown>;
 const originalFetch = window.fetch.bind(window);

 const calls: Array<{ pathname: string; isLocal: boolean }> = [];
 const responseJson = (body: unknown, status = 200) =>
 new Response(JSON.stringify(body), {
 status,
 headers: { 'content-type': 'application/json' },
 });

 window.fetch = (async (input: RequestInfo | URL) => {
	  const rawUrl =
		typeof input === 'string'
		  ? input
		  : input instanceof URL
			? input.toString()
			: input.url;
	  const url = new URL(rawUrl, location.origin);
	  const isLocal = url.hostname === '127.0.0.1' && url.port === '46123';
	  calls.push({ pathname: url.pathname, isLocal });

	  if (isLocal && url.pathname === '/api/local-env-update') {
		return responseJson({ error: 'Unauthorized' }, 401);
	  }
	  if (isLocal && url.pathname === '/api/local-validate-secret') {
		throw new Error('ECONNREFUSED');
	  }

	  if (!isLocal && url.pathname === '/api/local-env-update') {
		return responseJson({ leaked: true }, 200);
	  }
	  if (!isLocal && url.pathname === '/api/local-validate-secret') {
		return responseJson({ leaked: true }, 200);
 }

 return responseJson({ ok: true }, 200);
 }) as typeof window.fetch;

 const previousTauri = globalWindow.__TAURI__;
 globalWindow.__TAURI__ = { core: { invoke: () => Promise.resolve(null) } };
 delete globalWindow.__wmFetchPatched;

 try {
 runtime.installRuntimeFetchPatch();

 const envUpdateResponse = await window.fetch('/api/local-env-update', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ key: 'GROQ_API_KEY', value: 'sk-secret-value' }),
 });

 let validateError: string | null = null;
 try {
 await window.fetch('/api/local-validate-secret', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ key: 'GROQ_API_KEY', value: 'sk-secret-value' }),
 });
 } catch (error) {
 validateError = error instanceof Error ? error.message : String(error);
 }

 return {
 envUpdateStatus: envUpdateResponse.status,
 validateError,
 calls,
 };
 } finally {
 window.fetch = originalFetch;
 delete globalWindow.__wmFetchPatched;
 if (previousTauri === undefined) {
 delete globalWindow.__TAURI__;
 } else {
 globalWindow.__TAURI__ = previousTauri;
 }
 }
 });

 expect(result.envUpdateStatus).toBe(401);
 expect(result.validateError).toContain('ECONNREFUSED');

	expect(result.calls.some((call) => call.isLocal && call.pathname === '/api/local-env-update')).toBe(true);
	expect(result.calls.some((call) => call.isLocal && call.pathname === '/api/local-validate-secret')).toBe(true);
	expect(result.calls.some((call) => !call.isLocal && call.pathname === '/api/local-env-update')).toBe(false);
	expect(result.calls.some((call) => !call.isLocal && call.pathname === '/api/local-validate-secret')).toBe(false);
  });

  test('chunk preload reload guard is one-shot until app boot clears it', async ({ page }) => {
 await page.goto('/tests/runtime-harness.html');

 const result = await page.evaluate(async () => {
 const {
 buildChunkReloadStorageKey,
 installChunkReloadGuard,
 clearChunkReloadGuard,
 } = await import('/src/bootstrap/chunk-reload.ts');

 const listeners = new Map<string, Array<() => void>>();
 const eventTarget = {
 addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
 const list = listeners.get(type) ?? [];
 list.push(() => {
 if (typeof listener === 'function') {
 listener(new Event(type));
 } else {
 listener.handleEvent(new Event(type));
 }
 });
 listeners.set(type, list);
 },
 };

 const storageMap = new Map<string, string>();
 const storage = {
 getItem: (key: string) => storageMap.get(key) ?? null,
 setItem: (key: string, value: string) => {
 storageMap.set(key, value);
 },
 removeItem: (key: string) => {
 storageMap.delete(key);
 },
 };

 const emit = (eventName: string) => {
 const handlers = listeners.get(eventName) ?? [];
 handlers.forEach((handler) => handler());
 };

 let reloadCount = 0;
 const storageKey = installChunkReloadGuard('9.9.9', {
 eventTarget,
 storage,
 eventName: 'preload-error',
 reload: () => {
 reloadCount += 1;
 },
 });

 emit('preload-error');
 emit('preload-error');
 const reloadCountBeforeClear = reloadCount;

 clearChunkReloadGuard(storageKey, storage);
 emit('preload-error');

 return {
 storageKey,
 expectedKey: buildChunkReloadStorageKey('9.9.9'),
 reloadCountBeforeClear,
 reloadCountAfterClear: reloadCount,
 storedValue: storageMap.get(storageKey) ?? null,
 };
 });

 expect(result.storageKey).toBe(result.expectedKey);
 expect(result.reloadCountBeforeClear).toBe(1);
 expect(result.reloadCountAfterClear).toBe(2);
 expect(result.storedValue).toBe('1');
  });

  test('update badge picks the architecture-correct desktop asset', async ({ page }) => {
 await page.goto('/tests/runtime-harness.html');

 const result = await page.evaluate(async () => {
 const { DesktopUpdater } = await import('/src/app/desktop-updater.ts');
 const updaterProto = DesktopUpdater.prototype as unknown as {
 resolveDownloadInfo: (data: { assets?: Array<{ name: string; browser_download_url: string }> }) => { url: string; name: string | null };
 };
 const assets = [
 { name: 'Crystal-Ball_2.25.147_x64.dmg', browser_download_url: 'https://downloads.example/x64.dmg' },
 { name: 'Crystal-Ball_2.25.147_aarch64.dmg', browser_download_url: 'https://downloads.example/aarch64.dmg' },
 { name: 'release-manifest.json', browser_download_url: 'https://downloads.example/release-manifest.json' },
 ];
 const selected = updaterProto.resolveDownloadInfo.call({}, { assets });
 const fallback = updaterProto.resolveDownloadInfo.call({}, { assets: [] });
 return { selected, fallback };
 });

 const expectedArch = process.arch === 'arm64' ? 'aarch64' : 'x64';
 expect(result.selected.name).toContain(expectedArch);
 expect(result.selected.url).toBe(`https://downloads.example/${expectedArch}.dmg`);
 expect(result.fallback).toEqual({
 url: 'https://github.com/bradleybond512/crystal-ball/releases/latest',
 name: null,
 });
  });

  test('MapContainer falls back to SVG when WebGL2 is unavailable', async ({ page }) => {
 await page.goto('/tests/runtime-harness.html');

 const result = await page.evaluate(async () => {
 const { DEFAULT_MAP_LAYERS } = await import('/src/config/index.ts');
 const { initI18n } = await import('/src/services/i18n.ts');
 await initI18n();
 const { MapContainer } = await import('/src/components/MapContainer.ts');

 const mapHost = document.createElement('div');
 mapHost.className = 'map-container';
 mapHost.style.width = '1200px';
 mapHost.style.height = '720px';
 document.body.appendChild(mapHost);

 const originalGetContext = HTMLCanvasElement.prototype.getContext;
 let map: InstanceType<typeof MapContainer> | null = null;

 try {
 HTMLCanvasElement.prototype.getContext = (function (
 this: HTMLCanvasElement,
 contextId: string,
 options?: unknown
 ) {
 if (contextId === 'webgl2') return null;
 return originalGetContext.call(this, contextId, options as never);
 }) as typeof HTMLCanvasElement.prototype.getContext;

 map = new MapContainer(mapHost, {
 zoom: 1,
 pan: { x: 0, y: 0 },
 view: 'global',
 layers: { ...DEFAULT_MAP_LAYERS },
 timeRange: '7d',
 });

 const deadline = Date.now() + 5_000;
 while (map.isDeckGLMode() && Date.now() < deadline) {
 await new Promise((resolve) => setTimeout(resolve, 20));
 }

 return {
 isDeckGLMode: map.isDeckGLMode(),
 hasSvgModeClass: mapHost.classList.contains('svg-mode'),
 hasDeckModeClass: mapHost.classList.contains('deckgl-mode'),
 deckWrapperCount: mapHost.querySelectorAll('.deckgl-map-wrapper').length,
 svgWrapperCount: mapHost.querySelectorAll('.map-wrapper').length,
 };
 } finally {
 HTMLCanvasElement.prototype.getContext = originalGetContext;
 map?.destroy();
 mapHost.remove();
 }
 });

 expect(result.isDeckGLMode).toBe(false);
 expect(result.hasSvgModeClass).toBe(true);
 expect(result.hasDeckModeClass).toBe(false);
 expect(result.deckWrapperCount).toBe(0);
 expect(result.svgWrapperCount).toBe(1);
  });

  test('MapContainer clears partial DeckGL DOM after constructor failure fallback', async ({ page }) => {
 await page.goto('/tests/runtime-harness.html');

 const result = await page.evaluate(async () => {
 const { DEFAULT_MAP_LAYERS } = await import('/src/config/index.ts');
 const { initI18n } = await import('/src/services/i18n.ts');
 await initI18n();
 const { MapContainer } = await import('/src/components/MapContainer.ts');

 const mapHost = document.createElement('div');
 mapHost.className = 'map-container';
 mapHost.style.width = '1200px';
 mapHost.style.height = '720px';
 document.body.appendChild(mapHost);

 const originalGetContext = HTMLCanvasElement.prototype.getContext;
 const originalGetElementById = Document.prototype.getElementById;
 let map: InstanceType<typeof MapContainer> | null = null;

 try {
 HTMLCanvasElement.prototype.getContext = (function (
 this: HTMLCanvasElement,
 contextId: string,
 options?: unknown
 ) {
 if (contextId === 'webgl2') {
 return {} as WebGL2RenderingContext;
 }
 return originalGetContext.call(this, contextId, options as never);
 }) as typeof HTMLCanvasElement.prototype.getContext;

 Document.prototype.getElementById = (function (
 this: Document,
 id: string
 ): HTMLElement | null {
 if (id === 'deckgl-basemap') {
 return null;
 }
 return originalGetElementById.call(this, id);
 }) as typeof Document.prototype.getElementById;

 map = new MapContainer(mapHost, {
 zoom: 1,
 pan: { x: 0, y: 0 },
 view: 'global',
 layers: { ...DEFAULT_MAP_LAYERS },
 timeRange: '7d',
 });

 const deadline = Date.now() + 5_000;
 while (map.isDeckGLMode() && Date.now() < deadline) {
 await new Promise((resolve) => setTimeout(resolve, 20));
 }

 return {
 isDeckGLMode: map.isDeckGLMode(),
 hasSvgModeClass: mapHost.classList.contains('svg-mode'),
 hasDeckModeClass: mapHost.classList.contains('deckgl-mode'),
 deckWrapperCount: mapHost.querySelectorAll('.deckgl-map-wrapper').length,
 svgWrapperCount: mapHost.querySelectorAll('.map-wrapper').length,
 };
 } finally {
 HTMLCanvasElement.prototype.getContext = originalGetContext;
 Document.prototype.getElementById = originalGetElementById;
 map?.destroy();
 mapHost.remove();
 }
 });

 expect(result.isDeckGLMode).toBe(false);
 expect(result.hasSvgModeClass).toBe(true);
 expect(result.hasDeckModeClass).toBe(false);
 expect(result.deckWrapperCount).toBe(0);
 expect(result.svgWrapperCount).toBe(1);
  });

  test('loadMarkets keeps Yahoo-backed data when Finnhub is skipped', async ({ page }) => {
 await page.goto('/tests/runtime-harness.html');

 const result = await page.evaluate(async () => {
 const { DataLoaderManager } = await import('/src/app/data-loader.ts');
 const originalFetch = window.fetch.bind(window);

 const calls: string[] = [];
 const toUrl = (input: RequestInfo | URL): string => {
 if (typeof input === 'string') return new URL(input, window.location.origin).toString();
 if (input instanceof URL) return input.toString();
 return new URL(input.url, window.location.origin).toString();
 };
 const responseJson = (body: unknown, status = 200) =>
 new Response(JSON.stringify(body), {
 status,
 headers: { 'content-type': 'application/json' },
 });

 const marketRenders: number[] = [];
 const marketConfigErrors: string[] = [];
 const heatmapRenders: number[] = [];
 const heatmapContent = document.createElement('div');
 const commoditiesRenders: number[] = [];
 const commoditiesConfigErrors: string[] = [];
 const cryptoRenders: number[] = [];
 const apiStatuses: Array<{ name: string; status: string }> = [];

 // Yahoo-only symbols (same set as server handler)
 const yahooOnly = new Set(['^GSPC', '^DJI', '^IXIC', '^VIX', 'GC=F', 'CL=F', 'NG=F', 'SI=F', 'HG=F']);

 window.fetch = (async (input: RequestInfo | URL) => {
 const url = toUrl(input);
 calls.push(url);
 const parsed = new URL(url);

 // Generated RPC client: GET /api/market/v1/list-market-quotes?symbols=...
 if (parsed.pathname === '/api/market/v1/list-market-quotes') {
 const symbols = parsed.searchParams.getAll('symbols');
 const quotes = symbols
 .filter((s: string) => yahooOnly.has(s))
 .map((s: string) => {
 const base = s.length * 100;
 return { symbol: s, name: s, display: s, price: base + 1, change: ((base + 1) - base) / base * 100, sparkline: [base - 2, base - 1, base, base + 1] };
 });
 return responseJson({
 quotes,
 finnhubSkipped: true,
 skipReason: 'FINNHUB_API_KEY not configured',
 });
 }

 // Generated RPC client: GET /api/market/v1/list-crypto-quotes
 if (parsed.pathname === '/api/market/v1/list-crypto-quotes') {
 return responseJson({
 quotes: [
 { name: 'Bitcoin', symbol: 'BTC', price: 50000, change: 1.2, sparkline: [1, 2, 3] },
 { name: 'Ethereum', symbol: 'ETH', price: 3000, change: -0.5, sparkline: [1, 2, 3] },
 { name: 'Solana', symbol: 'SOL', price: 120, change: 2.1, sparkline: [1, 2, 3] },
 ],
 });
 }

 return responseJson({});
 }) as typeof window.fetch;

 const fakeApp = {
 ctx: {
 latestMarkets: [] as Array<unknown>,
 panels: {
 markets: {
 renderMarkets: (data: Array<unknown>) => marketRenders.push(data.length),
 showConfigError: (message: string) => marketConfigErrors.push(message),
 },
 heatmap: {
 renderHeatmap: (data: Array<unknown>) => heatmapRenders.push(data.length),
 getContentElement: () => heatmapContent,
 },
 commodities: {
 renderCommodities: (data: Array<unknown>) => commoditiesRenders.push(data.length),
 showConfigError: (message: string) => commoditiesConfigErrors.push(message),
 showRetrying: () => {},
 },
 crypto: {
 renderCrypto: (data: Array<unknown>) => cryptoRenders.push(data.length),
 showRetrying: () => {},
 },
 },
 statusPanel: {
 updateApi: (name: string, payload: { status?: string }) => {
 apiStatuses.push({ name, status: payload.status ?? '' });
 },
 },
 },
 };

 try {
 await (DataLoaderManager.prototype as unknown as { loadMarkets: () => Promise<void> })
 .loadMarkets.call(fakeApp);

 // Commodities now go through listMarketQuotes (batch), not individual Yahoo calls
 const marketQuoteCalls = calls.filter((url) =>
 new URL(url).pathname === '/api/market/v1/list-market-quotes'
 );

 return {
 marketRenders,
 marketConfigErrors,
 heatmapRenders,
 heatmapGateText: heatmapContent.textContent ?? '',
 commoditiesRenders,
 commoditiesConfigErrors,
 cryptoRenders,
 apiStatuses,
 latestMarketsCount: fakeApp.ctx.latestMarkets.length,
 marketQuoteCalls: marketQuoteCalls.length,
 };
 } finally {
 window.fetch = originalFetch;
 }
 });

 expect(result.marketRenders.some((count) => count > 0)).toBe(true);
 expect(result.latestMarketsCount).toBeGreaterThan(0);
 expect(result.marketConfigErrors.length).toBe(0);

 expect(result.heatmapRenders.length).toBe(0);
 expect(result.heatmapGateText).toContain('Finnhub API Key required');

 expect(result.commoditiesRenders.some((count) => count > 0)).toBe(true);
 expect(result.commoditiesConfigErrors.length).toBe(0);
 // Commodities go through listMarketQuotes batch (at least 2 calls: stocks + commodities)
 expect(result.marketQuoteCalls).toBeGreaterThanOrEqual(2);

 expect(result.cryptoRenders.some((count) => count > 0)).toBe(true);
 expect(result.apiStatuses.some((entry) => entry.name === 'Finnhub' && entry.status === 'error')).toBe(true);
 expect(result.apiStatuses.some((entry) => entry.name === 'CoinGecko' && entry.status === 'ok')).toBe(true);
  });

  test('fetchHapiSummary maps proto countryCode to iso2 field', async ({ page }) => {
 await page.goto('/tests/runtime-harness.html');

 const result = await page.evaluate(async () => {
 const originalFetch = window.fetch.bind(window);
 const toUrl = (input: RequestInfo | URL): string => {
 if (typeof input === 'string') return new URL(input, window.location.origin).toString();
 if (input instanceof URL) return input.toString();
 return new URL(input.url, window.location.origin).toString();
 };
 const responseJson = (body: unknown, status = 200) =>
 new Response(JSON.stringify(body), {
 status,
 headers: { 'content-type': 'application/json' },
 });

 const seenCountryCodes = new Set<string>();

 window.fetch = (async (input: RequestInfo | URL) => {
 const parsed = new URL(toUrl(input));
 if (parsed.pathname === '/api/conflict/v1/get-humanitarian-summary') {
 const countryCode = String(parsed.searchParams.get('country_code') || '').toUpperCase();
 seenCountryCodes.add(countryCode);
 return responseJson({
 summary: {
 countryCode,
 countryName: countryCode,
 conflictEventsTotal: 1,
 conflictPoliticalViolenceEvents: 1,
 conflictFatalities: 1,
 referencePeriod: '2026-02',
 conflictDemonstrations: 0,
 updatedAt: Date.now(),
 },
 });
 }
 return responseJson({});
 }) as typeof window.fetch;

 try {
 const conflict = await import('/src/services/conflict/index.ts');
 const summaries = await conflict.fetchHapiSummary();
 const us = summaries.get('US') as Record<string, unknown> | undefined;
 return {
 fetchedCount: seenCountryCodes.size,
 usIso2: us?.iso2 ?? null,
 hasIso3Field: !!us && Object.prototype.hasOwnProperty.call(us, 'iso3'),
 };
 } finally {
 window.fetch = originalFetch;
 }
 });

 expect(result.fetchedCount).toBeGreaterThan(0);
 expect(result.usIso2).toBe('US');
 expect(result.hasIso3Field).toBe(false);
  });

  const preservationCases = [
    { name: 'successful local response without a cloud key', key: '', mode: 'http', status: 200, localCalls: 1 },
    { name: 'rate-limited response without a cloud key', key: '', mode: 'http', status: 429, localCalls: 1 },
    { name: 'rate-limited response with a whitespace cloud key', key: '   ', mode: 'http', status: 429, localCalls: 1 },
    { name: 'final unauthorized response after token refresh', key: '', mode: 'http', status: 401, localCalls: 2 },
    { name: 'final connection error after four local attempts', key: '', mode: 'connection', status: 0, localCalls: 4 },
    { name: 'caller abort after one local attempt', key: '', mode: 'abort', status: 0, localCalls: 1 },
    { name: 'keyed local-only prefix response', key: 'wm_test_key_1234567890abcdef', mode: 'http', status: 429, localCalls: 1, target: '/api/local-env-update' },
    { name: 'keyed local-only exact-path error', key: 'wm_test_key_1234567890abcdef', mode: 'connection', status: 0, localCalls: 4, target: '/api/conflict/v1/list-ucdp-events?limit=1' },
    { name: 'keyed cloud response after local failure', key: 'wm_test_key_1234567890abcdef', mode: 'cloud-response', status: 502, localCalls: 1 },
    { name: 'keyed cloud rejection after local HTTP failure', key: 'wm_test_key_1234567890abcdef', mode: 'cloud-error', status: 0, localCalls: 1 },
    { name: 'keyed cloud rejection after local connection failure', key: 'wm_test_key_1234567890abcdef', mode: 'cloud-error-after-connection', status: 0, localCalls: 4 },
  ];

  for (const scenario of preservationCases) {
    test(`runtime preserves ${scenario.name}`, async ({ page }) => {
      await page.goto('/tests/runtime-harness.html');
      const result = await page.evaluate(async (scenario) => {
        const runtime = await import('/src/services/runtime.ts');
        const runtimeConfig = await import('/src/services/runtime-config.ts');
        const webSecretStore = await import('/src/services/web-secret-store.ts');
        const globalWindow = window as unknown as Record<string, unknown>;
        const originalFetch = window.fetch;
        const previousTauri = globalWindow.__TAURI__;
        const calls: Array<{ local: boolean; authorization: string | null; cloudKey: string | null; sameCallerSignal: boolean }> = [];
        const responses: Response[] = [];
        const connectionErrors: Error[] = [];
        const controller = new AbortController();
        const abortError = new DOMException('Synthetic caller cancellation', 'AbortError');
        const cloudError = new Error('Synthetic cloud failure');
        const cloudResponse = new Response('original cloud body', { status: 502, headers: { 'Retry-After': '120' } });
        let tokenReads = 0;
        let localAttempts = 0;

        // Configure only synthetic browser secrets before installing the desktop bridge.
        await webSecretStore.createVault('runtime-e2e-vault-passphrase');
        await runtimeConfig.setSecretValue('CRYSTALBALL_API_KEY' as import('/src/services/runtime-config.ts').RuntimeSecretKey, scenario.key);
        globalWindow.__TAURI__ = { core: { invoke: async (command: string) => {
          if (command === 'get_local_api_port') return 46123;
          if (command === 'get_local_api_token') return `synthetic-local-token-${++tokenReads}`;
          return null;
        } } };
        delete globalWindow.__wmFetchPatched;
        window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          const url = new URL(raw, location.origin);
          const local = url.hostname === '127.0.0.1' && url.port === '46123';
          const headers = new Headers(init?.headers);
          calls.push({ local, authorization: headers.get('Authorization'), cloudKey: headers.get('X-CrystalBall-Key'), sameCallerSignal: init?.signal === controller.signal });
          if (!local) {
            if (scenario.mode === 'cloud-response') return cloudResponse;
            throw cloudError;
          }
          localAttempts++;
          if (scenario.mode === 'abort') {
            controller.abort(abortError);
            throw abortError;
          }
          if (scenario.mode === 'connection' || scenario.mode === 'cloud-error-after-connection') {
            const error = new Error(`Synthetic connection failure ${localAttempts}`);
            connectionErrors.push(error);
            throw error;
          }
          const response = new Response(`original local body ${localAttempts}`, {
            status: scenario.mode.startsWith('cloud-') ? 429 : scenario.status,
            headers: { 'Retry-After': '60', 'X-Local-Evidence': 'retained' },
          });
          responses.push(response);
          return response;
        }) as typeof window.fetch;

        try {
          runtime.installRuntimeFetchPatch();
          let response: Response | undefined;
          let error: unknown;
          try {
            response = await window.fetch(scenario.target ?? '/api/fred-data?series_id=CPIAUCSL', {
              headers: { 'X-Request-Evidence': 'retained' },
              ...(scenario.mode === 'abort' ? { signal: controller.signal } : {}),
            });
          } catch (caught) {
            error = caught;
          }
          return {
            responseIdentity: response !== undefined && response === (scenario.mode === 'cloud-response' ? cloudResponse : responses.at(-1)),
            status: response?.status ?? 0,
            body: response ? await response.text() : null,
            retryAfter: response?.headers.get('Retry-After') ?? null,
            evidenceHeader: response?.headers.get('X-Local-Evidence') ?? null,
            errorIdentity: error !== undefined && error === (scenario.mode.startsWith('cloud-error') ? cloudError : scenario.mode === 'abort' ? abortError : connectionErrors.at(-1)),
            errorName: error instanceof Error ? error.name : null,
            tokenReads,
            calls,
          };
        } finally {
          window.fetch = originalFetch;
          delete globalWindow.__wmFetchPatched;
          if (previousTauri === undefined) delete globalWindow.__TAURI__;
          else globalWindow.__TAURI__ = previousTauri;
          await runtimeConfig.setSecretValue('CRYSTALBALL_API_KEY' as import('/src/services/runtime-config.ts').RuntimeSecretKey, '');
          await webSecretStore.destroyVault();
        }
      }, scenario);

      const local = result.calls.filter((call) => call.local);
      const cloud = result.calls.filter((call) => !call.local);
      expect(local).toHaveLength(scenario.localCalls);
      expect(cloud).toHaveLength(scenario.mode.startsWith('cloud-') ? 1 : 0);
      expect(result.status).toBe(scenario.status);
      expect(result.tokenReads).toBe(scenario.status === 401 ? 2 : 1);
      expect(local[0]?.authorization).toBe('Bearer synthetic-local-token-1');
      expect(local.every((call) => call.cloudKey === null)).toBe(true);
      if (scenario.status === 401) expect(local[1]?.authorization).toBe('Bearer synthetic-local-token-2');
      if (cloud.length) {
        expect(cloud[0]?.authorization).toBeNull();
        expect(cloud[0]?.cloudKey).toBe('wm_test_key_1234567890abcdef');
      }
      if (scenario.status) {
        expect(result.responseIdentity).toBe(true);
        expect(result.body).toBe(scenario.mode === 'cloud-response' ? 'original cloud body' : `original local body ${scenario.localCalls}`);
        expect(result.retryAfter).toBe(scenario.mode === 'cloud-response' ? '120' : '60');
        if (scenario.mode === 'http') expect(result.evidenceHeader).toBe('retained');
      } else {
        expect(result.errorIdentity).toBe(true);
      }
      if (scenario.mode === 'abort') {
        expect(result.errorName).toBe('AbortError');
        expect(local[0]?.sameCallerSignal).toBe(true);
      }
    });
  }

  test('cloud fallback allowed with valid CrystalBall API key', async ({ page }) => {
 await page.goto('/tests/runtime-harness.html');

 const result = await page.evaluate(async () => {
 const runtime = await import('/src/services/runtime.ts');
 const runtimeConfig = await import('/src/services/runtime-config.ts');
 const webSecretStore = await import('/src/services/web-secret-store.ts');
 const globalWindow = window as unknown as Record<string, unknown>;
 const originalFetch = window.fetch.bind(window);

	const calls: Array<{
	  pathname: string;
	  isLocal: boolean;
	  cloudApiKey: string | null;
	}> = [];
 const responseJson = (body: unknown, status = 200) =>
 new Response(JSON.stringify(body), {
 status,
 headers: { 'content-type': 'application/json' },
 });

 window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	  const rawUrl =
		typeof input === 'string'
		  ? input
		  : input instanceof URL
			? input.toString()
			: input.url;
	  const url = new URL(rawUrl, location.origin);
	  const isLocal = url.hostname === '127.0.0.1' && url.port === '46123';
	  calls.push({
		pathname: url.pathname,
		isLocal,
		cloudApiKey: new Headers(init?.headers).get('X-CrystalBall-Key'),
	  });

	  if (isLocal && url.pathname === '/api/market/v1/test') {
		return responseJson({ error: 'local sidecar unavailable' }, 503);
	  }
	  if (!isLocal && url.pathname === '/api/market/v1/test') {
		return responseJson({ quotes: [] }, 200);
 }
 return responseJson({ ok: true }, 200);
 }) as typeof window.fetch;

 const previousTauri = globalWindow.__TAURI__;
 globalWindow.__TAURI__ = { core: { invoke: () => Promise.resolve(null) } };
 delete globalWindow.__wmFetchPatched;

 const testKey = 'wm_test_key_1234567890abcdef';
 await webSecretStore.createVault('runtime-e2e-vault-passphrase');
 await runtimeConfig.setSecretValue('CRYSTALBALL_API_KEY' as import('/src/services/runtime-config.ts').RuntimeSecretKey, testKey);

 try {
 runtime.installRuntimeFetchPatch();

 const response = await window.fetch('/api/market/v1/test');
 const body = await response.json() as { quotes?: unknown[] };

	  return {
		status: response.status,
		hasQuotes: Array.isArray(body.quotes),
		localCalls: calls.filter((call) => call.isLocal && call.pathname === '/api/market/v1/test').length,
		cloudCalls: calls.filter((call) => !call.isLocal && call.pathname === '/api/market/v1/test').length,
		wmKeyHeader: calls.find((call) => !call.isLocal && call.pathname === '/api/market/v1/test')?.cloudApiKey ?? null,
 };
 } finally {
 window.fetch = originalFetch;
 delete globalWindow.__wmFetchPatched;
 if (previousTauri === undefined) {
 delete globalWindow.__TAURI__;
 } else {
 globalWindow.__TAURI__ = previousTauri;
 }
 await runtimeConfig.setSecretValue('CRYSTALBALL_API_KEY' as import('/src/services/runtime-config.ts').RuntimeSecretKey, '');
 await webSecretStore.destroyVault();
 }
 });

	expect(result.status).toBe(200);
	expect(result.hasQuotes).toBe(true);
	expect(result.localCalls).toBe(1);
	expect(result.cloudCalls).toBe(1);
 expect(result.wmKeyHeader).toBe('wm_test_key_1234567890abcdef');
  });

  test('country-instability HAPI fallback ignores eventsCivilianTargeting in score', async ({ page }) => {
 await page.goto('/tests/runtime-harness.html');

 const result = await page.evaluate(async () => {
 const cii = await import('/src/services/country-instability.ts');

 const makeSummary = (eventsCivilianTargeting: number) => ({
 iso2: 'US',
 locationName: 'United States',
 month: '2026-02',
 eventsTotal: 0,
 eventsPoliticalViolence: 1,
 eventsCivilianTargeting,
 eventsDemonstrations: 0,
 fatalitiesTotalPoliticalViolence: 0,
 fatalitiesTotalCivilianTargeting: 0,
 });

 cii.clearCountryData();
 cii.ingestHapiForCII(new Map([['US', makeSummary(0)]]));
 const scoreWithoutCivilian = cii.getCountryScore('US');

 cii.clearCountryData();
 cii.ingestHapiForCII(new Map([['US', makeSummary(999)]]));
 const scoreWithCivilian = cii.getCountryScore('US');

 return { scoreWithoutCivilian, scoreWithCivilian };
 });

 expect(result.scoreWithoutCivilian).not.toBeNull();
 expect(result.scoreWithCivilian).not.toBeNull();
 expect(result.scoreWithoutCivilian).toBe(result.scoreWithCivilian);
 expect(result.scoreWithCivilian as number).toBeLessThan(10);
  });
});
