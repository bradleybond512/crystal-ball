/* eslint-disable sonarjs/no-nested-conditional, unicorn/no-array-callback-reference */
/**
 * Infrastructure alert bridge — promotes power-grid + comms-health signals
 * into the unified alert store so the correlation engine and triage bar can
 * see them. Power-grid alerts get geocoded by region centroid; comms-health
 * is a single rolling alert that updates in place when overall != normal.
 */

import { unifiedAlertStore, type UnifiedAlert, type AlertSeverity } from './unified-alerts';
import { fetchPowerGridAlerts, type PowerGridAlert } from './power-grid-alerts';
import { fetchCommsHealth, type CommsHealthData } from './comms-health';

const POWER_POLL_MS = 15 * 60_000;
const COMMS_POLL_MS = 5 * 60_000;

/** Rough centroids for the regions extracted by power-grid-alerts. */
const REGION_CENTROIDS: Record<string, { lat: number; lon: number }> = {
  WECC:    { lat: 39.5, lon: -116 },
  SERC:    { lat: 33.5, lon: -86.5 },
  RFC:     { lat: 40.5, lon: -80 },
  MRO:     { lat: 44.5, lon: -93 },
  NPCC:    { lat: 43, lon: -75 },
  TRE:     { lat: 31, lon: -99 },
  ERCOT:   { lat: 31, lon: -99 },
  CAISO:   { lat: 37, lon: -120 },
  PJM:     { lat: 39.5, lon: -77.5 },
  MISO:    { lat: 41.5, lon: -90 },
  SPP:     { lat: 36, lon: -97 },
  NYISO:   { lat: 42.5, lon: -75 },
  ISONE:   { lat: 43, lon: -71.5 },
  California: { lat: 37, lon: -120 },
  Texas:      { lat: 31, lon: -99 },
  'New York': { lat: 42.5, lon: -75 },
  Florida:    { lat: 28.5, lon: -82 },
  'New England': { lat: 43, lon: -71.5 },
  Midwest:    { lat: 41.5, lon: -90 },
  Southeast:  { lat: 33.5, lon: -86.5 },
  Northwest:  { lat: 45.5, lon: -120 },
  Southwest:  { lat: 34.5, lon: -110 },
  'North America': { lat: 40, lon: -100 },
};

function powerSeverity(s: PowerGridAlert['severity']): AlertSeverity {
  return s; // already aligned
}

function toUnified(p: PowerGridAlert): UnifiedAlert {
  const loc = REGION_CENTROIDS[p.region] ?? REGION_CENTROIDS['North America']!;
  return {
    id: `pg-${p.id}`,
    source: 'power-grid',
    severity: powerSeverity(p.severity),
    title: p.title,
    body: `[${p.region} · ${p.alertType}] ${p.description}`,
    timestamp: p.pubDate.getTime(),
    location: loc,
    relevanceScore: p.severity === 'critical' ? 90 : (p.severity === 'high' ? 70 : 50),
    acknowledged: false,
    pinned: false,
    link: p.url,
  };
}

async function pollPowerGrid(): Promise<void> {
  try {
    const alerts = await fetchPowerGridAlerts();
    if (alerts.length === 0) return;
    unifiedAlertStore.ingest(alerts.map(toUnified));
  } catch { /* noop */ }
}

let lastCommsState: CommsHealthData['overall'] | null = null;
async function pollCommsHealth(): Promise<void> {
  try {
    const c = await fetchCommsHealth();
    if (c.overall === 'normal') {
      lastCommsState = 'normal';
      return;
    }
    // Only re-ingest when state changes severity bucket.
    if (c.overall === lastCommsState) return;
    lastCommsState = c.overall;
    const sev: AlertSeverity = c.overall === 'critical' ? 'critical' : 'high';
    const degraded = [...c.cables.degraded, ...c.ixp.degraded].slice(0, 4).join(', ') || 'multiple regions';
    unifiedAlertStore.ingest([{
      id: 'comms-health-rolling',
      source: 'comms-health',
      severity: sev,
      title: `Internet infrastructure ${c.overall}`,
      body: `BGP hijacks ${c.bgp.hijacks}, leaks ${c.bgp.leaks}. DDoS L7 ${c.ddos.l7}, L3 ${c.ddos.l3}. Degraded: ${degraded}.`,
      timestamp: Date.now(),
      relevanceScore: c.overall === 'critical' ? 95 : 75,
      acknowledged: false,
      pinned: false,
    }]);
  } catch { /* noop */ }
}

let started = false;
let _powerTimer: number | null = null;
let _commsTimer: number | null = null;

export function startInfrastructureAlertBridge(): void {
  if (started) return;
  started = true;
  void pollPowerGrid();
  void pollCommsHealth();
  _powerTimer = window.setInterval(() => void pollPowerGrid(), POWER_POLL_MS);
  _commsTimer = window.setInterval(() => void pollCommsHealth(), COMMS_POLL_MS);
}

export function stopInfrastructureAlertBridge(): void {
  if (_powerTimer !== null) { clearInterval(_powerTimer); _powerTimer = null; }
  if (_commsTimer !== null) { clearInterval(_commsTimer); _commsTimer = null; }
  started = false;
}
