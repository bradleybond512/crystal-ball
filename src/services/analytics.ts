/**
 * PostHog Analytics Service
 *
 * Active when VITE_POSTHOG_KEY is set AND the user has explicitly opted in.
 * All exports are no-ops when the key is absent (dev/local) or user has not consented.
 *
 * Consent model (opt-in):
 * - localStorage key 'wm-analytics-consent':
 * 'true'  → user explicitly opted in (analytics enabled)
 * 'false' → user explicitly opted out
 * absent  → not consented (analytics disabled by default)
 * - A one-time consent prompt is surfaced on first boot for new installs
 * (see AnalyticsConsentBanner); 'wm-analytics-consent-prompt-seen' records it.
 * - Installs that predate consent gating are migrated once to 'true' so their
 * prior (opt-out-era) behaviour is preserved — see migrateAnalyticsConsent().
 * - Ghost Mode always suppresses analytics regardless of consent.
 *
 * Data safety:
 * - Typed allowlists per event — unlisted properties silently dropped
 * - sanitize_properties callback strips strings matching API key prefixes
 * - No session recordings, no autocapture
 * - distinct_id is a random UUID — pseudonymous, not identifiable
 */

import { isDesktopRuntime } from './runtime';
import { isGhostMode } from './mode-manager';
import { getRuntimeConfigSnapshot, type RuntimeSecretKey } from './runtime-config';
import { SITE_VARIANT } from '@/config/variant';

// ── Analytics consent ──

const CONSENT_KEY = 'wm-analytics-consent';

export function hasAnalyticsConsent(): boolean {
  // Absent key = no consent (default-off). Only 'true' means consented.
  return localStorage.getItem(CONSENT_KEY) === 'true';
}

/** Single gate: consent granted AND not in Ghost Mode. Call before every send path. */
export function isAnalyticsAllowed(): boolean {
  return hasAnalyticsConsent() && !isGhostMode();
}

export function setAnalyticsConsent(allow: boolean): void {
  localStorage.setItem(CONSENT_KEY, allow ? 'true' : 'false');
  if (!allow) {
    // Clear the persistent installation ID so re-identification is not possible.
    localStorage.removeItem('wm-installation-id');
    // Clear the offline queue — revoked consent must not replay buffered events.
    try { localStorage.removeItem(OFFLINE_QUEUE_KEY); } catch { /* ignore */ }
    // Tell the SDK to stop capturing before dropping the reference — the
    // posthog-js singleton persists in module scope and would otherwise
    // still fire automatic events (capture_pageleave) after revocation.
    try { posthogInstance?.opt_out_capturing(); } catch { /* ignore */ }
    posthogInstance = null;
    initPromise = null;
  }
}

const CONSENT_PROMPT_SEEN_KEY = 'wm-analytics-consent-prompt-seen';

/** True once the first-run consent prompt has been shown (or migration ran). */
export function hasSeenConsentPrompt(): boolean {
  return localStorage.getItem(CONSENT_PROMPT_SEEN_KEY) === 'true';
}

export function markConsentPromptSeen(): void {
  localStorage.setItem(CONSENT_PROMPT_SEEN_KEY, 'true');
}

/**
 * One-time consent migration. Runs at boot before initAnalytics().
 *
 * - Already prompted/migrated → no-op.
 * - Explicit choice already on file (key present) → just mark prompt seen.
 * - Pre-consent-gate install (no choice, but a prior installation id exists) →
 *   migrate to 'true' to preserve the opt-out-era behaviour these users had.
 * - Brand-new install (no choice, no installation id) → leave unconsented so the
 *   first-run banner can ask. markConsentPromptSeen() is the banner's job here.
 */
export function migrateAnalyticsConsent(): void {
  try {
    if (hasSeenConsentPrompt()) return;
    if (localStorage.getItem(CONSENT_KEY) !== null) {
      markConsentPromptSeen();
      return;
    }
    const isExistingInstall = localStorage.getItem('wm-installation-id') !== null;
    if (isExistingInstall) {
      localStorage.setItem(CONSENT_KEY, 'true');
      markConsentPromptSeen();
    }
  } catch { /* localStorage unavailable — treat as unconsented */ }
}

// ── Installation identity ──

function getOrCreateInstallationId(): string {
  const STORAGE_KEY = 'wm-installation-id';
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
 id = crypto.randomUUID();
 localStorage.setItem(STORAGE_KEY, id);
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

// ── PostHog instance management ──

interface PostHogInstance {
  init: (key: string, config: Record<string, unknown>) => void;
  register: (props: Record<string, unknown>) => void;
  capture: (event: string, props?: Record<string, unknown>, options?: { transport?: 'XHR' | 'sendBeacon' }) => void;
  opt_out_capturing: () => void;
}

let posthogInstance: PostHogInstance | null = null;
let initPromise: Promise<void> | null = null;

/** Inject a fake PostHog instance for unit tests only. */
export function _setPosthogForTest(instance: PostHogInstance | null): void {
  posthogInstance = instance;
}

const _env = (import.meta.env as Record<string, string> | undefined) ?? {};
const POSTHOG_KEY = _env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = isDesktopRuntime()
  ? ((_env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com')
  : '/ingest'; // Reverse proxy through own domain to bypass ad blockers

// ── Public API ──

export async function initAnalytics(): Promise<void> {
  if (!POSTHOG_KEY) return;
  if (!isAnalyticsAllowed()) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
 try {
 const mod = await import('posthog-js');
 const posthog = mod.default;

 posthog.init(POSTHOG_KEY, {
 api_host: POSTHOG_HOST,
 ui_host: 'https://us.posthog.com',
 persistence: 'localStorage',
 autocapture: false,
 capture_pageview: false, // Manual capture below — auto-capture silently fails with bootstrap + SPA
 capture_pageleave: true,
 disable_session_recording: true,
 bootstrap: { distinctID: getOrCreateInstallationId() },
 sanitize_properties: (props: Record<string, unknown>) => deepStripSecrets(props),
 });

 // Register minimal super properties — app version + platform only.
 const superProps: Record<string, unknown> = {
 platform: isDesktopRuntime() ? 'desktop' : 'web',
 variant: SITE_VARIANT,
 app_version: __APP_VERSION__,
 };

 posthog.register(superProps);
 posthogInstance = posthog as unknown as PostHogInstance;

 // Fire $pageview manually after full init — auto capture_pageview: true
 // fires during init() before super props are registered, and silently
 // fails with bootstrap + SPA setups (posthog-js #386).
 posthog.capture('$pageview');

 // Flush any events queued while offline (desktop)
 flushOfflineQueue();

 // Re-flush when coming back online
 if (isDesktopRuntime()) {
 window.addEventListener('online', () => flushOfflineQueue());
 }
 } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[Analytics] Failed to initialize PostHog:', error);
 }
  })();

  return initPromise;
}

// ── Offline event queue (desktop) ──

const OFFLINE_QUEUE_KEY = 'wm-analytics-offline-queue';
const OFFLINE_QUEUE_CAP = 200;

function enqueueOffline(name: string, props: Record<string, unknown>): void {
  try {
 const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
 const queue = (raw ? JSON.parse(raw) : []) as { name: string; props: Record<string, unknown>; ts: number }[];
 queue.push({ name, props, ts: Date.now() });
 if (queue.length > OFFLINE_QUEUE_CAP) queue.splice(0, queue.length - OFFLINE_QUEUE_CAP);
 localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch { /* localStorage full or unavailable */ }
}

function flushOfflineQueue(): void {
  if (!isAnalyticsAllowed()) {
    // Consent revoked or ghost mode — clear queue without sending.
    try { localStorage.removeItem(OFFLINE_QUEUE_KEY); } catch { /* ignore */ }
    return;
  }
  if (!posthogInstance) return;
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    if (!raw) return;
    const queue = JSON.parse(raw) as { name: string; props: Record<string, unknown> }[];
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
    for (const { name, props } of queue) {
      posthogInstance.capture(name, props);
    }
  } catch { /* corrupt queue, discard */ }
}

export function trackEvent(name: string, props?: Record<string, unknown>): void {
  if (!isAnalyticsAllowed()) return;
  const safeProps = props ? sanitizeProps(name, props) : {};
  if (!posthogInstance) {
    if (isDesktopRuntime() && POSTHOG_KEY) enqueueOffline(name, safeProps);
    return;
  }
  posthogInstance.capture(name, safeProps);
}

/** Use sendBeacon transport for events fired just before page reload. */
export function trackEventBeforeUnload(name: string, props?: Record<string, unknown>): void {
  if (!isAnalyticsAllowed()) return;
  if (!posthogInstance) return;
  const safeProps = props ? sanitizeProps(name, props) : {};
  posthogInstance.capture(name, safeProps, { transport: 'sendBeacon' });
}

export function trackPanelView(panelId: string): void {
  trackEvent('wm_panel_viewed', { panel_id: panelId });
}

export function trackApiKeysSnapshot(): void {
  const config = getRuntimeConfigSnapshot();
  const configured_key_count = (Object.keys(SECRET_ANALYTICS_NAMES) as RuntimeSecretKey[])
    .filter(k => Boolean(config.secrets[k]?.value)).length;
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
