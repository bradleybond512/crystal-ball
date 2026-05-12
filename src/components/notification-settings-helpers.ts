/**
 * Pure helpers shared by NotificationSettingsPanel — extracted so tests
 * can import them without dragging in `i18n` / Vite's `import.meta.glob`
 * via the Panel base class.
 */

import {
  type NotificationDomain,
  type NotificationSeverity,
} from '../services/notifications/notification-settings-service';
import { type HistoryDomain, type HistorySeverity } from '../services/notifications/notification-history-service';

export const SETTINGS_DOMAIN_LABELS: Record<NotificationDomain, string> = {
  earthquakes: 'Earthquakes',
  wildfire: 'Wildfire',
  aviation: 'Aviation',
  maritime: 'AIS / Maritime',
  biosurveillance: 'Biosurveillance',
  space_weather: 'Space Weather',
  infrastructure: 'Infrastructure',
  geopolitical: 'Geopolitical',
  weather: 'Weather (NWS)',
  cyber: 'Cyber / HIBP',
  supply: 'Supply / Shortages',
};

export const SETTINGS_DOMAINS: readonly NotificationDomain[] = [
  'earthquakes',
  'wildfire',
  'aviation',
  'maritime',
  'biosurveillance',
  'space_weather',
  'infrastructure',
  'geopolitical',
  'weather',
  'cyber',
  'supply',
];

/**
 * Map the settings-service domain to the history-service domain so the
 * "Test notification" button logs in a category the user can find in
 * the history panel. The history domain set is broader; pick the
 * closest match per the producer pipeline's conventions.
 */
export const HISTORY_DOMAIN_FOR_SETTINGS: Record<NotificationDomain, HistoryDomain> = {
  earthquakes: 'seismic',
  wildfire: 'wildfire',
  aviation: 'unknown',
  maritime: 'unknown',
  biosurveillance: 'unknown',
  space_weather: 'geomagnetic',
  infrastructure: 'unknown',
  geopolitical: 'cap',
  weather: 'cap',
  cyber: 'cyber',
  supply: 'unknown',
};

/** History severity is a strict subset of settings severity (drops 'info'). */
export function settingsToHistorySeverity(sev: NotificationSeverity): HistorySeverity {
  if (sev === 'info') return 'low';
  return sev;
}

export interface SyntheticTestEntry {
  domain: HistoryDomain;
  source: string;
  action: 'fired';
  title: string;
  body: string;
  severity: HistorySeverity;
  ruleId: string;
  payload: Record<string, unknown>;
}

/**
 * Build the synthetic-alert history entry for a domain. Pure — takes the
 * threshold + a clock injection so tests can pin timestamps.
 */
export function buildTestHistoryEntry(
  domain: NotificationDomain,
  threshold: NotificationSeverity,
  nowMs: number = Date.now(),
): SyntheticTestEntry {
  return {
    domain: HISTORY_DOMAIN_FOR_SETTINGS[domain],
    source: 'notification-settings-panel',
    action: 'fired',
    title: `Test alert — ${SETTINGS_DOMAIN_LABELS[domain]}`,
    body: `Synthetic ${SETTINGS_DOMAIN_LABELS[domain]} notification fired from the settings panel at ${new Date(nowMs).toLocaleTimeString()}.`,
    severity: settingsToHistorySeverity(threshold),
    ruleId: `test-${domain}`,
    payload: { synthetic: true, settingsDomain: domain, firedAt: nowMs },
  };
}
