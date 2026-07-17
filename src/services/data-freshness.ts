/**
 * Data Freshness Tracker
 * Tracks when each data source was last updated to prevent
 * showing misleading "all clear" when we actually have no data.
 */

import { getCSSColor } from '@/utils/theme-colors';

export type DataSourceId =
  | 'acled' // Protests/conflicts
  | 'opensky' // Military flights
  | 'wingbits' // Aircraft enrichment
  | 'ais' // Vessel tracking
  | 'usgs' // Earthquakes
  | 'gdelt' // News velocity
  | 'gdelt_doc'  // GDELT Doc protest intelligence
  | 'rss' // RSS feeds
  | 'polymarket' // Prediction markets
  | 'predictions' // Predictions feed
  | 'pizzint' // PizzINT monitoring
  | 'outages' // Internet outages
  | 'cyber_threats' // Cyber threat IOC layer
  | 'weather' // Weather alerts
  | 'economic' // Economic indicators (FRED)
  | 'oil' // EIA oil analytics
  | 'spending' // USASpending.gov
  | 'dod-contracts' // USASpending DOD-filtered contract awards
  | 'wikidata-bases' // WikiData SPARQL military bases
  | 'firms' // NASA FIRMS satellite fires
  | 'acled_conflict' // ACLED battles/explosions/violence
  | 'ucdp' // UCDP conflict classification
  | 'hapi' // HDX HAPI aggregated conflict data
  | 'ucdp_events' // UCDP georeferenced conflict events
  | 'unhcr' // UNHCR displacement data
  | 'climate' // Climate anomaly data (Open-Meteo)
  | 'smoke_forecast' // Open-Meteo air-quality forecast (smoke engine)
  | 'worldpop' // WorldPop population exposure
  | 'giving' // Global giving activity data
  | 'bis' // BIS central bank data
  | 'wto_trade' // WTO trade policy data
  | 'supply_chain' // Supply chain disruption intelligence (shipping + minerals aggregate)
  | 'chokepoint-status' // Maritime chokepoint status — distinct from supply_chain so a shipping/minerals refresh can't mask a chokepoint outage
  | 'security_advisories'  // Government travel/security advisories
  | 'gpsjam' // GPS/GNSS interference
  | 'acled_airstrikes' // ACLED air/drone strikes & missile attacks
  | 's2_underground' // S2 Underground intelligence (GhostMaps)
  | 'faa_weather_cams' // FAA weather camera network
  | 'adsb' // ADS-B live aircraft tracking (OpenSky)
  | 'adsb-military' // Military ADS-B flight tracking
  | 'aviation-intel' // Aviation intel: NOTAMs, SIGMETs, PIREPs, military aircraft, delays
    | "maritime-safety"
    | "inciweb"
    | "cisa-advisories"
    | "nuclear-monitor"
    | "marine-hazards"
    | "disease-outbreak"
    | "avalanche-hazard"
    | "evacuation-router"
    | "disease-intel"
    | "wpc-winter-weather"
    | "fema-disasters"
    | "power-grid-alerts"
    | "wpc-excessive-rainfall"
    | "congress-defense"
    | "flood-gauges"
    | "telegram-intel"
    | "spaceflight-news"
    | "rainviewer-radar"
    | "lightning"
    | "copernicus-cems"
    | "faa-nas-status"
    | "phmsa-pipeline"
    | "air-quality"
    | "openaq-aqi"
    | "radiation-monitoring"
    | "dam-safety"
    | "nrc-nuclear"
    | "offline-alert-cache"
    | "spc-outlook"
    | "aerospace-reentry"
    | "un-security-council"
    | "oref-alerts"
    | "wildfire-smoke"
    | "offline-map-cache"
    | "spc-mesoscale"
    | "s2-underground"
    | "federal-register"
    | "hazmat-incidents"
    | "power-grid"
    | "gps-interference"
    | "faa-cameras"
    | "combatant-commands"
    | "water-quality"
    | "allied-military"
    | "ofac-sanctions"
    | "amtrak-alerts"
    | "tropical-cyclones"
    | "fdic-failures"
    | "internet-outages"
    | "drought-monitor"
    | "hdx-crisis"
    | "oil-spill-tracker"
    | "inpe-fires"
    | "cyber-extra"
    | "ntsb-investigations"
    | "aviation-hazards"
    | "habsos"
    | "wsb-sentiment"
    | "ecdc-surveillance"
    | "volcano-alerts"
    | "space-weather"
    | "food-insecurity"
    | "space-launches"
    | "iaea-nuclear"
    | "live-news"
    | "dsca-arms-transfers"
    | "ripe-atlas"
    | "foreign-mil-news"
    | "cpc-outlook"
    | "noaa-buoys"
    | "world-bank"
    | "nws-alerts"
    | "state-dept-advisories"
    | "tsunami-alerts"
    | "supply-chain-impact"
    | "faa-tfrs"
    | "usgs-pager"
    | "wastewater"
    | "volcano-monitor"
    | "severe-weather"
    | "shakealert"
  | 'webcams'; // Aggregated webcam feeds (Windy + DOT + YouTube)

export type FreshnessStatus = 'fresh' | 'stale' | 'very_stale' | 'no_data' | 'disabled' | 'error';

export interface DataSourceState {
  id: DataSourceId;
  name: string;
  lastUpdate: Date | null;
  lastError: string | null;
  lastErrorAt: number | null;
  itemCount: number;
  /** Items delivered by the MOST RECENT refresh (set, not accumulated, unlike
   *  itemCount). Lets diagnostics distinguish "fresh and delivering" from
   *  "fresh but the latest fetch came back empty" — an empty 200 OK that would
   *  otherwise read as healthy. 0 with a non-null lastUpdate + no error =
   *  delivered-empty (see isDeliveringEmpty). */
  lastBatchItemCount: number;
  enabled: boolean;
  status: FreshnessStatus;
  requiredForRisk: boolean; // Is this source important for risk assessment?
}

/**
 * True when a source looks fresh (recently updated, no error) but its most
 * recent refresh delivered zero items — a silently-empty feed that age-based
 * freshness alone reports as healthy. Pure; no side effects.
 */
export function isDeliveringEmpty(source: DataSourceState): boolean {
  return source.lastUpdate !== null && !source.lastError && source.lastBatchItemCount === 0;
}

export interface DataFreshnessSummary {
  totalSources: number;
  activeSources: number;
  staleSources: number;
  disabledSources: number;
  errorSources: number;
  overallStatus: 'sufficient' | 'limited' | 'insufficient';
  coveragePercent: number;
  oldestUpdate: Date | null;
  newestUpdate: Date | null;
}

// Thresholds in milliseconds
const FRESH_THRESHOLD = 15 * 60 * 1000; // 15 minutes
const STALE_THRESHOLD = 2 * 60 * 60 * 1000;  // 2 hours
const VERY_STALE_THRESHOLD = 6 * 60 * 60 * 1000; // 6 hours

// Core sources needed for meaningful risk assessment
// Note: ACLED is optional since GDELT provides protest data as fallback
const CORE_SOURCES: DataSourceId[] = ['gdelt', 'rss'];

const SOURCE_METADATA: Record<DataSourceId, { name: string; requiredForRisk: boolean; panelId?: string }> = {
  acled: { name: 'Protests & Conflicts', requiredForRisk: false, panelId: 'protests' },
  opensky: { name: 'Military Flights', requiredForRisk: false, panelId: 'military' },
  wingbits: { name: 'Aircraft Enrichment', requiredForRisk: false, panelId: 'military' },
  ais: { name: 'Vessel Tracking', requiredForRisk: false, panelId: 'shipping' },
  usgs: { name: 'Earthquakes', requiredForRisk: false, panelId: 'natural' },
  gdelt: { name: 'News Intelligence', requiredForRisk: true, panelId: 'intel' },
  gdelt_doc: { name: 'GDELT Doc Intelligence', requiredForRisk: false, panelId: 'protests' },
  rss: { name: 'Live News Feeds', requiredForRisk: true, panelId: 'live-news' },
  polymarket: { name: 'Prediction Markets', requiredForRisk: false, panelId: 'polymarket' },
  predictions: { name: 'Predictions Feed', requiredForRisk: false, panelId: 'polymarket' },
  pizzint: { name: 'PizzINT Monitoring', requiredForRisk: false, panelId: 'intel' },
  outages: { name: 'Internet Outages', requiredForRisk: false, panelId: 'outages' },
  cyber_threats: { name: 'Cyber Threat IOCs', requiredForRisk: false, panelId: 'map' },
  weather: { name: 'Weather Alerts', requiredForRisk: false, panelId: 'weather' },
  economic: { name: 'Economic Data (FRED)', requiredForRisk: false, panelId: 'economic' },
  oil: { name: 'Oil Analytics (EIA)', requiredForRisk: false, panelId: 'economic' },
  spending: { name: 'Gov Spending', requiredForRisk: false, panelId: 'economic' },
  'dod-contracts': { name: 'DOD Contracts', requiredForRisk: false, panelId: 'dod-contracts' },
  'wikidata-bases': { name: 'WikiData Bases', requiredForRisk: false, panelId: 'wikidata-bases' },
  firms: { name: 'FIRMS Satellite Fires', requiredForRisk: false, panelId: 'map' },
  acled_conflict: { name: 'Armed Conflicts (ACLED)', requiredForRisk: false, panelId: 'protests' },
  ucdp: { name: 'Conflict Classification (UCDP)', requiredForRisk: false, panelId: 'protests' },
  hapi: { name: 'Conflict Aggregates (HDX)', requiredForRisk: false, panelId: 'protests' },
  ucdp_events: { name: 'UCDP Conflict Events', requiredForRisk: false, panelId: 'ucdp-events' },
  unhcr: { name: 'UNHCR Displacement', requiredForRisk: false, panelId: 'displacement' },
  climate: { name: 'Climate Anomalies', requiredForRisk: false, panelId: 'climate' },
  smoke_forecast: { name: 'Smoke Forecast (Open-Meteo AQ)', requiredForRisk: false, panelId: 'air-smoke' },
  worldpop: { name: 'Population Exposure', requiredForRisk: false, panelId: 'population-exposure' },
  giving: { name: 'Global Giving Activity', requiredForRisk: false, panelId: 'giving' },
  bis: { name: 'BIS Central Banks', requiredForRisk: false, panelId: 'economic' },
  wto_trade: { name: 'WTO Trade Policy', requiredForRisk: false, panelId: 'trade-policy' },
  supply_chain: { name: 'Supply Chain Intelligence', requiredForRisk: false, panelId: 'supply-chain' },
  'chokepoint-status': { name: 'Maritime Chokepoint Status', requiredForRisk: false, panelId: 'supply-chain' },
  security_advisories: { name: 'Security Advisories', requiredForRisk: false, panelId: 'security-advisories' },
  gpsjam: { name: 'GPS/GNSS Interference', requiredForRisk: false, panelId: 'map' },
  acled_airstrikes: { name: 'Air Strikes & Drones (ACLED)', requiredForRisk: false, panelId: 'airstrikes' },
  s2_underground: { name: 'S2 Underground Intelligence', requiredForRisk: false, panelId: 'map' },
  faa_weather_cams: { name: 'FAA Weather Cameras', requiredForRisk: false, panelId: 'faa-weather-cams' },
  adsb: { name: 'ADS-B Aircraft', requiredForRisk: false, panelId: 'air-traffic' },
  'adsb-military': { name: 'Military ADS-B', requiredForRisk: false, panelId: 'geo-intel' },
  'aviation-intel': { name: 'Aviation Intel', requiredForRisk: false, panelId: 'aviation-intel' },
  webcams: { name: 'Webcam Aggregator', requiredForRisk: false, panelId: 'live-webcams' },
  "maritime-safety": { name: "Maritime Safety", requiredForRisk: false },
  "inciweb": { name: "Inciweb", requiredForRisk: false },
  "cisa-advisories": { name: "Cisa Advisories", requiredForRisk: false },
  "nuclear-monitor": { name: "Nuclear Monitor", requiredForRisk: false },
  "marine-hazards": { name: "Marine Hazards", requiredForRisk: false },
  "disease-outbreak": { name: "Disease Outbreak", requiredForRisk: false },
  "avalanche-hazard": { name: "Avalanche Hazard", requiredForRisk: false },
  "evacuation-router": { name: "Evacuation Router", requiredForRisk: false },
  "disease-intel": { name: "Disease Intel", requiredForRisk: false },
  "wpc-winter-weather": { name: "Wpc Winter Weather", requiredForRisk: false },
  "fema-disasters": { name: "Fema Disasters", requiredForRisk: false },
  "power-grid-alerts": { name: "Power Grid Alerts", requiredForRisk: false },
  "wpc-excessive-rainfall": { name: "Wpc Excessive Rainfall", requiredForRisk: false },
  "congress-defense": { name: "Congress Defense", requiredForRisk: false },
  "flood-gauges": { name: "Flood Gauges", requiredForRisk: false },
  "telegram-intel": { name: "Telegram Intel", requiredForRisk: false },
  "spaceflight-news": { name: "Spaceflight News", requiredForRisk: false },
  "rainviewer-radar": { name: "Rainviewer Radar", requiredForRisk: false },
  "lightning": { name: "Lightning", requiredForRisk: false },
  "copernicus-cems": { name: "Copernicus Cems", requiredForRisk: false },
  "faa-nas-status": { name: "Faa Nas Status", requiredForRisk: false },
  "phmsa-pipeline": { name: "Phmsa Pipeline", requiredForRisk: false },
  "air-quality": { name: "Air Quality", requiredForRisk: false },
  "openaq-aqi": { name: "OpenAQ Air Quality", requiredForRisk: false },
  "radiation-monitoring": { name: "Radiation Monitoring", requiredForRisk: false },
  "dam-safety": { name: "Dam Safety", requiredForRisk: false },
  "nrc-nuclear": { name: "Nrc Nuclear", requiredForRisk: false },
  "offline-alert-cache": { name: "Offline Alert Cache", requiredForRisk: false },
  "spc-outlook": { name: "Spc Outlook", requiredForRisk: false },
  "aerospace-reentry": { name: "Aerospace Reentry", requiredForRisk: false },
  "un-security-council": { name: "Un Security Council", requiredForRisk: false },
  "oref-alerts": { name: "Oref Alerts", requiredForRisk: false },
  "wildfire-smoke": { name: "Wildfire Smoke", requiredForRisk: false },
  "offline-map-cache": { name: "Offline Map Cache", requiredForRisk: false },
  "spc-mesoscale": { name: "Spc Mesoscale", requiredForRisk: false },
  "s2-underground": { name: "S2 Underground", requiredForRisk: false },
  "federal-register": { name: "Federal Register", requiredForRisk: false },
  "hazmat-incidents": { name: "Hazmat Incidents", requiredForRisk: false },
  "power-grid": { name: "Power Grid", requiredForRisk: false },
  "gps-interference": { name: "Gps Interference", requiredForRisk: false },
  "faa-cameras": { name: "Faa Cameras", requiredForRisk: false },
  "combatant-commands": { name: "Combatant Commands", requiredForRisk: false },
  "water-quality": { name: "Water Quality", requiredForRisk: false },
  "allied-military": { name: "Allied Military", requiredForRisk: false },
  "ofac-sanctions": { name: "Ofac Sanctions", requiredForRisk: false },
  "amtrak-alerts": { name: "Amtrak Alerts", requiredForRisk: false },
  "tropical-cyclones": { name: "Tropical Cyclones", requiredForRisk: false },
  "fdic-failures": { name: "Fdic Failures", requiredForRisk: false },
  "internet-outages": { name: "Internet Outages", requiredForRisk: false },
  "drought-monitor": { name: "Drought Monitor", requiredForRisk: false },
  "hdx-crisis": { name: "Hdx Crisis", requiredForRisk: false },
  "oil-spill-tracker": { name: "Oil Spill Tracker", requiredForRisk: false },
  "inpe-fires": { name: "Inpe Fires", requiredForRisk: false },
  "cyber-extra": { name: "Cyber Extra", requiredForRisk: false },
  "ntsb-investigations": { name: "Ntsb Investigations", requiredForRisk: false },
  "aviation-hazards": { name: "Aviation Hazards", requiredForRisk: false },
  "habsos": { name: "Habsos", requiredForRisk: false },
  "wsb-sentiment": { name: "Wsb Sentiment", requiredForRisk: false },
  "ecdc-surveillance": { name: "Ecdc Surveillance", requiredForRisk: false },
  "volcano-alerts": { name: "Volcano Alerts", requiredForRisk: false },
  "volcano-monitor": { name: "Volcano Monitor", requiredForRisk: false, panelId: "volcano-monitor" },
  "severe-weather": { name: "Severe Weather / SPC", requiredForRisk: false, panelId: "severe-weather" },
  "shakealert": { name: "ShakeAlert / ShakeMaps", requiredForRisk: false, panelId: "shakealert" },
  "space-weather": { name: "Space Weather", requiredForRisk: false },
  "food-insecurity": { name: "Food Insecurity", requiredForRisk: false },
  "space-launches": { name: "Space Launches", requiredForRisk: false },
  "iaea-nuclear": { name: "Iaea Nuclear", requiredForRisk: false },
  "live-news": { name: "Live News", requiredForRisk: false },
  "dsca-arms-transfers": { name: "Dsca Arms Transfers", requiredForRisk: false },
  "ripe-atlas": { name: "Ripe Atlas", requiredForRisk: false },
  "foreign-mil-news": { name: "Foreign Mil News", requiredForRisk: false },
  "cpc-outlook": { name: "Cpc Outlook", requiredForRisk: false },
  "noaa-buoys": { name: "Noaa Buoys", requiredForRisk: false },
  "world-bank": { name: "World Bank", requiredForRisk: false },
  "nws-alerts": { name: "Nws Alerts", requiredForRisk: false },
  "state-dept-advisories": { name: "State Dept Advisories", requiredForRisk: false },
  "tsunami-alerts": { name: "Tsunami Alerts", requiredForRisk: false },
  "supply-chain-impact": { name: "Supply Chain Impact", requiredForRisk: false },
  "faa-tfrs": { name: "Faa Tfrs", requiredForRisk: false },
  "usgs-pager": { name: "Usgs Pager", requiredForRisk: false },
  "wastewater": { name: "Wastewater Surveillance", requiredForRisk: false, panelId: "disease-outbreaks" },
};

class DataFreshnessTracker {
  private sources = new Map<DataSourceId, DataSourceState>();
  private listeners = new Set<() => void>();

  constructor() {
 // Initialize all sources
 for (const [id, meta] of Object.entries(SOURCE_METADATA)) {
 this.sources.set(id as DataSourceId, {
 id: id as DataSourceId,
 name: meta.name,
 lastUpdate: null,
 lastError: null,
 lastErrorAt: null,
 itemCount: 0,
 lastBatchItemCount: 0,
 enabled: true, // Assume enabled by default
 status: 'no_data',
 requiredForRisk: meta.requiredForRisk,
 });
 }
  }

  /**
 * Record that a data source received new data
 */
  recordUpdate(sourceId: DataSourceId, itemCount = 1): void {
 const source = this.sources.get(sourceId);
 if (source) {
 source.lastUpdate = new Date();
 source.itemCount += itemCount;
 source.lastBatchItemCount = itemCount;
 source.lastError = null;
 source.lastErrorAt = null;
 source.status = this.calculateStatus(source);
 this.notifyListeners();
 }
  }

  /**
 * Record an error for a data source
 */
  recordError(sourceId: DataSourceId, error: string): void {
 const source = this.sources.get(sourceId);
 if (source) {
 source.lastError = error;
 source.lastErrorAt = Date.now();
 source.status = 'error';
 this.notifyListeners();
 }
  }

  /**
 * True when any source recorded an error within the given window.
 * Used by the offline-staleness banner so a feed that is actively
 * failing surfaces as stale even when other feeds are refreshing
 * successfully (a failing feed stops writing cb-source-updates, so
 * the age-only check alone reports false-fresh).
 */
  hasRecentError(windowMs = 10 * 60 * 1000): boolean {
 const now = Date.now();
 for (const source of this.sources.values()) {
 if (!source.enabled) continue;
 if (source.lastError && source.lastErrorAt !== null && now - source.lastErrorAt <= windowMs) {
 return true;
 }
 }
 return false;
  }

  /**
 * Set whether a source is enabled/disabled
 */
  setEnabled(sourceId: DataSourceId, enabled: boolean): void {
 const source = this.sources.get(sourceId);
 if (source) {
 source.enabled = enabled;
 source.status = enabled ? this.calculateStatus(source) : 'disabled';
 this.notifyListeners();
 }
  }

  /**
 * Get the state of a specific source
 */
  getSource(sourceId: DataSourceId): DataSourceState | undefined {
 const source = this.sources.get(sourceId);
 if (source) {
 // Recalculate status in case time has passed
 source.status = source.enabled ? this.calculateStatus(source) : 'disabled';
 }
 return source;
  }

  /**
 * Get all source states
 */
  getAllSources(): DataSourceState[] {
 return [...this.sources.values()].map(source => ({
 ...source,
 status: source.enabled ? this.calculateStatus(source) : 'disabled',
 }));
  }

  /**
 * Enabled sources whose most recent refresh succeeded but returned zero items
 * (delivered-empty). These read as `fresh` by age alone — this is the only way
 * to tell "working and delivering" from "working but silently empty". Pure
 * read; does not mutate status or affect risk aggregation.
 */
  getEmptyDeliverySources(): DataSourceState[] {
 return this.getAllSources().filter((s) => s.enabled && isDeliveringEmpty(s));
  }

  /**
 * Get sources required for risk assessment
 */
  getRiskSources(): DataSourceState[] {
 return this.getAllSources().filter(s => s.requiredForRisk);
  }

  /**
 * Get overall data freshness summary
 */
  getSummary(): DataFreshnessSummary {
 const sources = this.getAllSources();
 const riskSources = sources.filter(s => s.requiredForRisk);

 const activeSources = sources.filter(s => s.status === 'fresh' || s.status === 'stale' || s.status === 'very_stale');
 const activeRiskSources = riskSources.filter(s => s.status === 'fresh' || s.status === 'stale' || s.status === 'very_stale');
 const staleSources = sources.filter(s => s.status === 'stale' || s.status === 'very_stale');
 const disabledSources = sources.filter(s => s.status === 'disabled');
 const errorSources = sources.filter(s => s.status === 'error');

 const updates = sources
 .filter(s => s.lastUpdate)
 .map(s => s.lastUpdate!.getTime());

 // Coverage is based on risk-required sources
 const coveragePercent = riskSources.length > 0
 ? Math.round((activeRiskSources.length / riskSources.length) * 100)
 : 0;

 // Overall status
 let overallStatus: 'sufficient' | 'limited' | 'insufficient';
 if (activeRiskSources.length >= CORE_SOURCES.length && coveragePercent >= 66) {
 overallStatus = 'sufficient';
 } else if (activeRiskSources.length >= 1) {
 overallStatus = 'limited';
 } else {
 overallStatus = 'insufficient';
 }

 return {
 totalSources: sources.length,
 activeSources: activeSources.length,
 staleSources: staleSources.length,
 disabledSources: disabledSources.length,
 errorSources: errorSources.length,
 overallStatus,
 coveragePercent,
 oldestUpdate: updates.length > 0 ? new Date(Math.min(...updates)) : null,
 newestUpdate: updates.length > 0 ? new Date(Math.max(...updates)) : null,
 };
  }

  /**
 * Check if we have enough data for risk assessment
 */
  hasSufficientData(): boolean {
 return this.getSummary().overallStatus === 'sufficient';
  }

  /**
 * Check if we have any data at all
 */
  hasAnyData(): boolean {
 return this.getSummary().activeSources > 0;
  }

  /**
 * Get panel ID for a source (to enable it)
 */
  getPanelIdForSource(sourceId: DataSourceId): string | undefined {
 return SOURCE_METADATA[sourceId]?.panelId;
  }

  /**
 * Subscribe to changes
 */
  subscribe(listener: () => void): () => void {
 this.listeners.add(listener);
 return () => this.listeners.delete(listener);
  }

  private calculateStatus(source: DataSourceState): FreshnessStatus {
 if (!source.enabled) return 'disabled';
 if (source.lastError) return 'error';
 if (!source.lastUpdate) return 'no_data';

 const age = Date.now() - source.lastUpdate.getTime();
 if (age < FRESH_THRESHOLD) return 'fresh';
 if (age < STALE_THRESHOLD) return 'stale';
 if (age < VERY_STALE_THRESHOLD) return 'very_stale';
 return 'no_data'; // Too old, treat as no data
  }

  private notifyListeners(): void {
 for (const listener of this.listeners) {
 try {
 listener();
 } catch (error) {
 console.error('[DataFreshness] Listener error:', error);
 }
 }
  }

  /**
 * Get human-readable time since last update
 */
  getTimeSince(sourceId: DataSourceId): string {
 const source = this.sources.get(sourceId);
 if (!source?.lastUpdate) return 'never';

 const ms = Date.now() - source.lastUpdate.getTime();
 if (ms < 60_000) return 'just now';
 if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
 if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
 return `${Math.floor(ms / 86_400_000)}d ago`;
  }
}

// Singleton instance
export const dataFreshness = new DataFreshnessTracker();

// Helper to get status color
export function getStatusColor(status: FreshnessStatus): string {
  switch (status) {
 case 'fresh': { return getCSSColor('--semantic-normal');
 }
 case 'stale': { return getCSSColor('--semantic-elevated');
 }
 case 'very_stale': { return getCSSColor('--semantic-high');
 }
 case 'error': { return getCSSColor('--semantic-critical');
 }
 case 'disabled': { return getCSSColor('--text-muted');
 }
 case 'no_data': { return getCSSColor('--text-dim');
 }
  }
}

// Helper to get status icon
export function getStatusIcon(status: FreshnessStatus): string {
  switch (status) {
 case 'fresh': { return '●';
 }
 case 'stale': { return '◐';
 }
 case 'very_stale': { return '○';
 }
 case 'error': { return '✕';
 }
 case 'disabled': { return '○';
 }
 case 'no_data': { return '○';
 }
  }
}

// Intelligence gap messages - explains what analysts CAN'T see (Quick Win #1)
const INTELLIGENCE_GAP_MESSAGES: Record<DataSourceId, string> = {
  acled: 'Protest/conflict events may be missed—ACLED data unavailable',
  opensky: 'Military aircraft positions unknown—flight tracking offline',
  wingbits: 'Aircraft identification limited—enrichment service unavailable',
  ais: 'Vessel positions outdated—possible dark shipping or AIS transponder-off activity undetected',
  usgs: 'Recent earthquakes may not be shown—seismic data unavailable',
  gdelt: 'News event velocity unknown—GDELT intelligence feed offline',
  gdelt_doc: 'Protest intelligence degraded—GDELT Doc feed offline',
  rss: 'Breaking news may be missed—RSS feeds not updating',
  polymarket: 'Prediction market signals unavailable—early warning capability degraded',
  predictions: 'Prediction feed unavailable—scenario signals may be stale',
  pizzint: 'PizzINT monitor unavailable—location/tension tracking degraded',
  outages: 'Internet disruptions may be unreported—outage monitoring offline',
  cyber_threats: 'Cyber IOC map points unavailable—malicious infrastructure visibility reduced',
  weather: 'Severe weather warnings may be missed—weather alerts unavailable',
  economic: 'Economic indicators stale—Fed/Treasury data not updating',
  oil: 'Oil market analytics unavailable—EIA data not updating',
  spending: 'Government spending data unavailable',
  'dod-contracts': 'DOD contract awards unavailable',
  'wikidata-bases': 'WikiData military bases unavailable',
  firms: 'Satellite fire detection unavailable—NASA FIRMS data not updating',
  acled_conflict: 'Armed conflict events may be missed—ACLED conflict data unavailable',
  ucdp: 'Conflict classification unavailable—UCDP data not loading',
  hapi: 'Aggregated conflict data unavailable—HDX HAPI not responding',
  ucdp_events: 'UCDP event-level conflict data unavailable',
  unhcr: 'UNHCR displacement data unavailable—refugee flows unknown',
  climate: 'Climate anomaly data unavailable—extreme weather patterns undetected',
  smoke_forecast: 'Air-quality forecast unavailable—wildfire smoke conditions and safe windows unknown',
  worldpop: 'Population exposure data unavailable—affected population unknown',
  giving: 'Global giving activity data unavailable',
  bis: 'Central bank policy data may be stale—BIS feed unavailable',
  wto_trade: 'Trade policy intelligence unavailable—WTO data not updating',
  supply_chain: 'Supply chain disruption status unavailable—chokepoint monitoring offline',
  'chokepoint-status': 'Maritime chokepoint status unavailable—corridor disruption may be missed',
  security_advisories: 'Government travel advisory data unavailable—security alerts may be missed',
  gpsjam: 'GPS/GNSS interference data unavailable—jamming zones undetected',
  acled_airstrikes: 'Air strike & drone event data unavailable—ACLED feed not responding',
  s2_underground: 'S2 Underground intelligence data unavailable—GhostMaps CIP feed not responding',
  faa_weather_cams: 'FAA weather camera data unavailable—camera feed not responding',
  adsb: 'Live aircraft positions unavailable—ADS-B tracking offline',
  'adsb-military': 'Military aircraft positions unavailable—military ADS-B tracking offline',
  'aviation-intel': 'Aviation feeds unavailable—NOTAMs / SIGMETs / PIREPs / military / delays offline',
  webcams: 'Webcam feeds unavailable—Windy/DOT/YouTube aggregation offline',
  // Per-service gap messages added in Pass 7 freshness wiring. Generic by default;
  // refine individual entries when the service ships dedicated copy.
  "maritime-safety": "Maritime safety data unavailable",
  "inciweb": "Wildfire incident data unavailable",
  "cisa-advisories": "CISA advisory feed unavailable",
  "nuclear-monitor": "Nuclear monitor data unavailable",
  "marine-hazards": "Marine hazard data unavailable",
  "disease-outbreak": "Disease outbreak data unavailable",
  "avalanche-hazard": "Avalanche hazard data unavailable",
  "evacuation-router": "Evacuation routing data unavailable",
  "disease-intel": "Disease intelligence data unavailable",
  "wpc-winter-weather": "WPC winter-weather data unavailable",
  "fema-disasters": "FEMA disaster data unavailable",
  "power-grid-alerts": "Power-grid alerts unavailable",
  "wpc-excessive-rainfall": "WPC excessive-rainfall data unavailable",
  "congress-defense": "Congress defense data unavailable",
  "flood-gauges": "Flood-gauge data unavailable",
  "telegram-intel": "Telegram intel data unavailable",
  "spaceflight-news": "Spaceflight news unavailable",
  "rainviewer-radar": "RainViewer radar unavailable",
  "lightning": "Lightning-strike data unavailable",
  "copernicus-cems": "Copernicus CEMS data unavailable",
  "faa-nas-status": "FAA NAS status unavailable",
  "phmsa-pipeline": "PHMSA pipeline data unavailable",
  "air-quality": "Air-quality data unavailable",
  "openaq-aqi": "OpenAQ air-quality data unavailable",
  "radiation-monitoring": "Radiation monitoring data unavailable",
  "dam-safety": "Dam-safety data unavailable",
  "nrc-nuclear": "NRC nuclear data unavailable",
  "spc-outlook": "SPC outlook data unavailable",
  "aerospace-reentry": "Aerospace reentry data unavailable",
  "un-security-council": "UN Security Council data unavailable",
  "oref-alerts": "Oref alerts unavailable",
  "wildfire-smoke": "Wildfire-smoke data unavailable",
  "spc-mesoscale": "SPC mesoscale discussion data unavailable",
  "federal-register": "Federal Register data unavailable",
  "hazmat-incidents": "HAZMAT incident data unavailable",
  "power-grid": "Power-grid data unavailable",
  "gps-interference": "GPS interference data unavailable",
  "faa-cameras": "FAA camera data unavailable",
  "combatant-commands": "Combatant commands data unavailable",
  "water-quality": "Water-quality data unavailable",
  "allied-military": "Allied military data unavailable",
  "ofac-sanctions": "OFAC sanctions data unavailable",
  "amtrak-alerts": "Amtrak alerts unavailable",
  "tropical-cyclones": "Tropical-cyclone data unavailable",
  "fdic-failures": "FDIC bank-failure data unavailable",
  "internet-outages": "Internet outage data unavailable",
  "drought-monitor": "Drought monitor data unavailable",
  "hdx-crisis": "HDX crisis data unavailable",
  "oil-spill-tracker": "Oil-spill tracker unavailable",
  "inpe-fires": "INPE fire data unavailable",
  "cyber-extra": "Cyber extras data unavailable",
  "ntsb-investigations": "NTSB investigations unavailable",
  "aviation-hazards": "Aviation-hazard data unavailable",
  "habsos": "HABSOS data unavailable",
  "wsb-sentiment": "WSB sentiment data unavailable",
  "ecdc-surveillance": "ECDC surveillance data unavailable",
  "volcano-alerts": "Volcano alerts unavailable",
  "volcano-monitor": "Volcano monitor data unavailable",
  "severe-weather": "SPC outlook/active warnings unavailable",
  "shakealert": "ShakeMap events unavailable",
  "space-weather": "Space-weather data unavailable",
  "food-insecurity": "Food-insecurity data unavailable",
  "space-launches": "Space-launch data unavailable",
  "iaea-nuclear": "IAEA nuclear data unavailable",
  "live-news": "Live news feed unavailable",
  "dsca-arms-transfers": "DSCA arms-transfer data unavailable",
  "ripe-atlas": "RIPE Atlas data unavailable",
  "foreign-mil-news": "Foreign military news unavailable",
  "cpc-outlook": "CPC outlook data unavailable",
  "noaa-buoys": "NOAA buoy data unavailable",
  "world-bank": "World Bank data unavailable",
  "nws-alerts": "NWS alerts unavailable",
  "state-dept-advisories": "State Department advisories unavailable",
  "tsunami-alerts": "Tsunami alerts unavailable",
  "supply-chain-impact": "Supply-chain impact data unavailable",
  "faa-tfrs": "FAA TFR data unavailable",
  "usgs-pager": "USGS PAGER data unavailable",
  "wastewater": "Wastewater surveillance data unavailable",
  "offline-alert-cache": "Offline alert cache unavailable",
  "offline-map-cache": "Offline map cache unavailable",
  "s2-underground": "S2 Underground feed unavailable",
};

/**
 * Get intelligence gap warnings for stale or unavailable data sources.
 * These warnings help analysts understand what they CANNOT see.
 */
export function getIntelligenceGaps(): { source: DataSourceId; message: string; severity: 'warning' | 'critical' }[] {
  const gaps: { source: DataSourceId; message: string; severity: 'warning' | 'critical' }[] = [];

  for (const source of dataFreshness.getAllSources()) {
 if (source.status === 'no_data' || source.status === 'very_stale' || source.status === 'error') {
 const message = INTELLIGENCE_GAP_MESSAGES[source.id] || `${source.name} data unavailable`;
 const severity = source.requiredForRisk || source.status === 'error' ? 'critical' : 'warning';
 gaps.push({ source: source.id, message, severity });
 }
  }

  return gaps.sort((a, b) => {
 // Critical first
 if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
 return 0;
  });
}

/**
 * Get a formatted intelligence gap summary for display.
 */
export function getIntelligenceGapSummary(): string[] {
  const gaps = getIntelligenceGaps();
  return gaps.map(gap => {
 const icon = gap.severity === 'critical' ? '⚠️ CRITICAL' : '⚡';
 return `${icon}: ${gap.message}`;
  });
}

/**
 * Check if there are any critical intelligence gaps.
 */
export function hasCriticalGaps(): boolean {
  return getIntelligenceGaps().some(gap => gap.severity === 'critical');
}
