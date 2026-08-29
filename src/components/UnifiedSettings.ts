import { FEEDS, INTEL_SOURCES, SOURCE_REGION_MAP } from '@/config/feeds';
import { PANEL_CATEGORY_MAP } from '@/config/panels';
import { SITE_VARIANT } from '@/config/variant';
import { LANGUAGES, changeLanguage, getCurrentLanguage, t } from '@/services/i18n';
import { getAiFlowSettings, setAiFlowSetting, getStreamQuality, setStreamQuality, STREAM_QUALITY_OPTIONS } from '@/services/ai-flow-settings';
import { isCognitionEnabled, setCognitionEnabled, type CognitionSwitchKey } from '@/services/cognition/cognition-settings';
import { isSummaryStripEnabled, setSummaryStripEnabled } from '@/components/SummaryStrip';
import { isAlwaysOn, setAlwaysOn } from '@/services/always-on';
import type { StreamQuality } from '@/services/ai-flow-settings';
import { escapeHtml } from '@/utils/sanitize';
import { trackLanguageChange, hasAnalyticsConsent, setAnalyticsConsent, initAnalytics } from '@/services/analytics';
import type { PanelConfig } from '@/types';
import { RuntimeConfigPanel } from './RuntimeConfigPanel';
import {
  RANGES as THRESHOLD_RANGES,
  loadThresholds,
  resetThresholds,
  saveThresholds,
  validateOrdering,
  type ThresholdConfig,
} from '@/services/config/alert-thresholds';
import type { StatusPanel } from './StatusPanel';
import { feedDisplayName } from './StatusPanel';
import { isYouTubeConnected, signInToYouTube, signOutOfYouTube, initYouTubeAccountListeners } from '@/services/youtube-account';
import { getImessageSettings, saveImessageSettings, sendImessage, type ImessageThreshold } from '@/services/imessage-bridge';
import { getApiBaseUrl } from '@/services/runtime';
import { tryInvokeTauri, invokeTauri } from '@/services/tauri-bridge';
import {
  getSavedPlaces,
  removeSavedPlace,
  setPrimarySavedPlace,
  subscribeSavedPlaces,
} from '@/services/saved-places';
import { getSavedPlacesFilterService } from '@/services/intelligence/saved-places-filter';
import {
  loadProximityConfig,
  saveProximityConfig,
  setLocationFromGps,
  setLocationManual,
} from '@/services/proximity-filter';
import { geocodeCityStateCountry } from '@/services/geonames';

const GEAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

const DESKTOP_RELEASES_URL = 'https://github.com/bradleybond512/crystal-ball/releases';

/**
 * Cognition kill-switches (Settings → General → Cognition). Fail-safe ON:
 * every switch defaults to enabled and a broken settings read keeps the
 * learning layer running (see cognition-settings.ts). Descriptions state
 * what turning the switch OFF does.
 */
const COGNITION_TOGGLES: readonly { id: string; key: CognitionSwitchKey; label: string; desc: string }[] = [
  {
    id: 'us-cog-evoi',
    key: 'evoi-planner',
    label: 'EVOI collection planner',
    desc: 'Off hides the "What to check next" suggestions in the Analyst HUD (⌘⇧A).',
  },
  {
    id: 'us-cog-episodic',
    key: 'episodic-recall',
    label: 'Episodic memory & historical analogs',
    desc: 'Off stops recording new episodes and hides "Historical analogs" on hypotheses; forecasts lose the analog boost.',
  },
  {
    id: 'us-cog-bocpd',
    key: 'bocpd',
    label: 'Regime-shift detection (BOCPD)',
    desc: 'Off stops change-point scanning — no amber "Regime shift" chip in the triage bar and no detection toasts.',
  },
  {
    id: 'us-cog-consolidation',
    key: 'consolidation',
    label: 'Schema consolidation',
    desc: 'Off pauses the 6-hour episodic→schema consolidation runs; the Crisis Signature Library stops learning new schemas.',
  },
  {
    id: 'us-cog-shadow',
    key: 'shadow-algorithms',
    label: 'Shadow algorithm comparison',
    desc: 'Off stops recording shadow A/B pairs — the Shadow Comparison panel receives no new data.',
  },
  {
    id: 'us-cog-calibration-bridges',
    key: 'calibration-bridges',
    label: 'Calibration bridge wiring',
    desc: 'Off stops the shortage and mode-forecast bridges from logging or resolving predictions against the calibration ledger.',
  },
  {
    id: 'us-cog-outcome-resolvers',
    key: 'outcome-resolvers',
    label: 'Deterministic outcome resolvers',
    desc: 'Off pauses market, weather, and event ground-truth resolvers without deleting forecasts or prior outcomes.',
  },
];

export interface UnifiedSettingsConfig {
  getPanelSettings: () => Record<string, PanelConfig>;
  togglePanel: (key: string) => void;
  setPanelsEnabled: (keys: string[], enabled: boolean) => void;
  getDisabledSources: () => Set<string>;
  toggleSource: (name: string) => void;
  setSourcesEnabled: (names: string[], enabled: boolean) => void;
  getAllSourceNames: () => string[];
  getLocalizedPanelName: (key: string, fallback: string) => string;
  isDesktopApp: boolean;
  statusPanel?: StatusPanel | null;
  openCreatePlace?: () => void;
  openEditPlace?: (placeId: string) => void;
}

type TabId = 'general' | 'panels' | 'sources' | 'api-keys' | 'thresholds' | 'places' | 'status' | 'help' | 'debug';

export class UnifiedSettings {
  private overlay: HTMLElement;
  private config: UnifiedSettingsConfig;
  private activeTab: TabId = 'general';
  private activeSourceRegion = 'all';
  private sourceFilter = '';
  private activePanelCategory = 'all';
  private panelFilter = '';
  private escapeHandler: (e: KeyboardEvent) => void;
  private apiConfigPanel: RuntimeConfigPanel | null = null;
  private _diagToken: string | null = null;
  private _diagRefreshInterval: ReturnType<typeof setInterval> | null = null;
  private placesDeleteConfirm: string | null = null;
  private _gpsPermissionDenied = false;

  constructor(config: UnifiedSettingsConfig) {
 this.config = config;

 this.overlay = document.createElement('div');
 this.overlay.className = 'modal-overlay';
 this.overlay.id = 'unifiedSettingsModal';
 this.overlay.setAttribute('role', 'dialog');
 this.overlay.setAttribute('aria-label', t('header.settings'));

 this.escapeHandler = (e: KeyboardEvent) => {
 if (e.key === 'Escape') this.close();
 };

 // Event delegation on stable overlay element
 // eslint-disable-next-line sonarjs/cognitive-complexity
 this.overlay.addEventListener('click', (e) => {
 const target = e.target as HTMLElement;

 // Close on overlay background click
 if (target === this.overlay) {
 this.close();
 return;
 }

 // Close button
 if (target.closest('.unified-settings-close')) {
 this.close();
 return;
 }

 // Tab switching
 const tab = target.closest<HTMLElement>('.unified-settings-tab');
 if (tab?.dataset.tab) {
 this.switchTab(tab.dataset.tab as TabId);
 return;
 }

 // Panel category pill
 const panelCatPill = target.closest<HTMLElement>('[data-panel-cat]');
 if (panelCatPill?.dataset.panelCat) {
 this.activePanelCategory = panelCatPill.dataset.panelCat;
 this.panelFilter = '';
 const searchInput = this.overlay.querySelector<HTMLInputElement>('.panels-search input');
 if (searchInput) searchInput.value = '';
 this.renderPanelCategoryPills();
 this.renderPanelsTab();
 return;
 }

 // Panel toggle
 const panelItem = target.closest<HTMLElement>('.panel-toggle-item');
 if (panelItem?.dataset.panel) {
 this.config.togglePanel(panelItem.dataset.panel);
 this.renderPanelsTab();
 return;
 }

 if (target.closest('.us-thresholds-reset')) {
 this.handleThresholdReset();
 return;
 }

 if (target.closest('.panels-select-all')) {
 this.config.setPanelsEnabled(this.getVisiblePanelKeys(), true);
 this.renderPanelsTab();
 return;
 }

 if (target.closest('.panels-select-none')) {
 this.config.setPanelsEnabled(this.getVisiblePanelKeys(), false);
 this.renderPanelsTab();
 return;
 }

 // Source toggle
 const sourceItem = target.closest<HTMLElement>('.source-toggle-item');
 if (sourceItem?.dataset.source) {
 this.config.toggleSource(sourceItem.dataset.source);
 this.renderSourcesGrid();
 this.updateSourcesCounter();
 return;
 }

 // Region pill
 const pill = target.closest<HTMLElement>('.unified-settings-region-pill');
 if (pill?.dataset.region) {
 this.activeSourceRegion = pill.dataset.region;
 this.sourceFilter = '';
 const searchInput = this.overlay.querySelector<HTMLInputElement>('.sources-search input');
 if (searchInput) searchInput.value = '';
 this.renderRegionPills();
 this.renderSourcesGrid();
 this.updateSourcesCounter();
 return;
 }

 // Select All
 if (target.closest('.sources-select-all')) {
 const visible = this.getVisibleSourceNames();
 this.config.setSourcesEnabled(visible, true);
 this.renderSourcesGrid();
 this.updateSourcesCounter();
 return;
 }

 // Select None
 if (target.closest('.sources-select-none')) {
 const visible = this.getVisibleSourceNames();
 this.config.setSourcesEnabled(visible, false);
 this.renderSourcesGrid();
 this.updateSourcesCounter();
 return;
 }

 // Home Location
 if (target.id === 'us-gps-location') {
 const btn = target as HTMLButtonElement;
 btn.textContent = 'Getting GPS…';
 btn.disabled = true;
 this._gpsPermissionDenied = false;
 // Show status next to button
 const statusSpan = btn.parentElement?.querySelector('#us-gps-status') as HTMLElement | null;
 if (statusSpan) { statusSpan.textContent = 'Waiting for location (up to 15s)…'; statusSpan.style.color = 'var(--text-tertiary)'; }
 setLocationFromGps()
 .then((loc) => {
  this._gpsPermissionDenied = false;
  if (statusSpan) { statusSpan.textContent = `Saved: ${loc.label}`; statusSpan.style.color = '#22c55e'; }
  btn.textContent = '\u2705 Saved!';
  setTimeout(() => this.refreshGeneralTab(), 1000);
 })
 .catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : 'Could not detect location.';
  this._gpsPermissionDenied = msg.includes('permission denied') || msg.includes('Permission denied');
  if (statusSpan) { statusSpan.textContent = msg; statusSpan.style.color = '#ef4444'; }
  btn.textContent = 'Use GPS';
  btn.disabled = false;
 });
 return;
 }
 if (target.id === 'us-open-location-settings') {
 void invokeTauri<void>('open_system_prefs_location').catch(() => {
 alert('Couldn\'t open System Settings. Go to System Settings \u2192 Privacy & Security \u2192 Location Services and enable Crystal Ball.');
 });
 return;
 }
 if (target.id === 'us-manual-location') {
 const latInput = this.overlay.querySelector<HTMLInputElement>('#us-home-lat');
 const lonInput = this.overlay.querySelector<HTMLInputElement>('#us-home-lon');
 const labelInput = this.overlay.querySelector<HTMLInputElement>('#us-home-label');
 // Fields render rounded to 5 decimals; when a field is unedited, prefer
 // the full-precision stored value so saving doesn't quantize it.
 const readCoord = (input: HTMLInputElement | null): number => {
 const raw = input?.value ?? '';
 const full = input?.dataset.fullPrecision;
 if (full && raw !== '' && Number.parseFloat(full).toFixed(5) === raw) {
 return Number.parseFloat(full);
 }
 return Number.parseFloat(raw);
 };
 const lat = readCoord(latInput);
 const lon = readCoord(lonInput);
 // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
 const label = labelInput?.value.trim() || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
 if (!Number.isNaN(lat) && !Number.isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
 setLocationManual(lat, lon, label);
 this.refreshGeneralTab();
 }
 return;
 }
 if (target.id === 'us-lookup-location') {
 const statusEl = this.overlay.querySelector<HTMLElement>('#us-lookup-status');
 const city = this.overlay.querySelector<HTMLInputElement>('#us-home-city')?.value ?? '';
 const state = this.overlay.querySelector<HTMLInputElement>('#us-home-state')?.value ?? '';
 const country = this.overlay.querySelector<HTMLInputElement>('#us-home-country')?.value ?? '';
 if (!city.trim() && !state.trim() && !country.trim()) {
 if (statusEl) statusEl.textContent = 'Enter a city, state, or country.';
 return;
 }
 if (statusEl) statusEl.textContent = 'Looking up…';
 const btn = target as HTMLButtonElement;
 btn.disabled = true;
 void (async () => {
 try {
 const result = await geocodeCityStateCountry(city, state, country);
 if (!result) {
 if (statusEl) statusEl.textContent = 'No match found. Try a different spelling or use coordinates.';
 return;
 }
 setLocationManual(result.lat, result.lon, result.label);
 if (statusEl) statusEl.textContent = `Set to ${result.label}`;
 this.refreshGeneralTab();
 } finally {
 btn.disabled = false;
 }
 })();
 return;
 }
 if (target.id === 'us-clear-location') {
 const config = loadProximityConfig();
 saveProximityConfig({ ...config, location: null, enabled: false });
 this.refreshGeneralTab();
 return;
 }

 // YouTube connect / disconnect
 if (target.id === 'us-yt-connect') {
 signInToYouTube();
 return;
 }
 if (target.id === 'us-yt-disconnect') {
 signOutOfYouTube();
 return;
 }

 // iMessage relay test send + threshold change handled elsewhere.
 if (target.id === 'us-imessage-test') {
 const recipient = (this.overlay.querySelector<HTMLInputElement>('#us-imessage-recipient')?.value ?? '').trim();
 const statusEl = this.overlay.querySelector<HTMLElement>('#us-imessage-status');
 if (!recipient) {
 if (statusEl) statusEl.textContent = 'Enter a recipient first.';
 return;
 }
 if (statusEl) statusEl.textContent = 'Sending…';
 const btn = target as HTMLButtonElement;
 btn.disabled = true;
 void sendImessage(recipient, 'Crystal Ball test message — alert routing is wired up.').then((result) => {
 if (statusEl) statusEl.textContent = result.ok ? 'Sent.' : `Failed: ${result.reason ?? 'unknown error'}`;
 }).finally(() => { btn.disabled = false; });
 return;
 }

 // Places tab actions
 const placesAction = target.closest<HTMLElement>('[data-places-action]')?.dataset.placesAction;
 if (placesAction) {
 const placeId = target.closest<HTMLElement>('[data-place-id]')?.dataset.placeId;
 if (placesAction === 'add') {
 this.config.openCreatePlace?.();
 return;
 }
 if (placesAction === 'edit' && placeId) {
 this.config.openEditPlace?.(placeId);
 return;
 }
 if (placesAction === 'delete' && placeId) {
 this.placesDeleteConfirm = placeId;
 this.renderPlacesTab();
 return;
 }
 if (placesAction === 'delete-confirm' && placeId) {
 removeSavedPlace(placeId);
 this.placesDeleteConfirm = null;
 return;
 }
 if (placesAction === 'delete-cancel') {
 this.placesDeleteConfirm = null;
 this.renderPlacesTab();
 return;
 }
 if (placesAction === 'set-primary' && placeId) {
 setPrimarySavedPlace(placeId);
 return;
 }
  
 return;
 }

 // Debug tab buttons
 if (target.id === 'us-open-reasoning-overlay') {
 document.dispatchEvent(new KeyboardEvent('keydown', {
 key: 'D', code: 'KeyD', shiftKey: true, metaKey: true, bubbles: true,
 }));
 return;
 }
 if (target.id === 'us-reload-app') {
 window.location.reload();
 return;
 }
 if (target.id === 'us-open-logs') {
 void tryInvokeTauri<string>('open_logs_folder');
 return;
 }
 if (target.id === 'us-open-api-log') {
 void tryInvokeTauri<string>('open_sidecar_log_file');
 return;
 }
 if (target.id === 'us-refresh-traffic') {
 void this._refreshTrafficLog();
 return;
 }
 if (target.id === 'us-clear-traffic') {
 void this._clearTrafficLog();
 // eslint-disable-next-line sonarjs/no-redundant-jump
 return;
 }
 });

 // Handle input events for search
 this.overlay.addEventListener('input', (e) => {
 const target = e.target as HTMLInputElement;
 if (target.closest('.panels-search')) {
 this.panelFilter = target.value;
 this.renderPanelsTab();
 } else if (target.closest('.sources-search')) {
 this.sourceFilter = target.value;
 this.renderSourcesGrid();
 this.updateSourcesCounter();
 } else if (target.dataset.thresholdPath) {
 this.handleThresholdChange(target.dataset.thresholdPath, target.value);
 }
 });

 // Handle change events for toggles and language select
 // eslint-disable-next-line sonarjs/cognitive-complexity
 this.overlay.addEventListener('change', (e) => {
 const target = e.target as HTMLInputElement;

 // Stream quality select
 if (target.id === 'us-stream-quality') {
 setStreamQuality(target.value as StreamQuality);
 return;
 }

 // Cognition kill-switches (Settings → General → Cognition)
 const cognitionToggle = COGNITION_TOGGLES.find((c) => c.id === target.id);
 if (cognitionToggle) {
 setCognitionEnabled(cognitionToggle.key, target.checked);
 return;
 }

 // At-a-glance summary strip (Settings → General → Overview)
 if (target.id === 'us-summary-strip') {
 setSummaryStripEnabled(target.checked);
 return;
 }

 // Language select
 if (target.closest('.unified-settings-lang-select')) {
 trackLanguageChange(target.value);
 void changeLanguage(target.value);
 return;
 }

 if (target.id === 'us-cloud') {
 setAiFlowSetting('cloudLlm', target.checked);
 this.updateAiStatus();
 } else if (target.id === 'us-browser') {
 setAiFlowSetting('browserModel', target.checked);
 const warn = this.overlay.querySelector('.ai-flow-toggle-warn') as HTMLElement;
 if (warn) warn.style.display = target.checked ? 'block' : 'none';
 this.updateAiStatus();
 } else if (target.id === 'us-map-flash') {
 setAiFlowSetting('mapNewsFlash', target.checked);
 } else if (target.id === 'us-always-on') {
 void setAlwaysOn(target.checked);
 } else if (target.id === 'us-verbose-log') {
 void this._toggleVerboseLog(target.checked);
 } else if (target.id === 'us-fetch-debug') {
 localStorage.setItem('wm-debug-log', target.checked ? '1' : '0');
 } else if (target.id === 'us-auto-refresh') {
 if (target.checked) this._startDebugAutoRefresh(); else this._stopDebugAutoRefresh();
 } else if (target.id === 'us-imessage-enabled') {
 const cur = getImessageSettings();
 saveImessageSettings({ ...cur, enabled: target.checked });
 } else if (target.id === 'us-imessage-recipient') {
 const cur = getImessageSettings();
 saveImessageSettings({ ...cur, recipient: target.value });
 } else if (target.id === 'us-imessage-threshold') {
 const cur = getImessageSettings();
 const next = target.value === 'high+critical' ? 'high+critical' : 'critical';
 saveImessageSettings({ ...cur, threshold: next as ImessageThreshold });
 } else if (target.id === 'us-analytics-consent') {
 setAnalyticsConsent(target.checked);
 if (target.checked) void initAnalytics();
 } else if (target.id === 'us-spf-radius') {
 const km = Number.parseInt(target.value, 10);
 if (Number.isFinite(km)) getSavedPlacesFilterService().setDefaultRadius(km);
 }
 });

 this.render();
 document.body.append(this.overlay);

 if (this.config.isDesktopApp) {
 initYouTubeAccountListeners(() => this.refreshGeneralTab());
 }

 subscribeSavedPlaces(() => {
 if (this.activeTab === 'places') this.renderPlacesTab();
 });
  }

  public open(tab?: TabId): void {
 if (tab) this.activeTab = tab;
 this.render();
 this.overlay.classList.add('active');
 localStorage.setItem('wm-settings-open', '1');
 document.addEventListener('keydown', this.escapeHandler);
  }

  public close(): void {
 this._stopDebugAutoRefresh();
 this.overlay.classList.remove('active');
 localStorage.removeItem('wm-settings-open');
 document.removeEventListener('keydown', this.escapeHandler);
  }

  public refreshPanelToggles(): void {
 if (this.activeTab === 'panels') this.renderPanelsTab();
  }

  private refreshGeneralTab(): void {
 if (this.activeTab !== 'general') return;
 const content = this.overlay.querySelector('[data-panel-id="general"]');
 if (content) content.innerHTML = this.renderGeneralContent();
  }

  public getButton(): HTMLButtonElement {
 const btn = document.createElement('button');
 btn.className = 'unified-settings-btn';
 btn.id = 'unifiedSettingsBtn';
 btn.setAttribute('aria-label', t('header.settings'));
 btn.innerHTML = GEAR_SVG;
 btn.addEventListener('click', () => this.open());
 return btn;
  }

  public destroy(): void {
 this._stopDebugAutoRefresh();
 document.removeEventListener('keydown', this.escapeHandler);
 this.apiConfigPanel?.destroy();
 this.apiConfigPanel = null;
 this.overlay.remove();
  }

  private tabClass(id: TabId): string {
 return `unified-settings-tab${this.activeTab === id ? ' active' : ''}`;
  }

  private render(): void {
 const apiKeyPanelClass = `unified-settings-tab-panel${this.activeTab === 'api-keys' ? ' active' : ''}`;
 const debugPanelClass = `unified-settings-tab-panel${this.activeTab === 'debug' ? ' active' : ''}`;

 this.overlay.innerHTML = `
 <div class="modal unified-settings-modal">
 <div class="modal-header">
 <span class="modal-title">${t('header.settings')}</span>
 <button class="modal-close unified-settings-close">×</button>
 </div>
 <div class="unified-settings-tabs">
 <button class="${this.tabClass('general')}" data-tab="general">${t('header.tabGeneral')}</button>
 <button class="${this.tabClass('panels')}" data-tab="panels">${t('header.tabPanels')}</button>
 <button class="${this.tabClass('sources')}" data-tab="sources">${t('header.tabSources')}</button>
 <button class="${this.tabClass('api-keys')}" data-tab="api-keys">${t('header.tabApiKeys')}</button>
 <button class="${this.tabClass('thresholds')}" data-tab="thresholds">Thresholds</button>
 <button class="${this.tabClass('places')}" data-tab="places">Places</button>
 <button class="${this.tabClass('status')}" data-tab="status">${t('panels.status')}</button>
 <button class="${this.tabClass('help')}" data-tab="help">Help</button>
 <button class="${this.tabClass('debug')}" data-tab="debug">Debug</button>
 </div>
 <div class="unified-settings-tab-panel${this.activeTab === 'general' ? ' active' : ''}" data-panel-id="general">
 ${this.renderGeneralContent()}
 </div>
 <div class="unified-settings-tab-panel${this.activeTab === 'panels' ? ' active' : ''}" data-panel-id="panels">
 <div class="unified-settings-region-wrapper">
 <div class="unified-settings-region-bar" id="usPanelCatBar"></div>
 </div>
 <div class="panels-search">
 <input type="text" placeholder="${t('header.filterPanels')}" value="${escapeHtml(this.panelFilter)}" />
 </div>
 <div class="panel-toggle-grid" id="usPanelToggles"></div>
 <div class="sources-footer panels-footer">
 <span class="sources-counter panels-counter" id="usPanelsCounter"></span>
 <button class="panels-select-all">${t('common.selectAll')}</button>
 <button class="panels-select-none">${t('common.selectNone')}</button>
 </div>
 </div>
 <div class="unified-settings-tab-panel${this.activeTab === 'sources' ? ' active' : ''}" data-panel-id="sources">
 <div class="unified-settings-region-wrapper">
 <div class="unified-settings-region-bar" id="usRegionBar"></div>
 </div>
 <div class="sources-search">
 <input type="text" placeholder="${t('header.filterSources')}" value="${escapeHtml(this.sourceFilter)}" />
 </div>
 <div class="sources-toggle-grid" id="usSourceToggles"></div>
 <div class="sources-footer">
 <span class="sources-counter" id="usSourcesCounter"></span>
 <button class="sources-select-all">${t('common.selectAll')}</button>
 <button class="sources-select-none">${t('common.selectNone')}</button>
 </div>
 </div>
 <div class="${apiKeyPanelClass}" data-panel-id="api-keys"></div>
 <div class="unified-settings-tab-panel${this.activeTab === 'thresholds' ? ' active' : ''}" data-panel-id="thresholds">
 ${this.renderThresholdsContent()}
 </div>
 <div class="unified-settings-tab-panel${this.activeTab === 'places' ? ' active' : ''}" data-panel-id="places">
 <div class="us-places-content" id="usPlacesContent"></div>
 </div>
 <div class="unified-settings-tab-panel${this.activeTab === 'status' ? ' active' : ''}" data-panel-id="status">
 <div class="us-status-content" id="usStatusContent"></div>
 </div>
 <div class="unified-settings-tab-panel${this.activeTab === 'help' ? ' active' : ''}" data-panel-id="help">
 ${this.renderHelpContent()}
 </div>
 <div class="${debugPanelClass}" data-panel-id="debug">${this.config.isDesktopApp ? this.renderDebugContent() : this.renderDebugContentWeb()}</div>
 </div>
 `;

 // Mount RuntimeConfigPanel content into API Keys tab. On web the panel
 // surfaces the passphrase-encrypted vault (create / unlock / lock /
 // destroy banner + per-provider inputs); on desktop it goes through the
 // Tauri keychain.
 {
 const apiContainer = this.overlay.querySelector<HTMLElement>('[data-panel-id="api-keys"]');
 if (apiContainer) {
 this.apiConfigPanel ??= new RuntimeConfigPanel({ mode: 'full', buffered: false });
 apiContainer.append(this.apiConfigPanel.getContentElement());
 }
 }

 // Populate dynamic sections after innerHTML is set
 this.renderPanelCategoryPills();
 this.renderPanelsTab();
 this.renderRegionPills();
 this.renderSourcesGrid();
 this.updateSourcesCounter();
 this.renderStatusTab();
 this.renderPlacesTab();
 if (!this.config.isDesktopApp) this.updateAiStatus();
 this.scrollActiveTabIntoView();
  }

  private scrollActiveTabIntoView(): void {
 const active = this.overlay.querySelector<HTMLElement>('.unified-settings-tab.active');
 // Optional call: jsdom has no scrollIntoView.
 active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  private switchTab(tab: TabId): void {
 if (this.activeTab === 'debug' && tab !== 'debug') {
 this._stopDebugAutoRefresh();
 }
 this.activeTab = tab;

 // Update tab buttons
 this.overlay.querySelectorAll('.unified-settings-tab').forEach(el => {
 el.classList.toggle('active', (el as HTMLElement).dataset.tab === tab);
 });

 // Update tab panels
 this.overlay.querySelectorAll('.unified-settings-tab-panel').forEach(el => {
 el.classList.toggle('active', (el as HTMLElement).dataset.panelId === tab);
 });

 // Tab strip scrolls horizontally on narrow modals — keep the active tab visible.
 this.scrollActiveTabIntoView();

 if (tab === 'debug') {
 if (this.config.isDesktopApp) {
 void this._refreshTrafficLog();
 void this._syncVerboseState();
 this._startDebugAutoRefresh();
 } else {
 void this._populateWebDebugStats();
 }
 }
 if (tab === 'places') {
 this.placesDeleteConfirm = null;
 this.renderPlacesTab();
 }
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  private renderGeneralContent(): string {
 const settings = getAiFlowSettings();
 const currentLang = getCurrentLanguage();

 let html = '';

 // Map section
 html += `<div class="ai-flow-section-label">${t('components.insights.sectionMap')}</div>`;
 html += this.toggleRowHtml('us-map-flash', t('components.insights.mapFlashLabel'), t('components.insights.mapFlashDesc'), settings.mapNewsFlash);

 // 24/7 operation section
 html += `<div class="ai-flow-section-label">24/7 Operation</div>`;
 html += this.toggleRowHtml('us-always-on', '24/7 background operation', 'Keep the algorithms running at full speed when the window is hidden (macOS; uses more battery).', isAlwaysOn());

 // Cognition kill-switches (learning layer). Fail-safe ON — see
 // cognition-settings.ts for the read-error posture.
 html += `<div class="ai-flow-section-label">Cognition (learning features)</div>`;
 for (const toggle of COGNITION_TOGGLES) {
 html += this.toggleRowHtml(toggle.id, toggle.label, toggle.desc, isCognitionEnabled(toggle.key));
 }

 // Overview strip (default ON).
 html += `<div class="ai-flow-section-label">Overview</div>`;
 html += this.toggleRowHtml('us-summary-strip', 'At-a-glance summary strip', 'Off hides the one-line status / alerts / data-freshness strip above the panel grid.', isSummaryStripEnabled());

 // AI Analysis section (web-only)
 if (!this.config.isDesktopApp) {
 html += `<div class="ai-flow-section-label">${t('components.insights.sectionAi')}</div>`;
 html += this.toggleRowHtml('us-cloud', t('components.insights.aiFlowCloudLabel'), t('components.insights.aiFlowCloudDesc'), settings.cloudLlm);

 html += this.toggleRowHtml('us-browser', t('components.insights.aiFlowBrowserLabel'), t('components.insights.aiFlowBrowserDesc'), settings.browserModel);
 html += `<div class="ai-flow-toggle-warn" style="display:${settings.browserModel ? 'block' : 'none'}">${t('components.insights.aiFlowBrowserWarn')}</div>`;

 // Ollama CTA
 html += `
 <div class="ai-flow-cta">
 <div class="ai-flow-cta-title">${t('components.insights.aiFlowOllamaCta')}</div>
 <div class="ai-flow-cta-desc">${t('components.insights.aiFlowOllamaCtaDesc')}</div>
 <a href="${DESKTOP_RELEASES_URL}" target="_blank" rel="noopener noreferrer" class="ai-flow-cta-link">${t('components.insights.aiFlowDownloadDesktop')}</a>
 </div>
 `;
 }

 // Streaming quality section
 const currentQuality = getStreamQuality();
 html += `<div class="ai-flow-section-label">${t('components.insights.sectionStreaming')}</div>`;
 html += `<div class="ai-flow-toggle-row">
 <div class="ai-flow-toggle-label-wrap">
 <div class="ai-flow-toggle-label">${t('components.insights.streamQualityLabel')}</div>
 <div class="ai-flow-toggle-desc">${t('components.insights.streamQualityDesc')}</div>
 </div>
 </div>`;
 html += `<select class="unified-settings-lang-select" id="us-stream-quality">`;
 for (const opt of STREAM_QUALITY_OPTIONS) {
 const selected = opt.value === currentQuality ? ' selected' : '';
 html += `<option value="${opt.value}"${selected}>${opt.label}</option>`;
 }
 html += `</select>`;

 // Home Location section
 {
 const proxConfig = loadProximityConfig();
 const loc = proxConfig.location;
 const locLabel = loc ? escapeHtml(loc.label) : 'Not set';
 const locSource = loc ? ` (${escapeHtml(loc.source)})` : '';
 // Display at 5 decimals (≈1 m). The full-precision stored value rides
 // along in data-full-precision so re-saving an unedited field doesn't
 // quantize what's persisted.
 const latVal = loc ? escapeHtml(loc.lat.toFixed(5)) : '';
 const lonVal = loc ? escapeHtml(loc.lon.toFixed(5)) : '';
 const latFull = loc ? escapeHtml(String(loc.lat)) : '';
 const lonFull = loc ? escapeHtml(String(loc.lon)) : '';
 const labelVal = loc ? escapeHtml(loc.label) : '';
 let deniedHtml = '';
 if (this._gpsPermissionDenied) {
 const openBtn = this.config.isDesktopApp
 ? '<button id="us-open-location-settings" class="spm-btn spm-btn--ghost spm-btn--sm" style="margin-left:4px;">Open Location Settings</button>'
 : '';
 deniedHtml = `<div style="font-size:11px;color:#ef4444;margin-top:4px;">Location permission denied.${openBtn}</div>`;
 }
 html += `<div class="ai-flow-section-label">Home Location</div>`;
 html += `
 <div class="ai-flow-toggle-row" style="flex-direction:column;align-items:stretch;">
 <div style="display:flex;align-items:center;justify-content:space-between;">
 <div class="ai-flow-toggle-label-wrap">
 <div class="ai-flow-toggle-label">Current location</div>
 <div class="ai-flow-toggle-desc">${locLabel}${locSource}</div>
 </div>
 <button id="us-gps-location" class="spm-btn spm-btn--primary spm-btn--sm" style="min-width:100px">Use GPS</button>
 <span id="us-gps-status" style="font-size:11px;display:block;margin-top:4px;min-height:16px;"></span>
 </div>
 ${deniedHtml}
 </div>
 <div class="ai-flow-toggle-row" style="flex-direction:column;align-items:flex-start;gap:6px">
 <div class="ai-flow-toggle-label">Set manually</div>
 <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
 <input id="us-home-city" type="text" placeholder="City" style="width:140px;padding:4px 6px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary)">
 <input id="us-home-state" type="text" placeholder="State / region" style="width:140px;padding:4px 6px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary)">
 <input id="us-home-country" type="text" placeholder="Country" style="width:140px;padding:4px 6px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary)">
 <button id="us-lookup-location" class="spm-btn spm-btn--primary spm-btn--sm" style="min-width:70px">Look up</button>
 <span id="us-lookup-status" style="font-size:11px;color:var(--text-muted);min-height:14px;"></span>
 </div>
 <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
 <span style="font-size:11px;color:var(--text-muted);">or coordinates:</span>
 <input id="us-home-lat" class="us-coord-input" type="number" inputmode="decimal" step="0.00001" min="-90" max="90" autocomplete="off" placeholder="Latitude" value="${latVal}" data-full-precision="${latFull}" style="width:100px;padding:4px 6px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary)">
 <input id="us-home-lon" class="us-coord-input" type="number" inputmode="decimal" step="0.00001" min="-180" max="180" autocomplete="off" placeholder="Longitude" value="${lonVal}" data-full-precision="${lonFull}" style="width:110px;padding:4px 6px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary)">
 <input id="us-home-label" type="text" placeholder="Label (optional)" value="${labelVal}" style="width:130px;padding:4px 6px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary)">
 <button id="us-manual-location" class="spm-btn spm-btn--primary spm-btn--sm" style="min-width:50px">Set</button>
 ${loc ? `<button id="us-clear-location" class="spm-btn spm-btn--ghost spm-btn--sm" style="min-width:55px">Clear</button>` : ''}
 </div>
 </div>
 `;
 }

 // YouTube Account section — shown in both builds, with different copy
 // for web (browser cookie jar handles auth) vs desktop (in-app webview).
 {
 const connected = isYouTubeConnected();
 const desktopCopy = 'Use your subscription to avoid ads in live streams. Optional — cookies are shared with embedded players.';
 const webCopy = 'Embedded players use your browser\'s YouTube session. Open YouTube in a new tab to switch accounts or sign in.';
 html += `<div class="ai-flow-section-label">YouTube Account</div>`;
 html += `<div class="ai-flow-toggle-row yt-account-row">
 <div class="ai-flow-toggle-label-wrap">
 <div class="ai-flow-toggle-label">${this.config.isDesktopApp ? 'Sign in to YouTube' : 'YouTube session'}</div>
 <div class="ai-flow-toggle-desc">${this.config.isDesktopApp ? desktopCopy : webCopy}</div>
 </div>
 <div class="yt-account-status">${this._renderYtStatus(connected)}</div>
 </div>`;
 }

 // iMessage relay (macOS desktop only — Apple has no API for the web)
 if (this.config.isDesktopApp) {
 const im = getImessageSettings();
 const recipientVal = escapeHtml(im.recipient);
 const checkedAttr = im.enabled ? 'checked' : '';
 const critSel = im.threshold === 'critical' ? ' selected' : '';
 const highSel = im.threshold === 'high+critical' ? ' selected' : '';
 html += `<div class="ai-flow-section-label">iMessage alerts</div>`;
 html += `<div class="ai-flow-toggle-row imessage-row" style="flex-direction:column;align-items:flex-start;gap:6px">
 <div class="ai-flow-toggle-label-wrap" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;">
 <div>
 <div class="ai-flow-toggle-label">Route critical alerts to iMessage</div>
 <div class="ai-flow-toggle-desc">Sends through your signed-in macOS Messages app. Rate-limited to 1 per 30s. Requires the Messages app to be open and signed in.</div>
 </div>
 <label class="ai-flow-switch"><input type="checkbox" id="us-imessage-enabled" ${checkedAttr}><span class="ai-flow-slider"></span></label>
 </div>
 <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;width:100%;">
 <input id="us-imessage-recipient" type="text" placeholder="Phone, email, or contact name" value="${recipientVal}" style="flex:1 1 220px;min-width:160px;padding:4px 6px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary)">
 <select id="us-imessage-threshold" style="padding:4px 6px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary)">
 <option value="critical"${critSel}>Critical only</option>
 <option value="high+critical"${highSel}>High + Critical</option>
 </select>
 <button type="button" id="us-imessage-test" class="spm-btn spm-btn--primary spm-btn--sm" style="min-width:60px">Test</button>
 <span id="us-imessage-status" style="font-size:11px;color:var(--text-muted);min-height:14px;"></span>
 </div>
 </div>`;
 }

 // Language section
 html += `<div class="ai-flow-section-label">${t('header.languageLabel')}</div>`;
 html += `<select class="unified-settings-lang-select">`;
 for (const lang of LANGUAGES) {
 const selected = lang.code === currentLang ? ' selected' : '';
 html += `<option value="${lang.code}"${selected}>${lang.flag} ${lang.label}</option>`;
 }
 html += `</select>`;

 // Privacy section
 html += `<div class="ai-flow-section-label">Privacy</div>`;
 html += this.toggleRowHtml('us-analytics-consent', 'Share anonymous usage analytics', 'Sends aggregate counts (no key names, no personal data) to PostHog to help improve Crystal Ball. Off by default.', hasAnalyticsConsent());

 html += `<div class="ai-flow-section-label">Build Identity</div>`;
 html += `
 <div class="ai-flow-toggle-row">
 <div class="ai-flow-toggle-label-wrap">
 <div class="ai-flow-toggle-label">Version</div>
 <div class="ai-flow-toggle-desc">v${escapeHtml(__APP_VERSION__)} • ${escapeHtml(__BUILD_VARIANT__)}</div>
 </div>
 </div>
 <div class="ai-flow-toggle-row">
 <div class="ai-flow-toggle-label-wrap">
 <div class="ai-flow-toggle-label">Release tag</div>
 <div class="ai-flow-toggle-desc">${escapeHtml(__BUILD_TAG__)}</div>
 </div>
 </div>
 <div class="ai-flow-toggle-row">
 <div class="ai-flow-toggle-label-wrap">
 <div class="ai-flow-toggle-label">Commit</div>
 <div class="ai-flow-toggle-desc">${escapeHtml(__BUILD_COMMIT_SHA__.slice(0, 12))}</div>
 </div>
 </div>
 <div class="ai-flow-toggle-row">
 <div class="ai-flow-toggle-label-wrap">
 <div class="ai-flow-toggle-label">Build timestamp</div>
 <div class="ai-flow-toggle-desc">${escapeHtml(__BUILD_TIMESTAMP__)}</div>
 </div>
 </div>
 `;

 // AI status footer (web-only)
 if (!this.config.isDesktopApp) {
 html += `<div class="ai-flow-popup-footer"><span class="ai-flow-status-dot" id="usStatusDot"></span><span class="ai-flow-status-text" id="usStatusText"></span></div>`;
 }

 return html;
  }

  private toggleRowHtml(id: string, label: string, desc: string, checked: boolean): string {
 return `
 <div class="ai-flow-toggle-row">
 <div class="ai-flow-toggle-label-wrap">
 <div class="ai-flow-toggle-label">${label}</div>
 <div class="ai-flow-toggle-desc">${desc}</div>
 </div>
 <label class="ai-flow-switch">
 <input type="checkbox" id="${id}"${checked ? ' checked' : ''}>
 <span class="ai-flow-slider"></span>
 </label>
 </div>
 `;
  }

  private updateAiStatus(): void {
 const settings = getAiFlowSettings();
 const dot = this.overlay.querySelector('#usStatusDot');
 const text = this.overlay.querySelector('#usStatusText');
 if (!dot || !text) return;

 dot.className = 'ai-flow-status-dot';
 if (settings.cloudLlm && settings.browserModel) {
 dot.classList.add('active');
 text.textContent = t('components.insights.aiFlowStatusCloudAndBrowser');
 } else if (settings.cloudLlm) {
 dot.classList.add('active');
 text.textContent = t('components.insights.aiFlowStatusActive');
 } else if (settings.browserModel) {
 dot.classList.add('browser-only');
 text.textContent = t('components.insights.aiFlowStatusBrowserOnly');
 } else {
 dot.classList.add('disabled');
 text.textContent = t('components.insights.aiFlowStatusDisabled');
 }
  }

  public setPlaceCallbacks(openCreate: () => void, openEdit: (placeId: string) => void): void {
 this.config.openCreatePlace = openCreate;
 this.config.openEditPlace = openEdit;
  }

  public refreshStatusTab(): void {
 if (this.activeTab === 'status') this.renderStatusTab();
  }

  // ── Thresholds tab ───────────────────────────────────────────────────

  private renderThresholdsContent(): string {
    const c = loadThresholds();
    const ranges = THRESHOLD_RANGES;
    const errs = validateOrdering(c);
    const errBlock = errs.length === 0 ? '' :
      `<div class="us-thresholds-error">${errs.map(e => escapeHtml(e)).join('<br/>')}</div>`;
    return `<div class="us-thresholds-content">
      <p class="us-thresholds-intro">
        Crystal Ball only fires push alerts when an event exceeds the
        thresholds below. Adjust to taste — values persist across sessions.
      </p>
      ${errBlock}
      ${this.thresholdGroup('Seismic — earthquakes (USGS / EEW)', [
        { path: 'seismic.pushMinMagnitude', label: 'Min magnitude for push',
          value: c.seismic.pushMinMagnitude, range: ranges.seismic.pushMinMagnitude,
          unit: 'M' },
        { path: 'seismic.voiceMinMagnitude', label: 'Min magnitude for voice',
          value: c.seismic.voiceMinMagnitude, range: ranges.seismic.voiceMinMagnitude,
          unit: 'M' },
      ])}
      ${this.thresholdGroup('Geomagnetic — solar storm (NOAA SWPC)', [
        { path: 'geomagnetic.pushMinKp', label: 'Min Kp index for push',
          value: c.geomagnetic.pushMinKp, range: ranges.geomagnetic.pushMinKp, unit: 'Kp' },
        { path: 'geomagnetic.voiceMinKp', label: 'Min Kp index for voice',
          value: c.geomagnetic.voiceMinKp, range: ranges.geomagnetic.voiceMinKp, unit: 'Kp' },
      ])}
      ${this.thresholdGroup('Wildfire — FIRMS satellite detections', [
        { path: 'wildfire.pushMinFRP', label: 'Min Fire Radiative Power for push',
          value: c.wildfire.pushMinFRP, range: ranges.wildfire.pushMinFRP, unit: 'MW' },
        { path: 'wildfire.radiusKm', label: 'Alert radius from saved places',
          value: c.wildfire.radiusKm, range: ranges.wildfire.radiusKm, unit: 'km' },
      ])}
      ${this.thresholdGroup('Air quality — AirNow / PurpleAir', [
        { path: 'airQuality.pushMinAQI', label: 'Min US AQI for push',
          value: c.airQuality.pushMinAQI, range: ranges.airQuality.pushMinAQI, unit: 'AQI' },
      ])}
      ${this.thresholdGroup('Markets — VIX + OFR Financial Stress Index', [
        { path: 'economic.pushMinVIX', label: 'Min VIX for push',
          value: c.economic.pushMinVIX, range: ranges.economic.pushMinVIX, unit: '' },
        { path: 'economic.ofrFsiSigmas', label: 'OFR FSI z-score threshold',
          value: c.economic.ofrFsiSigmas, range: ranges.economic.ofrFsiSigmas, unit: 'σ' },
      ])}
      ${this.thresholdGroup('Hurricanes — NHC tropical cyclones', [
        { path: 'hurricane.pushMinCategory', label: 'Min Saffir-Simpson category',
          value: c.hurricane.pushMinCategory, range: ranges.hurricane.pushMinCategory,
          unit: 'cat' },
      ])}
      <div class="us-thresholds-actions">
        <button class="us-thresholds-reset" type="button">Restore defaults</button>
      </div>
    </div>`;
  }

  private thresholdGroup(
    title: string,
    rows: { path: string; label: string; value: number;
      range: { min: number; max: number; step: number }; unit: string }[],
  ): string {
    const inputs = rows.map(r => `
      <div class="us-threshold-row">
        <label class="us-threshold-label" for="threshold-${r.path}">
          ${escapeHtml(r.label)}
        </label>
        <div class="us-threshold-input">
          <input type="range" min="${r.range.min}" max="${r.range.max}" step="${r.range.step}"
            value="${r.value}" data-threshold-path="${escapeHtml(r.path)}"
            class="us-threshold-slider" />
          <input type="number" min="${r.range.min}" max="${r.range.max}" step="${r.range.step}"
            value="${r.value}" data-threshold-path="${escapeHtml(r.path)}"
            id="threshold-${r.path}" class="us-threshold-number" />
          <span class="us-threshold-unit">${escapeHtml(r.unit)}</span>
        </div>
      </div>`).join('');
    return `<fieldset class="us-threshold-group">
      <legend>${escapeHtml(title)}</legend>
      ${inputs}
    </fieldset>`;
  }

  private handleThresholdChange(path: string, raw: string): void {
    const numeric = Number.parseFloat(raw);
    if (!Number.isFinite(numeric)) return;
    const current = loadThresholds();
    const [bucket, field] = path.split('.') as [keyof ThresholdConfig, string];
    const next: ThresholdConfig = {
      ...current,
      [bucket]: { ...(current[bucket] as unknown as Record<string, number>), [field]: numeric },
    } as ThresholdConfig;
    saveThresholds(next);
    // Re-render the whole modal so paired slider+number input stay in sync.
    this.render();
  }

  private handleThresholdReset(): void {
    resetThresholds();
    this.render();
  }

  private renderHelpContent(): string {
 return `<div class="us-help-content">
 <div class="us-help-section">
 <h3>Getting Started</h3>
 <p>Crystal Ball is a free, open-source geopolitical intelligence dashboard. It pulls live data from dozens of public APIs and displays them on an interactive map and sidebar panels.</p>
 <ul>
 <li><strong>Sidebar panels</strong> — click any panel tab on the left to expand it. Panels with a badge show new unread items.</li>
 <li><strong>Map</strong> — use the layer toggles in Settings → Sources to show/hide map overlays. Click any map marker for details.</li>
 <li><strong>Gear icon</strong> — opens this Settings dialog where you configure panels, map layers, and API keys.</li>
 </ul>
 </div>

 <div class="us-help-section">
 <h3>Setting Up API Keys</h3>
 <p>Many data sources require free API keys. Go to <strong>Settings → API Keys</strong> to configure them.</p>
 <ul>
 <li><strong>ACLED</strong> — Air strikes, drone events, conflict data. Register free at <a href="https://developer.acleddata.com/" target="_blank" rel="noopener">developer.acleddata.com</a>. You need both an Access Token and your registered email.</li>
 <li><strong>NASA FIRMS</strong> — Satellite wildfire detection. Free key at <a href="https://firms.modaps.eosdis.nasa.gov/api/area/" target="_blank" rel="noopener">NASA FIRMS</a>.</li>
 <li><strong>Finnhub</strong> — Stock market & sector heatmap. Free tier at <a href="https://finnhub.io/register" target="_blank" rel="noopener">finnhub.io</a>.</li>
 <li><strong>AISStream</strong> — Live ship tracking. Free at <a href="https://aisstream.io/authenticate" target="_blank" rel="noopener">aisstream.io</a>.</li>
 <li><strong>OpenSky</strong> — Military flight tracking. Free account at <a href="https://opensky-network.org/" target="_blank" rel="noopener">opensky-network.org</a>.</li>
 <li><strong>Wingbits</strong> — Aircraft enrichment for ADS-B data. Free at <a href="https://wingbits.com/register" target="_blank" rel="noopener">wingbits.com</a>.</li>
 <li><strong>AI Summarization</strong> — Every panel has an AI summary button (✦). Use Ollama (local/free), Groq (free tier), or OpenRouter.</li>
 </ul>
 </div>

 <div class="us-help-section">
 <h3>Monitoring Modes</h3>
 <ul>
 <li><strong>Peace Mode</strong> — Default balanced view. All panels visible.</li>
 <li><strong>Finance Mode</strong> — Auto-triggers when S&amp;P 500 moves ≥2.5% or BTC ≥5% in a day. Prioritizes markets, economy, trade panels.</li>
 <li><strong>War Mode</strong> — Auto-triggers on geopolitical escalation signals. Prioritizes military, conflict, threat intelligence panels.</li>
 <li>Switch modes manually using the mode button in the bottom-left of the sidebar.</li>
 </ul>
 </div>

 <div class="us-help-section">
 <h3>Map Controls</h3>
 <ul>
 <li><strong>Scroll/pinch</strong> — zoom in/out.</li>
 <li><strong>Click + drag</strong> — pan the map.</li>
 <li><strong>Click a marker</strong> — opens a detail popup for that event.</li>
 <li><strong>Basemap</strong> — switch between street, satellite, and terrain views via the map controls.</li>
 <li><strong>Low Power Mode (⚡)</strong> — disables animations and spatial audio to reduce CPU/GPU load.</li>
 <li><strong>Time range filter</strong> — filter map events to the last 1h, 6h, 24h, 48h, or 7 days.</li>
 </ul>
 </div>

 <div class="us-help-section">
 <h3>Panel Tips</h3>
 <ul>
 <li><strong>AI Summary (✦)</strong> — every panel (except live video) has an AI summary button. Click it to get a 2–3 sentence intelligence briefing from the panel's data.</li>
 <li><strong>Click-to-fly</strong> — clicking an event row in most panels (ACLED, Airstrikes, UCDP, Earthquakes, etc.) flies the map to that location.</li>
 <li><strong>Drag panels</strong> — drag panel tabs to reorder them in the sidebar.</li>
 <li><strong>Panel counts</strong> — the badge on each tab shows the item count. A pulsing badge indicates new unread items.</li>
 </ul>
 </div>

 <div class="us-help-section">
 <h3>Open Source &amp; Contributing</h3>
 <p>Crystal Ball is free and open source under the AGPL-3.0 License. Originally forked from <a href="https://github.com/bradleybond512/crystal-ball" target="_blank" rel="noopener">bradleybond512/crystal-ball</a>.</p>
 <ul>
 <li><a href="https://crystal-ball-observatory.bradleybond512.chatgpt.site/" target="_blank" rel="noopener">Website</a></li>
 <li><a href="https://github.com/bradleybond512/crystal-ball" target="_blank" rel="noopener">GitHub Repository</a></li>
 <li><a href="https://github.com/bradleybond512/crystal-ball/discussions" target="_blank" rel="noopener">Community Discussions</a></li>
 <li><a href="https://github.com/bradleybond512/crystal-ball/issues" target="_blank" rel="noopener">Report a Bug</a></li>
 </ul>
 </div>
 </div>`;
  }

  private renderStatusTab(): void {
 const container = this.overlay.querySelector('#usStatusContent');
 if (!container) return;
 const sp = this.config.statusPanel;
 if (!sp) {
 container.innerHTML = `<div style="padding:16px;color:var(--text-dim)">${t('components.status.storageUnavailable')}</div>`;
 return;
 }

 const feeds = sp.getFeeds();
 const apis = sp.getApis();

 let html = `<div class="us-status-section">
 <div class="us-status-section-title">${t('components.status.dataFeeds')}</div>`;
 for (const feed of feeds.values()) {
 html += `<div class="status-row">
 <span class="status-dot ${feed.status}"></span>
 <span class="status-name">${escapeHtml(feedDisplayName(feed.name))}</span>
 <span class="status-detail">${feed.itemCount} items</span>
 <span class="status-time">${feed.lastUpdate ? sp.formatTime(feed.lastUpdate) : 'Never'}</span>
 </div>`;
 }
 html += `</div>`;

 html += `<div class="us-status-section">
 <div class="us-status-section-title">${t('components.status.apiStatus')}</div>`;
 for (const api of apis.values()) {
 html += `<div class="status-row">
 <span class="status-dot ${api.status}"></span>
 <span class="status-name">${escapeHtml(api.name)}</span>
 ${api.latency ? `<span class="status-detail">${api.latency}ms</span>` : ''}
 </div>`;
 }
 html += `</div>`;

 html += `<div class="us-status-section">
 <div class="us-status-section-title">${t('components.status.storage')}</div>
 <div id="usStorageInfo"></div>
 </div>`;

 html += `<div class="us-status-footer">${t('components.status.updatedAt', { time: sp.formatTime(new Date()) })}</div>`;

 container.innerHTML = html;
 void this.updateStorageInfo();
  }

  private async updateStorageInfo(): Promise<void> {
 const container = this.overlay.querySelector('#usStorageInfo');
 if (!container) return;
 try {
 if ('storage' in navigator && 'estimate' in navigator.storage) {
 const estimate = await navigator.storage.estimate();
 const used = estimate.usage ? (estimate.usage / 1024 / 1024).toFixed(2) : '0';
 const quota = estimate.quota ? (estimate.quota / 1024 / 1024).toFixed(0) : 'N/A';
 container.innerHTML = `<div class="status-row">
 <span class="status-name">IndexedDB</span>
 <span class="status-detail">${used} MB / ${quota} MB</span>
 </div>`;
 } else {
 container.innerHTML = `<div class="status-row">${t('components.status.storageUnavailable')}</div>`;
 }
 } catch {
 container.innerHTML = `<div class="status-row">${t('components.status.storageUnavailable')}</div>`;
 }
  }

  private getAvailablePanelCategories(): { key: string; label: string }[] {
 const panelKeys = new Set(Object.keys(this.config.getPanelSettings()));
 const variant = SITE_VARIANT || 'full';
 const categories: { key: string; label: string }[] = [
 { key: 'all', label: t('header.sourceRegionAll') }
 ];

 for (const [catKey, catDef] of Object.entries(PANEL_CATEGORY_MAP)) {
 if (catDef.variants && !catDef.variants.includes(variant)) continue;
 const hasPanel = catDef.panelKeys.some(pk => panelKeys.has(pk));
 if (hasPanel) {
 categories.push({ key: catKey, label: t(catDef.labelKey) });
 }
 }

 return categories;
  }

  private getVisiblePanelEntries(): [string, PanelConfig][] {
 const panelSettings = this.config.getPanelSettings();
 const variant = SITE_VARIANT || 'full';
 let entries = Object.entries(panelSettings)
 .filter(([key]) => key !== 'runtime-config' || this.config.isDesktopApp);

 if (this.activePanelCategory !== 'all') {
 const catDef = PANEL_CATEGORY_MAP[this.activePanelCategory];
 if (catDef && (!catDef.variants || catDef.variants.includes(variant))) {
 const allowed = new Set(catDef.panelKeys);
 entries = entries.filter(([key]) => allowed.has(key));
 }
 }

 if (this.panelFilter) {
 const lower = this.panelFilter.toLowerCase();
 entries = entries.filter(([key, panel]) =>
 key.toLowerCase().includes(lower) ||
 panel.name.toLowerCase().includes(lower) ||
 this.config.getLocalizedPanelName(key, panel.name).toLowerCase().includes(lower)
 );
 }

 return entries;
  }

  private getVisiblePanelKeys(): string[] {
 return this.getVisiblePanelEntries().map(([key]) => key);
  }

  private renderPanelCategoryPills(): void {
 const bar = this.overlay.querySelector('#usPanelCatBar');
 if (!bar) return;

 const categories = this.getAvailablePanelCategories();
 bar.innerHTML = categories.map(c =>
 `<button class="unified-settings-region-pill${this.activePanelCategory === c.key ? ' active' : ''}" data-panel-cat="${c.key}">${escapeHtml(c.label)}</button>`
 ).join('');
  }

  private renderPlacesTab(): void {
 const container = this.overlay.querySelector('#usPlacesContent');
 if (!container) return;

 const filterSvc = getSavedPlacesFilterService();
 const currentRadius = filterSvc.getDefaultRadius();

 const places = getSavedPlaces();
 const MAX = 20;
 let html = `<div class="us-proximity-filter-section" style="padding:10px 0 12px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:10px;">
   <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;opacity:0.6;margin-bottom:6px;">Proximity Filter Fallback Radius</div>
   <div style="display:flex;align-items:center;gap:8px;">
     <input id="us-spf-radius" type="number" min="50" max="5000" step="50" value="${currentRadius}" style="width:80px;padding:4px 6px;background:var(--bg-secondary,#1e1e1e);border:1px solid var(--border-color,#333);border-radius:4px;color:var(--text-primary,#eee);font-size:12px;">
     <span style="font-size:12px;opacity:0.7;">km</span>
   </div>
   <div style="font-size:11px;opacity:0.5;margin-top:4px;">Applies to places with no per-place radius set. Each place&apos;s own radius takes precedence — edit a place to set its radius.</div>
 </div>`;
 html += `<div class="us-places-header"><span class="us-places-count">${places.length} / ${MAX} places</span><button class="spm-btn spm-btn--primary spm-btn--sm" data-places-action="add" type="button">+ Add Place</button></div>`;

 if (places.length === 0) {
 html += `<div class="us-places-empty">No saved places yet. Add your home, work, and other key locations.</div>`;
 } else {
 html += `<div class="us-places-list">`;
 for (const place of places) {
 const isConfirming = this.placesDeleteConfirm === place.id;
 const tags = place.tags.map((tag) => `<span class="watchlist-panel-chip">${escapeHtml(tag)}</span>`).join('');
 const primaryStar = place.primary ? '<span class="us-place-star">&#x2605;</span>' : '';
 // eslint-disable-next-line unicorn/no-negated-condition
 const setPrimaryBtn = !place.primary
 ? `<button class="spm-btn spm-btn--ghost spm-btn--sm" data-places-action="set-primary" data-place-id="${escapeHtml(place.id)}" type="button" title="Set as primary">&#x2606;</button>`
 : '';
 const deleteArea = isConfirming
 ? `<button class="spm-btn spm-btn--danger spm-btn--sm" data-places-action="delete-confirm" data-place-id="${escapeHtml(place.id)}" type="button">Confirm</button><button class="spm-btn spm-btn--ghost spm-btn--sm" data-places-action="delete-cancel" type="button">No</button>`
 : `<button class="spm-btn spm-btn--ghost spm-btn--sm spm-btn--danger-ghost" data-places-action="delete" data-place-id="${escapeHtml(place.id)}" type="button">&#xD7;</button>`;
 html += `<div class="us-place-row" data-place-id="${escapeHtml(place.id)}"><div class="us-place-info"><div class="us-place-name">${primaryStar}${escapeHtml(place.name)}</div><div class="us-place-meta">${place.lat.toFixed(4)}, ${place.lon.toFixed(4)} &bull; ${place.radiusKm} km ${tags}</div></div><div class="us-place-actions">${setPrimaryBtn}<button class="spm-btn spm-btn--ghost spm-btn--sm" data-places-action="edit" data-place-id="${escapeHtml(place.id)}" type="button">Edit</button>${deleteArea}</div></div>`;
 }
 html += `</div>`;
 }

 container.innerHTML = html;
  }

  private renderPanelsTab(): void {
 const container = this.overlay.querySelector('#usPanelToggles');
 if (!container) return;

 const entries = this.getVisiblePanelEntries();
 container.innerHTML = entries.map(([key, panel]) => `
 <div class="panel-toggle-item ${panel.enabled ? 'active' : ''}" data-panel="${escapeHtml(key)}">
 <div class="panel-toggle-checkbox">${panel.enabled ? '✓' : ''}</div>
 <span class="panel-toggle-label">${escapeHtml(this.config.getLocalizedPanelName(key, panel.name))}</span>
 </div>
 `).join('');
 this.updatePanelsCounter();
  }

  private getAvailableRegions(): { key: string; label: string }[] {
 const feedKeys = new Set(Object.keys(FEEDS));
 const regions: { key: string; label: string }[] = [
 { key: 'all', label: t('header.sourceRegionAll') }
 ];

 for (const [regionKey, regionDef] of Object.entries(SOURCE_REGION_MAP)) {
 if (regionKey === 'intel') {
 if (INTEL_SOURCES.length > 0) {
 regions.push({ key: regionKey, label: t(regionDef.labelKey) });
 }
 continue;
 }
 const hasFeeds = regionDef.feedKeys.some(fk => feedKeys.has(fk));
 if (hasFeeds) {
 regions.push({ key: regionKey, label: t(regionDef.labelKey) });
 }
 }

 return regions;
  }

  private getSourcesByRegion(): Map<string, string[]> {
 const map = new Map<string, string[]>();
 const feedKeys = new Set(Object.keys(FEEDS));

 for (const [regionKey, regionDef] of Object.entries(SOURCE_REGION_MAP)) {
 const sources: string[] = [];
 if (regionKey === 'intel') {
 INTEL_SOURCES.forEach(f => sources.push(f.name));
 } else {
 for (const fk of regionDef.feedKeys) {
 if (feedKeys.has(fk)) {
 FEEDS[fk]!.forEach(f => sources.push(f.name));
 }
 }
 }
 if (sources.length > 0) {
  
 map.set(regionKey, [...sources].sort((a, b) => a.localeCompare(b)));
 }
 }

 return map;
  }

  private getVisibleSourceNames(): string[] {
 let sources: string[];
 if (this.activeSourceRegion === 'all') {
 sources = this.config.getAllSourceNames();
 } else {
 const byRegion = this.getSourcesByRegion();
 sources = byRegion.get(this.activeSourceRegion) ?? [];
 }

 if (this.sourceFilter) {
 const lower = this.sourceFilter.toLowerCase();
 sources = sources.filter(s => s.toLowerCase().includes(lower));
 }

 return sources;
  }

  private renderRegionPills(): void {
 const bar = this.overlay.querySelector('#usRegionBar');
 if (!bar) return;

 const regions = this.getAvailableRegions();
 bar.innerHTML = regions.map(r =>
 `<button class="unified-settings-region-pill${this.activeSourceRegion === r.key ? ' active' : ''}" data-region="${r.key}">${escapeHtml(r.label)}</button>`
 ).join('');
  }

  private renderSourcesGrid(): void {
 const container = this.overlay.querySelector('#usSourceToggles');
 if (!container) return;

 const sources = this.getVisibleSourceNames();
 const disabled = this.config.getDisabledSources();

 container.innerHTML = sources.map(source => {
 const isEnabled = !disabled.has(source);
 const escaped = escapeHtml(source);
 return `
 <div class="source-toggle-item ${isEnabled ? 'active' : ''}" data-source="${escaped}">
 <div class="source-toggle-checkbox">${isEnabled ? '✓' : ''}</div>
 <span class="source-toggle-label">${escaped}</span>
 </div>
 `;
 }).join('');
  }

  private updateSourcesCounter(): void {
 const counter = this.overlay.querySelector('#usSourcesCounter');
 if (!counter) return;

 const disabled = this.config.getDisabledSources();
 const allSources = this.config.getAllSourceNames();
 const enabledTotal = allSources.length - disabled.size;

 counter.textContent = t('header.sourcesEnabled', { enabled: String(enabledTotal), total: String(allSources.length) });
  }

  private updatePanelsCounter(): void {
 const counter = this.overlay.querySelector('#usPanelsCounter');
 if (!counter) return;

 const allPanels = Object.entries(this.config.getPanelSettings())
 .filter(([key]) => key !== 'runtime-config' || this.config.isDesktopApp)
 .map(([, panel]) => panel);
 const enabledTotal = allPanels.filter((panel) => panel.enabled).length;

 counter.textContent = `${enabledTotal}/${allPanels.length} enabled`;
  }

  // ── Debug tab ──────────────────────────────────────────────────────────────

  // eslint-disable-next-line sonarjs/cognitive-complexity -- linear storage + SW probe, reads cleaner inline
  private async _populateWebDebugStats(): Promise<void> {
 const storageEl = this.overlay.querySelector<HTMLElement>('[data-web-debug="storage"]');
 const swEl = this.overlay.querySelector<HTMLElement>('[data-web-debug="sw"]');
 if (storageEl) {
 try {
 const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } };
 const est = await nav?.storage?.estimate?.();
 if (est?.usage === undefined || est?.quota === undefined) {
 storageEl.textContent = 'unavailable';
 } else {
 const used = (est.usage / 1024 / 1024).toFixed(1);
 const quota = (est.quota / 1024 / 1024).toFixed(0);
 storageEl.textContent = `${used} MiB / ${quota} MiB`;
 }
 } catch {
 storageEl.textContent = 'unavailable';
 }
 }
 if (swEl) {
 try {
 const reg = await navigator.serviceWorker?.getRegistration();
 if (!reg) {
 swEl.textContent = 'not registered';
 } else if (reg.waiting) {
 swEl.textContent = 'update waiting (reload to activate)';
 } else if (reg.installing) {
 swEl.textContent = 'installing';
 } else {
 swEl.textContent = 'active';
 }
 } catch {
 swEl.textContent = 'unavailable';
 }
 }
  }

  private _renderYtStatus(connected: boolean): string {
 if (!this.config.isDesktopApp) {
 // Web is always "connected" via the browser cookie jar; the button
 // routes to youtube.com for account switching / fresh sign-in.
 return `<span class="yt-status-dot connected"></span><span class="yt-status-text">Via browser</span><button id="us-yt-connect" class="spm-btn spm-btn--primary spm-btn--sm">Open YouTube</button>`;
 }
 if (connected) {
 return `<span class="yt-status-dot connected"></span><span class="yt-status-text">Connected</span><button id="us-yt-disconnect" class="spm-btn spm-btn--ghost spm-btn--sm">Disconnect</button>`;
 }
 return `<button id="us-yt-connect" class="spm-btn spm-btn--primary spm-btn--sm">Connect</button>`;
  }

  private renderDebugContentWeb(): string {
 const fetchDebug = localStorage.getItem('wm-debug-log') === '1';
 const ua = typeof navigator === 'undefined' ? 'n/a' : navigator.userAgent;
 const variant = SITE_VARIANT || 'full';
 const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
 // These build macros are stamped at vite build time so they identify
 // exactly which Vercel deployment / commit the user is running.
 const commitSha = typeof __BUILD_COMMIT_SHA__ === 'string' ? __BUILD_COMMIT_SHA__.slice(0, 12) : 'dev';
 const buildTag = typeof __BUILD_TAG__ === 'string' ? __BUILD_TAG__ : '';
 const buildTime = typeof __BUILD_TIMESTAMP__ === 'string' ? __BUILD_TIMESTAMP__ : '';
 return `
 <div class="us-debug-content">
 <div class="us-debug-section-label">Runtime</div>
 <dl class="us-debug-kv">
 <dt>Version</dt><dd>${escapeHtml(version)}${buildTag && buildTag !== `v${version}` ? ` (${escapeHtml(buildTag)})` : ''}</dd>
 <dt>Build commit</dt><dd><code>${escapeHtml(commitSha)}</code></dd>
 <dt>Built at</dt><dd>${escapeHtml(buildTime)}</dd>
 <dt>Variant</dt><dd>${escapeHtml(variant)}</dd>
 <dt>User agent</dt><dd>${escapeHtml(ua)}</dd>
 <dt>Storage</dt><dd><span data-web-debug="storage">computing…</span></dd>
 <dt>Service worker</dt><dd><span data-web-debug="sw">checking…</span></dd>
 </dl>
 <div class="us-debug-section-label">Diagnostics</div>
 <div class="us-debug-toggles">
 <label class="us-debug-toggle-row"><input type="checkbox" id="us-fetch-debug" ${fetchDebug ? 'checked' : ''}> Frontend Fetch Debug</label>
 </div>
 <div class="us-debug-actions">
 <button id="us-open-reasoning-overlay" class="us-debug-btn">Open Reasoning Overlay (⌘⇧D)</button>
 <button id="us-reload-app" class="us-debug-btn">Reload app</button>
 </div>
 <p class="us-debug-empty" style="margin-top:12px;">Sidecar traffic logs and keychain tools are desktop-only. For browser-side issues, use DevTools + the Reasoning Overlay.</p>
 </div>
 `;
  }

  private renderDebugContent(): string {
 const fetchDebug = localStorage.getItem('wm-debug-log') === '1';
 return `
 <div class="us-debug-content">
 <div class="us-debug-section-label">Logs</div>
 <div class="us-debug-actions">
 <button id="us-open-logs" class="us-debug-btn">Open Logs Folder</button>
 <button id="us-open-api-log" class="us-debug-btn">Open API Log</button>
 </div>
 <div class="us-debug-section-label">Diagnostics</div>
 <div class="us-debug-toggles">
 <label class="us-debug-toggle-row"><input type="checkbox" id="us-verbose-log"> Verbose Sidecar Log</label>
 <label class="us-debug-toggle-row"><input type="checkbox" id="us-fetch-debug" ${fetchDebug ? 'checked' : ''}> Frontend Fetch Debug</label>
 </div>
 <div class="us-debug-traffic-header">
 <span class="us-debug-traffic-title">API Traffic <span id="us-traffic-count"></span></span>
 <div class="us-debug-traffic-controls">
 <label><input type="checkbox" id="us-auto-refresh" checked> Auto</label>
 <button id="us-refresh-traffic" class="us-debug-btn">Refresh</button>
 <button id="us-clear-traffic" class="us-debug-btn">Clear</button>
 </div>
 </div>
 <div id="us-traffic-log" class="us-debug-traffic-log"><p class="us-debug-empty">Loading…</p></div>
 </div>
 `;
  }

  private async _diagFetch(path: string, init?: RequestInit): Promise<Response> {
 if (!this._diagToken) {
 try { this._diagToken = await tryInvokeTauri<string>('get_local_api_token'); } catch { /* unavailable */ }
 }
 const headers = new Headers(init?.headers);
 if (this._diagToken) headers.set('Authorization', `Bearer ${this._diagToken}`);
 const base = getApiBaseUrl() || '';
 return fetch(`${base}${path}`, { ...init, headers });
  }

  private async _syncVerboseState(): Promise<void> {
 const toggle = this.overlay.querySelector<HTMLInputElement>('#us-verbose-log');
 if (!toggle) return;
 try {
 const res = await this._diagFetch('/api/local-debug-toggle');
 const data = await res.json() as { verboseMode: boolean };
 if (!data || typeof data.verboseMode !== 'boolean') return;
 toggle.checked = data.verboseMode;
 } catch { /* sidecar not running */ }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async _toggleVerboseLog(_enabled: boolean): Promise<void> {
 try {
 const res = await this._diagFetch('/api/local-debug-toggle', { method: 'POST' });
 const data = await res.json() as { verboseMode: boolean };
 if (!data || typeof data.verboseMode !== 'boolean') return;
 const toggle = this.overlay.querySelector<HTMLInputElement>('#us-verbose-log');
 if (toggle) toggle.checked = data.verboseMode;
 } catch { /* sidecar not running */ }
  }

  private async _refreshTrafficLog(): Promise<void> {
 const logEl = this.overlay.querySelector<HTMLElement>('#us-traffic-log');
 const countEl = this.overlay.querySelector<HTMLElement>('#us-traffic-count');
 if (!logEl) return;
 try {
 const res = await this._diagFetch('/api/local-traffic-log');
 const data = await res.json() as { entries?: { timestamp: string; method: string; path: string; status: number; durationMs: number }[] };
 const entries = data && Array.isArray(data.entries) ? data.entries : [];
 if (countEl) countEl.textContent = `(${entries.length})`;
 if (entries.length === 0) {
 logEl.innerHTML = '<p class="us-debug-empty">No traffic recorded.</p>';
 return;
 }
 const rows = [...entries].reverse().map(e => {
 const ts = e.timestamp.split('T')[1]?.replace('Z', '') ?? e.timestamp;
 let cls: string;
 if (e.status < 300) cls = 'ok';
 else if (e.status < 500) cls = 'warn';
 else cls = 'err';
 return `<tr class="us-diag-${cls}"><td>${escapeHtml(ts)}</td><td>${escapeHtml(e.method)}</td><td title="${escapeHtml(e.path)}">${escapeHtml(e.path)}</td><td>${e.status}</td><td>${e.durationMs}ms</td></tr>`;
 }).join('');
 logEl.innerHTML = `<table class="us-debug-table"><thead><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Duration</th></tr></thead><tbody>${rows}</tbody></table>`;
 } catch {
 logEl.innerHTML = '<p class="us-debug-empty">Sidecar unreachable.</p>';
 }
  }

  private async _clearTrafficLog(): Promise<void> {
 try { await this._diagFetch('/api/local-traffic-log', { method: 'DELETE' }); } catch { /* ignore */ }
 const logEl = this.overlay.querySelector<HTMLElement>('#us-traffic-log');
 const countEl = this.overlay.querySelector<HTMLElement>('#us-traffic-count');
 if (logEl) logEl.innerHTML = '<p class="us-debug-empty">Log cleared.</p>';
 if (countEl) countEl.textContent = '(0)';
  }

  private _startDebugAutoRefresh(): void {
 this._stopDebugAutoRefresh();
 this._diagRefreshInterval = setInterval(() => void this._refreshTrafficLog(), 3000);
  }

  private _stopDebugAutoRefresh(): void {
 if (this._diagRefreshInterval) {
 clearInterval(this._diagRefreshInterval);
 this._diagRefreshInterval = null;
 }
  }
}
