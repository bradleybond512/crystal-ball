/**
 * PostHog Analytics Service
 *
 * Active when VITE_POSTHOG_KEY is set AND the user has explicitly opted in.
 * PostHog requires its configured key; web analytics shares the explicit-consent gate.
 *
 * Consent model (opt-in):
 * - localStorage key 'wm-analytics-consent':
 * 'true' with version '2' and no conflicting source → proven explicit opt-in
 * 'false' → user explicitly opted out
 * absent  → not consented (analytics disabled by default)
 * - The consent prompt (AnalyticsConsentBanner) asks every install that has
 * no explicit choice on file; 'wm-analytics-consent-prompt-seen' records it.
 * - Consent is never implied. Older builds auto-migrated pre-banner installs
 * to 'true'; ambiguous installs are reset off and shown a nonblocking notice
 * — see migrateAnalyticsConsent().
 * - Ghost Mode always suppresses analytics regardless of consent.
 *
 * Data safety:
 * - Typed allowlists per event — unlisted properties silently dropped
 * - Each HTTP send checks consent and strips strings matching API key prefixes
 * - No session recordings, no autocapture
 * - distinct_id is a random UUID — pseudonymous, not identifiable
 */

import { isDesktopRuntime } from './runtime';
import { safeSetItem } from '@/utils/safe-storage';
import { isGhostMode } from './mode-manager';
import { isSecretSet, type RuntimeSecretKey } from './runtime-config';
import { SITE_VARIANT } from '@/config/variant';

// ── Analytics consent ──

const CONSENT_KEY = 'wm-analytics-consent';
const CONSENT_VERSION_KEY = 'wm-analytics-consent-version';
const EXPLICIT_CONSENT_VERSION = '2';
const CONSENT_SOURCE_KEY = 'wm-analytics-consent-source';
const CONSENT_REASON_KEY = 'wm-analytics-consent-reason';
const CONSENT_PROMPT_SEEN_KEY = 'wm-analytics-consent-prompt-seen';
const RESET_NOTICE_SEEN_KEY = 'wm-analytics-consent-reset-notice-seen';
let consentBlocked = false;
let consentGeneration = 0;
let pendingResetNotice = false;
let resetNoticeShown = false;

export function hasAnalyticsConsent(): boolean {
  if (consentBlocked) return false;
  try {
    const source = localStorage.getItem(CONSENT_SOURCE_KEY);
    return localStorage.getItem(CONSENT_KEY) === 'true'
      && localStorage.getItem(CONSENT_VERSION_KEY) === EXPLICIT_CONSENT_VERSION
      && (source === null || source === 'user');
  } catch {
    consentBlocked = true;
    stopAnalytics();
    return false;
  }
}

export function isAnalyticsAllowed(): boolean {
  return hasAnalyticsConsent() && !isGhostMode();
}

function clearAnalyticsData(): void {
  for (const key of ['wm-installation-id', OFFLINE_QUEUE_KEY]) {
    try { localStorage.removeItem(key); } catch { /* Storage failure must not prevent SDK shutdown. */ }
  }
}

function stopAnalytics(): void {
  consentGeneration++;
  initPromise = null;
  captureInstance = null;
  for (const controller of activeRequests) controller.abort();
  activeRequests.clear();
  clearAnalyticsData();
}

export function setAnalyticsConsent(allow: boolean): void {
  consentBlocked = true;
  stopAnalytics();
  pendingResetNotice = false;
  resetNoticeShown = true;
  if (!allow) {
    for (const key of [CONSENT_KEY, CONSENT_VERSION_KEY, CONSENT_SOURCE_KEY]) {
      try { localStorage.removeItem(key); } catch { /* Keep revocation effective even if one key fails. */ }
    }
  }
  try {
    const choiceWritten = safeSetItem(CONSENT_KEY, allow ? 'true' : 'false');
    const sourceWritten = safeSetItem(CONSENT_SOURCE_KEY, 'user');
    const reasonWritten = safeSetItem(CONSENT_REASON_KEY, 'user-choice');
    const versionWritten = choiceWritten && sourceWritten && reasonWritten
      && safeSetItem(CONSENT_VERSION_KEY, EXPLICIT_CONSENT_VERSION);
    consentBlocked = !versionWritten;
  } catch { /* Failed writes leave this session opted out. */ }
}

export function hasSeenConsentPrompt(): boolean {
  if (pendingResetNotice || resetNoticeShown) return true;
  try { return localStorage.getItem(CONSENT_PROMPT_SEEN_KEY) === 'true'; }
  catch { return false; }
}

export function markConsentPromptSeen(): void {
  try {
    if (localStorage.getItem(CONSENT_PROMPT_SEEN_KEY) !== 'true') safeSetItem(CONSENT_PROMPT_SEEN_KEY, 'true');
  } catch { /* Unavailable storage must not interrupt the app. */ }
}

export function hasPendingAnalyticsResetNotice(): boolean {
  if (resetNoticeShown) return false;
  try {
    return (pendingResetNotice || localStorage.getItem(CONSENT_REASON_KEY) === 'legacy-reset')
      && localStorage.getItem(RESET_NOTICE_SEEN_KEY) !== 'true';
  } catch { return pendingResetNotice; }
}

export function markAnalyticsResetNoticeSeen(): void {
  resetNoticeShown = true;
  pendingResetNotice = false;
  try { safeSetItem(RESET_NOTICE_SEEN_KEY, 'true'); } catch { /* Best effort across restarts. */ }
}

function preserveDeclinedConsent(source: string | null, explicit: boolean): void {
  if (source !== 'user' && source !== 'default') {
    safeSetItem(CONSENT_SOURCE_KEY, explicit ? 'user' : 'default');
    safeSetItem(CONSENT_REASON_KEY, explicit ? 'user-choice' : 'default');
  }
  markConsentPromptSeen();
}

export function migrateAnalyticsConsent(): void {
  try {
    const recorded = localStorage.getItem(CONSENT_KEY);
    const source = localStorage.getItem(CONSENT_SOURCE_KEY);
    const explicit = localStorage.getItem(CONSENT_VERSION_KEY) === EXPLICIT_CONSENT_VERSION
      && (source === null || source === 'user');
    if (recorded === 'true' && explicit) {
      safeSetItem(CONSENT_SOURCE_KEY, 'user');
      safeSetItem(CONSENT_REASON_KEY, 'user-choice');
      markConsentPromptSeen();
      return;
    }
    const legacy = recorded === 'true' || (recorded === null
      && (localStorage.getItem('wm-installation-id') !== null || localStorage.getItem(OFFLINE_QUEUE_KEY) !== null));
    stopAnalytics();
    if (legacy) {
      consentBlocked = true;
      pendingResetNotice = true;
      safeSetItem(CONSENT_KEY, 'false');
      safeSetItem(CONSENT_SOURCE_KEY, 'default');
      safeSetItem(CONSENT_REASON_KEY, 'legacy-reset');
      localStorage.removeItem(CONSENT_VERSION_KEY);
      markConsentPromptSeen();
    } else if (recorded === 'false') {
      preserveDeclinedConsent(source, explicit);
    } else if (recorded === null) {
      safeSetItem(CONSENT_SOURCE_KEY, 'default');
      safeSetItem(CONSENT_REASON_KEY, 'default');
    } else {
      consentBlocked = true;
      safeSetItem(CONSENT_KEY, 'false');
      safeSetItem(CONSENT_SOURCE_KEY, 'default');
      safeSetItem(CONSENT_REASON_KEY, 'invalid');
      localStorage.removeItem(CONSENT_VERSION_KEY);
    }
  } catch {
    consentBlocked = true;
    stopAnalytics();
  }
}

// ── Installation identity ──

function getOrCreateInstallationId(): string {
  const STORAGE_KEY = 'wm-installation-id';
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
 id = crypto.randomUUID();
 safeSetItem(STORAGE_KEY, id);
  }
  return id;
}

// ── Stable property name map for secret keys ──

const SECRET_ANALYTICS_NAMES: Record<RuntimeSecretKey, string> = {
  CRYSTALBALL_API_KEY: 'crystalball_cloud',
  ANTHROPIC_API_KEY: 'anthropic',
  GROQ_API_KEY: 'groq',
  OPENROUTER_API_KEY: 'openrouter',
  FRED_API_KEY: 'fred',
  EIA_API_KEY: 'eia',
  CLOUDFLARE_API_TOKEN: 'cloudflare',
  ACLED_ACCESS_TOKEN: 'acled',
  ACLED_EMAIL: 'acled_email',
  ACLED_REFRESH_TOKEN: 'acled_refresh',
  URLHAUS_AUTH_KEY: 'urlhaus',
  OTX_API_KEY: 'otx',
  ABUSEIPDB_API_KEY: 'abuseipdb',
  WINGBITS_API_KEY: 'wingbits',
  WS_RELAY_URL: 'ws_relay',
  VITE_WS_RELAY_URL: 'vite_ws_relay',
  VITE_OPENSKY_RELAY_URL: 'opensky_relay',
  OPENSKY_CLIENT_ID: 'opensky',
  OPENSKY_CLIENT_SECRET: 'opensky_secret',
  AISSTREAM_API_KEY: 'aisstream',
  FINNHUB_API_KEY: 'finnhub',
  NASA_FIRMS_API_KEY: 'nasa_firms',
  AIRNOW_API_KEY: 'airnow',
  PURPLEAIR_API_KEY: 'purpleair',
  OLLAMA_API_URL: 'ollama_url',
  OLLAMA_MODEL: 'ollama_model',
  WTO_API_KEY: 'wto',
  AVIATIONSTACK_API: 'aviationstack',
  ICAO_API_KEY: 'icao',
  THREATFOX_API_KEY: 'threatfox',
  NEWSAPI_KEY: 'newsapi',
  NEWSDATA_API_KEY: 'newsdata',
  VIRUSTOTAL_API_KEY: 'virustotal',
  SHODAN_API_KEY: 'shodan',
  UCDP_API_TOKEN: 'ucdp',
  FMP_API_KEY: 'fmp',
  OWM_API_KEY: 'owm',
  GREYNOISE_API_KEY: 'greynoise',
  NASA_API_KEY: 'nasa',
  URLSCAN_API_KEY: 'urlscan',
  BITCOINABUSE_API_KEY: 'bitcoinabuse',
  VULNERS_API_KEY: 'vulners',
  MEDIASTACK_API_KEY: 'mediastack',
  PULSEDIVE_API_KEY: 'pulsedive',
  HIBP_API_KEY: 'hibp',
  GEONAMES_USERNAME: 'geonames',
  IPINFO_TOKEN: 'ipinfo',
  CESIUM_ION_TOKEN: 'cesium',
  GOOGLE_MAPS_API_KEY: 'google_maps',
  MAPBOX_API_KEY: 'mapbox',
  MAPTILER_API_KEY: 'maptiler',
  S2U_XMPP_JID: 's2u_xmpp_jid',
  S2U_XMPP_SECRET: 's2u_xmpp_secret',
  S2U_TAK_URL: 's2u_tak_url',
  S2U_TAK_USERNAME: 's2u_tak_username',
  S2U_TAK_SECRET: 's2u_tak_secret',
  S2U_TLS_INSECURE_OPT_IN: 's2u_tls_insecure',
  CENSYS_API_ID: 'censys_id',
  CENSYS_API_SECRET: 'censys_secret',
  SECURITYTRAILS_API_KEY: 'securitytrails',
  WHOISXML_API_KEY: 'whoisxml',
  MISP_URL: 'misp_url',
  MISP_API_KEY: 'misp',
  OPENCTI_URL: 'opencti_url',
  OPENCTI_API_KEY: 'opencti',
  PATREON_OAUTH_CLIENT_ID: 'patreon_client_id',
  PATREON_OAUTH_CLIENT_SECRET: 'patreon_client_secret',
  PATREON_ACCESS_TOKEN: 'patreon_access',
  PATREON_REFRESH_TOKEN: 'patreon_refresh',
  PATREON_AUDIO_RSS_URL: 'patreon_audio_rss',
  OPENAQ_API_KEY: 'openaq',
  WINDY_WEBCAMS_API_KEY: 'windy_webcams',
  NPS_API_KEY: 'nps',
};

// ── Typed event schemas (allowlisted properties per event) ──

const EVENT_SCHEMAS: Record<string, Set<string>> = {
  // Phase 1 — core events
  wm_app_loaded: new Set(['load_time_ms', 'panel_count']),
  wm_panel_viewed: new Set(['panel_id']),
  wm_summary_generated: new Set(['provider', 'model', 'cached']),
  wm_summary_failed: new Set(['last_provider']),
  // Payload minimized: count only, no per-key presence map, no OLLAMA_MODEL value.
  wm_api_keys_configured: new Set(['configured_key_count']),
  // Phase 2 — plan-specified events
  wm_panel_resized: new Set(['panel_id', 'new_span']),
  wm_variant_switched: new Set(['from', 'to']),
  wm_map_layer_toggled: new Set(['layer_id', 'enabled', 'source']),
  wm_country_brief_opened: new Set(['country_code']),
  wm_theme_changed: new Set(['theme']),
  wm_language_changed: new Set(['language']),
  wm_feature_toggled: new Set(['feature_id', 'enabled']),
  wm_search_used: new Set(['query_length', 'result_count']),
  // Phase 2 — additional interaction events
  wm_map_view_changed: new Set(['view']),
  wm_country_selected: new Set(['country_code', 'source']),
  wm_search_result_selected: new Set(['result_type']),
  wm_panel_toggled: new Set(['panel_id', 'enabled']),
  wm_finding_clicked: new Set(['finding_id', 'finding_source', 'finding_type', 'priority']),
  wm_update_shown: new Set(['current_version', 'remote_version']),
  wm_update_clicked: new Set(['target_version']),
  wm_update_dismissed: new Set(['target_version']),
  wm_critical_banner_action: new Set(['action', 'theater_id']),
  wm_download_clicked: new Set(['platform']),
  wm_download_banner_dismissed: new Set(),
  wm_webcam_selected: new Set(['webcam_id', 'city', 'view_mode']),
  wm_webcam_region_filtered: new Set(['region']),
  wm_deeplink_opened: new Set(['deeplink_type', 'target']),
};

function sanitizeProps(event: string, raw: Record<string, unknown>): Record<string, unknown> {
  const allowed = EVENT_SCHEMAS[event];
  if (!allowed) return {};
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
 if (allowed.has(k)) safe[k] = v;
  }
  return safe;
}

// ── Defense-in-depth: strip values that look like API keys ──

const API_KEY_PREFIXES = /^(sk-|gsk_|or-|Bearer )/;

function stripSecretsValue(value: unknown): unknown {
  if (typeof value === 'string') {
 return API_KEY_PREFIXES.test(value) ? '[REDACTED]' : value;
  }
  if (Array.isArray(value)) {
 return value.map((v) => stripSecretsValue(v));
  }
  if (value !== null && typeof value === 'object') {
 const cleaned: Record<string, unknown> = {};
 for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
 cleaned[k] = stripSecretsValue(v);
 }
 return cleaned;
  }
  return value;
}

function deepStripSecrets(props: Record<string, unknown>): Record<string, unknown> {
  return stripSecretsValue(props) as Record<string, unknown>;
}

// ── Consent-bound capture transport ──

interface CaptureInstance {
  capture: (event: string, props?: Record<string, unknown>) => void;
}

let captureInstance: CaptureInstance | null = null;
let initPromise: Promise<void> | null = null;
const activeRequests = new Set<AbortController>();
let vercelInitialized = false;
let consentListenersAdded = false;
let _onlineListenerAdded = false;

export function _setCaptureForTest(instance: CaptureInstance | null): void {
  captureInstance = instance;
  initPromise = null;
  consentBlocked = false;
  pendingResetNotice = false;
  resetNoticeShown = false;
  consentGeneration++;
}

const _env = (import.meta.env as Record<string, string> | undefined) ?? {};
const POSTHOG_KEY = _env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = isDesktopRuntime()
  ? ((_env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com')
  : '/ingest'; // Reverse proxy through own domain to bypass ad blockers

// ── Public API ──

function refreshAnalyticsConsent(): void {
  if (isAnalyticsAllowed()) void initAnalytics();
  else stopAnalytics();
}

function attachConsentListeners(): void {
  if (consentListenersAdded) return;
  consentListenersAdded = true;
  window.addEventListener('storage', (event) => {
    if (event.key === null || [CONSENT_KEY, CONSENT_VERSION_KEY, CONSENT_SOURCE_KEY].includes(event.key)) refreshAnalyticsConsent();
  });
  if (typeof document !== 'undefined') document.addEventListener('wm:mode-changed', refreshAnalyticsConsent);
}

export async function initAnalytics(): Promise<void> {
  attachConsentListeners();
  if (!isAnalyticsAllowed()) return;
  if (initPromise) return initPromise;
  const generation = consentGeneration;
  const allowed = () => generation === consentGeneration && isAnalyticsAllowed();
  const initialize = async () => {
    try {
      if (!isDesktopRuntime() && !vercelInitialized) {
        const { inject } = await import('@vercel/analytics');
        if (!allowed()) return;
        inject({ beforeSend: (event) => isAnalyticsAllowed() ? event : null });
        vercelInitialized = true;
      }
      if (!POSTHOG_KEY || !allowed()) return;
      const distinctID = getOrCreateInstallationId();
      if (!allowed()) return;
      captureInstance = { capture: (event, properties = {}) => {
        if (!allowed()) return;
        const controller = new AbortController();
        activeRequests.add(controller);
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const body = JSON.stringify({
          api_key: POSTHOG_KEY,
          distinct_id: distinctID,
          event,
          properties: {
            ...deepStripSecrets(sanitizeProps(event, properties)),
            platform: isDesktopRuntime() ? 'desktop' : 'web',
            variant: SITE_VARIANT,
            app_version: __APP_VERSION__,
            $process_person_profile: false,
          },
        });
        void fetch(`${POSTHOG_HOST.replace(/\/$/, '')}/i/v0/e/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          credentials: 'omit',
          keepalive: false,
          signal: controller.signal,
        }).catch(() => undefined).finally(() => {
          clearTimeout(timeout);
          activeRequests.delete(controller);
        });
      } };
      captureInstance.capture('$pageview');
      flushOfflineQueue();
      if (isDesktopRuntime() && !_onlineListenerAdded) {
        _onlineListenerAdded = true;
        window.addEventListener('online', () => flushOfflineQueue());
      }
    } catch (error) {
      if (generation === consentGeneration) initPromise = null;
      // eslint-disable-next-line no-console
      console.warn('[Analytics] Failed to initialize analytics:', error);
    }
  };
  initPromise = initialize();
  return initPromise;
}

// ── Offline event queue (desktop) ──

const OFFLINE_QUEUE_KEY = 'wm-analytics-offline-queue';
const OFFLINE_QUEUE_CAP = 200;

function enqueueOffline(name: string, props: Record<string, unknown>): void {
  if (!isAnalyticsAllowed()) return;
  try {
 const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
 const queue = (raw ? JSON.parse(raw) : []) as { name: string; props: Record<string, unknown>; ts: number }[];
 queue.push({ name, props, ts: Date.now() });
 if (queue.length > OFFLINE_QUEUE_CAP) queue.splice(0, queue.length - OFFLINE_QUEUE_CAP);
 safeSetItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch { /* localStorage full or unavailable */ }
}

function flushOfflineQueue(): void {
  if (!isAnalyticsAllowed()) {
    // Consent revoked or ghost mode — clear queue without sending.
    try { localStorage.removeItem(OFFLINE_QUEUE_KEY); } catch { /* ignore */ }
    return;
  }
  if (!captureInstance) return;
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return;
    const queue = JSON.parse(raw) as { name: string; props: Record<string, unknown> }[];
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
    for (const { name, props } of queue) {
      if (!isAnalyticsAllowed() || !captureInstance) return;
      captureInstance.capture(name, props);
    }
  } catch { /* corrupt queue, discard */ }
}

export function trackEvent(name: string, props?: Record<string, unknown>): void {
  if (!isAnalyticsAllowed()) return;
  const safeProps = props ? sanitizeProps(name, props) : {};
  if (!captureInstance) {
    if (isDesktopRuntime() && POSTHOG_KEY) enqueueOffline(name, safeProps);
    return;
  }
  captureInstance.capture(name, safeProps);
}

/** Page-exit delivery is best effort so every request remains abortable. */
export function trackEventBeforeUnload(name: string, props?: Record<string, unknown>): void {
  if (!isAnalyticsAllowed()) return;
  if (!captureInstance) return;
  const safeProps = props ? sanitizeProps(name, props) : {};
  captureInstance.capture(name, safeProps);
}

export function trackPanelView(panelId: string): void {
  trackEvent('wm_panel_viewed', { panel_id: panelId });
}

export function trackApiKeysSnapshot(): void {
  // Presence only: sidecar-only values never reach this window (R4-SEC-001).
  const configured_key_count = (Object.keys(SECRET_ANALYTICS_NAMES) as RuntimeSecretKey[])
    .filter((key) => isSecretSet(key)).length;
  trackEvent('wm_api_keys_configured', { configured_key_count });
}

export function trackLLMUsage(provider: string, model: string, cached: boolean): void {
  trackEvent('wm_summary_generated', { provider, model, cached });
}

export function trackLLMFailure(lastProvider: string): void {
  trackEvent('wm_summary_failed', { last_provider: lastProvider });
}

// ── Phase 2 helpers (plan-specified events) ──

export function trackPanelResized(panelId: string, newSpan: number): void {
  trackEvent('wm_panel_resized', { panel_id: panelId, new_span: newSpan });
}

export function trackVariantSwitch(from: string, to: string): void {
  trackEventBeforeUnload('wm_variant_switched', { from, to });
}

export function trackMapLayerToggle(layerId: string, enabled: boolean, source: 'user' | 'programmatic'): void {
  trackEvent('wm_map_layer_toggled', { layer_id: layerId, enabled, source });
}

export function trackCountryBriefOpened(countryCode: string): void {
  trackEvent('wm_country_brief_opened', { country_code: countryCode });
}

export function trackThemeChanged(theme: string): void {
  trackEventBeforeUnload('wm_theme_changed', { theme });
}

export function trackLanguageChange(language: string): void {
  trackEventBeforeUnload('wm_language_changed', { language });
}

export function trackFeatureToggle(featureId: string, enabled: boolean): void {
  trackEvent('wm_feature_toggled', { feature_id: featureId, enabled });
}

export function trackSearchUsed(queryLength: number, resultCount: number): void {
  trackEvent('wm_search_used', { query_length: queryLength, result_count: resultCount });
}

// ── Phase 2 helpers (additional interaction events) ──

export function trackMapViewChange(view: string): void {
  trackEvent('wm_map_view_changed', { view });
}

export function trackCountrySelected(code: string, name: string, source: string): void {
  trackEvent('wm_country_selected', { country_code: code, country_name: name, source });
}

export function trackSearchResultSelected(resultType: string): void {
  trackEvent('wm_search_result_selected', { result_type: resultType });
}

export function trackPanelToggled(panelId: string, enabled: boolean): void {
  trackEvent('wm_panel_toggled', { panel_id: panelId, enabled });
}

export function trackFindingClicked(id: string, source: string, type: string, priority: string): void {
  trackEvent('wm_finding_clicked', { finding_id: id, finding_source: source, finding_type: type, priority });
}

export function trackUpdateShown(current: string, remote: string): void {
  trackEvent('wm_update_shown', { current_version: current, remote_version: remote });
}

export function trackUpdateClicked(version: string): void {
  trackEvent('wm_update_clicked', { target_version: version });
}

export function trackUpdateDismissed(version: string): void {
  trackEvent('wm_update_dismissed', { target_version: version });
}

export function trackCriticalBannerAction(action: string, theaterId: string): void {
  trackEvent('wm_critical_banner_action', { action, theater_id: theaterId });
}

export function trackDownloadClicked(platform: string): void {
  trackEvent('wm_download_clicked', { platform });
}

export function trackDownloadBannerDismissed(): void {
  trackEvent('wm_download_banner_dismissed');
}

export function trackWebcamSelected(webcamId: string, city: string, viewMode: string): void {
  trackEvent('wm_webcam_selected', { webcam_id: webcamId, city, view_mode: viewMode });
}

export function trackWebcamRegionFiltered(region: string): void {
  trackEvent('wm_webcam_region_filtered', { region });
}

export function trackDeeplinkOpened(type: string, target: string): void {
  trackEvent('wm_deeplink_opened', { deeplink_type: type, target });
}
