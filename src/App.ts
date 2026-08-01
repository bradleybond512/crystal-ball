import type { Monitor, PanelConfig, MapLayers } from '@/types';
import type { AppContext } from '@/app/app-context';
import {
  REFRESH_INTERVALS,
  DEFAULT_PANELS,
  DEFAULT_MAP_LAYERS,
  MOBILE_DEFAULT_MAP_LAYERS,
  STORAGE_KEYS,
  SITE_VARIANT,
} from '@/config';
import { initDB, cleanOldSnapshots, isAisConfigured, initAisStream, isOutagesConfigured, disconnectAisStream } from '@/services';
import { mlWorker } from '@/services/ml-worker';
import { getAiFlowSettings, subscribeAiFlowChange } from '@/services/ai-flow-settings';
import { startLearning } from '@/services/country-instability';
import { dataFreshness } from '@/services/data-freshness';
import { loadFromStorage, parseMapUrlState, saveToStorage, isMobileDevice } from '@/utils';
import type { ParsedMapUrlState } from '@/utils';
import { SignalModal, IntelligenceGapBadge, BreakingNewsBanner } from '@/components';
import { initBreakingNewsAlerts, destroyBreakingNewsAlerts } from '@/services/breaking-news-alerts';
import { initSoundManager } from '@/services/sound-manager';
import type { ServiceStatusPanel } from '@/components/ServiceStatusPanel';
import type { StablecoinPanel } from '@/components/StablecoinPanel';
import type { ETFFlowsPanel } from '@/components/ETFFlowsPanel';
import type { MacroSignalsPanel } from '@/components/MacroSignalsPanel';
import type { StrategicPosturePanel } from '@/components/StrategicPosturePanel';
import type { StrategicRiskPanel } from '@/components/StrategicRiskPanel';
import { isDesktopRuntime } from '@/services/runtime';
import { initAppActivity } from '@/services/app-activity';
import { BETA_MODE } from '@/config/beta';
import { trackEvent, trackDeeplinkOpened } from '@/services/analytics';
import { preloadCountryGeometry, getCountryNameByCode } from '@/services/country-geometry';
import { initI18n } from '@/services/i18n';
import { getAlgorithmEvaluationLedger } from '@/services/algorithms/algorithms-state';
import {
  persistAlgorithmLedger,
  startAlgorithmLedgerPersistence,
} from '@/services/algorithms/algorithm-ledger-persistence';
import { syncForecastEvaluations } from '@/services/algorithms/forecast-outcome-grading';
import { getCalibrationStore } from '@/services/intelligence/forecast-calibration-adapter';

import { fetchBootstrapData } from '@/services/bootstrap';
import { preloadIdbBackedStores, installIdbStorageRouting } from '@/services/intelligence/idb-store-cache';
import { DesktopUpdater } from '@/app/desktop-updater';
import { DesktopNotifications } from '@/app/desktop-notifications';
import { CountryIntelManager } from '@/app/country-intel';
import { SearchManager } from '@/app/search-manager';
import { RefreshScheduler } from '@/app/refresh-scheduler';
import { PanelLayoutManager } from '@/app/panel-layout';
import { DataLoaderManager } from '@/app/data-loader';
import { EventHandlerManager } from '@/app/event-handlers';
import { resolveUserRegion } from '@/utils/user-location';
import type { GodsVisionView } from '@/components/GodsVisionView';
import { getRuntimeConfigSnapshot } from '@/services/runtime-config';
import { startNotificationRouter } from '@/services/notification-router';

export let cyberReactorUnsubscribe: (() => void) | null = null;

const CYBER_LAYER_ENABLED = import.meta.env.VITE_ENABLE_CYBER_LAYER === 'true';
const CRITICAL_PRIORITY_PANELS: Record<string, string[]> = {
  full: ['watchlist', 'alert-center', 'strategic-risk', 'strategic-posture', 'insights', 'cii', 'geo-hubs', 'live-news', 'live-webcams'],
  tech: ['insights', 'regulation', 'tech-readiness', 'ai', 'tech-hubs', 'tech', 'policy'],
  finance: ['insights', 'markets', 'macro-signals', 'economic', 'commodities', 'live-news', 'live-webcams'],
};

function clonePanelSettings(settings: Record<string, PanelConfig>): Record<string, PanelConfig> {
  return Object.fromEntries(
 Object.entries(settings).map(([key, config]) => [key, { ...config }]),
  );
}

export type { CountryBriefSignals } from '@/app/app-context';

export class App {
  private state: AppContext;
  private pendingDeepLinkCountry: string | null = null;
  private panelRetryTimer: number | null = null;
  private onPanelRetry: (() => void) | null = null;

  private panelLayout: PanelLayoutManager;
  private dataLoader: DataLoaderManager;
  private eventHandlers: EventHandlerManager;
  private searchManager: SearchManager;
  private countryIntel: CountryIntelManager;
  private refreshScheduler: RefreshScheduler;
  private desktopUpdater: DesktopUpdater;
  private desktopNotifications: DesktopNotifications;

  private godsVisionView: GodsVisionView | null = null;
  private modules: { destroy(): void }[] = [];
  private unsubAiFlow: (() => void) | null = null;

  constructor(containerId: string) {
 const el = document.getElementById(containerId);
 if (!el) throw new Error(`Container ${containerId} not found`);

 const PANEL_ORDER_KEY = 'panel-order';
 const PANEL_SPANS_KEY = 'crystalball-panel-spans';

 const isMobile = isMobileDevice();
 const isDesktopApp = isDesktopRuntime();
 const monitors = loadFromStorage<Monitor[]>(STORAGE_KEYS.monitors, []);

 // Use mobile-specific defaults on first load (no saved layers)
 const defaultLayers = isMobile ? MOBILE_DEFAULT_MAP_LAYERS : DEFAULT_MAP_LAYERS;

 let mapLayers: MapLayers;
 let panelSettings: Record<string, PanelConfig>;

 // Check if variant changed - reset all settings to variant defaults
 const storedVariant = localStorage.getItem('crystalball-variant');
 const currentVariant = SITE_VARIANT;
 console.log(`[App] Variant check: stored="${storedVariant}", current="${currentVariant}"`);
 if (storedVariant === currentVariant) {
 mapLayers = loadFromStorage<MapLayers>(STORAGE_KEYS.mapLayers, defaultLayers);
 // Happy variant: force non-happy layers off even if localStorage has stale true values
 if (currentVariant === 'happy') {
 const unhappyLayers: (keyof MapLayers)[] = ['conflicts', 'bases', 'hotspots', 'nuclear', 'irradiators', 'sanctions', 'military', 'protests', 'pipelines', 'waterways', 'ais', 'flights', 'spaceports', 'minerals', 'natural', 'fires', 'outages', 'cyberThreats', 'weather', 'economic', 'cables', 'datacenters', 'ucdpEvents', 'displacement', 'climate', 'iranAttacks'];
 unhappyLayers.forEach(layer => { mapLayers[layer] = false; });
 }
 panelSettings = clonePanelSettings(
 loadFromStorage<Record<string, PanelConfig>>(
 STORAGE_KEYS.panels,
 DEFAULT_PANELS,
 ),
 );
 // Merge in any new panels that didn't exist when settings were saved
 for (const [key, config] of Object.entries(DEFAULT_PANELS)) {
 if (!(key in panelSettings)) {
 panelSettings[key] = { ...config };
 }
 }
 console.log('[App] Loaded panel settings from storage:', Object.entries(panelSettings).filter(([_, v]) => !v.enabled).map(([k]) => k));

 // One-time migration: reorder panels for existing users (v1.9 panel layout)
 const PANEL_ORDER_MIGRATION_KEY = 'crystalball-panel-order-v1.9';
 if (!localStorage.getItem(PANEL_ORDER_MIGRATION_KEY)) {
 const savedOrder = localStorage.getItem(PANEL_ORDER_KEY);
 if (savedOrder) {
 try {
 const order: string[] = JSON.parse(savedOrder);
 const priorityPanels = ['insights', 'strategic-posture', 'cii', 'strategic-risk'];
 const filtered = order.filter(k => !priorityPanels.includes(k) && k !== 'live-news');
 const liveNewsIdx = order.indexOf('live-news');
 const newOrder = liveNewsIdx === -1 ? [] : ['live-news'];
 newOrder.push(...priorityPanels.filter(p => order.includes(p)), ...filtered);
 localStorage.setItem(PANEL_ORDER_KEY, JSON.stringify(newOrder));
 console.log('[App] Migrated panel order to v1.8 layout');
 } catch {
 // Invalid saved order, will use defaults
 }
 }
 localStorage.setItem(PANEL_ORDER_MIGRATION_KEY, 'done');
 }

 const criticalPriorityPanels = CRITICAL_PRIORITY_PANELS[currentVariant] ?? [];
 const CRITICAL_PRIORITY_MIGRATION_KEY = 'crystalball-critical-top-v2.7.5';
 if (criticalPriorityPanels.length > 0 && !localStorage.getItem(CRITICAL_PRIORITY_MIGRATION_KEY)) {
 const savedOrder = localStorage.getItem(PANEL_ORDER_KEY);
 if (savedOrder) {
 try {
 const order: string[] = JSON.parse(savedOrder);
 const filtered = order.filter(k => !criticalPriorityPanels.includes(k));
 const newOrder = [
 ...criticalPriorityPanels.filter(panelKey => order.includes(panelKey)),
 ...filtered,
 ];
 localStorage.setItem(PANEL_ORDER_KEY, JSON.stringify(newOrder));
 console.log(`[App] ${currentVariant} variant: moved critical panels to top`);
 } catch {
 // Invalid saved order, will use defaults
 }
 }
 localStorage.setItem(CRITICAL_PRIORITY_MIGRATION_KEY, 'done');
 }

 const FULL_PANEL_VISIBILITY_MIGRATION_KEY = 'crystalball-full-panels-visible-v2.7.6';
 if (currentVariant === 'full' && !localStorage.getItem(FULL_PANEL_VISIBILITY_MIGRATION_KEY)) {
 for (const [key, config] of Object.entries(DEFAULT_PANELS)) {
 // Panels that default to disabled (e.g. 'maritime-intel', superseded by
 // 'maritime-superpower') must not be force-enabled; a user's saved
 // enabled state for them is preserved as-is.
 if (!config.enabled) continue;
 if (panelSettings[key]) {
 panelSettings[key].name = config.name;
 panelSettings[key].priority = config.priority;
 panelSettings[key].enabled = true;
 } else {
 panelSettings[key] = { ...config, enabled: true };
 }
 }
 saveToStorage(STORAGE_KEYS.panels, panelSettings);
 localStorage.setItem(FULL_PANEL_VISIBILITY_MIGRATION_KEY, 'done');
 }
 } else {
 // Variant changed - use defaults for new variant, clear old settings
 console.log('[App] Variant changed - resetting to defaults');
 localStorage.setItem('crystalball-variant', currentVariant);
 localStorage.removeItem(STORAGE_KEYS.mapLayers);
 localStorage.removeItem(STORAGE_KEYS.panels);
 localStorage.removeItem(PANEL_ORDER_KEY);
 localStorage.removeItem(PANEL_SPANS_KEY);
 mapLayers = { ...defaultLayers };
 panelSettings = clonePanelSettings(DEFAULT_PANELS);
 }

 // One-time migration: clear stale panel ordering and sizing state
 const LAYOUT_RESET_MIGRATION_KEY = 'crystalball-layout-reset-v2.5';
 if (!localStorage.getItem(LAYOUT_RESET_MIGRATION_KEY)) {
 const hadSavedOrder = !!localStorage.getItem(PANEL_ORDER_KEY);
 const hadSavedSpans = !!localStorage.getItem(PANEL_SPANS_KEY);
 if (hadSavedOrder || hadSavedSpans) {
 localStorage.removeItem(PANEL_ORDER_KEY);
 localStorage.removeItem(PANEL_SPANS_KEY);
 console.log('[App] Applied layout reset migration (v2.5): cleared panel order/spans');
 }
 localStorage.setItem(LAYOUT_RESET_MIGRATION_KEY, 'done');
 }

 // One-time migration: remove runtime-config sidebar panel (moved to Settings → API Keys tab)
 const RUNTIME_CONFIG_MIGRATION_KEY = 'crystalball-runtime-config-removed-v2.5.25';
 if (!localStorage.getItem(RUNTIME_CONFIG_MIGRATION_KEY)) {
 if ('runtime-config' in panelSettings) {
 delete panelSettings['runtime-config'];
 saveToStorage(STORAGE_KEYS.panels, panelSettings);
 console.log('[App] Migration: removed runtime-config sidebar panel (now in Settings → API Keys)');
 }
 localStorage.setItem(RUNTIME_CONFIG_MIGRATION_KEY, 'done');
 }

 const initialUrlState: ParsedMapUrlState | null = parseMapUrlState(window.location.search, mapLayers);
 if (initialUrlState.layers) {
 if (currentVariant === 'tech') {
 const geoLayers: (keyof MapLayers)[] = ['conflicts', 'bases', 'hotspots', 'nuclear', 'irradiators', 'sanctions', 'military', 'protests', 'pipelines', 'waterways', 'ais', 'flights', 'spaceports', 'minerals'];
 const urlLayers = initialUrlState.layers;
 geoLayers.forEach(layer => {
 urlLayers[layer] = false;
 });
 }
 // For happy variant, force off all non-happy layers (including natural events)
 if (currentVariant === 'happy') {
 const unhappyLayers: (keyof MapLayers)[] = ['conflicts', 'bases', 'hotspots', 'nuclear', 'irradiators', 'sanctions', 'military', 'protests', 'pipelines', 'waterways', 'ais', 'flights', 'spaceports', 'minerals', 'natural', 'fires', 'outages', 'cyberThreats', 'weather', 'economic', 'cables', 'datacenters', 'ucdpEvents', 'displacement', 'climate', 'iranAttacks'];
 const urlLayers = initialUrlState.layers;
 unhappyLayers.forEach(layer => {
 urlLayers[layer] = false;
 });
 }
 mapLayers = initialUrlState.layers;
 }
 if (!CYBER_LAYER_ENABLED) {
 mapLayers.cyberThreats = false;
 }
 const disabledSources = new Set(loadFromStorage<string[]>(STORAGE_KEYS.disabledFeeds, []));

 // Build shared state object
 this.state = {
 map: null,
 isMobile,
 isDesktopApp,
 container: el,
 panels: {},
 newsPanels: {},
 panelSettings,
 mapLayers,
 allNews: [],
 newsByCategory: {},
 latestMarkets: [],
 latestPredictions: [],
 latestClusters: [],
 intelligenceCache: {},
 cyberThreatsCache: null,
 acledEvents: [],
 adsbMilitary: [],
 disabledSources,
 currentTimeRange: '7d',
 inFlight: new Set(),
 seenGeoAlerts: new Set(),
 monitors,
 signalModal: null,
 statusPanel: null,
 searchModal: null,
 findingsBadge: null,
 breakingBanner: null,
 playbackControl: null,
 exportPanel: null,
 unifiedSettings: null,
 mobileWarningModal: null,
 pizzintIndicator: null,
 countryBriefPage: null,
 countryTimeline: null,
 positivePanel: null,
 countersPanel: null,
 progressPanel: null,
 breakthroughsPanel: null,
 heroPanel: null,
 digestPanel: null,
 speciesPanel: null,
 renewablePanel: null,
 tvMode: null,
 happyAllItems: [],
 isDestroyed: false,
 isPlaybackMode: false,
 isIdle: false,
 initialLoadComplete: false,
 resolvedLocation: 'global',
 initialUrlState,
 PANEL_ORDER_KEY,
 PANEL_SPANS_KEY,
 updateState: null,
 };

 // Instantiate modules (callbacks wired after all modules exist)
 this.refreshScheduler = new RefreshScheduler(this.state);
 this.countryIntel = new CountryIntelManager(this.state);
 this.desktopUpdater = new DesktopUpdater(this.state);
 this.desktopNotifications = new DesktopNotifications(this.state);

 this.dataLoader = new DataLoaderManager(this.state, {
 renderCriticalBanner: (postures) => this.panelLayout.renderCriticalBanner(postures),
 });

 this.searchManager = new SearchManager(this.state, {
 openCountryBriefByCode: (code, country) => this.countryIntel.openCountryBriefByCode(code, country),
 });

 this.panelLayout = new PanelLayoutManager(this.state, {
 openCountryStory: (code, name) => this.countryIntel.openCountryStory(code, name),
 openCountryBriefByCode: (code, name) => this.countryIntel.openCountryBriefByCode(code, name),
 getCountryWatchSnapshot: (code, name) => this.countryIntel.getCountryWatchSnapshot(code, name),
 loadAllData: () => this.dataLoader.loadAllData(),
 updateMonitorResults: () => this.dataLoader.updateMonitorResults(),
 loadSecurityAdvisories: () => this.dataLoader.loadSecurityAdvisories(),
 });

 this.eventHandlers = new EventHandlerManager(this.state, {
 updateSearchIndex: () => this.searchManager.updateSearchIndex(),
 loadAllData: () => this.dataLoader.loadAllData(),
 flushStaleRefreshes: () => this.refreshScheduler.flushStaleRefreshes(),
 setHiddenSince: (ts) => this.refreshScheduler.setHiddenSince(ts),
 loadDataForLayer: (layer) => { void this.dataLoader.loadDataForLayer(layer as keyof MapLayers); },
 waitForAisData: () => this.dataLoader.waitForAisData(),
 syncDataFreshnessWithLayers: () => this.dataLoader.syncDataFreshnessWithLayers(),
 });

 // Wire cross-module callback: DataLoader → SearchManager
 this.dataLoader.updateSearchIndex = () => this.searchManager.updateSearchIndex();

 // Track destroy order (reverse of init)
 this.modules = [
 this.desktopUpdater,
 this.panelLayout,
 this.countryIntel,
 this.searchManager,
 this.dataLoader,
 this.refreshScheduler,
 this.eventHandlers,
 ];
  }

  public async init(): Promise<void> {
 const initStart = performance.now();
 // Log-bridge records breadcrumbs, long-task perf events, and memory snapshots
 // in every runtime. In desktop builds it also forwards to ~/Library/Logs via
 // Tauri; in web builds the invokeTauri calls no-op but the client-side
 // breadcrumb buffer remains available for diagnostics copy-outs.
 const { installLogBridge, bootTrace, resetBootTrace } = await import('@/services/log-bridge');
 installLogBridge();
 resetBootTrace();
 bootTrace('init:start');
 await initDB();
 await initI18n();
 cyberReactorUnsubscribe = startNotificationRouter();
 const aiFlow = getAiFlowSettings();
 if (aiFlow.browserModel || isDesktopRuntime()) {
 await mlWorker.init();
 if (BETA_MODE) mlWorker.loadModel('summarization-beta').catch(() => {});
 }

 this.unsubAiFlow = subscribeAiFlowChange((key) => {
 if (key === 'browserModel') {
 const s = getAiFlowSettings();
 if (s.browserModel) {
 mlWorker.init();
 } else {
 mlWorker.terminate();
 }
 }
 });

 // Check AIS configuration before init
 if (!isAisConfigured()) {
 this.state.mapLayers.ais = false;
 } else if (this.state.mapLayers.ais) {
 initAisStream();
 }

 // Hydrate in-memory cache from bootstrap endpoint (before panels construct and fetch)
 await fetchBootstrapData();

 const resolvedRegion = await resolveUserRegion();
 this.state.resolvedLocation = resolvedRegion;

 // Relocate the large reasoning stores from localStorage to IndexedDB and warm
 // their in-memory mirror BEFORE panels/reasoning construct, so their sync
 // hydration reads warm data (and one-time-migrates any localStorage copy).
 // Fail-open: a preload error just leaves the stores to rebuild from live data.
 const bootPreT = typeof performance === 'undefined' ? 0 : performance.now();
 bootTrace('preload:stores:start');
 try {
 await preloadIdbBackedStores();
 installIdbStorageRouting();
 } catch { /* non-fatal */ }
 try {
 const algorithmLedger = getAlgorithmEvaluationLedger();
 await startAlgorithmLedgerPersistence({ ledger: algorithmLedger });
 syncForecastEvaluations(
 getCalibrationStore().all(),
 algorithmLedger,
 );
 await persistAlgorithmLedger({ ledger: algorithmLedger });
 } catch (error) {
 console.warn('[algorithm-outcome-grading] startup wiring failed:', error);
 }
 bootTrace('preload:stores:done');

 // Phase 1: Layout (creates map + panels — they'll find hydrated data)
 const bootLayoutT = typeof performance === 'undefined' ? 0 : performance.now();
 bootTrace('panelLayout.init:start');
 this.panelLayout.init();
 bootTrace('panelLayout.init:done');
 if (bootLayoutT > 0) {
 console.warn(`[BOOT-TIMING] preload+routing gated boot for ${(bootLayoutT - bootPreT).toFixed(0)}ms; panelLayout.init took ${(performance.now() - bootLayoutT).toFixed(0)}ms`);
 }

 // Happy variant: pre-populate panels from persistent cache for instant render
 if (SITE_VARIANT === 'happy') {
 await this.dataLoader.hydrateHappyPanelsFromCache();
 }

 // Phase 2: Shared UI components
 bootTrace('phase2:shared-ui:start');
 this.state.signalModal = new SignalModal();
 this.state.signalModal.setLocationClickHandler((lat, lon) => {
 this.state.map?.setCenter(lat, lon, 4);
 });
 if (!this.state.isMobile) {
 this.state.findingsBadge = new IntelligenceGapBadge();
 this.state.findingsBadge.setOnSignalClick((signal) => {
 if (this.state.countryBriefPage?.isVisible()) return;
 if (localStorage.getItem('wm-settings-open') === '1') return;
 this.state.signalModal?.showSignal(signal);
 });
 this.state.findingsBadge.setOnAlertClick((alert) => {
 if (this.state.countryBriefPage?.isVisible()) return;
 if (localStorage.getItem('wm-settings-open') === '1') return;
 this.state.signalModal?.showAlert(alert);
 });
 }

 if (!this.state.isMobile) {
 bootTrace('phase2:breaking-news:start');
 initBreakingNewsAlerts();
 this.state.breakingBanner = new BreakingNewsBanner();
 }

 // Phase 3: UI setup methods
 bootTrace('phase3:ui-setup:start');
 initSoundManager();
 this.eventHandlers.startHeaderClock();
 this.eventHandlers.setupMobileWarning();
 this.eventHandlers.setupPlaybackControl();
 bootTrace('phase3:status-panel:start');
 this.eventHandlers.setupStatusPanel();
 this.eventHandlers.setupPizzIntIndicator();
 this.eventHandlers.setupExportPanel();
 bootTrace('phase3:unified-settings:start');
 this.eventHandlers.setupUnifiedSettings();
 this.panelLayout.wirePlaceCallbacks();

 // Phase 4: SearchManager, MapLayerHandlers, CountryIntel
 bootTrace('phase4:search-mapslayers-countryintel:start');
 this.searchManager.init();
 this.eventHandlers.setupMapLayerHandlers();
 this.countryIntel.init();

 // God's Eye toggle (keyboard shortcut + sidebar button dispatch this)
 document.addEventListener('cb:toggle-gods-vision', () => {
 this.toggleGodsVision().catch(() => {/* error handled in GodsVisionView */});
 });

 // A panel whose loading budget expired shows a "Source unreachable — Retry"
 // state; clicking Retry dispatches cb:panel-retry. Re-run the data wave so the
 // panel gets a fresh fetch. Debounced so mashing Retry across several stalled
 // panels coalesces into one refresh. Handler stored so destroy() can detach it.
 this.onPanelRetry = () => {
 if (this.panelRetryTimer !== null) return;
 this.panelRetryTimer = window.setTimeout(() => {
 this.panelRetryTimer = null;
 this.dataLoader.loadAllData().catch(() => {/* per-source errors surface in-panel */});
 }, 400);
 };
 document.addEventListener('cb:panel-retry', this.onPanelRetry);

 // Phase 5: Event listeners + URL sync
 bootTrace('phase5:events-urlsync:start');
 initAppActivity();
 this.eventHandlers.init();
 // Capture ?country= BEFORE URL sync overwrites it
 const initState = parseMapUrlState(window.location.search, this.state.mapLayers);
 this.pendingDeepLinkCountry = initState.country ?? null;
 this.eventHandlers.setupUrlStateSync();

 // Phase 6: Data loading. Country geometry (a ~214 KB fetch + parse) is only
 // needed later by map hit-testing / the country layer, not by loadAllData —
 // so run both concurrently instead of gating the whole first data wave on it.
 bootTrace('phase6:data-load:start');
 this.dataLoader.syncDataFreshnessWithLayers();
 bootTrace('phase6:data-load:awaiting');
 await Promise.all([preloadCountryGeometry(), this.dataLoader.loadAllData()]);
 bootTrace('phase6:data-load:done');

 startLearning();
 bootTrace('startLearning:done');

 // Hide unconfigured layers after first data load
 if (!isAisConfigured()) {
 this.state.map?.hideLayerToggle('ais');
 }
 if (isOutagesConfigured() === false) {
 this.state.map?.hideLayerToggle('outages');
 }
 if (!CYBER_LAYER_ENABLED) {
 this.state.map?.hideLayerToggle('cyberThreats');
 }

 // Phase 7: Refresh scheduling
 this.setupRefreshIntervals();
 this.eventHandlers.setupSnapshotSaving();
 cleanOldSnapshots().catch((error) => console.warn('[Storage] Snapshot cleanup failed:', error));

 // Phase 8: Deep links + update checks
 this.handleDeepLinks();
 this.desktopUpdater.init();
 this.desktopNotifications.init();

 // Analytics
 trackEvent('wm_app_loaded', {
 load_time_ms: Math.round(performance.now() - initStart),
 panel_count: Object.keys(this.state.panels).length,
 });
 this.eventHandlers.setupPanelViewTracking();
  }

  public destroy(): void {
 this.state.isDestroyed = true;

 if (this.onPanelRetry) {
 document.removeEventListener('cb:panel-retry', this.onPanelRetry);
 this.onPanelRetry = null;
 }
 if (this.panelRetryTimer !== null) {
 clearTimeout(this.panelRetryTimer);
 this.panelRetryTimer = null;
 }

 // Destroy all modules in reverse order
 for (let i = this.modules.length - 1; i >= 0; i--) {
 this.modules[i]!.destroy();
 }

 // Clean up subscriptions, map, AIS, and breaking news
 this.unsubAiFlow?.();
 this.state.breakingBanner?.destroy();
 this.desktopNotifications.destroy();
 this.desktopUpdater.destroy();
 destroyBreakingNewsAlerts();
 this.state.map?.destroy();
 disconnectAisStream();
  }

  async toggleGodsVision(): Promise<void> {
 if (this.godsVisionView) {
 // Full teardown — frees WebGL context, GPU textures, all timers
 this.godsVisionView.destroy();
 this.godsVisionView = null;
 return;
 }
 // Cesium reads CESIUM_BASE_URL at module init — must be set before dynamic import
 (window as unknown as Record<string, unknown>).CESIUM_BASE_URL = '/cesium';
 try {
 const { GodsVisionView } = await import('@/components/GodsVisionView');
 const ionToken = getRuntimeConfigSnapshot().secrets.CESIUM_ION_TOKEN?.value;
 this.godsVisionView = new GodsVisionView(ionToken);
 } catch (error) {
 console.error('[GodsVision] dynamic import failed:', error, (error as Error)?.stack);
 return;
 }
 void this.godsVisionView.enter();
  }

  private handleDeepLinks(): void {
 const url = new URL(window.location.href);
 const MAX_DEEP_LINK_RETRIES = 60;
 const DEEP_LINK_RETRY_INTERVAL_MS = 500;
 const DEEP_LINK_INITIAL_DELAY_MS = 2000;

 // Check for story deep link: /story?c=UA&t=ciianalysis
 if (url.pathname === '/story' || url.searchParams.has('c')) {
 const countryCode = url.searchParams.get('c');
 if (countryCode) {
 trackDeeplinkOpened('story', countryCode);
 const countryName = getCountryNameByCode(countryCode.toUpperCase()) || countryCode;

 let attempts = 0;
 const checkAndOpen = () => {
 if (dataFreshness.hasSufficientData() && this.state.latestClusters.length > 0) {
 this.countryIntel.openCountryStory(countryCode.toUpperCase(), countryName);
 return;
 }
 attempts += 1;
 if (attempts >= MAX_DEEP_LINK_RETRIES) {
 this.eventHandlers.showToast('Data not available');
 return;
 } else {
 setTimeout(checkAndOpen, DEEP_LINK_RETRY_INTERVAL_MS);
 }
 };
 setTimeout(checkAndOpen, DEEP_LINK_INITIAL_DELAY_MS);

 history.replaceState(null, '', '/');
 return;
 }
 }

 // Check for country brief deep link: ?country=UA
 const deepLinkCountry = this.pendingDeepLinkCountry;
 this.pendingDeepLinkCountry = null;
 if (deepLinkCountry) {
 trackDeeplinkOpened('country', deepLinkCountry);
 const cName = CountryIntelManager.resolveCountryName(deepLinkCountry);
 let attempts = 0;
 const checkAndOpenBrief = () => {
 if (dataFreshness.hasSufficientData()) {
 this.countryIntel.openCountryBriefByCode(deepLinkCountry, cName);
 return;
 }
 attempts += 1;
 if (attempts >= MAX_DEEP_LINK_RETRIES) {
 this.eventHandlers.showToast('Data not available');
 return;
 } else {
 setTimeout(checkAndOpenBrief, DEEP_LINK_RETRY_INTERVAL_MS);
 }
 };
 setTimeout(checkAndOpenBrief, DEEP_LINK_INITIAL_DELAY_MS);
 }
  }

  private setupRefreshIntervals(): void {
 // Always refresh news for all variants
 this.refreshScheduler.scheduleRefresh('news', () => this.dataLoader.loadNews(), REFRESH_INTERVALS.feeds);

 // Happy variant only refreshes news -- skip all geopolitical/financial/military refreshes
 if (SITE_VARIANT !== 'happy') {
 this.refreshScheduler.registerAll([
 { name: 'markets', fn: () => this.dataLoader.loadMarkets(), intervalMs: REFRESH_INTERVALS.markets },
 { name: 'predictions', fn: () => this.dataLoader.loadPredictions(), intervalMs: REFRESH_INTERVALS.predictions },
 { name: 'pizzint', fn: () => this.dataLoader.loadPizzInt(), intervalMs: 10 * 60 * 1000 },
 { name: 'natural', fn: () => this.dataLoader.loadNatural(), intervalMs: 60 * 60 * 1000, condition: () => this.state.mapLayers.natural },
 // The earthquakes fusion domain's 2nd and 3rd votes. Both providers declare
 // freshnessTtlMs: 10 min, and provider-health marks a provider `stale` once
 // now - lastSuccessAt exceeds it — so an unscheduled loader leaves the domain
 // running on USGS alone ~10 min after launch, with no upstream fault.
 // 8 min, not 10: scheduleRefresh applies +/-10% jitter, so an interval set
 // EQUAL to the TTL lands over it on roughly half its ticks and the provider
 // flaps healthy/stale. 8 min tops out at 8.8 min AT THE DEFAULT CADENCE
 // MULTIPLIER — computeDelay also multiplies by the ghost (x5) and context
 // (x2 battery / x4 low-power) factors, under which these do exceed the TTL
 // and report stale. That is the intended trade, not a regression: those modes
 // exist to buy battery with freshness, and a provider whose data really is
 // 20 min old SHOULD read stale. What this fixes is the default path, where
 // the user chose nothing and the domain went stale anyway.
 // Both routes are already sidecar-cached on a stable key (emsc 2 min,
 // geofon 5 min), so the cadence costs at most one upstream request per tick.
 { name: 'emscSeismic', fn: () => this.dataLoader.loadEmscSeismic(), intervalMs: 8 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'geofonSeismic', fn: () => this.dataLoader.loadGeofonSeismic(), intervalMs: 8 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 // Safety-critical: drives the status chip + storm posture, so it must keep
 // refreshing even when the weather map layer is toggled off.
 { name: 'weather', fn: () => this.dataLoader.loadWeatherAlerts(), intervalMs: 10 * 60 * 1000 },
 { name: 'fred', fn: () => this.dataLoader.loadFredData(), intervalMs: 30 * 60 * 1000 },
 { name: 'oil', fn: () => this.dataLoader.loadOilAnalytics(), intervalMs: 30 * 60 * 1000 },
 { name: 'spending', fn: () => this.dataLoader.loadGovernmentSpending(), intervalMs: 60 * 60 * 1000 },
 { name: 'bis', fn: () => this.dataLoader.loadBisData(), intervalMs: 60 * 60 * 1000 },
 { name: 'firms', fn: () => this.dataLoader.loadFirmsData(), intervalMs: 30 * 60 * 1000 },
 { name: 'inpeFires', fn: () => this.dataLoader.loadInpeFires(), intervalMs: 20 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'ais', fn: () => this.dataLoader.loadAisSignals(), intervalMs: REFRESH_INTERVALS.ais, condition: () => this.state.mapLayers.ais },
 { name: 'cables', fn: () => this.dataLoader.loadCableActivity(), intervalMs: 30 * 60 * 1000, condition: () => this.state.mapLayers.cables },
 { name: 'cableHealth', fn: () => this.dataLoader.loadCableHealth(), intervalMs: 2 * 60 * 60 * 1000, condition: () => this.state.mapLayers.cables },
 { name: 'flights', fn: () => this.dataLoader.loadFlightDelays(), intervalMs: 2 * 60 * 60 * 1000, condition: () => this.state.mapLayers.flights },
 { name: 'cyberThreats', fn: () => {
 this.state.cyberThreatsCache = null;
 return this.dataLoader.loadCyberThreats();
 }, intervalMs: 10 * 60 * 1000, condition: () => CYBER_LAYER_ENABLED && this.state.mapLayers.cyberThreats },
 { name: 'spaceWeather', fn: () => this.dataLoader.loadSpaceWeather(), intervalMs: 5 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'spaceflightNews', fn: () => this.dataLoader.loadSpaceflightNews(), intervalMs: 60 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'localIDS', fn: () => this.dataLoader.loadLocalIDS(), intervalMs: 5 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'littleSnitch', fn: () => this.dataLoader.loadLittleSnitch(), intervalMs: 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'diseaseOutbreaks', fn: () => this.dataLoader.loadDiseaseOutbreaks(), intervalMs: 15 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'humanitarianCrises', fn: () => this.dataLoader.loadHumanitarianCrises(), intervalMs: 60 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'ripeAtlas', fn: () => this.dataLoader.loadRipeAtlas(), intervalMs: 10 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'ripeNcc', fn: () => this.dataLoader.loadRipeNcc(), intervalMs: 60 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 // Both votes of the internet_outages fusion domain, AND the warm cache the
 // survival comms axis reads synchronously. 4 min is set by the TIGHTER of the
 // two contracts: ioda's registry freshnessTtlMs is 15 min, but
 // internet-outages.getCachedIodaOutages() returns [] once its own cache is
 // >= 10 min old, and fetchIodaOutages() only refetches on a tick that finds
 // the cache already >= 10 min old. At a 15 min cadence that getter is empty
 // for a third of every cycle and the comms axis silently reports no threats.
 //
 // Because the refetch is LAZY — triggered by the first tick that finds the
 // cache already expired, not by expiry itself — no interval closes the gap
 // entirely; it only bounds it at one jittered tick, ~1.1x the interval. Exact
 // divisors buy nothing here: 5 min would line up only with zero jitter, and
 // ticks at 4.5/9.0 push the refetch to 14.5 and leave the axis blind 10->14.5.
 // 4 min caps the blind window at 4.4 min, under half the 10 min it protects —
 // AT THE DEFAULT CADENCE MULTIPLIER, the same scoping as the seismic entries
 // above. computeDelay also multiplies by the ghost (x5), context (x2 battery /
 // x4 low-power) and hidden (x10) factors, and under any of those this loader
 // ticks slower than the 10 min cache it warms, so the comms axis does go blind
 // for part of each cycle. That is the same freshness-for-battery trade those
 // modes exist to make, and it is NOT silently wrong the way the boot-only bug
 // was: the axis is quiet because the user asked for quiet. The default path —
 // where the user chose nothing — is what this interval fixes. If the comms axis
 // is ever deemed safety-critical enough to survive throttling, the fix is an
 // exemption in the scheduler, not a smaller interval here.
 //
 // Cheap at that rate because neither path's upstream rate is set by this
 // interval, but they are bounded differently and only one is cadence-proof.
 // The limit=5000 fusion fetch snaps its window to a 15 min boundary, so extra
 // ticks land on the sidecar cache: <=96 upstream/day in steady state however
 // often we tick (a sidecar restart or an uncached 502 adds misses).
 // The limit=50 comms fetch early-returns from its own 10 min module cache
 // without touching the network, so it reaches IODA about once per expiry,
 // ~100-145/day. That one is NOT quantum-bounded — it builds an unsnapped
 // second-resolution key, so every expiry is an upstream miss — but its rate
 // is set by that 10 min module cache, not by this interval.
 { name: 'internetOutages', fn: () => this.dataLoader.loadInternetOutages(), intervalMs: 4 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'federalRegister', fn: () => this.dataLoader.loadFederalRegister(), intervalMs: 60 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'airQuality', fn: () => this.dataLoader.loadAirQuality(), intervalMs: 30 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'commsHealth', fn: () => this.dataLoader.loadCommsHealth(), intervalMs: 2 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'powerGrid', fn: () => this.dataLoader.loadPowerGrid(), intervalMs: 5 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'economicStress', fn: () => this.dataLoader.loadEconomicStress(), intervalMs: 15 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'tsunamiAlerts', fn: () => this.dataLoader.loadTsunamiAlerts(), intervalMs: 5 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'tropicalCyclones', fn: () => this.dataLoader.loadTropicalCyclones(), intervalMs: 30 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'savedPlaceWeather', fn: () => this.dataLoader.loadSavedPlaceWeather(), intervalMs: 30 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'foodInsecurity', fn: () => this.dataLoader.loadFoodInsecurity(), intervalMs: 4 * 60 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
      { name: 'worldBankBaselines', fn: () => this.dataLoader.loadWorldBankBaselines(), intervalMs: 6 * 60 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'globalWeather', fn: () => this.dataLoader.loadGlobalWeather(), intervalMs: 30 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'openSanctions', fn: () => this.dataLoader.loadOpenSanctions(), intervalMs: 60 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 { name: 'edgarFilings', fn: () => this.dataLoader.loadEdgarFilings(), intervalMs: 30 * 60 * 1000, condition: () => SITE_VARIANT === 'full' },
 ]);
 }

 // Panel-level refreshes (moved from panel constructors into scheduler for hidden-tab awareness + jitter)
 this.refreshScheduler.scheduleRefresh(
 'service-status',
 () => (this.state.panels['service-status'] as ServiceStatusPanel).fetchStatus(),
 60_000,
 () => !!this.state.panels['service-status']
 );
 this.refreshScheduler.scheduleRefresh(
 'stablecoins',
 () => (this.state.panels.stablecoins as StablecoinPanel).fetchData(),
 3 * 60_000,
 () => !!this.state.panels.stablecoins
 );
 this.refreshScheduler.scheduleRefresh(
 'etf-flows',
 () => (this.state.panels['etf-flows'] as ETFFlowsPanel).fetchData(),
 3 * 60_000,
 () => !!this.state.panels['etf-flows']
 );
 this.refreshScheduler.scheduleRefresh(
 'macro-signals',
 () => (this.state.panels['macro-signals'] as MacroSignalsPanel).fetchData(),
 3 * 60_000,
 () => !!this.state.panels['macro-signals']
 );
 this.refreshScheduler.scheduleRefresh(
 'strategic-posture',
 () => (this.state.panels['strategic-posture'] as StrategicPosturePanel).refresh(),
 15 * 60_000,
 () => !!this.state.panels['strategic-posture']
 );
 this.refreshScheduler.scheduleRefresh(
 'strategic-risk',
 () => (this.state.panels['strategic-risk'] as StrategicRiskPanel).refresh(),
 5 * 60_000,
 () => !!this.state.panels['strategic-risk']
 );

 // WTO trade policy data — annual data, poll every 10 min to avoid hammering upstream
 if (SITE_VARIANT === 'full' || SITE_VARIANT === 'finance') {
 this.refreshScheduler.scheduleRefresh('tradePolicy', () => this.dataLoader.loadTradePolicy(), 10 * 60 * 1000);
 this.refreshScheduler.scheduleRefresh('supplyChain', () => this.dataLoader.loadSupplyChain(), 10 * 60 * 1000);
 }

 // FAA weather cameras — scored against NWS/GDACS alerts, slow-changing data
 if (SITE_VARIANT === 'full') {
 this.refreshScheduler.scheduleRefresh(
 'faa-weather-cams',
 () => this.dataLoader.loadFAACameras(),
 20 * 60_000,
 () => !!this.state.panels['faa-weather-cams']
 );
 }

 // ADS-B live aircraft tracking (OpenSky, 60s)
 if (SITE_VARIANT !== 'happy') {
 this.refreshScheduler.scheduleRefresh(
 'adsb',
 () => this.dataLoader.loadAdsb(),
 60_000,
 () => this.state.mapLayers.adsb || !!this.state.panels['air-traffic']
 );
 }

 this.refreshScheduler.scheduleRefresh(
 'threat-intel-hub',
 () => this.dataLoader.loadThreatIntelHub(),
 15 * 60 * 1000,
 () => !!this.state.panels['threat-intel-hub'],
 );
 this.refreshScheduler.scheduleRefresh(
 'geo-intel',
 () => this.dataLoader.loadGeoIntel(),
 2 * 60 * 1000,
 () => !!this.state.panels['geo-intel'],
 );
 this.refreshScheduler.scheduleRefresh(
 'dark-web',
 () => this.dataLoader.loadDarkWeb(),
 60 * 60 * 1000,
 () => !!this.state.panels['dark-web'],
 );

 // Telegram Intel (near real-time, 60s refresh)
 this.refreshScheduler.scheduleRefresh(
 'telegram-intel',
 () => this.dataLoader.loadTelegramIntel(),
 60_000,
 () => !!this.state.panels['telegram-intel']
 );

 // Refresh intelligence signals for CII (geopolitical variant only)
 if (SITE_VARIANT === 'full') {
 this.refreshScheduler.scheduleRefresh('intelligence', () => {
 const { military, iranEvents } = this.state.intelligenceCache;
 this.state.intelligenceCache = {};
 if (military) this.state.intelligenceCache.military = military;
 if (iranEvents) this.state.intelligenceCache.iranEvents = iranEvents;
 return this.dataLoader.loadIntelligenceSignals();
 }, 15 * 60 * 1000);
 }
  }
}
