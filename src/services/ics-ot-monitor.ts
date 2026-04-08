/**
 * ICS/OT Security Monitor — Dragos-style industrial control system tracking
 *
 * Maintains an in-memory registry of ICS/OT assets (PLCs, RTUs, HMIs,
 * SCADA servers, historians, engineering workstations, safety systems) and
 * their associated security alerts. Provides dashboard aggregation and
 * per-sector risk scoring suitable for map-layer and panel rendering.
 *
 * Modelled after Dragos WorldView / OT-Watch monitoring concepts.
 * No external dependencies, no network calls — pure in-memory state.
 *
 * Integration: call registerOtAsset() on startup or discovery events;
 * call ingestOtAlert() whenever an OT security feed (Shodan ICS exposure,
 * CISA ICS-CERT advisories, local sensor) reports an anomaly.
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** Category of ICS/OT device. */
export type OtAssetType =
  | 'plc'
  | 'rtu'
  | 'hmi'
  | 'scada_server'
  | 'historian'
  | 'engineering_ws'
  | 'safety_system';

/** Operational status of an ICS/OT asset. */
export type OtAssetStatus = 'online' | 'offline' | 'compromised' | 'unknown';

/** Alert category mapped to common OT threat patterns. */
export type OtAlertType =
  | 'unauthorized_access'
  | 'firmware_change'
  | 'protocol_anomaly'
  | 'network_scan'
  | 'policy_violation'
  | 'connection_anomaly';

/** Severity tier for OT alerts. */
export type OtAlertSeverity = 'critical' | 'high' | 'medium' | 'low';

/** A registered ICS/OT device. */
export interface OtAsset {
  /** Unique asset identifier. */
  id: string;
  /** Human-readable device name. */
  name: string;
  /** Device category. */
  type: OtAssetType;
  /** Industry vertical (e.g. 'energy', 'water', 'manufacturing'). */
  sector: string;
  /** Primary industrial protocol in use (e.g. 'Modbus', 'DNP3', 'S7'). */
  protocol: string;
  /** Facility or site label. */
  location: string;
  /** Latitude of the asset's physical location. */
  lat: number;
  /** Longitude of the asset's physical location. */
  lon: number;
  /** Unix timestamp (ms) of the most recent status update. */
  lastSeen: number;
  /** Current operational / security status. */
  status: OtAssetStatus;
}

/** A security alert raised against a specific OT asset. */
export interface OtAlert {
  /** Unique alert identifier. */
  id: string;
  /** ID of the affected asset. */
  assetId: string;
  /** Name of the affected asset (denormalised for quick display). */
  assetName: string;
  /** Category of anomaly detected. */
  alertType: OtAlertType;
  /** Alert severity tier. */
  severity: OtAlertSeverity;
  /** Free-text description of the observed anomaly. */
  description: string;
  /** Unix timestamp (ms) when the alert was recorded. */
  timestamp: number;
  /** Optional MITRE ATT&CK for ICS tactic (e.g. 'Inhibit Response Function'). */
  mitreTactic?: string;
}

/** Aggregated dashboard view returned by getOtDashboard(). */
export interface OtDashboard {
  /** Total number of registered assets. */
  totalAssets: number;
  /** Number of assets with status 'online'. */
  onlineCount: number;
  /** Number of assets with status 'offline'. */
  offlineCount: number;
  /** Number of assets with status 'compromised'. */
  compromisedCount: number;
  /** Total alerts in the last 24 hours. */
  alertCount24h: number;
  /** Alerts with severity 'critical' in the last 24 hours. */
  criticalAlerts: OtAlert[];
  /** Count of assets per sector. */
  sectorBreakdown: Map<string, number>;
}

/** Per-sector risk summary returned by getSectorRisk(). */
export interface SectorRisk {
  /** Sector name. */
  sector: string;
  /** Number of registered assets in this sector. */
  assetCount: number;
  /** Number of alerts in the last 24 hours for this sector. */
  alertCount: number;
  /**
 * Composite risk score 0–100.
 * Derived from alert frequency, severity weighting, and compromised-asset ratio.
 */
  riskScore: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Lookback window for "recent" alerts used in dashboard and risk scoring. */
const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

/** Severity weights used in risk score computation. */
const SEVERITY_WEIGHT: Record<OtAlertSeverity, number> = {
  critical: 40,
  high: 20,
  medium: 8,
  low: 2,
};

// ── In-memory state ────────────────────────────────────────────────────────

/** All registered OT assets, keyed by asset ID. */
const assets = new Map<string, OtAsset>();

/** All ingested OT alerts, keyed by alert ID. */
const alerts = new Map<string, OtAlert>();

/** Monotonically incrementing counter for simple unique IDs. */
let idCounter = 0;

// ── Helpers ────────────────────────────────────────────────────────────────

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

function alertsInWindow(since: number): OtAlert[] {
  return Array.from(alerts.values()).filter((a) => a.timestamp >= since);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Register an ICS/OT asset. If an asset with the same ID already exists it
 * is fully replaced (use for discovery updates or heartbeat refreshes).
 *
 * @param id - Unique device identifier (e.g. serial number, IP:port).
 * @param name - Human-readable device label.
 * @param type - Device category.
 * @param sector - Industry vertical (e.g. 'energy', 'water').
 * @param protocol - Primary ICS protocol (e.g. 'Modbus', 'DNP3', 'EtherNet/IP').
 * @param location - Site or facility label.
 * @param lat - Physical latitude.
 * @param lon - Physical longitude.
 * @param status - Initial status (defaults to 'unknown').
 */
export function registerOtAsset(
  id: string,
  name: string,
  type: OtAssetType,
  sector: string,
  protocol: string,
  location: string,
  lat: number,
  lon: number,
  status: OtAssetStatus = 'unknown',
): OtAsset {
  const asset: OtAsset = {
 id,
 name,
 type,
 sector,
 protocol,
 location,
 lat,
 lon,
 lastSeen: Date.now(),
 status,
  };
  assets.set(id, asset);
  return asset;
}

/**
 * Record a security alert against a registered asset.
 *
 * If the asset's current status is 'online' or 'unknown' and the alert type
 * is 'unauthorized_access' or 'firmware_change', the asset status is
 * automatically elevated to 'compromised'.
 *
 * @param assetId - ID of the affected asset (must be registered).
 * @param alertType - Category of anomaly.
 * @param severity - Alert severity tier.
 * @param description - Free-text description.
 * @param mitreTactic - Optional MITRE ATT&CK for ICS tactic string.
 * @returns The created OtAlert, or null if the assetId is not registered.
 */
export function ingestOtAlert(
  assetId: string,
  alertType: OtAlertType,
  severity: OtAlertSeverity,
  description: string,
  mitreTactic?: string,
): OtAlert | null {
  const asset = assets.get(assetId);
  if (!asset) return null;

  const alert: OtAlert = {
 id: nextId('alert'),
 assetId,
 assetName: asset.name,
 alertType,
 severity,
 description,
 timestamp: Date.now(),
 mitreTactic,
  };

  alerts.set(alert.id, alert);

  // Elevate asset status on high-impact alert types
  if (
 (alertType === 'unauthorized_access' || alertType === 'firmware_change') &&
 asset.status !== 'compromised'
  ) {
 asset.status = 'compromised';
 asset.lastSeen = alert.timestamp;
  }

  return alert;
}

/**
 * Return all registered OT assets sorted by name ascending.
 */
export function getOtAssets(): OtAsset[] {
  return Array.from(assets.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Return alerts recorded at or after the given timestamp.
 * Defaults to the last 24 hours. Results are sorted newest-first.
 *
 * @param since - Unix timestamp (ms). Omit for 24-hour default.
 */
export function getOtAlerts(since?: number): OtAlert[] {
  const cutoff = since ?? Date.now() - WINDOW_24H_MS;
  return alertsInWindow(cutoff).sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Return an aggregated dashboard snapshot for the last 24 hours.
 */
export function getOtDashboard(): OtDashboard {
  const now = Date.now();
  const recent = alertsInWindow(now - WINDOW_24H_MS);

  let onlineCount = 0;
  let offlineCount = 0;
  let compromisedCount = 0;
  const sectorBreakdown = new Map<string, number>();

  for (const asset of assets.values()) {
 if (asset.status === 'online') onlineCount++;
 else if (asset.status === 'offline') offlineCount++;
 else if (asset.status === 'compromised') compromisedCount++;

 sectorBreakdown.set(asset.sector, (sectorBreakdown.get(asset.sector) ?? 0) + 1);
  }

  const criticalAlerts = recent.filter((a) => a.severity === 'critical');

  return {
 totalAssets: assets.size,
 onlineCount,
 offlineCount,
 compromisedCount,
 alertCount24h: recent.length,
 criticalAlerts,
 sectorBreakdown,
  };
}

/**
 * Return per-sector risk scores for all sectors with registered assets,
 * sorted by riskScore descending (highest risk first).
 *
 * Risk score formula (0–100):
 * - Base: sum of SEVERITY_WEIGHT values for all 24h alerts in the sector
 * - Bonus: +20 if any compromised asset exists in the sector
 * - Clamped to [0, 100]
 */
export function getSectorRisk(): SectorRisk[] {
  const now = Date.now();
  const recent = alertsInWindow(now - WINDOW_24H_MS);

  // Map assetId → sector for quick lookup
  const assetSector = new Map<string, string>();
  const assetCountBySector = new Map<string, number>();
  const compromisedBySector = new Set<string>();

  for (const asset of assets.values()) {
 assetSector.set(asset.id, asset.sector);
 assetCountBySector.set(asset.sector, (assetCountBySector.get(asset.sector) ?? 0) + 1);
 if (asset.status === 'compromised') {
 compromisedBySector.add(asset.sector);
 }
  }

  // Accumulate weighted alert score per sector
  const alertCountBySector = new Map<string, number>();
  const weightedScoreBySector = new Map<string, number>();

  for (const alert of recent) {
 const sector = assetSector.get(alert.assetId);
 if (!sector) continue;
 alertCountBySector.set(sector, (alertCountBySector.get(sector) ?? 0) + 1);
 weightedScoreBySector.set(
 sector,
 (weightedScoreBySector.get(sector) ?? 0) + SEVERITY_WEIGHT[alert.severity],
 );
  }

  const results: SectorRisk[] = [];

  for (const [sector, assetCount] of assetCountBySector.entries()) {
 const alertCount = alertCountBySector.get(sector) ?? 0;
 let score = weightedScoreBySector.get(sector) ?? 0;
 if (compromisedBySector.has(sector)) score += 20;
 const riskScore = Math.min(100, Math.max(0, Math.round(score)));
 results.push({ sector, assetCount, alertCount, riskScore });
  }

  return results.sort((a, b) => b.riskScore - a.riskScore);
}
