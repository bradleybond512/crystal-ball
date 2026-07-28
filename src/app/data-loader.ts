import type { AppContext, AppModule } from '@/app/app-context';
import type { NewsItem, MapLayers, SocialUnrestEvent } from '@/types';
import type { MarketData } from '@/types';
import type { TimeRange } from '@/components';
import {
  FEEDS,
  INTEL_SOURCES,
  SECTORS,
  COMMODITIES,
  MARKET_SYMBOLS,
  SITE_VARIANT,
  LAYER_TO_SOURCE,
} from '@/config';
import { INTEL_HOTSPOTS, CONFLICT_ZONES } from '@/config/geo';
import { tokenizeForMatch, matchKeyword } from '@/utils/keyword-match';
import { createConcurrencyLimiter } from '@/utils/concurrency-limiter';
import { fetchJsonCached } from '@/utils/point-fetch-cache';
import {
  fetchCategoryFeeds,
  getFeedFailures,
  fetchMultipleStocks,
  fetchCrypto,
  fetchPredictions,
  fetchEarthquakes,
  fetchWeatherAlerts,
  fetchUgcZonesForPoint,
  fetchFredData,
  fetchInternetOutages,
  isOutagesConfigured,
  fetchAisSignals,
  getAisStatus,
  isAisConfigured,
  fetchCableActivity,
  fetchCableHealth,
  fetchProtestEvents,
  getProtestStatus,
  fetchFlightDelays,
  fetchMilitaryFlights,
  fetchMilitaryVessels,
  initMilitaryVesselStream,
  isMilitaryVesselTrackingConfigured,
  fetchUSNIFleetReport,
  updateBaseline,
  calculateDeviation,
  addToSignalHistory,
  analysisWorker,
  fetchPizzIntStatus,
  fetchGdeltTensions,
  fetchNaturalEvents,
  fetchRecentAwards,
  fetchOilAnalytics,
  fetchBisData,
  fetchCyberThreats,
  drainTrendingSignals,
  fetchTradeRestrictions,
  fetchTariffTrends,
  fetchTradeFlows,
  fetchTradeBarriers,
  fetchShippingRates,
  fetchChokepointStatus,
  fetchCriticalMinerals,
  fetchTropicalCyclones,
  fetchSpcSummary,
  fetchMarineHazards,
  fetchExcessiveRainfallOutlooks,
  fetchWinterWeatherOutlooks,
  fetchBuoyAlerts,
  fetchHurricaneRecon,
  getStormPreparednessContext,
  updateStormPreparednessContext,
} from '@/services';
import { refreshStormPosture } from '@/services/survival/storm-posture-state';
import { checkBatchForBreakingAlerts } from '@/services/breaking-news-alerts';
import { reportElevatedPanel } from '@/services/panel-correlation';
import { fetchGDACSEvents } from '@/services/gdacs';
import { normalizeNaturalEventToAlert } from '@/services/eonet';
import { mlWorker } from '@/services/ml-worker';
import { clusterNewsHybrid } from '@/services/clustering';
import { ingestProtests, ingestFlights, ingestVessels, ingestEarthquakes, detectGeoConvergence, geoConvergenceToSignal } from '@/services/geo-convergence';
import { signalAggregator } from '@/services/signal-aggregator';
import { updateAndCheck } from '@/services/temporal-baseline';
import { fetchAllFires, flattenFires, computeRegionStats, toMapFires } from '@/services/wildfires';
import { fetchInpeFires } from '@/services/inpe-fires';
import { analyzeFlightsForSurge, surgeAlertToSignal, detectForeignMilitaryPresence, foreignPresenceToSignal, getTheaterPostureSummaries, type TheaterPostureSummary } from '@/services/military-surge';
import { fetchCachedTheaterPosture, ingestLocalPostures } from '@/services/cached-theater-posture';
import { ingestProtestsForCII, ingestMilitaryForCII, ingestNewsForCII, ingestOutagesForCII, ingestConflictsForCII, ingestUcdpForCII, ingestHapiForCII, ingestDisplacementForCII, ingestClimateForCII, ingestStrikesForCII, ingestOrefForCII, ingestAviationForCII, ingestAdvisoriesForCII, ingestGpsJammingForCII, ingestAisDisruptionsForCII, ingestSatelliteFiresForCII, ingestCyberThreatsForCII, ingestTemporalAnomaliesForCII, isInLearningMode } from '@/services/country-instability';
import { fetchGpsInterference } from '@/services/gps-interference';
import { situationEngine } from '@/services/situation-engine';
import { dataFreshness, type DataSourceId } from '@/services/data-freshness';
import { fetchConflictEvents, fetchUcdpClassifications, fetchHapiSummary, fetchUcdpEvents, deduplicateAgainstAcled, fetchIranEvents } from '@/services/conflict';
import { fetchUnhcrPopulation } from '@/services/displacement';
import { fetchClimateAnomalies } from '@/services/climate';
import { fetchSecurityAdvisories } from '@/services/security-advisories';
import { fetchTelegramFeed } from '@/services/telegram-intel';
import { fetchOrefAlerts, startOrefPolling, stopOrefPolling, onOrefAlertsUpdate } from '@/services/oref-alerts';
import { enrichEventsWithExposure } from '@/services/population-exposure';
import { getTopActiveGeoHubs } from '@/services/geo-activity';
import { getTopActiveHubs } from '@/services/tech-activity';
import { debounce, getCircuitBreakerCooldownInfo } from '@/utils';
import { isFeatureAvailable } from '@/services/runtime-config';
import { getApiBaseUrl } from '@/services/runtime';
import { getAiFlowSettings } from '@/services/ai-flow-settings';
import { t, getCurrentLanguage } from '@/services/i18n';
import { getHydratedData } from '@/services/bootstrap';
import { canQueueAiClassification, AI_CLASSIFY_MAX_PER_FEED } from '@/services/ai-classify-queue';
import { classifyWithAI } from '@/services/threat-classifier';
import { getTunedParam } from '@/services/algorithms/tunable-params-store';
import { ingestHeadlines } from '@/services/trending-keywords';
import type { ListFeedDigestResponse } from '@/generated/client/crystalball/news/v1/service_client';
import type { GetSectorSummaryResponse } from '@/generated/client/crystalball/market/v1/service_client';
import { maybeShowDownloadBanner } from '@/components/DownloadBanner';
import { mountCommunityWidget } from '@/components/CommunityWidget';
import { ResearchServiceClient } from '@/generated/client/crystalball/research/v1/service_client';
import {
  MarketPanel,
  HeatmapPanel,
  CommoditiesPanel,
  CryptoPanel,
  PredictionPanel,
  MonitorPanel,
  InsightsPanel,
  CIIPanel,
  StrategicPosturePanel,
  EconomicPanel,
  TechReadinessPanel,
  UcdpEventsPanel,
  DisplacementPanel,
  ClimateAnomalyPanel,
  PopulationExposurePanel,
  TsunamiAlertsPanel,
  TropicalCyclonesPanel,
  FoodInsecurityPanel,
  TradePolicyPanel,
  SupplyChainPanel,
  SecurityAdvisoriesPanel,
  OrefSirensPanel,
  TelegramIntelPanel,
} from '@/components';
import { SatelliteFiresPanel } from '@/components/SatelliteFiresPanel';
import { EarthquakesPanel } from '@/components/EarthquakesPanel';
import { CyberThreatPanel } from '@/components/CyberThreatPanel';
import { AlertCenterPanel } from '@/components/AlertCenterPanel';
import { InfrastructurePanel } from '@/components/InfrastructurePanel';
import { fetchNearbyInfrastructure } from '@/services/infrastructure/hifld';
import { fetchIodaOutages } from '@/services/internet-outages';
import { AirstrikesPanel } from '@/components/AirstrikesPanel';
import { fetchAirstrikes } from '@/services/airstrikes';
import { updateFromFlights } from '@/services/strike-packages';
import { StrikePackagePanel } from '@/components/StrikePackagePanel';
import { DodContractsPanel } from '@/components/DodContractsPanel';
import { fetchDodContracts } from '@/services/dod-contracts';
import { WikidataBasesPanel } from '@/components/WikidataBasesPanel';
import { fetchWikidataBases } from '@/services/wikidata-bases';
import { fetchS2Underground } from '@/services/s2-underground';
import { fetchThreatFoxIOCs, fetchOpenPhishFeed, fetchSpamhausDrop, fetchCisaKev, fetchOtxIOCs, fetchPhishStatsFeed } from '@/services/cyber-extra';
// Space, disease, and humanitarian loaders live in ./loaders/ — no direct imports here.
import { fetchGlobalAirQuality } from '@/services/air-quality';
import { fetchInciwebIncidents } from '@/services/inciweb';
import { fetchHazmatIncidents } from '@/services/hazmat-incidents';
import { classifyNewsItem } from '@/services/positive-classifier';
import { fetchGivingSummary } from '@/services/giving';
import { fetchNWSAlerts, type NWSAlert } from '@/services/nws-alerts';
import { routeWeatherAlert } from '@/services/weather/weather-warning-router';
import { deliveryPriorityRank } from '@/services/weather/weather-urgency';
import type { NwsAlertMinimal, AlertPolygon } from '@/services/weather/weather-threat-types';
import type { WeatherThreatCandidate } from '@/services/weather/personal-weather-status';
import { recordWarningPredictions } from '@/services/weather/warning-verification-bridge';
import { fetchFAACameras, scoreCamerasAgainstAlerts, getDisasterProximateCameras } from '@/services/faa-cameras';
import { FAAWeatherCamsPanel } from '@/components/FAAWeatherCamsPanel';
import { fetchAdsbSnapshot } from '@/services/adsb';
import type { AirTrafficPanel } from '@/components/AirTrafficPanel';
import { fetchRipeAtlasStatus } from '@/services/ripe-atlas';
import type { RipeAtlasPanel } from '@/components/RipeAtlasPanel';
import { fetchRipeNccStatus } from '@/services/ripe-ncc';
import type { RipeNccPanel } from '@/components/RipeNccPanel';
import { updateRegionCount, getHighRiskRegions } from '@/services/ema-forecast';
import { countryIso3Slug } from '@/services/intelligence/entity-slug';
import { GDACSAlertsPanel } from '@/components/GDACSAlertsPanel';
import { NWSAlertsPanel } from '@/components/NWSAlertsPanel';
import { GivingPanel } from '@/components';
import { GeoHubsPanel } from '@/components/GeoHubsPanel';
import { TechHubsPanel } from '@/components/TechHubsPanel';
import { fetchProgressData } from '@/services/progress-data';
import { fetchConservationWins } from '@/services/conservation-data';
import { fetchRenewableEnergyData, fetchEnergyCapacity } from '@/services/renewable-energy-data';
import { checkMilestones } from '@/services/celebration';
import { fetchHappinessScores } from '@/services/happiness-data';
import { fetchRenewableInstallations } from '@/services/renewable-installations';
import { filterBySentiment } from '@/services/sentiment-gate';
import { fetchAllPositiveTopicIntelligence } from '@/services/gdelt-intel';
import { fetchPositiveGeoEvents, geocodePositiveNewsItems } from '@/services/positive-events-geo';
import { fetchKindnessData } from '@/services/kindness-data';
import { getPersistentCache, setPersistentCache } from '@/services/persistent-cache';
import { withOfflineCache, registerCriticalSources, feedFreshnessFromSnapshot } from '@/services/offline-alert-cache';
import {
  ingestCyberToIoc, ingestCisaKevToIoc,
  ingestAisToDarkVessel, ingestMilVesselsToDarkVessel,
  checkGeofenceEarthquakes, checkGeofenceProtests, checkGeofenceCyber, checkGeofenceAirstrikes, checkGeofenceMilitary,
  ingestGpsToSigint, ingestCableToSigint, ingestOutagesToSigint,
  ingestEarthquakesToPoL, ingestProtestsToPoL, ingestCyberToPoL, rollPoLBaseline,
  ingestCyberToKillChain,
  ingestCyberToConvergence, ingestOutagesToConvergence, ingestAirstrikesToConvergence,
  ingestMilFlightsToOrbat, ingestMilVesselsToOrbat,
  ingestOutagesToTopology, ingestCableToTopology,
  ingestCisaToIcsOt,
  initModeTracking,
  ingestCyberToGraph, ingestMilFlightsToGraph, ingestMilVesselsToGraph,
  ingestEarthquakesToTimeline, ingestCyberToTimeline, ingestAirstrikesToTimeline,
  updateCompoundThreatLevels,
  ingestEarthquakesToMatrix, ingestCyberToMatrix, ingestAirstrikesToMatrix,
  checkVesselsAgainstSanctions,
} from '@/services/intel-pipeline';
import { fetchNewsApiHeadlines } from '@/services/newsapi';
import { fetchNewsDataFeed } from '@/services/newsdata';
import type { ThreatLevel as ClientThreatLevel } from '@/services/threat-classifier';
import type { NewsItem as ProtoNewsItem, ThreatLevel as ProtoThreatLevel } from '@/generated/client/crystalball/news/v1/service_client';
import { fetchIswReports } from '@/services/isw-reports';
import { IswReportsPanel } from '@/components/IswReportsPanel';
import { NatoNewsPanel } from '@/components/NatoNewsPanel';
import { DodNewsPanel } from '@/components/DodNewsPanel';
import { ReliefWebPanel } from '@/components/ReliefWebPanel';
import { BellingcatPanel } from '@/components/BellingcatPanel';
import { FcdoWarningsPanel } from '@/components/FcdoWarningsPanel';
import { DfatWarningsPanel } from '@/components/DfatWarningsPanel';
import { GacWarningsPanel } from '@/components/GacWarningsPanel';
import { GovConvergencePanel } from '@/components/GovConvergencePanel';
import { EmscSeismicPanel } from '@/components/EmscSeismicPanel';
import { AcapsPanel } from '@/components/AcapsPanel';
import { LiveUaMapPanel } from '@/components/LiveUaMapPanel';
import { AerospaceReentryPanel } from '@/components/AerospaceReentryPanel';
import { AmtrakAlertsPanel } from '@/components/AmtrakAlertsPanel';
import { AvalancheHazardPanel } from '@/components/AvalancheHazardPanel';
import { DscaArmsPanel } from '@/components/DscaArmsPanel';
import { EcdcSurveillancePanel } from '@/components/EcdcSurveillancePanel';
import { FdicFailuresPanel } from '@/components/FdicFailuresPanel';
import { HabsosPanel } from '@/components/HabsosPanel';
import { UnSecurityCouncilPanel } from '@/components/UnSecurityCouncilPanel';
import { WildfireSmokePanel } from '@/components/WildfireSmokePanel';
import { CentralBankCalendarPanel } from '@/components/CentralBankCalendarPanel';
import { fetchNatoNews } from '@/services/nato-news';
import { fetchDodNews } from '@/services/dod-news';
import { fetchReliefWebCrises } from '@/services/reliefweb';
import { fetchBellingcatOsint } from '@/services/bellingcat';
import { fetchFcdoWarnings, fetchDfatWarnings, fetchGacWarnings, fetchGovWarningConvergence, getConvergenceAlerts } from '@/services/travel-warnings';
import { fetchEmscSeismic } from '@/services/emsc-seismic';
import { fetchAcapsCrises } from '@/services/acaps';
import { fetchLiveUaMap } from '@/services/liveuamap';
import { fetchDebrisReentries } from '@/services/aerospace-reentry';
import { fetchAmtrakAlerts } from '@/services/amtrak-alerts';
import { fetchAvalancheHazard } from '@/services/avalanche-hazard';
import { fetchArmsTransfers } from '@/services/dsca-arms-transfers';
import { fetchEcdcAlerts } from '@/services/ecdc-surveillance';
import { fetchBankFailures } from '@/services/fdic-failures';
import { fetchHabObservations } from '@/services/habsos';
import { fetchUnSecurityCouncil } from '@/services/un-security-council';
import { fetchWildfireSmoke } from '@/services/wildfire-smoke';
import { getUpcomingMeetings } from '@/services/central-bank-calendar';
import { fetchCongressDefense } from '@/services/congress-defense';
import { fetchCombatantCommands } from '@/services/combatant-commands';
import { fetchForeignMilNews } from '@/services/foreign-mil-news';
import { fetchMesoscaleDiscussions } from '@/services/spc-mesoscale';
import { showApiKeyGate } from '@/components/api-key-gate';
import { detectCompoundThreats, toHazardSignal } from '@/services/compound-threat';
import { detectWeatherThreatConvergence } from '@/services/weather-threat-convergence';
import { analyzeWeatherImpacts, weatherToSupplyChainSignals } from '@/services/weather-impact';
import { ingestEvent as ingestCorrelationMatrix, classifyRegion, getGlobalScore as getMatrixGlobalScore } from '@/services/correlation-matrix';
import { ingestWeatherAnomalySignals, ingestMatrixScoreSignal, anomalyEngine } from '@/services/anomaly-detection';
import { notificationDispatcher } from '@/services/notification-dispatcher';
import { initWebhookDispatcher } from '@/services/webhook-dispatcher';
import { detectStrikePackages } from '@/services/strike-package';
import { fetchSatelliteCatalog } from '@/services/satellite-catalog';
import { satellitePropagator } from '@/services/satellite-propagator';
import { unifiedAlertStore } from '@/services/unified-alerts';
import { ingestEarthquakesUnified, ingestCyberThreatsUnified } from '@/services/unified-ingestors';
import {
  normalizeBreakingAlert,
  normalizeNWSAlert,
  normalizeGDACSEvent,
  normalizeTsunamiAlert,
  normalizeResourceAlert,
} from '@/services/alert-normalizer';
import type { ResourceAlertDetail } from '@/services/alert-normalizer';
import type { BreakingAlert } from '@/services/breaking-news-alerts';
import { fetchFloodGauges } from '@/services/flood-gauges';
import { fetchExtendedForecast } from '@/services/extended-forecast';
import { fetchRadarFrames } from '@/services/rainviewer-radar';
import { fetchTidePredictions, TIDE_STATIONS } from '@/services/tide-predictions';
import { fetchPollenData } from '@/services/pollen';
import { fetchRedFlagWarnings, fetchFireWeatherOutlook } from '@/services/red-flag-warnings';
import { fetchLightningStrikes } from '@/services/lightning';
import type { ExtendedForecastPanel } from '@/components/ExtendedForecastPanel';
import type { WeatherRadarPanel } from '@/components/WeatherRadarPanel';
import type { TidePredictionsPanel } from '@/components/TidePredictionsPanel';
import type { PollenPanel } from '@/components/PollenPanel';
import type { GoesSatellitePanel } from '@/components/GoesSatellitePanel';
import type { NeoTrackerPanel } from '@/components/NeoTrackerPanel';
import type { FloodMonitorPanel } from '@/components/FloodMonitorPanel';
import type { IntelligenceFeedPanel } from '@/components/IntelligenceFeedPanel';
import { ingest } from '@/services/intelligence/observation-store';
import type { ObservationEvent } from '@/types/intelligence';
import { fetchDamSafetyAlerts } from '@/services/dam-safety';
import { fetchPowerGridAlerts } from '@/services/power-grid-alerts';
import { fetchGridStatus } from '@/services/power-grid';
import { getDatacenterSite, setDatacenterSite, recomputeDatacenterPosture } from '@/services/datacenter/datacenter-state';
import { toIsoString } from '@/services/weather/weather-exposure';
import type { PowerContext } from '@/services/infrastructure/osm-power';
import {
  fetchOpenMeteoConditions,
  fetchSite24hForecast,
  fetchSiteAirQuality,
  fetchConnectivitySignal,
  getWeatherAlertsFeedState,
  isWeatherFeedFresh,
  isAlertSpatiallyUnevaluable,
} from '@/services/weather';
import { fetchGreyNoise, fetchOtxPulses, fetchAbuseIpDb, fetchUrlscanFeed } from '@/services/osint';
import { fetchAcledEvents, fetchAdsbMilitary } from '@/services/osint';
import { fetchHibpBreaches, fetchTorMetrics } from '@/services/osint';
import { fetchWorldBankProfile } from '@/services/world-bank';
import type { ThreatIntelHubPanel } from '@/components/ThreatIntelHubPanel';
import type { GeoIntelPanel } from '@/components/GeoIntelPanel';
import type { DarkWebPanel } from '@/components/DarkWebPanel';
// ── Extracted loader modules ──
// Single-source fetch → panel-update flows live in domain files under
// ./loaders/. DataLoader keeps thin wrappers that bind `this.ctx` + the
// compound-threat callback so the App.ts refresh scheduler registrations
// don't have to change.
import * as spaceLoaders from '@/app/loaders/space';
import * as utilityLoaders from '@/app/loaders/utility';
import * as hazardLoaders from '@/app/loaders/hazards';
import * as diseaseLoaders from '@/app/loaders/disease';
import * as cyberLoaders from '@/app/loaders/cyber';
import { earthquakesToObservations } from '@/services/intelligence/adapters/earthquake-adapter';
import {
  getLatestFusion,
  recordDomainObservations,
} from '@/services/providers/fusion-publish';
import { usgsEarthquakesToObservations, emscEventsToObservations } from '@/services/earthquake/earthquake-fusion-observations';
import { openMeteoAqToObservations, openaqToObservations } from '@/services/airquality/airquality-fusion-observations';
import { exchangePricesToObservations } from '@/services/market/crypto-fusion-observations';
import { fetchCoinbasePrices } from '@/services/market/coinbase-fetch';
import { fetchFinnhubPrices, fetchYahooPrices } from '@/services/market/stock-fetch';
import { fetchCoingeckoPrices } from '@/services/market/coingecko-fetch';
import { recordFusedSpotPrices } from '@/services/market/spot-price-store';
import { fetchOpenaqWorstReadings } from '@/services/airquality/openaq-worst-fetch';
import { aisDisruptionsToObservations, adsbTrackToObservation } from '@/services/intelligence/adapters/ais-adapter';
import { forecastToObservations, type OpenMeteoHourlyForecast } from '@/services/intelligence/adapters/weather-forecast-adapter';
import { floodGaugesToObservations, type NOAACoopsResponse } from '@/services/intelligence/adapters/flood-gauge-adapter';
import { riverDischargeToObservations, type OpenMeteoFloodForecast } from '@/services/intelligence/adapters/river-discharge-adapter';
import { marineForecastToObservations, type OpenMeteoMarineForecast } from '@/services/intelligence/adapters/marine-forecast-adapter';
import { fewsNetToObservations, hdxHapiToObservations, type FEWSNETResponse, type HDXHAPIResponse } from '@/services/intelligence/adapters/food-security-adapter';
import { ingest as ingestObservations, getRecent as getRecentObservations } from '@/services/intelligence/observation-store';
import {
  airstrikesToObservations,
  conflictEventsToObservations,
  createConflictObservationDeduper,
  newsClustersToObservations,
  orefAlertsToObservations,
  unrestEventsToObservations,
  ucdpEventsToObservations,
} from '@/services/intelligence/conflict-observation-adapters';
import { slog } from '@/services/structured-log';

const PROTO_TO_CLIENT_LEVEL: Record<ProtoThreatLevel, ClientThreatLevel> = {
  THREAT_LEVEL_UNSPECIFIED: 'info',
  THREAT_LEVEL_LOW: 'low',
  THREAT_LEVEL_MEDIUM: 'medium',
  THREAT_LEVEL_HIGH: 'high',
  THREAT_LEVEL_CRITICAL: 'critical',
};

// Stable dedupe key for an NWS alert. Prefers the official alert id (unique
// per issuance — an updated/re-issued warning gets a fresh id and re-notifies);
// Convert an NWS GeoJSON geometry (Polygon / MultiPolygon) to an AlertPolygon's
// ring list so the saved-place matcher can run point-in-polygon. Returns
// undefined for missing / non-polygon / degenerate geometry.
function alertPolygonFromGeoJson(geometry: { type: string; coordinates: unknown } | null | undefined): AlertPolygon | undefined {
  if (!geometry || !Array.isArray(geometry.coordinates)) return undefined;
  let rings: unknown;
  if (geometry.type === 'Polygon') rings = geometry.coordinates;
  else if (geometry.type === 'MultiPolygon') rings = (geometry.coordinates as unknown[]).flat();
  else return undefined;
  if (!Array.isArray(rings) || rings.length === 0) return undefined;
  const first = rings[0];
  if (!Array.isArray(first) || first.length < 3) return undefined;
  return { rings: rings as AlertPolygon['rings'] };
}

function nwsAlertMinimal(alert: NWSAlert): NwsAlertMinimal {
  const messageType = alert.messageType?.trim().toLowerCase();
  return {
    id: alert.id,
    event: alert.event,
    sent: alert.sent ?? alert.onset ?? alert.expires,
    expires: alert.expires,
    severity: (alert.severity?.toLowerCase() ?? 'unknown') as NwsAlertMinimal['severity'],
    messageType:
      messageType === 'alert'
      || messageType === 'update'
      || messageType === 'cancel'
        ? messageType
        : messageType ? 'unknown' : undefined,
    polygon: alertPolygonFromGeoJson(alert.geometry),
    headline: alert.headline,
  };
}

// falls back to a hash of headline+area when the id is missing so a long-lived
// warning still maps to one stable key across refreshes.
function weatherAlertDedupeKey(alert: { id?: string; headline?: string; event?: string; areaDesc?: string }): string {
  if (alert.id) return `nws-${alert.id}`;
  const basis = `${alert.headline ?? alert.event ?? ''}|${alert.areaDesc ?? ''}`;
  let hash = 5381;
  for (const ch of basis) hash = (hash * 33 + (ch.codePointAt(0) ?? 0)) % 2_147_483_647;
  return `nws-h${hash.toString(36)}`;
}

// A long-lived NWS warning keeps reappearing in every fetch. Re-notify at most
// once per this window so the user gets a periodic reminder, not spam each cycle.
const WEATHER_NOTIFY_DEDUPE_WINDOW_MS = 60 * 60 * 1000;

function protoItemToNewsItem(p: ProtoNewsItem): NewsItem {
  const level = PROTO_TO_CLIENT_LEVEL[p.threat?.level ?? 'THREAT_LEVEL_UNSPECIFIED'];
  return {
 source: p.source,
 title: p.title,
 link: p.link,
 pubDate: new Date(p.publishedAt),
 isAlert: p.isAlert,
 threat: p.threat ? {
 level,
 category: p.threat.category as import('@/services/threat-classifier').EventCategory,
 confidence: p.threat.confidence,
 source: (p.threat.source || 'keyword') as 'keyword' | 'ml' | 'llm',
 } : undefined,
 ...(p.locationName && { locationName: p.locationName }),
 ...(p.location && { lat: p.location.latitude, lon: p.location.longitude }),
  };
}

const CYBER_LAYER_ENABLED = import.meta.env.VITE_ENABLE_CYBER_LAYER === 'true';

// Cache of derived UGC zones per `${lat},${lon}` so the datacenter posture
// loop resolves a site's forecast/county zones once instead of hitting NWS
// `/points` on every weather refresh.
const _siteUgcZoneCache = new Map<string, string[]>();

// Cache OSM grid infrastructure per `${lat},${lon}` — Overpass is rate-limited,
// so the datacenter loop reuses a site's plants/substations/lines for 6h rather
// than refetching on every weather refresh.
const _siteGridInfraCache = new Map<string, { ctx: PowerContext; at: number }>();
const GRID_INFRA_TTL_MS = 6 * 60 * 60 * 1000;
async function resolveGridInfrastructure(lat: number, lon: number): Promise<PowerContext | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = _siteGridInfraCache.get(key);
  if (cached && Date.now() - cached.at < GRID_INFRA_TTL_MS) return cached.ctx;
  try {
    const { fetchSitePowerContext } = await import('@/services/infrastructure/osm-power-source');
    const ctx = await fetchSitePowerContext(lat, lon, 25);
    _siteGridInfraCache.set(key, { ctx, at: Date.now() });
    return ctx;
  } catch {
    return cached?.ctx ?? null;
  }
}

export interface DataLoaderCallbacks {
  renderCriticalBanner: (postures: TheaterPostureSummary[]) => void;
}

export class DataLoaderManager implements AppModule {
  private ctx: AppContext;
  private callbacks: DataLoaderCallbacks;

  private mapFlashCache = new Map<string, number>();
  private readonly dedupeConflictObservations =
    createConflictObservationDeduper();
  private readonly MAP_FLASH_COOLDOWN_MS = 10 * 60 * 1000;
  private _lastFlashCleanup = 0;
  private readonly applyTimeRangeFilterToNewsPanelsDebounced = debounce(() => {
 this.applyTimeRangeFilterToNewsPanels();
  }, 120);

  public updateSearchIndex: () => void = () => {};

  private digestBreaker = { state: 'closed' as 'closed' | 'open' | 'half-open', failures: 0, cooldownUntil: 0 };
  private lastGoodDigest: ListFeedDigestResponse | null = null;

  constructor(ctx: AppContext, callbacks: DataLoaderCallbacks) {
 this.ctx = ctx;
 this.callbacks = callbacks;
  }

  init(): void {
 // Pre-register critical data sources for offline cache status tracking
 registerCriticalSources();

 // Wire AAR auto-creation on mode transitions
 initModeTracking();

 // Subscribe to anomaly detections → dispatch critical anomalies as notifications
 anomalyEngine.subscribe((anomaly) => {
 if (anomaly.severity === 'critical') {
 notificationDispatcher.dispatchAnomalyAlert(anomaly);
 }
 });

 // Wire outbound webhook dispatcher (Slack / Discord / generic)
 initWebhookDispatcher();

 // Bridge breaking-news events into the unified alert store
 document.addEventListener('wm:breaking-news', (e: Event) => {
 const alert = (e as CustomEvent<BreakingAlert>).detail;
 if (alert) unifiedAlertStore.ingest([normalizeBreakingAlert(alert)]);
 });

 // Bridge resource depletion alerts into the unified alert store
 document.addEventListener('wm:resource-alert', (e: Event) => {
 const detail = (e as CustomEvent<ResourceAlertDetail>).detail;
 if (detail) unifiedAlertStore.ingest([normalizeResourceAlert(detail)]);
 });

 // Disaster-proximate FAA cameras — informs the panel's disaster
 // mode badge so cameras near severe weather are highlighted, but
 // does NOT touch the map's camera layer. The full
 // `loadFAACameras()` task already populates the map with every
 // scored camera; overwriting it here used to clear the map down
 // to the disaster subset (or to [] when no severe disasters were
 // active), which is why FAA cams disappeared from the map at
 // startup.
 void (async () => {
 try {
 const [raw, nwsResult, gdacsResult] = await Promise.all([
 fetchFAACameras(),
 withOfflineCache('nws-alerts', () => fetchNWSAlerts(), 1 * 60 * 60 * 1000),
 withOfflineCache('gdacs-events', () => fetchGDACSEvents(), 1 * 60 * 60 * 1000),
 ]);
 const proximate = getDisasterProximateCameras(raw, nwsResult.data, gdacsResult.data);
 // Panel-side disaster badge only — map keeps the full set.
 (this.ctx.panels['faa-weather-cams'] as FAAWeatherCamsPanel | undefined)?.setDisasterMode(true, proximate);
 } catch { /* non-critical */ }
 })();
  }

  destroy(): void {
 stopOrefPolling();
  }

  private async tryFetchDigest(): Promise<ListFeedDigestResponse | null> {
 const now = Date.now();

 if (this.digestBreaker.state === 'open') {
 if (now < this.digestBreaker.cooldownUntil) {
 return this.lastGoodDigest ?? await this.loadPersistedDigest();
 }
 this.digestBreaker.state = 'half-open';
 }

 try {
 const resp = await fetch(
 `/api/news/v1/list-feed-digest?variant=${SITE_VARIANT}&lang=${getCurrentLanguage()}`,
 // 1.5s (was 3s): on a cold/keyless boot this fetch fails; the breaker + cached
 // digest take over, so a shorter wait gets the "what changed" view on screen
 // faster instead of stalling the news load for 3s × 2 attempts.
 { signal: AbortSignal.timeout(1500) },
 );
 if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
 const data = await resp.json() as ListFeedDigestResponse;
 const catCount = Object.keys(data.categories ?? {}).length;
 console.info(`[News] Digest fetched: ${catCount} categories`);
 this.lastGoodDigest = data;
 this.persistDigest(data);
 this.digestBreaker = { state: 'closed', failures: 0, cooldownUntil: 0 };
 return data;
 } catch (error) {
 console.warn('[News] Digest fetch failed, using fallback:', error);
 this.digestBreaker.failures++;
 if (this.digestBreaker.failures >= 2) {
 this.digestBreaker.state = 'open';
 this.digestBreaker.cooldownUntil = now + 60_000;
 }
 return this.lastGoodDigest ?? await this.loadPersistedDigest();
 }
  }

  private persistDigest(data: ListFeedDigestResponse): void {
 setPersistentCache('digest:last-good', data).catch(() => {});
  }

  private async loadPersistedDigest(): Promise<ListFeedDigestResponse | null> {
 try {
 const envelope = await getPersistentCache<ListFeedDigestResponse>('digest:last-good');
 if (!envelope) return null;
 if (Date.now() - envelope.updatedAt > 30 * 60 * 1000) return null;
 this.lastGoodDigest = envelope.data;
 return envelope.data;
 } catch { return null; }
  }

  private shouldShowIntelligenceNotifications(): boolean {
 return !this.ctx.isMobile && !!this.ctx.findingsBadge?.isPopupEnabled();
  }

  async loadAllData(): Promise<void> {
 const runGuarded = async (name: string, fn: () => Promise<void>): Promise<void> => {
 if (this.ctx.isDestroyed || this.ctx.inFlight.has(name)) return;
 this.ctx.inFlight.add(name);
 try {
 await fn();
 } catch (error) {
 if (!this.ctx.isDestroyed) {
   console.error(`[App] ${name} failed:`, error);
   slog('error', 'feed', `${name} failed`, { fields: { feed: name, err: String(error).slice(0, 200) } });
 }
 } finally {
 this.ctx.inFlight.delete(name);
 }
 };

 const tasks: { name: string; task: () => Promise<void> }[] = [
 { name: 'news', task: () => runGuarded('news', () => this.loadNews()) },
 ];

 // Happy variant only loads news data -- skip all geopolitical/financial/military data
 if (SITE_VARIANT !== 'happy') {
 tasks.push({ name: 'markets', task: () => runGuarded('markets', () => this.loadMarkets()) });
 tasks.push({ name: 'predictions', task: () => runGuarded('predictions', () => this.loadPredictions()) });
 tasks.push({ name: 'pizzint', task: () => runGuarded('pizzint', () => this.loadPizzInt()) });
 tasks.push({ name: 'fred', task: () => runGuarded('fred', () => this.loadFredData()) });
 tasks.push({ name: 'oil', task: () => runGuarded('oil', () => this.loadOilAnalytics()) });
 tasks.push({ name: 'spending', task: () => runGuarded('spending', () => this.loadGovernmentSpending()) });
 tasks.push({ name: 'dod-contracts', task: () => runGuarded('dod-contracts', () => this.loadDodContracts()) });
 tasks.push({ name: 'wikidata-bases', task: () => runGuarded('wikidata-bases', () => this.loadWikidataBases()) });
 tasks.push({ name: 'bis', task: () => runGuarded('bis', () => this.loadBisData()) });

 // Trade policy data (FULL and FINANCE only)
 if (SITE_VARIANT === 'full' || SITE_VARIANT === 'finance') {
 tasks.push({ name: 'tradePolicy', task: () => runGuarded('tradePolicy', () => this.loadTradePolicy()) });
 tasks.push({ name: 'supplyChain', task: () => runGuarded('supplyChain', () => this.loadSupplyChain()) });
 }
 }

 // Progress charts data (happy variant only)
 if (SITE_VARIANT === 'happy') {
 tasks.push({
 name: 'progress',
 task: () => runGuarded('progress', () => this.loadProgressData()),
 });
 tasks.push({
 name: 'species',
 task: () => runGuarded('species', () => this.loadSpeciesData()),
 });
 tasks.push({
 name: 'renewable',
 task: () => runGuarded('renewable', () => this.loadRenewableData()),
 });
 tasks.push({
 name: 'happinessMap',
 task: () => runGuarded('happinessMap', async () => {
 const data = await fetchHappinessScores();
 this.ctx.map?.setHappinessScores(data);
 }),
 });
 tasks.push({
 name: 'renewableMap',
 task: () => runGuarded('renewableMap', async () => {
 const installations = await fetchRenewableInstallations();
 this.ctx.map?.setRenewableInstallations(installations);
 }),
 });
 }

 // Global giving activity data (all variants)
 tasks.push({
 name: 'giving',
 task: () => runGuarded('giving', async () => {
 const givingResult = await fetchGivingSummary();
 if (!givingResult.ok) {
 dataFreshness.recordError('giving', 'Giving data unavailable (retaining prior state)');
 return;
 }
 const data = givingResult.data;
 (this.ctx.panels.giving as GivingPanel)?.setData(data);
 if (data.platforms.length > 0) dataFreshness.recordUpdate('giving', data.platforms.length);
 }),
 });

 if (SITE_VARIANT === 'full') {
 tasks.push({ name: 'intelligence', task: () => runGuarded('intelligence', () => this.loadIntelligenceSignals()) });
 }

 if (SITE_VARIANT === 'full') tasks.push({ name: 'firms', task: () => runGuarded('firms', () => this.loadFirmsData()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'inpeFires', task: () => runGuarded('inpeFires', () => this.loadInpeFires()) });
 if (this.ctx.mapLayers.natural) tasks.push({ name: 'natural', task: () => runGuarded('natural', () => this.loadNatural()) });
 // Weather is safety-critical: it drives the status chip + storm posture, not
 // just the map overlay. Never gate the fetch on the cosmetic `mapLayers.weather`
 // toggle — turning the layer off must not blind the user to a live storm.
 if (SITE_VARIANT !== 'happy') tasks.push({ name: 'weather', task: () => runGuarded('weather', () => this.loadWeatherAlerts()) });
 if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.ais) tasks.push({ name: 'ais', task: () => runGuarded('ais', () => this.loadAisSignals()) });
 if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.adsb) tasks.push({ name: 'adsb', task: () => runGuarded('adsb', () => this.loadAdsb()) });
 if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.cables) tasks.push({ name: 'cables', task: () => runGuarded('cables', () => this.loadCableActivity()) });
 if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.cables) tasks.push({ name: 'cableHealth', task: () => runGuarded('cableHealth', () => this.loadCableHealth()) });
 if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.flights) tasks.push({ name: 'flights', task: () => runGuarded('flights', () => this.loadFlightDelays()) });
 if (SITE_VARIANT !== 'happy' && CYBER_LAYER_ENABLED && this.ctx.mapLayers.cyberThreats) tasks.push({ name: 'cyberThreats', task: () => runGuarded('cyberThreats', () => this.loadCyberThreats()) });
 if (SITE_VARIANT !== 'happy') tasks.push({ name: 'iranAttacks', task: () => runGuarded('iranAttacks', () => this.loadIranEvents()) });
 if (SITE_VARIANT !== 'happy' && (this.ctx.mapLayers.techEvents || SITE_VARIANT === 'tech')) tasks.push({ name: 'techEvents', task: () => runGuarded('techEvents', () => this.loadTechEvents()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'spaceWeather', task: () => runGuarded('spaceWeather', () => this.loadSpaceWeather()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'spaceflightNews', task: () => runGuarded('spaceflightNews', () => this.loadSpaceflightNews()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'spaceLaunches', task: () => runGuarded('spaceLaunches', () => this.loadSpaceLaunches()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'diseaseOutbreaks', task: () => runGuarded('diseaseOutbreaks', () => this.loadDiseaseOutbreaks()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'diseaseIntel', task: () => runGuarded('diseaseIntel', () => this.loadDiseaseIntel()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'humanitarianCrises', task: () => runGuarded('humanitarianCrises', () => this.loadHumanitarianCrises()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'federalRegister', task: () => runGuarded('federalRegister', () => this.loadFederalRegister()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'airQuality', task: () => runGuarded('airQuality', () => this.loadAirQuality()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'wildfireIncidents', task: () => runGuarded('wildfireIncidents', () => this.loadWildfireIncidents()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'wildfireIntel', task: () => runGuarded('wildfireIntel', () => this.loadWildfireIntel()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'purpleAir', task: () => runGuarded('purpleAir', () => this.loadPurpleAir()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'hazmatIncidents', task: () => runGuarded('hazmatIncidents', () => this.loadHazmatIncidents()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'oilSpills', task: () => runGuarded('oilSpills', () => this.loadOilSpills()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'gdacsAlerts', task: () => runGuarded('gdacsAlerts', () => this.loadGDACSAlerts()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'floodGauges', task: () => runGuarded('floodGauges', () => this.loadFloodGauges()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'expandedIntelligence', task: () => runGuarded('expandedIntelligence', () => this.loadExpandedIntelligence()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'volcanoAlerts', task: () => runGuarded('volcanoAlerts', () => this.loadVolcanoAlerts()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'volcanoMonitor', task: () => runGuarded('volcanoMonitor', () => this.loadVolcanoMonitor()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'severeWeather', task: () => runGuarded('severeWeather', () => this.loadSevereWeather()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'shakeAlert', task: () => runGuarded('shakeAlert', () => this.loadShakeAlert()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'nwsAlerts', task: () => runGuarded('nwsAlerts', () => this.loadNWSAlerts()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'faaCameras', task: () => runGuarded('faaCameras', () => this.loadFAACameras()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'savedPlaceWeather', task: () => runGuarded('savedPlaceWeather', () => this.loadSavedPlaceWeather()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'emaForecast', task: () => runGuarded('emaForecast', () => this.runEMAForecast()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'globalWeather', task: () => runGuarded('globalWeather', () => this.loadGlobalWeather()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'openSanctions', task: () => runGuarded('openSanctions', () => this.loadOpenSanctions()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'edgarFilings', task: () => runGuarded('edgarFilings', () => this.loadEdgarFilings()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'infrastructure', task: () => runGuarded('infrastructure', () => this.loadInfrastructure()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'internetOutages', task: () => runGuarded('internetOutages', () => this.loadInternetOutages()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'iswReports', task: () => runGuarded('iswReports', () => this.loadIswReports()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'natoNews', task: () => runGuarded('natoNews', () => this.loadNatoNews()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'dodNews', task: () => runGuarded('dodNews', () => this.loadDodNews()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'reliefWeb', task: () => runGuarded('reliefWeb', () => this.loadReliefWebCrises()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'bellingcat', task: () => runGuarded('bellingcat', () => this.loadBellingcat()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'travelWarnings', task: () => runGuarded('travelWarnings', () => this.loadTravelWarnings()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'emscSeismic', task: () => runGuarded('emscSeismic', () => this.loadEmscSeismic()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'acapsCrises', task: () => runGuarded('acapsCrises', () => this.loadAcapsCrises()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'liveUaMap', task: () => runGuarded('liveUaMap', () => this.loadLiveUaMap()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'debrisReentries', task: () => runGuarded('debrisReentries', () => this.loadDebrisReentries()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'amtrakAlerts', task: () => runGuarded('amtrakAlerts', () => this.loadAmtrakAlerts()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'avalancheHazard', task: () => runGuarded('avalancheHazard', () => this.loadAvalancheHazard()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'armsTransfers', task: () => runGuarded('armsTransfers', () => this.loadArmsTransfers()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'ecdcSurveillance', task: () => runGuarded('ecdcSurveillance', () => this.loadEcdcSurveillance()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'fdicFailures', task: () => runGuarded('fdicFailures', () => this.loadFdicFailures()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'habsos', task: () => runGuarded('habsos', () => this.loadHabsos()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'unSecurityCouncil', task: () => runGuarded('unSecurityCouncil', () => this.loadUnSecurityCouncil()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'wildfireSmoke', task: () => runGuarded('wildfireSmoke', () => this.loadWildfireSmoke()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'centralBankCalendar', task: () => runGuarded('centralBankCalendar', () => this.loadCentralBankCalendar()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'congressDefense', task: () => runGuarded('congressDefense', () => this.loadCongressDefense()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'combatantCommands', task: () => runGuarded('combatantCommands', () => this.loadCombatantCommands()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'foreignMilNews', task: () => runGuarded('foreignMilNews', () => this.loadForeignMilNews()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'spcMesoscale', task: () => runGuarded('spcMesoscale', () => this.loadSpcMesoscale()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'extendedForecast', task: () => runGuarded('extendedForecast', () => this.loadExtendedForecast()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'weatherRadar', task: () => runGuarded('weatherRadar', () => this.loadWeatherRadar()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'tidePredictions', task: () => runGuarded('tidePredictions', () => this.loadTidePredictions()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'pollenData', task: () => runGuarded('pollenData', () => this.loadPollenData()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'goesSatellite', task: () => runGuarded('goesSatellite', () => this.loadGoesSatellite()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'neoTracker', task: () => runGuarded('neoTracker', () => this.loadNeoTracker()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'floodMonitor', task: () => runGuarded('floodMonitor', () => this.loadFloodMonitor()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'intelligenceFeed', task: () => runGuarded('intelligenceFeed', () => this.loadIntelligenceFeed()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'lightning', task: () => runGuarded('lightning', () => this.loadLightning()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'redFlagWarnings', task: () => runGuarded('redFlagWarnings', () => this.loadRedFlagWarnings()) });
 if (SITE_VARIANT === 'full') tasks.push({ name: 'satellites', task: () => runGuarded('satellites', () => this.loadSatellites()) });
 if (SITE_VARIANT !== 'happy') tasks.push({ name: 'threat-intel-hub', task: () => runGuarded('threat-intel-hub', () => this.loadThreatIntelHub()) });
 if (SITE_VARIANT !== 'happy') tasks.push({ name: 'geo-intel', task: () => runGuarded('geo-intel', () => this.loadGeoIntel()) });
 if (SITE_VARIANT !== 'happy') tasks.push({ name: 'dark-web', task: () => runGuarded('dark-web', () => this.loadDarkWeb()) });

 if (SITE_VARIANT === 'tech') {
 tasks.push({ name: 'techReadiness', task: () => runGuarded('techReadiness', () => (this.ctx.panels['tech-readiness'] as TechReadinessPanel)?.refresh()) });
 }

 // Two-wave loading: critical panels first, then deferred.
 const CRITICAL = new Set([
 'news', 'markets', 'weather', 'nwsAlerts', 'gdacsAlerts', 'intelligence',
 'natural', 'cyberThreats', 'predictions', 'spaceWeather', 'firms',
 ]);
 const critical = tasks.filter(t => CRITICAL.has(t.name));
 const deferred = tasks.filter(t => !CRITICAL.has(t.name));

 const limiter = createConcurrencyLimiter(12);
 const wave1 = await limiter.mapSettled(critical, t => t.task());
 wave1.forEach((result, idx) => {
 if (result.status === 'rejected') {
 console.error(`[App] ${critical[idx]?.name} load failed:`, result.reason);
 }
 });
 const wave2 = await limiter.mapSettled(deferred, t => t.task());
 wave2.forEach((result, idx) => {
 if (result.status === 'rejected') {
 console.error(`[App] ${deferred[idx]?.name} load failed:`, result.reason);
 }
 });

 this.updateSearchIndex();
 document.dispatchEvent(new CustomEvent('wm:data-refreshed'));
  }

  async loadDataForLayer(layer: keyof MapLayers): Promise<void> {
 if (this.ctx.isDestroyed || this.ctx.inFlight.has(layer)) return;
 this.ctx.inFlight.add(layer);
 this.ctx.map?.setLayerLoading(layer, true);
 try {
 switch (layer) {
 case 'natural': {
 await this.loadNatural();
 break;
 }
 case 'fires': {
 await this.loadFirmsData();
 break;
 }
 case 'weather': {
 await this.loadWeatherAlerts();
 break;
 }
 case 'outages': {
 await this.loadOutages();
 break;
 }
 case 'cyberThreats': {
 await this.loadCyberThreats();
 break;
 }
 case 'ais': {
 await this.loadAisSignals();
 break;
 }
 case 'cables': {
 await Promise.all([this.loadCableActivity(), this.loadCableHealth()]);
 break;
 }
 case 'protests': {
 await this.loadProtests();
 break;
 }
 case 'flights': {
 await this.loadFlightDelays();
 break;
 }
 case 'military': {
 await this.loadMilitary();
 break;
 }
 case 'techEvents': {
 if (import.meta.env.DEV) console.log('[loadDataForLayer] Loading techEvents...');  
 await this.loadTechEvents();
 if (import.meta.env.DEV) console.log('[loadDataForLayer] techEvents loaded');  
 break;
 }
 case 'positiveEvents': {
 await this.loadPositiveEvents();
 break;
 }
 case 'kindness': {
 this.loadKindnessData();
 break;
 }
 case 'iranAttacks': {
 await this.loadIranEvents();
 break;
 }
 case 'ucdpEvents':
 case 'displacement':
 case 'climate':
 case 'gpsJamming': {
 await this.loadIntelligenceSignals();
 break;
 }
 case 'adsb': {
 await this.loadAdsb();
 break;
 }
 case 'acledEvents':
 case 'militaryFlights': {
 await this.loadGeoIntel();
 break;
 }
 }
 } finally {
 this.ctx.inFlight.delete(layer);
 this.ctx.map?.setLayerLoading(layer, false);
 }
  }

  private findFlashLocation(title: string): { lat: number; lon: number } | null {
 const tokens = tokenizeForMatch(title);
 let bestMatch: { lat: number; lon: number; matches: number } | null = null;

 const countKeywordMatches = (keywords: string[] | undefined): number => {
 if (!keywords) return 0;
 let matches = 0;
 for (const keyword of keywords) {
 const cleaned = keyword.trim().toLowerCase();
 if (cleaned.length >= 3 && matchKeyword(tokens, cleaned)) {
 matches++;
 }
 }
 return matches;
 };

 for (const hotspot of INTEL_HOTSPOTS) {
 const matches = countKeywordMatches(hotspot.keywords);
 if (matches > 0 && (!bestMatch || matches > bestMatch.matches)) {
 bestMatch = { lat: hotspot.lat, lon: hotspot.lon, matches };
 }
 }

 for (const conflict of CONFLICT_ZONES) {
 const matches = countKeywordMatches(conflict.keywords);
 if (matches > 0 && (!bestMatch || matches > bestMatch.matches)) {
 bestMatch = { lat: conflict.center[1], lon: conflict.center[0], matches };
 }
 }

 return bestMatch;
  }

  private flashMapForNews(items: NewsItem[]): void {
 if (!this.ctx.map || !this.ctx.initialLoadComplete) return;
 if (!getAiFlowSettings().mapNewsFlash) return;
 const now = Date.now();

 if (now - this._lastFlashCleanup > 60_000) {
 this._lastFlashCleanup = now;
 for (const [key, timestamp] of this.mapFlashCache.entries()) {
   if (now - timestamp > this.MAP_FLASH_COOLDOWN_MS) {
   this.mapFlashCache.delete(key);
   }
 }
 }

 for (const item of items) {
 const cacheKey = `${item.source}|${item.link || item.title}`;
 const lastSeen = this.mapFlashCache.get(cacheKey);
 if (lastSeen && now - lastSeen < this.MAP_FLASH_COOLDOWN_MS) {
 continue;
 }

 const location = this.findFlashLocation(item.title);
 if (!location) continue;

 this.ctx.map.flashLocation(location.lat, location.lon);
 this.mapFlashCache.set(cacheKey, now);
 }
  }

  getTimeRangeWindowMs(range: TimeRange): number {
 const ranges: Record<TimeRange, number> = {
 '1h': 60 * 60 * 1000,
 '6h': 6 * 60 * 60 * 1000,
 '24h': 24 * 60 * 60 * 1000,
 '48h': 48 * 60 * 60 * 1000,
 '7d': 7 * 24 * 60 * 60 * 1000,
 'all': Infinity,
 };
 return ranges[range];
  }

  filterItemsByTimeRange(items: NewsItem[], range: TimeRange = this.ctx.currentTimeRange): NewsItem[] {
 if (range === 'all') return items;
 const cutoff = Date.now() - this.getTimeRangeWindowMs(range);
 return items.filter((item) => {
 const ts = item.pubDate instanceof Date ? item.pubDate.getTime() : new Date(item.pubDate).getTime();
 return Number.isFinite(ts) ? ts >= cutoff : true;
 });
  }

  getTimeRangeLabel(range: TimeRange = this.ctx.currentTimeRange): string {
 const labels: Record<TimeRange, string> = {
 '1h': 'the last hour',
 '6h': 'the last 6 hours',
 '24h': 'the last 24 hours',
 '48h': 'the last 48 hours',
 '7d': 'the last 7 days',
 'all': 'all time',
 };
 return labels[range];
  }

  renderNewsForCategory(category: string, items: NewsItem[]): void {
 this.ctx.newsByCategory[category] = items;
 const panel = this.ctx.newsPanels[category];
 if (!panel) return;
 const filteredItems = this.filterItemsByTimeRange(items);
 if (filteredItems.length === 0 && items.length > 0) {
 panel.renderFilteredEmpty(`No items in ${this.getTimeRangeLabel()}`);
 return;
 }
 panel.renderNews(filteredItems);
  }

  applyTimeRangeFilterToNewsPanels(): void {
 Object.entries(this.ctx.newsByCategory).forEach(([category, items]) => {
 this.renderNewsForCategory(category, items);
 });
  }

  applyTimeRangeFilterDebounced(): void {
 this.applyTimeRangeFilterToNewsPanelsDebounced();
  }

  private async loadNewsCategory(category: string, feeds: typeof FEEDS.politics, digest?: ListFeedDigestResponse | null): Promise<NewsItem[]> {
 try {
 const panel = this.ctx.newsPanels[category];

 const enabledFeeds = (feeds ?? []).filter(f => !this.ctx.disabledSources.has(f.name));
 if (enabledFeeds.length === 0) {
 delete this.ctx.newsByCategory[category];
 if (panel) panel.showError(t('common.allSourcesDisabled'));
 this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
 status: 'ok',
 itemCount: 0,
 });
 return [];
 }

 // Digest branch: server already aggregated feeds — map proto items to client types
 if (digest?.categories && category in digest.categories) {
 const enabledNames = new Set(enabledFeeds.map(f => f.name));
 const items = (digest.categories[category]?.items ?? [])
 .map(protoItemToNewsItem)
 .filter(i => enabledNames.has(i.source));

 ingestHeadlines(items.map(i => ({ title: i.title, pubDate: i.pubDate, source: i.source, link: i.link })));

 const aiCandidates = items
 .filter(i => i.threat?.source === 'keyword')
 .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
 .slice(0, AI_CLASSIFY_MAX_PER_FEED);
 for (const item of aiCandidates) {
 if (!canQueueAiClassification(item.title)) continue;
 classifyWithAI(item.title, SITE_VARIANT).then(ai => {
 if (ai && item.threat && ai.confidence > item.threat.confidence) {
 item.threat = ai;
 item.isAlert = ai.level === 'critical' || ai.level === 'high';
 }
 }).catch(() => {});
 }

 checkBatchForBreakingAlerts(items);
 this.flashMapForNews(items);
 this.renderNewsForCategory(category, items);

 this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
 status: 'ok',
 itemCount: items.length,
 });

 if (panel) {
 try {
 const baseline = await updateBaseline(`news:${category}`, items.length);
 const deviation = calculateDeviation(items.length, baseline);
 panel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
 } catch (error) { console.warn(`[Baseline] news:${category} write failed:`, error); }
 }

 return items;
 }

 // Per-feed fallback: fetch each feed individually (first load or digest unavailable)
 const renderIntervalMs = 100;
 let lastRenderTime = 0;
 let renderTimeout: ReturnType<typeof setTimeout> | null = null;
 let pendingItems: NewsItem[] | null = null;

 const flushPendingRender = () => {
 if (!pendingItems) return;
 this.renderNewsForCategory(category, pendingItems);
 pendingItems = null;
 lastRenderTime = Date.now();
 };

 const scheduleRender = (partialItems: NewsItem[]) => {
 if (!panel) return;
 pendingItems = partialItems;
 const elapsed = Date.now() - lastRenderTime;
 if (elapsed >= renderIntervalMs) {
 if (renderTimeout) {
 clearTimeout(renderTimeout);
 renderTimeout = null;
 }
 flushPendingRender();
 return;
 }

 if (!renderTimeout) {
 renderTimeout = setTimeout(() => {
 renderTimeout = null;
 flushPendingRender();
 }, renderIntervalMs - elapsed);
 }
 };

 const { data: items } = await withOfflineCache(`news-rss:${category}`, () => fetchCategoryFeeds(enabledFeeds, {
 onBatch: (partialItems) => {
 scheduleRender(partialItems);
 this.flashMapForNews(partialItems);
 checkBatchForBreakingAlerts(partialItems);
 },
 }), 2 * 60 * 60 * 1000);

 this.renderNewsForCategory(category, items);
 if (panel) {
 if (renderTimeout) {
 clearTimeout(renderTimeout);
 renderTimeout = null;
 pendingItems = null;
 }

 if (items.length === 0) {
 const failures = getFeedFailures();
 const failedFeeds = enabledFeeds.filter(f => failures.has(f.name));
 if (failedFeeds.length > 0) {
 const names = failedFeeds.map(f => f.name).join(', ');
 panel.showError(`${t('common.noNewsAvailable')} (${names} failed)`);
 }
 }

 try {
 const baseline = await updateBaseline(`news:${category}`, items.length);
 const deviation = calculateDeviation(items.length, baseline);
 panel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
 } catch (error) { console.warn(`[Baseline] news:${category} write failed:`, error); }
 }

 this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
 status: 'ok',
 itemCount: items.length,
 });
 this.ctx.statusPanel?.updateApi('RSS2JSON', { status: 'ok' });

 return items;
 } catch (error) {
 this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
 status: 'error',
 errorMessage: String(error),
 });
 this.ctx.statusPanel?.updateApi('RSS2JSON', { status: 'error' });
 delete this.ctx.newsByCategory[category];
 return [];
 }
  }

  async loadNews(): Promise<void> {
 // Reset happy variant accumulator for fresh pipeline run
 if (SITE_VARIANT === 'happy') {
 this.ctx.happyAllItems = [];
 }

 // Fire digest fetch early (non-blocking) — await before category loop
 const digestPromise = this.tryFetchDigest();

 const categories = Object.entries(FEEDS)
 .filter((entry): entry is [string, typeof FEEDS[keyof typeof FEEDS]] => Array.isArray(entry[1]) && entry[1].length > 0)
 .map(([key, feeds]) => ({ key, feeds }));

 const digest = await digestPromise;

 const maxCategoryConcurrency = SITE_VARIANT === 'tech' ? 4 : 5;
 const categoryConcurrency = Math.max(1, Math.min(maxCategoryConcurrency, categories.length));
 const categoryResults: PromiseSettledResult<NewsItem[]>[] = [];
 for (let i = 0; i < categories.length; i += categoryConcurrency) {
 const chunk = categories.slice(i, i + categoryConcurrency);
 const chunkResults = await Promise.allSettled(
 chunk.map(({ key, feeds }) => this.loadNewsCategory(key, feeds, digest))
 );
 categoryResults.push(...chunkResults);
 }

 const collectedNews: NewsItem[] = [];
 categoryResults.forEach((result, idx) => {
 if (result.status === 'fulfilled') {
 const items = result.value;
 // Tag items with content categories for happy variant
 if (SITE_VARIANT === 'happy') {
 for (const item of items) {
 item.happyCategory = classifyNewsItem(item.source, item.title);
 }
 // Accumulate curated items for the positive news pipeline
 this.ctx.happyAllItems = this.ctx.happyAllItems.concat(items);
 }
 collectedNews.push(...items);
 } else {
 console.error(`[App] News category ${categories[idx]?.key} failed:`, result.reason);
 }
 });

 if (SITE_VARIANT === 'full') {
 const enabledIntelSources = INTEL_SOURCES.filter(f => !this.ctx.disabledSources.has(f.name));
 const intelPanel = this.ctx.newsPanels.intel;
 if (enabledIntelSources.length === 0) {
 delete this.ctx.newsByCategory.intel;
 if (intelPanel) intelPanel.showError(t('common.allIntelSourcesDisabled'));
 this.ctx.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: 0 });
 } else if (digest?.categories && 'intel' in digest.categories) {
 // Digest branch for intel
 const enabledNames = new Set(enabledIntelSources.map(f => f.name));
 const intel = (digest.categories.intel?.items ?? [])
 .map(protoItemToNewsItem)
 .filter(i => enabledNames.has(i.source));
 checkBatchForBreakingAlerts(intel);
 this.renderNewsForCategory('intel', intel);
 if (intelPanel) {
 try {
 const baseline = await updateBaseline('news:intel', intel.length);
 const deviation = calculateDeviation(intel.length, baseline);
 intelPanel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
 } catch (error) { console.warn('[Baseline] news:intel write failed:', error); }
 }
 this.ctx.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: intel.length });
 collectedNews.push(...intel);
 this.flashMapForNews(intel);
 } else {
 const intelResult = await Promise.allSettled([fetchCategoryFeeds(enabledIntelSources)]);
 if (intelResult[0]?.status === 'fulfilled') {
 const intel = intelResult[0].value;
 checkBatchForBreakingAlerts(intel);
 this.renderNewsForCategory('intel', intel);
 if (intelPanel) {
 try {
 const baseline = await updateBaseline('news:intel', intel.length);
 const deviation = calculateDeviation(intel.length, baseline);
 intelPanel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
 } catch (error) { console.warn('[Baseline] news:intel write failed:', error); }
 }
 this.ctx.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: intel.length });
 collectedNews.push(...intel);
 this.flashMapForNews(intel);
 } else {
 delete this.ctx.newsByCategory.intel;
 console.error('[App] Intel feed failed:', intelResult[0]?.reason);
 }
 }
 }

 // Augment with NewsAPI and NewsData headlines (non-blocking, best-effort)
 const [newsApiItems, newsDataItems] = await Promise.all([
 fetchNewsApiHeadlines('geopolitics world conflict crisis', 15).catch(() => [] as typeof collectedNews),
 fetchNewsDataFeed('world news geopolitics').catch(() => [] as typeof collectedNews),
 ]);
 collectedNews.push(...newsApiItems, ...newsDataItems);

 this.ctx.allNews = collectedNews;
 this.ctx.initialLoadComplete = true;
 maybeShowDownloadBanner();
 mountCommunityWidget();
 updateAndCheck([
 { type: 'news', region: 'global', count: collectedNews.length },
 ]).then(anomalies => {
 if (anomalies.length > 0) {
 signalAggregator.ingestTemporalAnomalies(anomalies);
 ingestTemporalAnomaliesForCII(anomalies);
 (this.ctx.panels.cii as CIIPanel)?.refresh();
 }
 }).catch(() => {});

 this.ctx.map?.updateHotspotActivity(this.ctx.allNews);

 this.updateMonitorResults();

 try {
 this.ctx.latestClusters = mlWorker.isAvailable
 ? await clusterNewsHybrid(this.ctx.allNews)
 : await analysisWorker.clusterNews(this.ctx.allNews);

 if (this.ctx.latestClusters.length > 0) {
 const insightsPanel = this.ctx.panels.insights as InsightsPanel | undefined;
 insightsPanel?.updateInsights(this.ctx.latestClusters);
 const conflictNews = this.dedupeConflictObservations(
   newsClustersToObservations(this.ctx.latestClusters),
 );
 if (conflictNews.length > 0) ingestObservations(conflictNews);
 }

 const geoLocated = this.ctx.latestClusters
 .filter((c): c is typeof c & { lat: number; lon: number } => c.lat != undefined && c.lon != undefined)
 .map(c => ({
 lat: c.lat,
 lon: c.lon,
 title: c.primaryTitle,
 threatLevel: c.threat?.level ?? 'info',
 timestamp: c.lastUpdated,
 }));
 if (geoLocated.length > 0) {
 this.ctx.map?.setNewsLocations(geoLocated);
 }

 if (SITE_VARIANT === 'tech') {
 const techActivities = getTopActiveHubs(this.ctx.latestClusters);
 this.ctx.map?.setTechActivity(techActivities);
 (this.ctx.panels['tech-hubs'] as TechHubsPanel | undefined)?.setActivities(techActivities);
 }

 if (SITE_VARIANT === 'full') {
 const geoActivities = getTopActiveGeoHubs(this.ctx.latestClusters);
 this.ctx.map?.setGeoActivity(geoActivities);
 (this.ctx.panels['geo-hubs'] as GeoHubsPanel | undefined)?.setActivities(geoActivities);
 }
 } catch (error) {
 console.error('[App] Clustering failed, clusters unchanged:', error);
 }

 // Happy variant: run multi-stage positive news pipeline + map layers
 if (SITE_VARIANT === 'happy') {
 await this.loadHappySupplementaryAndRender();
 await Promise.allSettled([
 this.ctx.mapLayers.positiveEvents ? this.loadPositiveEvents() : Promise.resolve(),
 this.ctx.mapLayers.kindness ? Promise.resolve(this.loadKindnessData()) : Promise.resolve(),
 ]);
 }
  }

  async loadMarkets(): Promise<void> {
 try {
 const { data: stocksResult } = await withOfflineCache('market-data', () => fetchMultipleStocks(MARKET_SYMBOLS, {
 onBatch: (partialStocks) => {
 this.ctx.latestMarkets = partialStocks;
 (this.ctx.panels.markets as MarketPanel).renderMarkets(partialStocks);
 },
 }), 4 * 60 * 60 * 1000);

 this.ctx.latestMarkets = stocksResult.data;
 (this.ctx.panels.markets as MarketPanel).renderMarkets(stocksResult.data, stocksResult.rateLimited);

 if (stocksResult.rateLimited && stocksResult.data.length === 0) {
 const rlMsg = 'Market data temporarily unavailable (rate limited) — retrying shortly';
 this.ctx.panels.heatmap?.showError(rlMsg);
 this.ctx.panels.commodities?.showError(rlMsg);
 } else if (stocksResult.skipped) {
 this.ctx.statusPanel?.updateApi('Finnhub', { status: 'error' });
 if (stocksResult.data.length === 0) {
 const marketsPanel = this.ctx.panels.markets;
 if (marketsPanel) showApiKeyGate(marketsPanel, 'FINNHUB_API_KEY', () => { void this.loadMarkets(); });
 }
 const heatmapPanel = this.ctx.panels.heatmap;
 if (heatmapPanel) showApiKeyGate(heatmapPanel, 'FINNHUB_API_KEY', () => { void this.loadMarkets(); });
 } else {
 this.ctx.statusPanel?.updateApi('Finnhub', { status: 'ok' });

 const hydratedSectors = getHydratedData('sectors') as GetSectorSummaryResponse | undefined;
 if (hydratedSectors?.sectors?.length) {
 const mapped = hydratedSectors.sectors.map((s) => ({ name: s.name, change: s.change }));
 (this.ctx.panels.heatmap as HeatmapPanel).renderHeatmap(mapped);
 } else {
 const sectorsResult = await fetchMultipleStocks(
 SECTORS.map((s) => ({ ...s, display: s.name })),
 {
 onBatch: (partialSectors) => {
 (this.ctx.panels.heatmap as HeatmapPanel).renderHeatmap(
 partialSectors.map((s) => ({ name: s.name, change: s.change }))
 );
 },
 }
 );
 (this.ctx.panels.heatmap as HeatmapPanel).renderHeatmap(
 sectorsResult.data.map((s) => ({ name: s.name, change: s.change }))
 );
 }
 }

 const commoditiesPanel = this.ctx.panels.commodities as CommoditiesPanel;
 const mapCommodity = (c: MarketData) => ({ display: c.display, price: c.price, change: c.change, sparkline: c.sparkline });

 let commoditiesLoaded = stocksResult.rateLimited && stocksResult.data.length === 0;
 for (let attempt = 0; attempt < 3 && !commoditiesLoaded; attempt++) {
 if (attempt > 0) {
 commoditiesPanel.showRetrying();
 await new Promise(r => setTimeout(r, 20_000));
 }
 const commoditiesResult = await fetchMultipleStocks(COMMODITIES, {
 onBatch: (partial) => commoditiesPanel.renderCommodities(partial.map(mapCommodity)),
 });
 const mapped = commoditiesResult.data.map(mapCommodity);
 if (mapped.some(d => d.price !== null)) {
 commoditiesPanel.renderCommodities(mapped);
 commoditiesLoaded = true;
 }
 }
 if (!commoditiesLoaded) {
 commoditiesPanel.renderCommodities([]);
 }
 } catch {
 this.ctx.statusPanel?.updateApi('Finnhub', { status: 'error' });
 }

 try {
 let crypto = await fetchCrypto();
 if (crypto.length === 0) {
 (this.ctx.panels.crypto as CryptoPanel).showRetrying();
 await new Promise(r => setTimeout(r, 20_000));
 crypto = await fetchCrypto();
 }
 (this.ctx.panels.crypto as CryptoPanel).renderCrypto(crypto);
 this.ctx.statusPanel?.updateApi('CoinGecko', { status: crypto.length > 0 ? 'ok' : 'error' });
 } catch {
 this.ctx.statusPanel?.updateApi('CoinGecko', { status: 'error' });
 }
 // Crypto price fusion: CoinGecko + Coinbase, matched by symbol. Dedicated
 // fail-closed fetches (NOT the panel's cached fetchCrypto) so a down source
 // records a failing outcome instead of corroborating against stale prices.
 const cg = await fetchCoingeckoPrices();
 const cgObservedAt = Date.now();
 recordDomainObservations('coingecko', exchangePricesToObservations('coingecko', cg.prices, cgObservedAt), cg.ok, cgObservedAt);
 const coinbase = await fetchCoinbasePrices();
 const coinbaseObservedAt = Date.now();
 recordDomainObservations('coinbase', exchangePricesToObservations('coinbase', coinbase.prices, coinbaseObservedAt), coinbase.ok, coinbaseObservedAt);
 recordFusedSpotPrices(getLatestFusion('crypto', coinbaseObservedAt).facts);
 // Stock price fusion: Yahoo (no-key) + Finnhub (keyed), matched by ticker. Fail-closed.
 const yahoo = await fetchYahooPrices();
 const yahooObservedAt = Date.now();
 recordDomainObservations('yahoo-finance', exchangePricesToObservations('yahoo-finance', yahoo.prices, yahooObservedAt), yahoo.ok, yahooObservedAt);
 const finnhub = await fetchFinnhubPrices();
 const finnhubObservedAt = Date.now();
 recordDomainObservations('finnhub', exchangePricesToObservations('finnhub', finnhub.prices, finnhubObservedAt), finnhub.ok, finnhubObservedAt);
 recordFusedSpotPrices(getLatestFusion('stocks', finnhubObservedAt).facts);
  }

  async loadPredictions(): Promise<void> {
 try {
 const predictions = await fetchPredictions();
 this.ctx.latestPredictions = predictions;
 (this.ctx.panels.polymarket as PredictionPanel).renderPredictions(predictions);

 this.ctx.statusPanel?.updateFeed('Polymarket', { status: 'ok', itemCount: predictions.length });
 this.ctx.statusPanel?.updateApi('Polymarket', { status: 'ok' });
 dataFreshness.recordUpdate('polymarket', predictions.length);
 dataFreshness.recordUpdate('predictions', predictions.length);

 void this.runCorrelationAnalysis();
 } catch (error) {
 this.ctx.statusPanel?.updateFeed('Polymarket', { status: 'error', errorMessage: String(error) });
 this.ctx.statusPanel?.updateApi('Polymarket', { status: 'error' });
 dataFreshness.recordError('polymarket', String(error));
 dataFreshness.recordError('predictions', String(error));
 }
  }

  async loadNatural(): Promise<void> {
 const [earthquakeResult, eonetResult] = await Promise.allSettled([
 withOfflineCache('earthquake-data', () => fetchEarthquakes(), 1 * 60 * 60 * 1000).then(r => r.data),
 fetchNaturalEvents(30),
 ]);

 if (earthquakeResult.status === 'fulfilled') {
 this.ctx.intelligenceCache.earthquakes = earthquakeResult.value;
 this.ctx.map?.setEarthquakes(earthquakeResult.value);
 ingestEarthquakes(earthquakeResult.value);
 checkGeofenceEarthquakes(earthquakeResult.value);
 ingestEarthquakesToPoL(earthquakeResult.value);
 ingestEarthquakesToTimeline(earthquakeResult.value);
 ingestEarthquakesToMatrix(earthquakeResult.value);
 ingestEarthquakesUnified(earthquakeResult.value);
 const eqObs = earthquakesToObservations(earthquakeResult.value);
 ingestObservations(eqObs);
 if (eqObs.length > 0) {
   try {
     const { annotateModelOutput } = await import('@/services/intelligence/assumption-producers');
     const latestId = eqObs[eqObs.length - 1]!.id;
     annotateModelOutput(`earthquake-batch-${latestId}`, 'score', { observations: eqObs.slice(0, 50) }, { algorithmId: 'big-event-detector', domain: 'earthquake' });
   } catch { /* assumption instrumentation is non-critical */ }
 }
 (this.ctx.panels.earthquakes as EarthquakesPanel)?.update(earthquakeResult.value);
 this.ctx.statusPanel?.updateApi('USGS', { status: 'ok' });
 dataFreshness.recordUpdate('usgs', earthquakeResult.value.length);
 recordDomainObservations('usgs-earthquakes', usgsEarthquakesToObservations(earthquakeResult.value), true);
 } else {
 this.ctx.intelligenceCache.earthquakes = [];
 this.ctx.map?.setEarthquakes([]);
 (this.ctx.panels.earthquakes as EarthquakesPanel)?.update([]);
 this.ctx.statusPanel?.updateApi('USGS', { status: 'error' });
 dataFreshness.recordError('usgs', String(earthquakeResult.reason));
 recordDomainObservations('usgs-earthquakes', [], false);
 }

 if (eonetResult.status === 'fulfilled') {
 this.ctx.map?.setNaturalEvents(eonetResult.value);
 // C3 — keyless resilience: ingest EONET events into the unified alert store
 // so the intelligence layer (compound-risk, big-event-detector, etc.) sees
 // natural events even when no API keys are loaded.
 // fetchNaturalEvents() returns merged EONET + GDACS events; filter to
 // EONET-only (sourceName !== 'GDACS') to avoid double-ingesting GDACS
 // events that loadGDACSAlerts() already ingests as gdacs-${id} alerts.
 const eonetOnly = eonetResult.value.filter((e) => e.sourceName !== 'GDACS');
 const eonetAlerts = eonetOnly.map(normalizeNaturalEventToAlert);
 unifiedAlertStore.ingest(eonetAlerts);
 this.ctx.statusPanel?.updateFeed('EONET', {
 status: 'ok',
 itemCount: eonetResult.value.length,
 });
 this.ctx.statusPanel?.updateApi('NASA EONET', { status: 'ok' });
 } else {
 this.ctx.map?.setNaturalEvents([]);
 this.ctx.statusPanel?.updateFeed('EONET', { status: 'error', errorMessage: String(eonetResult.reason) });
 this.ctx.statusPanel?.updateApi('NASA EONET', { status: 'error' });
 }

 const hasEarthquakes = earthquakeResult.status === 'fulfilled' && earthquakeResult.value.length > 0;
 const hasEonet = eonetResult.status === 'fulfilled' && eonetResult.value.length > 0;
 this.ctx.map?.setLayerReady('natural', hasEarthquakes || hasEonet);
 this.pushObservationsToSidecar();

 // Evaluate disaster auto-trigger (uses cached GDACS data — no extra fetch)
 const earthquakes = earthquakeResult.status === 'fulfilled' ? earthquakeResult.value : [];

 // Report elevated panels for correlation detector
 if (earthquakes.some(eq => eq.magnitude >= 6.5)) {
 reportElevatedPanel('earthquakes', 'Earthquakes');
 }

 withOfflineCache('gdacs-events', () => fetchGDACSEvents(), 1 * 60 * 60 * 1000).then(({ data: gdacs }) => {
 if (gdacs.some(e => e.alertLevel === 'Red')) {
 reportElevatedPanel('gdacs-alerts', 'GDACS Disaster Alerts');
 }
 }).catch(() => {});
  }

  async loadTechEvents(): Promise<void> {
 if (import.meta.env.DEV) console.log('[loadTechEvents] Called. SITE_VARIANT:', SITE_VARIANT, 'techEvents layer:', this.ctx.mapLayers.techEvents);  
 if (SITE_VARIANT !== 'tech' && !this.ctx.mapLayers.techEvents) {
 if (import.meta.env.DEV) console.log('[loadTechEvents] Skipping - not tech variant and layer disabled');  
 return;
 }

 try {
 const client = new ResearchServiceClient('', { fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) });
 const data = await client.listTechEvents({
 type: 'conference',
 mappable: true,
 days: 90,
 limit: 50,
 });
 if (!data.success) throw new Error(data.error || 'Unknown error');

 const now = new Date();
 // data.events is typed as TechEvent[] by the generated client — drop the
 // `any` annotation so schema drift is caught at compile time.
 const mapEvents = data.events.map((e) => ({
 id: e.id,
 title: e.title,
 location: e.location,
 lat: e.coords?.lat ?? 0,
 lng: e.coords?.lng ?? 0,
 country: e.coords?.country ?? '',
 startDate: e.startDate,
 endDate: e.endDate,
 url: e.url,
 daysUntil: Math.ceil((new Date(e.startDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
 }));

 this.ctx.map?.setTechEvents(mapEvents);
 this.ctx.map?.setLayerReady('techEvents', mapEvents.length > 0);
 this.ctx.statusPanel?.updateFeed('Tech Events', { status: 'ok', itemCount: mapEvents.length });

 if (SITE_VARIANT === 'tech' && this.ctx.searchModal) {
 this.ctx.searchModal.registerSource('techevent', mapEvents.map((e: { id: string; title: string; location: string; startDate: string }) => ({
 id: e.id,
 title: e.title,
 subtitle: `${e.location} • ${new Date(e.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
 data: e,
 })));
 }
 } catch (error) {
 console.error('[App] Failed to load tech events:', error);
 this.ctx.map?.setTechEvents([]);
 this.ctx.map?.setLayerReady('techEvents', false);
 this.ctx.statusPanel?.updateFeed('Tech Events', { status: 'error', errorMessage: String(error) });
 }
  }

  private haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async loadWeatherAlerts(): Promise<void> {
 try {
 const snapshot = await withOfflineCache('weather-alerts', () => fetchWeatherAlerts(), 1 * 60 * 60 * 1000);
 const alerts = snapshot.data;
 // Capture the feed's currency ATOMICALLY with `alerts`, on this same
 // synchronous turn. The breaker's data-state is a mutable global that a
 // fire-and-forget stale-while-revalidate refresh can flip to mode:'live'
 // AFTER this await resolves. Reading it LATE — after the zone/exposure
 // awaits below, at chip-publication time — is a TOCTOU: the background
 // refresh could report 'live' while `alerts` is still the stale (empty)
 // set, proving a false "all clear". Snapshot it now so freshness matches
 // the dataset it describes.
 const weatherFeedFresh = isWeatherFeedFresh(getWeatherAlertsFeedState());
 this.ctx.map?.setWeatherAlerts(alerts);
 this.ctx.map?.setLayerReady('weather', alerts.length > 0);
 const freshness = feedFreshnessFromSnapshot(snapshot);
 if (freshness.fresh) {
 this.ctx.statusPanel?.updateFeed('Weather', { status: 'ok', itemCount: alerts.length });
 dataFreshness.recordUpdate('weather', alerts.length);
 void import('@/services/offline-staleness').then(({ recordSourceUpdate }) => { recordSourceUpdate('weather', Date.now()); });
 } else {
 // Live NWS fetch failed and we're serving the offline cache — do NOT advance
 // freshness; a stale weather snapshot must never read as a fresh all-clear.
 this.ctx.statusPanel?.updateFeed('Weather', { status: 'error', itemCount: alerts.length, errorMessage: freshness.staleReason ?? 'offline cache' });
 dataFreshness.recordError('weather', freshness.staleReason ?? 'offline cache');
 void import('@/services/offline-staleness').then(({ recordSourceUpdate }) => { recordSourceUpdate('weather', freshness.staleTimestamp ?? Date.now()); });
 }
 updateStormPreparednessContext({ weatherAlerts: alerts });

 // Refresh the survival "Storm Posture" engine on the weather tick. The
 // state singleton owns its own fetch (NWS alerts + saved places); this
 // just nudges it so the StormPosturePanel updates alongside the map.
 void refreshStormPosture();

 // Feed weather alerts + grid status into the datacenter posture engine.
 // Only runs when the user has a saved place tagged data_center.
 if (getDatacenterSite()) {
 // Contain the datacenter posture computation: it runs many awaits and
 // timestamp coercions, and a throw here must never abort the weather tick's
 // downstream status-chip publication — otherwise a single malformed alert
 // could strand a stale "ALL CLEAR" over a live storm.
 try {
 let site = getDatacenterSite()!;
 // Resolve the site's own UGC zones once (forecast zone + county) so
 // zone-only NWS products (ice/heat/flood are often issued by UGC zone,
 // not polygon) can match the site instead of reading as clear. Cached
 // by lat,lon; best-effort — degrades to polygon-only matching on failure.
 if (!site.ugcZones) {
 const zoneKey = `${site.lat},${site.lon}`;
 let zones = _siteUgcZoneCache.get(zoneKey);
 if (!zones) {
 zones = await fetchUgcZonesForPoint(site.lat, site.lon);
 _siteUgcZoneCache.set(zoneKey, zones);
 }
 if (zones.length > 0) {
 // Re-read current site after async gap — only write back if it's still
 // the same site (prevents stale-site race if saved places changed).
 const current = getDatacenterSite();
 if (current && current.lat === site.lat && current.lon === site.lon) {
 setDatacenterSite({ ...current, ugcZones: zones });
 }
 site = getDatacenterSite() ?? site;
 }
 }
 const grid = await fetchGridStatus().catch(() => null);
 const gridStatus = grid?.find((g) => g.region === site.eiaRegion) ?? null;
 // Map WeatherAlert[] → NwsAlertMinimal[]. Shapes differ (severity casing,
 // Date vs ISO). Carry EVERY outer ring of the warning into polygon.rings so
 // matchAlertToPlace does point-in-polygon over the union — a MultiPolygon
 // warning whose 2nd+ sub-polygon covers the site must still match here, the
 // same way the personal-exposure path matches it (weather-exposure.ts). Fall
 // back to the legacy single `coordinates` ring when `polygonRings` is absent.
 // UGC zones thread through so the matcher's zone fallback fires for
 // polygon-free alerts.
 const nwsAlerts = alerts.map((a) => {
 const rings = (a.polygonRings && a.polygonRings.length > 0 ? a.polygonRings : [a.coordinates])
 .filter((ring) => ring.length >= 3);
 return {
 id: a.id,
 event: a.event,
 sent: toIsoString(a.onset),
 expires: toIsoString(a.expires),
 severity: (a.severity?.toLowerCase() as import('@/services/weather/weather-threat-types').WeatherSeverity | undefined),
 polygon: rings.length > 0 ? { rings } : undefined,
 ugcZones: a.ugcZones,
 headline: a.headline,
 };
 });
 const [condResult, forecastResult, aqResult, connResult] = await Promise.allSettled([
   fetchOpenMeteoConditions(site.lat, site.lon),
   fetchSite24hForecast(site.lat, site.lon),
   fetchSiteAirQuality(site.lat, site.lon),
   fetchConnectivitySignal(),
 ]);
 const rawCond = condResult.status === 'fulfilled' ? condResult.value : null;
 const siteConditions = rawCond ? {
   tempC: rawCond.temperature,
   feelsLikeC: rawCond.feelsLike,
   humidityPct: rawCond.humidity,
   windSpeedKmh: rawCond.windSpeed,
   windDirectionDeg: rawCond.windDirection,
   precipMm: rawCond.precipitation,
   uvIndex: rawCond.uvIndex,
   weatherCode: rawCond.weatherCode,
 } : null;
 const nearbySeismic = (this.ctx.intelligenceCache?.earthquakes ?? [])
   .filter((eq) => {
     if (!eq.location) return false;
     if (eq.magnitude < 3.5) return false;
     if (Date.now() - eq.occurredAt > 24 * 60 * 60 * 1000) return false;
     return this.haversineKm(site.lat, site.lon, eq.location.latitude, eq.location.longitude) <= 200;
   })
   .map((eq) => ({
     magnitudeM: eq.magnitude,
     distanceKm: Math.round(this.haversineKm(site.lat, site.lon, eq.location!.latitude, eq.location!.longitude)),
     place: eq.place,
     occurredAt: eq.occurredAt,
   }));
 const gridInfrastructure = await resolveGridInfrastructure(site.lat, site.lon);
 recomputeDatacenterPosture({
   gridStatus,
   weatherAlerts: nwsAlerts,
   nearbyOutageCount: null,
   conditions: siteConditions,
   forecast24h: forecastResult.status === 'fulfilled' ? forecastResult.value : [],
   airQuality: aqResult.status === 'fulfilled' ? aqResult.value : null,
   seismicNearby: nearbySeismic,
   connectivity: connResult.status === 'fulfilled' ? connResult.value : null,
   gridInfrastructure,
 });
 } catch (error) {
 console.warn('[Datacenter] posture recompute failed; skipping this tick:', error);
 }
 }

 // Wire weather alerts into the insights state singleton so Command
 // Center, Personal Impact, and Action Briefs all reflect the same
 // data view.
 try {
 const { bridgeWeatherAlertsToInsights } = await import('@/services/insights/data-bridge');
 const { slog: _slog } = await import('@/services/structured-log');
 const bridgeResult = bridgeWeatherAlertsToInsights(alerts, {
   log: (level, message, fields) => _slog(level, 'pipeline', message, { fields: fields as Record<string, string | number | boolean | null> | undefined }),
 });
 // Record ingested stage for each bridged event
 try {
   const { getPipelineTraceRegistry: getPTR } = await import('@/services/diagnostics/diagnostics-state');
   const ptr = getPTR();
   for (const evt of bridgeResult.events) {
     ptr.record(evt.eventId, 'weather', { stage: 'ingested' });
   }
 } catch { /* trace unavailable */ }
 } catch (error) {
 console.warn('[data-loader] insights bridge failed:', error);
 }

 // Run severe alerts through the Big Event Detector → Notification
 // Ladder → native/in-app dispatch. Only Extreme/Severe alerts enter
 // the ladder; lesser severities are not actionable at this rung.
 // Quiet-hours flag defaults false until settings exposes getQuietHoursActive().
 try {
 const [
 { detectBigEvent },
 { routeBigEventToLadder },
 { getNotificationTraceRegistry, getPipelineTraceRegistry },
 { recordAlgorithmEvaluation },
 { annotateModelOutput: annotateWeatherOutput },
 { getNotificationPreferencesService },
 { computeAlertExposure },
 { getSavedPlaces },
 { resolveSavedPlaceZonesWithHealth, toMatcherPlace, savedPlacesMatchSignature },
 { selectPersonalWeatherThreat, setPersonalWeatherThreat, confirmPersonalWeatherClear, revokePersonalWeatherClearConfirmation, resolveThreatExpiryMs, decideThreatPublication },
 ] = await Promise.all([
 import('@/services/insights/big-event-detector'),
 import('@/services/insights/notification-ladder'),
 import('@/services/diagnostics/diagnostics-state'),
 import('@/services/algorithms/record-evaluation'),
 import('@/services/intelligence/assumption-producers'),
 import('@/services/notifications/notification-preferences'),
 import('@/services/weather/weather-exposure'),
 import('@/services/saved-places'),
 import('@/services/weather/saved-place-adapter'),
 import('@/services/weather/personal-weather-status'),
 ]);
 const pipelineTrace = getPipelineTraceRegistry();
 const SEVERITY_SCORE: Record<string, number> = { Extreme: 95, Severe: 80, Moderate: 55, Minor: 30, Unknown: 20 };
 const RUNG_ACTION: Record<string, 'sound+banner' | 'banner' | null> = {
 announcement: 'sound+banner',
 critical: 'sound+banner',
 banner_sound: 'sound+banner',
 banner: 'banner',
 in_app: null,
 silent: null,
 };
 const registry = getNotificationTraceRegistry();
 // Real quiet-hours state + the user's per-domain bypass, instead of hardcoding
 // them off. Non-safety weather alerts are now suppressible during quiet hours;
 // safety-critical (emergency/critical tier) events still override via the
 // ladder's safety path. Computed once per batch (same instant for all alerts).
 const notifPrefs = getNotificationPreferencesService();
 const quietHoursActive = notifPrefs.isQuietHour();
 const weatherQuietHoursBypass = notifPrefs
 .getPreferences()
 .domains.find((d) => d.domain === 'weather')?.quietHoursOverride ?? false;
 const severeAlerts = alerts.filter(
 (a) => a.severity === 'Extreme' || a.severity === 'Severe',
 );
 // Personal exposure: match each alert's polygon (or UGC zones, for
 // geometry-free alerts) against the user's saved places so an official
 // warning sitting over the user clears the Big Event Detector's
 // exposureFloor (70). Before this, userExposure was hardcoded to 50 —
 // below the floor — so a lone NWS warning fired only the weight-35
 // high_confidence_high_impact trigger (< threshold 40) and was silently
 // dropped: the "all clear during a severe storm" bug. Adapted to the
 // matcher's SavedPlace shape (same mapping the storm-decision path uses).
 // Carry the user's configured radius through: the matcher uses it as the
 // near-polygon sensitivity buffer and only near-matches non-high-urgency
 // hazards when a place opts in via radiusKm. Dropping it shrank the user's
 // coverage to the 10 km hazard default — the opposite of what someone
 // asking "why wasn't I warned?" wants. Resolve each place's own UGC zones
 // too so geometry-free (zone-only) NWS products — ice/heat/flood are often
 // issued by UGC zone, not polygon — match instead of reading as clear.
 const savedPlaces = getSavedPlaces();
 // Fingerprint the match-relevant place set NOW, before the async zone lookup
 // below. This whole block matches `severeAlerts` against `savedPlaces` and then
 // publishes a clear decision — but a place added under a live warning DURING
 // the awaits fires the subscription that revokes any confirmed clear, and this
 // in-flight evaluation (still holding the pre-add set) would otherwise
 // re-confirm clear against a set that never saw the new place. Re-reading this
 // signature before publication lets us detect that and withhold the clear.
 const placesSignatureAtSnapshot = savedPlacesMatchSignature(savedPlaces);
 // Resolve zones AND capture whether any place's /points lookup failed. A
 // degraded zone picture (some place's zones unknown) must withhold the
 // confirmed-clear below: a geometry-free zone-only severe alert could match
 // an unresolved place and go unseen, so we can't honestly assert "all clear".
 const { zonesByPlace: placeZonesById, degraded: zonesDegraded } =
 await resolveSavedPlaceZonesWithHealth(savedPlaces);
 const weatherPlaces = savedPlaces.map((p) => toMatcherPlace(p, placeZonesById.get(p.id)));
 // Exposure floor read once (same tuned value the detector uses) so the
 // status-chip threat decision uses the identical "over the user" bar.
 const exposureFloor = getTunedParam('big-event-detector', 'exposureFloor', 70);
 // Personal weather threats for the title-bar status chip — collected as we
 // iterate so the chip can stop showing "ALL CLEAR" during a storm actually
 // over the user (see selectPersonalWeatherThreat). Personal, not national.
 const weatherThreatCandidates: WeatherThreatCandidate[] = [];
 // Did any alert's exposure match THROW? A crash leaves that alert's exposure
 // at the conservative default (50) — below the floor — so a warning genuinely
 // over the user could be scored as "not over you" and the chip could clear.
 // Treat any match failure as a reason to withhold "all clear" (fail closed),
 // the same way an unresolved UGC zone (zonesDegraded) does.
 let matchingDegraded = false;
 for (const alert of severeAlerts) {
 const severityScore = SEVERITY_SCORE[alert.severity] ?? 30;
 // With no saved place, exposure is genuinely unknown — keep the
 // conservative default rather than fabricating a location match.
 // Guarded: a single malformed alert (e.g. an unparseable NWS timestamp)
 // must not abort the whole severe-alert batch and strand the status-chip
 // publication after the loop. weather-exposure also hardens the known
 // invalid-Date crash; this is defense in depth.
 let userExposure = 50;
 // A severe alert stripped of all spatial data during normalization (no
 // polygon ring AND no UGC zone) cannot be matched to any saved place:
 // computeAlertExposure returns a low exposure WITHOUT throwing, so the catch
 // below never fires and matching reads "complete" for a warning we could not
 // actually place. Treat it like a crashed match — degrade so the clear falls
 // to revoke_confirmation instead of confirming clear off an unevaluable severe
 // warning. Independent of saved places: the gap is in the alert, not the user.
 if (isAlertSpatiallyUnevaluable(alert)) {
 matchingDegraded = true;
 }
 if (weatherPlaces.length > 0) {
 try {
 userExposure = computeAlertExposure(alert, weatherPlaces).exposure;
 } catch (error) {
 console.warn('[data-loader] weather exposure failed for', alert.id, error);
 matchingDegraded = true;
 }
 }
 // Record this alert as a chip-threat candidate. `alert.expires` is a Date
 // when freshly fetched but an ISO string after the offline cache round-trips
 // it — resolveThreatExpiryMs parses both (and falls back to a bounded window
 // only when the value is unusable) so a matched threat can never pin the chip
 // on forever and an expired one self-clears on time.
 weatherThreatCandidates.push({
 severity: alert.severity,
 event: alert.event,
 exposure: userExposure,
 expiresAt: resolveThreatExpiryMs(alert.expires),
 });
 // Route this alert through the ladder in an ISOLATED try: the chip
 // candidate above is already collected, so one malformed alert failing to
 // route must not abort the batch and strand the publication after the loop.
 try {
 const ladderInput = {
 id: alert.id,
 domain: 'weather',
 severityScore,
 truthScore: 0.85, // NWS is an official source — high prior confidence
 sourceCount: 1,
 hasOfficialSource: true,
 overlappingDomains: ['weather'] as const,
 userExposure,
 potentialImpact: severityScore,
 };
 const _bedStart = performance.now();
 // Threshold is a tunable param (B2): reads the auto-tuned value from the
 // store, falling back to the detector's built-in default (40) when unset.
 const bigEventResult = detectBigEvent(ladderInput, {
 threshold: getTunedParam('big-event-detector', 'threshold', 40),
 rapidJumpDelta: getTunedParam('big-event-detector', 'rapidJumpDelta', 25),
 exposureFloor,
 });
 // B1 (self-improvement gameplan): feed the evaluation ledger so the
 // adaptive-tuner has data. Guarded — instrumentation must never break
 // the notification data path.
 try {
 recordAlgorithmEvaluation('big-event-detector', {
 durationMs: performance.now() - _bedStart,
 score: bigEventResult.totalScore / 100,
 label: bigEventResult.isBigEvent ? 'big-event' : 'quiet',
 detail: { domain: 'weather', triggers: bigEventResult.triggers.length, tier: bigEventResult.tier },
 });
 } catch { /* ledger unavailable — skip silently */ }
 // confidence-urgency-matrix: the tier + deliveryPriority come directly from the matrix
 // computation inside detectBigEvent — record them as a separate matrix evaluation.
 try {
 recordAlgorithmEvaluation('confidence-urgency-matrix', {
 durationMs: performance.now() - _bedStart, // shares the detectBigEvent bracket (matrix runs inside it)
 score: bigEventResult.totalScore / 100,
 label: bigEventResult.tier,
 detail: { priority: bigEventResult.deliveryPriority, urgency: bigEventResult.urgency },
 });
 } catch { /* ledger unavailable — skip silently */ }
 // Assumption tracking — annotate live model output so AssumptionPanel
 // stats() shows nonzero totalOutputs. Guarded: must never break the
 // notification path.
 try {
   annotateWeatherOutput(alert.id, 'alert', { observations: getRecentObservations(50).filter(o => o.domain === 'weather') }, { algorithmId: 'big-event-detector', domain: 'weather' });
 } catch { /* assumption instrumentation is non-critical */ }
 if (!bigEventResult.isBigEvent) {
   pipelineTrace.record(alert.id, 'weather', { stage: 'evaluated', detail: { isBigEvent: false, tier: bigEventResult.tier } });
   continue;
 }
 pipelineTrace.record(alert.id, 'weather', { stage: 'evaluated', detail: { isBigEvent: true, tier: bigEventResult.tier } });
 // Dedupe: a stable per-alert key lets us detect a warning we already
 // notified for. The trace candidateId stays unique per occurrence (the
 // registry rejects duplicate ids), while situationId groups occurrences
 // of the same alert so dedupeMatch can fire on a recent prior dispatch.
 const dispatchAt = Date.now();
 const dedupeKey = weatherAlertDedupeKey(alert);
 const dedupeMatch = registry
   .bySituation(dedupeKey)
   .some((e) => {
     if (e.decision !== 'dispatched') return false;
     const lastAt = e.events[e.events.length - 1]?.at ?? e.candidate.createdAt;
     return dispatchAt - lastAt < WEATHER_NOTIFY_DEDUPE_WINDOW_MS;
   });
 const decision = routeBigEventToLadder(registry, bigEventResult, ladderInput, {
 candidateId: `${dedupeKey}-${dispatchAt}`,
 situationId: dedupeKey,
 domain: 'weather',
 headline: alert.headline || alert.event,
 summary: alert.areaDesc ? `${alert.event} — ${alert.areaDesc}` : alert.event,
 quietHoursActive,
 quietHoursBypassEnabled: weatherQuietHoursBypass,
 dedupeMatch,
 });
 pipelineTrace.record(alert.id, 'weather', { stage: 'routed', detail: { rung: decision.rung, dispatched: decision.dispatched } });
 const action = RUNG_ACTION[decision.rung] ?? null;
 if (decision.dispatched && action) {
 notificationDispatcher.dispatchNotification(
 {
 id: alert.id,
 source: 'nws',
 severity: alert.severity === 'Extreme' ? 'critical' : 'high',
 title: alert.event,
 body: alert.headline || alert.areaDesc || alert.event,
 timestamp: Date.now(),
 location: alert.centroid
 ? { lat: alert.centroid[1], lon: alert.centroid[0] }
 : undefined,
 relevanceScore: severityScore,
 acknowledged: false,
 pinned: false,
 },
 action,
 );
 }
 } catch (error) {
 console.warn('[data-loader] weather alert routing failed for', alert.id, error);
 }
 }
 // Feed the title-bar status chip: the worst Extreme/Severe alert matched to
 // a saved place (or null → chip clears). This is what stops the visible
 // "ALL CLEAR" chip from lying during a storm actually over the user.
 // Gate the CLEAR on an HONEST feed-currency read: `freshness.fresh` comes
 // from the offline-cache wrapper, which always reports success because the
 // NWS circuit breaker never throws — so that gate was inert in production.
 // `weatherFeedFresh` was captured from the breaker's real mode ATOMICALLY
 // with `alerts` at fetch time (see the note there); reading it late here
 // would race a background stale-while-revalidate refresh that could flip the
 // mode to 'live' while `alerts` is still the stale empty set. A clear is
 // only authorized on a live (or still-fresh cached) read AND when no saved
 // place's zone lookup failed (a degraded zone picture could hide a zone-only
 // warning) AND when no exposure match crashed (a match failure leaves that
 // alert scored below the floor, which could mask a warning over the user). A
 // real match always publishes. When the clear can't be trusted the prior
 // threat stays put to self-expire, and the chip shows the neutral "CHECKING
 // WEATHER" state (clear not confirmed) rather than a false ALL CLEAR.
 // Freshness and match-completeness are passed SEPARATELY: a fresh feed whose
 // match pipeline degraded (an unresolved zone or a crashed exposure match)
 // can't confirm a clear AND must revoke any prior confirmed clear — otherwise
 // a stale "ALL CLEAR" lingers over a fresh feed we never actually evaluated.
 // On a stale feed we leave everything to self-expire.
 // Also treat a saved-place set that CHANGED mid-evaluation as an incomplete
 // match: `weatherThreatCandidates` was scored against the pre-await snapshot,
 // so a place added under a live warning during the awaits was never evaluated.
 // Confirming clear here would silently reconfirm against the stale set and undo
 // the subscription's revoke — the TOCTOU fail-open. A changed set routes to
 // revoke_confirmation; the next tick re-evaluates against the current places.
 const placesChangedDuringEval =
 savedPlacesMatchSignature(getSavedPlaces()) !== placesSignatureAtSnapshot;
 const chipDecision = decideThreatPublication(
 selectPersonalWeatherThreat(weatherThreatCandidates, exposureFloor),
 weatherFeedFresh,
 !zonesDegraded && !matchingDegraded && !placesChangedDuringEval,
 );
 switch (chipDecision.action) {
 case 'publish': setPersonalWeatherThreat(chipDecision.value); break;
 case 'confirm_clear': confirmPersonalWeatherClear(); break;
 case 'revoke_confirmation': revokePersonalWeatherClearConfirmation(); break;
 case 'leave': break;
 }
 } catch (error) {
 console.warn('[data-loader] notification ladder failed:', error);
 }

 // Wire weather alerts into the mission ledger (closed-loop ops PR 2).
 // Each (alert × saved place) pair runs through polygon match +
 // urgency engine + mission bridge so time-to-warn / near-miss /
 // replay-fixture surfaces have real records to read from.
 try {
 const [{ routeAndBridgeWeatherAlerts }, { getPersonalProfile }] = await Promise.all([
 import('@/services/ops/weather-mission-bridge'),
 import('@/services/insights/insights-state'),
 ]);
 const places = getPersonalProfile().savedPlaces;
 if (places.length > 0) routeAndBridgeWeatherAlerts(alerts, places);
 } catch (error) {
 console.warn('[data-loader] mission bridge failed:', error);
 }

 // Wire weather into correlation matrix, anomaly detection, and convergence
 const severeCount = alerts.filter(a => a.severity === 'Extreme' || a.severity === 'Severe').length;
 ingestWeatherAnomalySignals(alerts.length, severeCount);
 for (const alert of alerts) {
 if (!alert.centroid) continue;
 const [lon, lat] = alert.centroid;
 const region = classifyRegion(lat, lon);
 if (!region) continue;
 const severityMap: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
 Extreme: 'critical', Severe: 'high', Moderate: 'medium', Minor: 'low', Unknown: 'low',
 };
 ingestCorrelationMatrix(lat, lon, 'weather', severityMap[alert.severity] ?? 'low');
 }

 // Weather-threat convergence detection
 const convergences = detectWeatherThreatConvergence(alerts);
 if (convergences.length > 0) {
 document.dispatchEvent(new CustomEvent('wm:weather-threat-convergence', { detail: convergences }));
 for (const c of convergences.filter(x => x.convergenceScore >= 70)) {
 notificationDispatcher.dispatchConvergenceAlert(c.description, c.convergenceScore, c.lat, c.lon);
 }
 }

 // Weather impact analysis
 const impacts = analyzeWeatherImpacts(alerts);
 if (impacts.length > 0) {
 document.dispatchEvent(new CustomEvent('wm:weather-impacts', { detail: impacts }));
 }

 // Supply chain disruption signals from weather
 const supplySignals = weatherToSupplyChainSignals(alerts);
 if (supplySignals.length > 0) {
 document.dispatchEvent(new CustomEvent('wm:weather-supply-signals', { detail: supplySignals }));
 }

 // Feed correlation matrix global score into anomaly detection for trend monitoring
 ingestMatrixScoreSignal(getMatrixGlobalScore());

 // Multi-source weather intelligence: fetch Open-Meteo hourly forecast
 // for each saved place and ingest as observations alongside NWS alerts.
 // When both sources flag the same area, truth-score corroboration applies.
 void (async () => {
 try {
 const { getSavedPlaces } = await import('@/services/saved-places');
 const places = getSavedPlaces().slice(0, 3); // cap to first 3 saved places
 await Promise.allSettled(places.map(async (place) => {
 if (!place.lat || !place.lon) return;
 const url = `${getApiBaseUrl()}/api/weather/local-forecast?lat=${place.lat}&lon=${place.lon}`;
 // Hourly-updated forecast; cache per lat,lon for 30m to avoid refetching the
 // full payload every weather cycle (supplementary data, not safety alerts).
 const forecast = await fetchJsonCached<OpenMeteoHourlyForecast>(url, 30 * 60_000);
 if (!forecast) return;
 const obs = forecastToObservations(forecast, place.lat, place.lon, place.name ?? 'Saved Place');
 if (obs.length > 0) ingestObservations(obs);
 }));
 } catch {
 /* local forecast failure is non-critical — NWS alerts are the primary source */
 }
 })();

 } catch (error) {
 this.ctx.map?.setLayerReady('weather', false);
 this.ctx.statusPanel?.updateFeed('Weather', { status: 'error' });
 dataFreshness.recordError('weather', String(error));
 }
  }

  async loadIntelligenceSignals(): Promise<void> {
 const tasks: Promise<void>[] = [];

 tasks.push((async () => {
 try {
 const outages = await fetchInternetOutages();
 this.ctx.intelligenceCache.outages = outages;
 ingestOutagesForCII(outages);
 signalAggregator.ingestOutages(outages);
 ingestOutagesToSigint(outages);
 ingestOutagesToConvergence(outages);
 ingestOutagesToTopology(outages);
 dataFreshness.recordUpdate('outages', outages.length);
 if (this.ctx.mapLayers.outages) {
 this.ctx.map?.setOutages(outages);
 this.ctx.map?.setLayerReady('outages', outages.length > 0);
 this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
 }
 } catch (error) {
 console.error('[Intelligence] Outages fetch failed:', error);
 dataFreshness.recordError('outages', String(error));
 }
 })());

 const protestsTask = (async (): Promise<SocialUnrestEvent[]> => {
 try {
 const protestData = await fetchProtestEvents();
 this.ctx.intelligenceCache.protests = protestData;
 ingestProtests(protestData.events);
 const unrestObservations = this.dedupeConflictObservations(
   unrestEventsToObservations(protestData.events),
 );
 if (unrestObservations.length > 0) ingestObservations(unrestObservations);
 ingestProtestsForCII(protestData.events);
 signalAggregator.ingestProtests(protestData.events);
 checkGeofenceProtests(protestData.events);
 ingestProtestsToPoL(protestData.events);
 const protestCount = protestData.sources.acled + protestData.sources.gdelt;
 if (protestCount > 0) dataFreshness.recordUpdate('acled', protestCount);
 if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt', protestData.sources.gdelt);
 if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt_doc', protestData.sources.gdelt);
 if (this.ctx.mapLayers.protests) {
 this.ctx.map?.setProtests(protestData.events);
 this.ctx.map?.setLayerReady('protests', protestData.events.length > 0);
 const status = getProtestStatus();
 this.ctx.statusPanel?.updateFeed('Protests', {
 status: 'ok',
 itemCount: protestData.events.length,
 errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
 });
 }
 return protestData.events;
 } catch (error) {
 console.error('[Intelligence] Protests fetch failed:', error);
 dataFreshness.recordError('acled', String(error));
 return [];
 }
 })();
 tasks.push(protestsTask.then(() => undefined));

 tasks.push((async () => {
 try {
 const { data: conflictData } = await withOfflineCache('conflict-events', () => fetchConflictEvents(), 1 * 60 * 60 * 1000);
 ingestConflictsForCII(conflictData.events);
 const conflictObservations = this.dedupeConflictObservations(
   conflictEventsToObservations(conflictData.events),
 );
 if (conflictObservations.length > 0) ingestObservations(conflictObservations);
 if (conflictData.count > 0) dataFreshness.recordUpdate('acled_conflict', conflictData.count);
 } catch (error) {
 console.error('[Intelligence] Conflict events fetch failed:', error);
 dataFreshness.recordError('acled_conflict', String(error));
 }
 })());

 tasks.push((async () => {
 try {
 const classifications = await fetchUcdpClassifications();
 ingestUcdpForCII(classifications);
 if (classifications.size > 0) dataFreshness.recordUpdate('ucdp', classifications.size);
 } catch (error) {
 console.error('[Intelligence] UCDP fetch failed:', error);
 dataFreshness.recordError('ucdp', String(error));
 }
 })());

 tasks.push((async () => {
 try {
 const summaries = await fetchHapiSummary();
 ingestHapiForCII(summaries);
 if (summaries.size > 0) dataFreshness.recordUpdate('hapi', summaries.size);
 } catch (error) {
 console.error('[Intelligence] HAPI fetch failed:', error);
 dataFreshness.recordError('hapi', String(error));
 }
 })());

 tasks.push((async () => {
 try {
 if (isMilitaryVesselTrackingConfigured()) {
 initMilitaryVesselStream();
 }
 const [flightResult, vesselResult] = await Promise.all([
 withOfflineCache('military-signals', () => fetchMilitaryFlights(), 1 * 60 * 60 * 1000),
 withOfflineCache('military-vessels', () => fetchMilitaryVessels(), 1 * 60 * 60 * 1000),
 ]);
 const flightData = flightResult.data;
 const vesselData = vesselResult.data;
 this.ctx.intelligenceCache.military = {
 flights: flightData.flights,
 flightClusters: flightData.clusters,
 vessels: vesselData.vessels,
 vesselClusters: vesselData.clusters,
 };
 fetchUSNIFleetReport().then((report) => {
 if (report) this.ctx.intelligenceCache.usniFleet = report;
 }).catch(() => {});
 ingestFlights(flightData.flights);
 ingestVessels(vesselData.vessels);
 ingestMilitaryForCII(flightData.flights, vesselData.vessels);
 signalAggregator.ingestFlights(flightData.flights);
 signalAggregator.ingestVessels(vesselData.vessels);
 ingestMilFlightsToOrbat(flightData.flights);
 // Strike package detection — classify coordinated air operations
 const strikePackages = detectStrikePackages(flightData.flights);
 if (strikePackages.length > 0) {
 document.dispatchEvent(new CustomEvent('wm:strike-packages', { detail: strikePackages }));
 for (const pkg of strikePackages) {
 if (pkg.threatLevel === 'critical' && pkg.inSensitiveAirspace) {
 notificationDispatcher.dispatchConvergenceAlert(
 `${pkg.label}: ${pkg.aircraftCount} aircraft in sensitive airspace — ${pkg.description.slice(0, 120)}`,
 pkg.threatScore, pkg.lat, pkg.lon,
 );
 }
 }
 }
 ingestMilVesselsToOrbat(vesselData.vessels);
 ingestMilVesselsToDarkVessel(vesselData.vessels);
 checkGeofenceMilitary(flightData.flights);
 ingestMilFlightsToGraph(flightData.flights);
 ingestMilVesselsToGraph(vesselData.vessels);
 checkVesselsAgainstSanctions(vesselData.vessels);
 dataFreshness.recordUpdate('opensky', flightData.flights.length);
 updateAndCheck([
 { type: 'military_flights', region: 'global', count: flightData.flights.length },
 { type: 'vessels', region: 'global', count: vesselData.vessels.length },
 ]).then(anomalies => {
 if (anomalies.length > 0) {
 signalAggregator.ingestTemporalAnomalies(anomalies);
 ingestTemporalAnomaliesForCII(anomalies);
 (this.ctx.panels.cii as CIIPanel)?.refresh();
 }
 }).catch(() => {});
 if (this.ctx.mapLayers.military) {
 this.ctx.map?.setMilitaryFlights(flightData.flights, flightData.clusters);
 this.ctx.map?.setMilitaryVessels(vesselData.vessels, vesselData.clusters);
 this.ctx.map?.updateMilitaryForEscalation(flightData.flights, vesselData.vessels);
 const militaryCount = flightData.flights.length + vesselData.vessels.length;
 this.ctx.statusPanel?.updateFeed('Military', {
 status: militaryCount > 0 ? 'ok' : 'warning',
 itemCount: militaryCount,
 });
 }
 if (!isInLearningMode()) {
 const surgeAlerts = analyzeFlightsForSurge(flightData.flights);
 if (surgeAlerts.length > 0) {
 const surgeSignals = surgeAlerts.map(surgeAlertToSignal);
 addToSignalHistory(surgeSignals);
 situationEngine.observeSignals(surgeSignals);
 (this.ctx.panels['alert-center'] as AlertCenterPanel)?.addSignals(surgeSignals);
 if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(surgeSignals);
 }
 const foreignAlerts = detectForeignMilitaryPresence(flightData.flights);
 if (foreignAlerts.length > 0) {
 const foreignSignals = foreignAlerts.map(foreignPresenceToSignal);
 addToSignalHistory(foreignSignals);
 situationEngine.observeSignals(foreignSignals);
 (this.ctx.panels['alert-center'] as AlertCenterPanel)?.addSignals(foreignSignals);
 if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(foreignSignals);
 }
 }
 } catch (error) {
 console.error('[Intelligence] Military fetch failed:', error);
 dataFreshness.recordError('opensky', String(error));
 }
 })());

 tasks.push((async () => {
 try {
 const protestEvents = await protestsTask;
 let result = await fetchUcdpEvents();
 for (let attempt = 1; attempt < 3 && !result.success; attempt++) {
 await new Promise(r => setTimeout(r, 15_000));
 result = await fetchUcdpEvents();
 }
 if (!result.success) {
 dataFreshness.recordError('ucdp_events', 'UCDP events unavailable (retaining prior event state)');
 return;
 }
 const acledEvents = protestEvents.map(e => ({
 latitude: e.lat, longitude: e.lon, event_date: e.time.toISOString(), fatalities: e.fatalities ?? 0,
 }));
 const events = deduplicateAgainstAcled(result.data, acledEvents);
 const ucdpObservations = this.dedupeConflictObservations(
   ucdpEventsToObservations(events),
 );
 if (ucdpObservations.length > 0) ingestObservations(ucdpObservations);
 (this.ctx.panels['ucdp-events'] as UcdpEventsPanel)?.setEvents(events);
 if (this.ctx.mapLayers.ucdpEvents) {
 this.ctx.map?.setUcdpEvents(events);
 }
 if (events.length > 0) dataFreshness.recordUpdate('ucdp_events', events.length);
 } catch (error) {
 console.error('[Intelligence] UCDP events fetch failed:', error);
 dataFreshness.recordError('ucdp_events', String(error));
 }
 })());

 // Air strikes & drone events (ACLED)
 tasks.push((async () => {
 try {
 const events = await fetchAirstrikes();
 (this.ctx.panels.airstrikes as AirstrikesPanel)?.update(events);
 if (this.ctx.mapLayers.airstrikes) {
 this.ctx.map?.setAirstrikes(events);
 }
 checkGeofenceAirstrikes(events);
 ingestAirstrikesToConvergence(events);
 ingestAirstrikesToTimeline(events);
 ingestAirstrikesToMatrix(events);
 const airstrikeObservations = this.dedupeConflictObservations(
   airstrikesToObservations(events),
 );
 if (airstrikeObservations.length > 0) ingestObservations(airstrikeObservations);
 if (events.length > 0) dataFreshness.recordUpdate('acled_airstrikes', events.length);
 } catch (error) {
 console.error('[Intelligence] Airstrikes fetch failed:', error);
 dataFreshness.recordError('acled_airstrikes', String(error));
 }
 })());

 // Strike package detection (piggybacks on military flights data)
 tasks.push((async () => {
 try {
 const { fetchMilitaryFlights } = await import('@/services/military-flights');
 const { flights } = await fetchMilitaryFlights();
 const packages = updateFromFlights(flights);
 (this.ctx.panels['strike-package'] as StrikePackagePanel)?.update(packages);
 if (this.ctx.mapLayers.strikePackages) {
 this.ctx.map?.setStrikePackages(packages);
 }
 } catch (error) {
 console.error('[Strike Packages] Detection failed:', error);
 }
 })());

 // S2 Underground intelligence (GhostMaps / ArcGIS CIP)
 tasks.push((async () => {
 try {
 const events = await fetchS2Underground();
 if (this.ctx.mapLayers.s2pimu) {
 this.ctx.map?.setS2Underground(events);
 }
 if (events.length > 0) dataFreshness.recordUpdate('s2_underground', events.length);
 } catch (error) {
 console.error('[Intelligence] S2 Underground fetch failed:', error);
 dataFreshness.recordError('s2_underground', String(error));
 }
 })());

 tasks.push((async () => {
 try {
 const unhcrResult = await fetchUnhcrPopulation();
 if (!unhcrResult.ok) {
 dataFreshness.recordError('unhcr', 'UNHCR displacement unavailable (retaining prior displacement state)');
 return;
 }
 const data = unhcrResult.data;
 (this.ctx.panels.displacement as DisplacementPanel)?.setData(data);
 ingestDisplacementForCII(data.countries);
 if (this.ctx.mapLayers.displacement && data.topFlows) {
 this.ctx.map?.setDisplacementFlows(data.topFlows);
 }
 if (data.countries.length > 0) dataFreshness.recordUpdate('unhcr', data.countries.length);
 } catch (error) {
 console.error('[Intelligence] UNHCR displacement fetch failed:', error);
 dataFreshness.recordError('unhcr', String(error));
 }
 })());

 tasks.push((async () => {
 try {
 const climateResult = await fetchClimateAnomalies();
 if (!climateResult.ok) {
 dataFreshness.recordError('climate', 'Climate anomalies unavailable (retaining prior climate state)');
 return;
 }
 const anomalies = climateResult.anomalies;
 (this.ctx.panels.climate as ClimateAnomalyPanel)?.setAnomalies(anomalies);
 ingestClimateForCII(anomalies);
 if (this.ctx.mapLayers.climate) {
 this.ctx.map?.setClimateAnomalies(anomalies);
 }
 if (anomalies.length > 0) dataFreshness.recordUpdate('climate', anomalies.length);
 } catch (error) {
 console.error('[Intelligence] Climate anomalies fetch failed:', error);
 dataFreshness.recordError('climate', String(error));
 }
 })());

 // Security advisories
 tasks.push(this.loadSecurityAdvisories());

 // Telegram Intel
 tasks.push(this.loadTelegramIntel());

 // OREF sirens
 tasks.push((async () => {
 try {
 const data = await fetchOrefAlerts();
 (this.ctx.panels['oref-sirens'] as OrefSirensPanel)?.setData(data);
 const alertCount = data.alerts?.length ?? 0;
 const historyCount24h = data.historyCount24h ?? 0;
 ingestOrefForCII(alertCount, historyCount24h);
 const orefObservations = this.dedupeConflictObservations(
   orefAlertsToObservations(data.alerts ?? []),
 );
 if (orefObservations.length > 0) ingestObservations(orefObservations);
 this.ctx.intelligenceCache.orefAlerts = { alertCount, historyCount24h };
 onOrefAlertsUpdate((update) => {
 (this.ctx.panels['oref-sirens'] as OrefSirensPanel)?.setData(update);
 const updAlerts = update.alerts?.length ?? 0;
 const updHistory = update.historyCount24h ?? 0;
 ingestOrefForCII(updAlerts, updHistory);
 const updateObservations = this.dedupeConflictObservations(
   orefAlertsToObservations(update.alerts ?? []),
 );
 if (updateObservations.length > 0) ingestObservations(updateObservations);
 this.ctx.intelligenceCache.orefAlerts = { alertCount: updAlerts, historyCount24h: updHistory };
 });
 startOrefPolling();
 } catch (error) {
 console.error('[Intelligence] OREF alerts fetch failed:', error);
 }
 })());

 // GPS/GNSS jamming
 tasks.push((async () => {
 try {
 const data = await fetchGpsInterference();
 if (!data) {
 ingestGpsJammingForCII([]);
 this.ctx.map?.setLayerReady('gpsJamming', false);
 return;
 }
 ingestGpsJammingForCII(data.hexes);
 ingestGpsToSigint(data.hexes);
 if (this.ctx.mapLayers.gpsJamming) {
 this.ctx.map?.setGpsJamming(data.hexes);
 this.ctx.map?.setLayerReady('gpsJamming', data.hexes.length > 0);
 }
 this.ctx.statusPanel?.updateFeed('GPS Jam', { status: 'ok', itemCount: data.hexes.length });
 dataFreshness.recordUpdate('gpsjam', data.hexes.length);
 } catch (error) {
 this.ctx.map?.setLayerReady('gpsJamming', false);
 this.ctx.statusPanel?.updateFeed('GPS Jam', { status: 'error' });
 dataFreshness.recordError('gpsjam', String(error));
 }
 })());

 await Promise.allSettled(tasks);

 try {
 const ucdpEvts = (this.ctx.panels['ucdp-events'] as UcdpEventsPanel)?.getEvents?.() || [];
 const events = [
 ...(this.ctx.intelligenceCache.protests?.events || []).slice(0, 10).map(e => ({
 id: e.id, lat: e.lat, lon: e.lon, type: 'conflict' as const, name: e.title || 'Protest',
 })),
 ...ucdpEvts.slice(0, 10).map(e => ({
 id: e.id, lat: e.latitude, lon: e.longitude, type: e.type_of_violence as string, name: `${e.side_a} vs ${e.side_b}`,
 })),
 ];
 if (events.length > 0) {
 const exposures = await enrichEventsWithExposure(events);
 (this.ctx.panels['population-exposure'] as PopulationExposurePanel)?.setExposures(exposures);
 if (exposures.length > 0) dataFreshness.recordUpdate('worldpop', exposures.length);
 } else {
 (this.ctx.panels['population-exposure'] as PopulationExposurePanel)?.setExposures([]);
 }
 } catch (error) {
 console.error('[Intelligence] Population exposure fetch failed:', error);
 dataFreshness.recordError('worldpop', String(error));
 }

 (this.ctx.panels.cii as CIIPanel)?.refresh();
 rollPoLBaseline();
 updateCompoundThreatLevels(
 this.ctx.cyberThreatsCache ?? [],
 this.ctx.intelligenceCache.earthquakes ?? [],
 (this.ctx.intelligenceCache.outages ?? []).map(o => ({ score: o.severity === 'total' ? 10 : o.severity === 'major' ? 7 : 3 })),
 );
 if (import.meta.env.DEV) console.log('[Intelligence] All signals loaded for CII calculation');  
  }

  async loadOutages(): Promise<void> {
 if (this.ctx.intelligenceCache.outages) {
 const outages = this.ctx.intelligenceCache.outages;
 this.ctx.map?.setOutages(outages);
 this.ctx.map?.setLayerReady('outages', outages.length > 0);
 this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
 return;
 }
 try {
 const outages = await fetchInternetOutages();
 this.ctx.intelligenceCache.outages = outages;
 this.ctx.map?.setOutages(outages);
 this.ctx.map?.setLayerReady('outages', outages.length > 0);
 ingestOutagesForCII(outages);
 signalAggregator.ingestOutages(outages);
 this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
 dataFreshness.recordUpdate('outages', outages.length);
 } catch (error) {
 this.ctx.map?.setLayerReady('outages', false);
 this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'error' });
 dataFreshness.recordError('outages', String(error));
 }
  }

  async loadCyberThreats(): Promise<void> {
 if (!CYBER_LAYER_ENABLED) {
 this.ctx.mapLayers.cyberThreats = false;
 this.ctx.map?.setLayerReady('cyberThreats', false);
 return;
 }

 if (this.ctx.cyberThreatsCache) {
 this.ctx.map?.setCyberThreats(this.ctx.cyberThreatsCache);
 this.ctx.map?.setLayerReady('cyberThreats', this.ctx.cyberThreatsCache.length > 0);
 ingestCyberThreatsForCII(this.ctx.cyberThreatsCache);
 (this.ctx.panels.cii as CIIPanel)?.refresh();
 (this.ctx.panels['cyber-threats'] as CyberThreatPanel)?.update(this.ctx.cyberThreatsCache);
 this.ctx.statusPanel?.updateFeed('Cyber Threats', { status: 'ok', itemCount: this.ctx.cyberThreatsCache.length });
 return;
 }

 try {
 const [threats, tfIocs, openPhish, spamhaus, cisaKev, otxIocs, phishStats] = await Promise.all([
 fetchCyberThreats({ limit: 500, days: 14 }),
 fetchThreatFoxIOCs(),
 fetchOpenPhishFeed(),
 fetchSpamhausDrop(),
 fetchCisaKev(),
 fetchOtxIOCs(),
 fetchPhishStatsFeed(),
 ]);
 const allThreats = [...threats, ...tfIocs, ...openPhish, ...spamhaus, ...cisaKev, ...otxIocs, ...phishStats];
 this.ctx.cyberThreatsCache = allThreats;
 this.ctx.map?.setCyberThreats(allThreats);
 this.ctx.map?.setLayerReady('cyberThreats', allThreats.length > 0);
 ingestCyberThreatsForCII(allThreats);
 ingestCyberToIoc(allThreats);
 ingestCisaKevToIoc(allThreats);
 ingestCyberToKillChain(allThreats);
 checkGeofenceCyber(allThreats);
 ingestCyberToPoL(allThreats);
 ingestCyberToConvergence(allThreats);
 ingestCisaToIcsOt(allThreats);
 ingestCyberToGraph(allThreats);
 ingestCyberToTimeline(allThreats);
 ingestCyberToMatrix(allThreats);
 ingestCyberThreatsUnified(allThreats);
 (this.ctx.panels.cii as CIIPanel)?.refresh();
 (this.ctx.panels['cyber-threats'] as CyberThreatPanel)?.update(allThreats);
 this.ctx.statusPanel?.updateFeed('Cyber Threats', { status: 'ok', itemCount: allThreats.length });
 this.ctx.statusPanel?.updateApi('Cyber Threats API', { status: 'ok' });
 dataFreshness.recordUpdate('cyber_threats', allThreats.length);
 } catch (error) {
 (this.ctx.panels['cyber-threats'] as CyberThreatPanel)?.update([]);
 this.ctx.map?.setLayerReady('cyberThreats', false);
 this.ctx.statusPanel?.updateFeed('Cyber Threats', { status: 'error', errorMessage: String(error) });
 this.ctx.statusPanel?.updateApi('Cyber Threats API', { status: 'error' });
 dataFreshness.recordError('cyber_threats', String(error));
 }
  }

  async loadLocalIDS(): Promise<void> { return cyberLoaders.loadLocalIDS(this.ctx); }
  async loadLittleSnitch(): Promise<void> { return cyberLoaders.loadLittleSnitch(this.ctx); }

  // Space domain → src/app/loaders/space.ts
  async loadSpaceWeather(): Promise<void> { return spaceLoaders.loadSpaceWeather(this.ctx); }
  async loadSpaceflightNews(): Promise<void> { return spaceLoaders.loadSpaceflightNews(this.ctx); }
  async loadSpaceLaunches(): Promise<void> { return spaceLoaders.loadSpaceLaunches(this.ctx); }

  // Disease + humanitarian → src/app/loaders/disease.ts
  async loadDiseaseOutbreaks(): Promise<void> { return diseaseLoaders.loadDiseaseOutbreaks(this.ctx); }
  async loadDiseaseIntel(): Promise<void> { return diseaseLoaders.loadDiseaseIntel(this.ctx); }
  async loadHumanitarianCrises(): Promise<void> { return diseaseLoaders.loadHumanitarianCrises(this.ctx); }

  // Hazard pipeline → src/app/loaders/hazards.ts
  // The compound-threat evaluator still owns cross-domain data, so we pass it
  // in as a callback rather than importing it from the loader module.
  async loadAirQuality(): Promise<void> { return hazardLoaders.loadAirQuality(this.ctx, () => void this.evaluateCompoundThreats()); }
  async loadWildfireIncidents(): Promise<void> { return hazardLoaders.loadWildfireIncidents(this.ctx, () => void this.evaluateCompoundThreats()); }
  async loadWildfireIntel(): Promise<void> { return hazardLoaders.loadWildfireIntel(this.ctx); }
  async loadPurpleAir(): Promise<void> { return hazardLoaders.loadPurpleAir(this.ctx); }
  async loadHazmatIncidents(): Promise<void> { return hazardLoaders.loadHazmatIncidents(this.ctx, () => void this.evaluateCompoundThreats()); }
  async loadOilSpills(): Promise<void> { return hazardLoaders.loadOilSpills(this.ctx); }

  async evaluateCompoundThreats(): Promise<void> {
 try {
 const [wildfires, aqReadings, hazmat, floodGauges, damAlerts, gridAlerts, openaqReadings] = await Promise.allSettled([
 fetchInciwebIncidents(),
 fetchGlobalAirQuality(),
 fetchHazmatIncidents(),
 fetchFloodGauges(),
 fetchDamSafetyAlerts(),
 fetchPowerGridAlerts(),
 fetchOpenaqWorstReadings(),
 ]);

 // Second air-quality source for fusion (OpenAQ ground stations). Fail-closed:
 // a degraded/failed fetch records ok=false so the provider health drops.
 if (openaqReadings.status === 'fulfilled') {
 const r = openaqReadings.value;
 recordDomainObservations('openaq-v3', openaqToObservations(r.readings), r.ok);
 } else {
 recordDomainObservations('openaq-v3', [], false);
 }

 const signals = [];

 // Wildfire signals
 if (wildfires.status === 'fulfilled') {
 for (const inc of wildfires.value) {
 if (inc.lat === null || inc.lon === null) continue;
 if (inc.severity === 'low') continue;
 signals.push(toHazardSignal(inc.id, 'wildfire', inc.severity, inc.lat, inc.lon, inc.name, 'inciweb'));
 }
 }

 // Air quality signals — unhealthy or worse
 if (aqReadings.status === 'fulfilled') {
 recordDomainObservations('open-meteo-aqi', openMeteoAqToObservations(aqReadings.value), true);
 for (const r of aqReadings.value) {
 if (r.aqiLevel === 'good' || r.aqiLevel === 'moderate' || r.aqiLevel === 'sensitive') continue;
 const sev = r.aqiLevel === 'hazardous' ? 'critical' : r.aqiLevel === 'very_unhealthy' ? 'high' : 'medium';
 signals.push(toHazardSignal(`aq-${r.city}`, 'air_quality', sev, r.lat, r.lon, `${r.city} AQI ${r.aqi}`, 'air-quality'));
 }
 } else {
 recordDomainObservations('open-meteo-aqi', [], false);
 }

 // Hazmat signals
 if (hazmat.status === 'fulfilled') {
 for (const inc of hazmat.value) {
 if (inc.lat === null || inc.lon === null) continue;
 if (inc.severity === 'low') continue;
 signals.push(toHazardSignal(inc.id, 'industrial', inc.severity, inc.lat, inc.lon, inc.title, 'hazmat'));
 }
 }

 // Flood gauge signals — major or moderate only
 if (floodGauges.status === 'fulfilled') {
 for (const g of floodGauges.value) {
 if (g.floodCategory !== 'major' && g.floodCategory !== 'moderate') continue;
 const sev = g.floodCategory === 'major' ? 'critical' : 'high';
 signals.push(toHazardSignal(g.id, 'flood', sev, g.lat, g.lon, g.siteName, 'flood-gauges'));
 }
 }

 // Dam safety signals
 if (damAlerts.status === 'fulfilled') {
 for (const a of damAlerts.value) {
 if (a.lat === null || a.lon === null) continue;
 signals.push(toHazardSignal(a.id, 'flood', a.severity, a.lat, a.lon, a.damName, 'dam-safety'));
 }
 }

 // Grid alerts — map to approximate US region centroid
 const REGION_COORDS: Record<string, [number, number]> = {
 WECC: [37.5, -110.0], SERC: [33.0, -86.0], RFC: [41.0, -80.0],
 NPCC: [42.5, -73.0], MRO: [45.0, -93.0], FRCC: [27.0, -81.0],
 Texas: [31.0, -99.0], California: [36.5, -119.0], PJM: [40.0, -77.0],
 MISO: [42.0, -89.0], SPP: [38.0, -97.0], NYISO: [43.0, -75.0],
 ISONE: [43.5, -71.5],
 };
 if (gridAlerts.status === 'fulfilled') {
 for (const a of gridAlerts.value) {
 if (a.severity === 'low' || a.alertType === 'info') continue;
 const regionKey = Object.keys(REGION_COORDS).find(k => a.region.includes(k));
 const [lat, lon] = REGION_COORDS[regionKey ?? ''] ?? [38.0, -97.0];
 signals.push(toHazardSignal(a.id, 'grid', a.severity, lat, lon, a.title, 'power-grid'));
 }
 }

 // Cyber threat signals from cached layer data
 if (this.ctx.cyberThreatsCache) {
 const highCyber = this.ctx.cyberThreatsCache.filter(t => t.severity === 'critical' || t.severity === 'high');
 for (const t of highCyber.slice(0, 20)) {
 signals.push(toHazardSignal(t.id, 'cyber', t.severity as 'critical' | 'high', t.lat, t.lon, t.indicator, 'cyber-threats'));
 }
 }

 const threats = detectCompoundThreats(signals);
 if (threats.length > 0) {
 document.dispatchEvent(new CustomEvent('wm:compound-threats-updated', { detail: threats }));
 for (const threat of threats) {
 if (threat.overallSeverity !== 'medium') {
 notificationDispatcher.dispatchCompoundThreatAlert(threat);
 }
 const region = classifyRegion(threat.lat, threat.lon);
 if (region) {
 const sevMap: Record<string, 'medium' | 'high' | 'critical'> = {
 medium: 'medium', high: 'high', critical: 'critical',
 };
 const domainMap: Record<string, 'military' | 'cyber' | 'weather' | 'infrastructure' | 'financial' | 'health' | 'conflict' | 'nuclear'> = {
 weather: 'weather', seismic: 'weather', wildfire: 'weather', flood: 'weather',
 industrial: 'infrastructure', grid: 'infrastructure', maritime: 'infrastructure',
 nuclear: 'nuclear', cyber: 'cyber', disease: 'health', conflict: 'conflict',
 food: 'financial', air_quality: 'weather',
 };
 for (const cat of threat.hazardCategories) {
 const domain = domainMap[cat];
 if (domain) {
 ingestCorrelationMatrix(threat.lat, threat.lon, domain, sevMap[threat.overallSeverity] ?? 'medium');
 }
 }
 }
 }
 }
 } catch (error) {
 console.warn('[compound-threats] evaluation failed', error);
 }
  }

  async loadGDACSAlerts(): Promise<void> {
 try {
 const { data: events } = await withOfflineCache('gdacs-events', () => fetchGDACSEvents(), 1 * 60 * 60 * 1000);
 this.ctx.intelligenceCache.gdacsAlerts = events;
 (this.ctx.panels['gdacs-alerts'] as GDACSAlertsPanel)?.update(events);
 unifiedAlertStore.ingest(events.map(normalizeGDACSEvent));

 // Wire GDACS into correlation matrix
 for (const event of events) {
 if (!event.coordinates) continue;
 const [lon, lat] = event.coordinates;
 if (lat == null || lon == null) continue;
 const region = classifyRegion(lat, lon);
 if (!region) continue;
 const severity: 'low' | 'medium' | 'high' | 'critical' =
 event.alertLevel === 'Red' ? 'critical'
 : event.alertLevel === 'Orange' ? 'high'
 : 'medium';
 // GDACS events map to 'weather' domain for hydrometeorological, 'infrastructure' for others
 const domain = (event.eventType === 'TC' || event.eventType === 'FL' || event.eventType === 'DR') ? 'weather' : 'infrastructure';
 ingestCorrelationMatrix(lat, lon, domain, severity);
 }
 } catch (error) {
 console.warn('[gdacs-alerts] fetch failed', error);
 (this.ctx.panels['gdacs-alerts'] as GDACSAlertsPanel)?.update([]);
 }
  }

  /** NOAA CO-OPS flood gauge observations — redundant source alongside USGS water data.
   *  Feeds the intelligence layer so compound-risk and truth-score get multi-source
   *  corroboration when both NOAA and USGS flag elevated water in the same area. */
  async loadFloodGauges(): Promise<void> {
    try {
      const { getSavedPlaces } = await import('@/services/saved-places');
      const places = getSavedPlaces().slice(0, 3);
      await Promise.allSettled(places.map(async (place) => {
        if (!place.lat || !place.lon) return;
        // The two sources are independent — fetch them concurrently rather than
        // serializing the river-discharge call behind the CO-OPS call.
        const coopsUrl = `${getApiBaseUrl()}/api/flood-gauges/noaa-coops?lat=${place.lat}&lon=${place.lon}`;
        const dischargeUrl = `${getApiBaseUrl()}/api/river-discharge?lat=${place.lat}&lon=${place.lon}`;
        // Independent + slow-changing — fetch concurrently, cache per lat,lon 30m.
        const [coops, discharge] = await Promise.all([
          fetchJsonCached<NOAACoopsResponse>(coopsUrl, 30 * 60_000),
          fetchJsonCached<OpenMeteoFloodForecast>(dischargeUrl, 30 * 60_000),
        ]);
        // Source 1: NOAA CO-OPS current water level
        if (coops) {
          const obs = floodGaugesToObservations(coops, place.name ?? 'Saved Place');
          if (obs.length > 0) ingestObservations(obs);
        }
        // Source 2: Open-Meteo GloFAS river discharge forecast (7-day predictive)
        if (discharge) {
          const obs = riverDischargeToObservations(discharge, place.lat, place.lon, place.name ?? 'Saved Place');
          if (obs.length > 0) ingestObservations(obs);
        }
      }));
    } catch {
      /* flood gauge failure is non-critical — USGS is the primary water source */
    }
  }

  /** Marine sea-state + food-security intelligence: fills maritime domain
   *  observation gap and feeds shortage models with genuine early-warning data. */
  async loadExpandedIntelligence(): Promise<void> {
    try {
      const { getSavedPlaces } = await import('@/services/saved-places');
      const places = getSavedPlaces().slice(0, 3);

      // Open-Meteo Marine forecast for each saved place (wave/swell/current)
      await Promise.allSettled(places.map(async (place) => {
        if (!place.lat || !place.lon) return;
        const url = `${getApiBaseUrl()}/api/marine-forecast?lat=${place.lat}&lon=${place.lon}`;
        const marine = await fetchJsonCached<OpenMeteoMarineForecast>(url, 30 * 60_000);
        if (!marine) return;
        const obs = marineForecastToObservations(marine, place.lat, place.lon, place.name ?? 'Saved Place');
        if (obs.length > 0) ingestObservations(obs);
      }));

      // FEWS NET IPC food-security packages (global)
      const fewsUrl = `${getApiBaseUrl()}/api/fews-net/food-security?country_code=all`;
      const fr = await fetch(fewsUrl);
      if (fr.ok) {
        const obs = fewsNetToObservations(await fr.json() as FEWSNETResponse);
        if (obs.length > 0) ingestObservations(obs);
      }

      // HDX HAPI food-security rows (global IPC-coded)
      // Gate behind the shared circuit breaker — when the sebuf HAPI RPC path
      // (fetchHapiSummary) is on cooldown, this direct fetch would also fail
      // and generate redundant errors / heat.
      if (!getCircuitBreakerCooldownInfo('HDX HAPI').onCooldown) {
        const hdxUrl = `${getApiBaseUrl()}/api/hdx-food-security`;
        const hr = await fetch(hdxUrl);
        if (hr.ok) {
          const obs = hdxHapiToObservations(await hr.json() as HDXHAPIResponse);
          if (obs.length > 0) ingestObservations(obs);
        }
      }

      // Assumption tracking — annotate once per batch (not per observation).
      try {
        const { annotateModelOutput } = await import('@/services/intelligence/assumption-producers');
        const batch = getRecentObservations(50);
        if (batch.length > 0) {
          const latestId = batch[batch.length - 1]!.id;
          annotateModelOutput(`hazard-batch-${latestId}`, 'score', { observations: batch }, { algorithmId: 'big-event-detector', domain: 'intelligence' });
        }
      } catch { /* assumption instrumentation is non-critical */ }
    } catch {
      /* expanded intelligence is supplemental — failures are non-critical */
    }
  }

  async loadVolcanoAlerts(): Promise<void> { return cyberLoaders.loadVolcanoAlerts(this.ctx); }
  async loadVolcanoMonitor(): Promise<void> { return cyberLoaders.loadVolcanoMonitor(this.ctx); }
  async loadSevereWeather(): Promise<void> { return cyberLoaders.loadSevereWeather(this.ctx); }
  async loadShakeAlert(): Promise<void> { return cyberLoaders.loadShakeAlert(this.ctx); }

  async loadNWSAlerts(): Promise<void> {
 try {
 const stormContext = getStormPreparednessContext();
 const [alertsResult, spcResult, marineResult, rainfallResult, winterResult] = await Promise.allSettled([
 withOfflineCache('nws-alerts', () => fetchNWSAlerts(), 1 * 60 * 60 * 1000).then(r => r.data),
 fetchSpcSummary(),
 fetchMarineHazards(),
 fetchExcessiveRainfallOutlooks(),
 fetchWinterWeatherOutlooks(),
 ]);
 const alerts = alertsResult.status === 'fulfilled' ? alertsResult.value : stormContext.nwsAlerts;
 const spcSummary = spcResult.status === 'fulfilled' ? spcResult.value : stormContext.spcSummary;
 const marineHazards = marineResult.status === 'fulfilled' ? marineResult.value : stormContext.marineHazards;
 const excessiveRainfallOutlooks = rainfallResult.status === 'fulfilled'
 ? rainfallResult.value
 : stormContext.excessiveRainfallOutlooks;
 const winterWeatherOutlooks = winterResult.status === 'fulfilled'
 ? winterResult.value
 : stormContext.winterWeatherOutlooks;
 const minimalAlerts = alerts.map(nwsAlertMinimal);
 (this.ctx.panels['nws-alerts'] as NWSAlertsPanel)?.update(alerts);
 unifiedAlertStore.ingest(alerts.map(normalizeNWSAlert));
 recordWarningPredictions(minimalAlerts);

 // Route alerts through Personal Storm Mode — find the highest-priority
 // decision across all alerts × saved places and broadcast it so the
 // PersonalStormMode component can show/hide the storm banner.
 // Polygon (when present) + UGC zones are threaded into the minimal so the
 // matcher can do point-in-polygon and fall back to zone matching.
 try {
 const { getSavedPlaces } = await import('@/services/saved-places');
 const { resolveSavedPlaceZones, toMatcherPlace } = await import('@/services/weather/saved-place-adapter');
 const places = getSavedPlaces();
 if (places.length > 0) {
 // Adapt saved-places.SavedPlace to weather-threat-types.SavedPlace via the
 // shared adapter — carries radiusKm (near-polygon buffer) AND resolved UGC
 // zones (zone fallback), which this site used to drop on both counts.
 const placeZonesById = await resolveSavedPlaceZones(places);
 const weatherPlaces = places.map(p => toMatcherPlace(p, placeZonesById.get(p.id)));
 let bestDecision = undefined;
 for (const minimal of minimalAlerts) {
 const decision = routeWeatherAlert(minimal, weatherPlaces);
 // Require a real Storm Mode payload (the router only builds one at
 // banner+ priority) — `payload?.activation !== 'inactive'` alone would
 // let payload-less digest/watch decisions activate the strip.
 if (decision.payload && decision.payload.activation !== 'inactive' && (!bestDecision ||
 deliveryPriorityRank(decision.urgency?.priority ?? 'background')
 > deliveryPriorityRank(bestDecision.urgency?.priority ?? 'background'))) {
 bestDecision = decision;
 }
 }
 document.dispatchEvent(new CustomEvent('cb:storm-decision', { detail: bestDecision }));
 }
 } catch { /* saved-places unavailable — non-fatal */ }

 updateStormPreparednessContext({
 nwsAlerts: alerts,
 spcSummary,
 excessiveRainfallOutlooks,
 winterWeatherOutlooks,
 marineHazards,
 });
 } catch (error) {
 console.warn('[nws-alerts] fetch failed', error);
 (this.ctx.panels['nws-alerts'] as NWSAlertsPanel)?.update([]);
 }
  }

  // Utility / infrastructure → src/app/loaders/utility.ts
  async loadSavedPlaceWeather(): Promise<void> { return utilityLoaders.loadSavedPlaceWeather(); }
  async loadCommsHealth(): Promise<void> { return utilityLoaders.loadCommsHealth(this.ctx); }
  async loadPowerGrid(): Promise<void> { return utilityLoaders.loadPowerGrid(this.ctx); }
  async loadEconomicStress(): Promise<void> { return utilityLoaders.loadEconomicStress(this.ctx); }
  async loadFederalRegister(): Promise<void> { return utilityLoaders.loadFederalRegister(this.ctx); }

  async runEMAForecast(): Promise<void> {
 // Accumulate event counts per country from cached intelligence data
 const regionCounts = new Map<string, number>();

 const protests = this.ctx.intelligenceCache?.protests?.events ?? [];
 for (const e of protests) {
 const key = e.country || e.region || 'Unknown';
 regionCounts.set(key, (regionCounts.get(key) ?? 0) + 1);
 }

 const earthquakes = this.ctx.intelligenceCache?.earthquakes ?? [];
 for (const eq of earthquakes) {
 if (eq.magnitude >= 5 && eq.place) {
 // Use the full place string as the EMA key rather than the trailing
 // component (e.g. "CA" or "Japan region") to avoid false merging with
 // protest-event region series that use ISO country codes.  Each seismic
 // zone gets its own independent EMA series this way.
 const key = eq.place;
 regionCounts.set(key, (regionCounts.get(key) ?? 0) + 1);
 }
 }

 // Update EMA for each tracked region
 for (const [region, count] of regionCounts.entries()) {
 updateRegionCount(region, count);
 }

 // Check for high-risk regions and emit velocity_spike signals into war threat evaluation
 const highRisk = getHighRiskRegions();

 // Dispatch EMA forecast event for sidebar sparklines
 document.dispatchEvent(new CustomEvent('wm:ema-forecast', {
 detail: {
 regions: highRisk.slice(0, 6).map(r => ({
 region:  r.region,
 risk24h: r.risk24h,
 trending: r.trending,
 })),
 },
 }));

 if (highRisk.length >= 2) {
 // 2+ high-risk regions = elevated conflict intelligence signal
 reportElevatedPanel('ucdp-events', 'UCDP Conflict Events');
 }
 if (highRisk.length > 0) {
 const signals = highRisk.slice(0, 3).map(forecast => {
 const countryIso3 = countryIso3Slug(forecast.region);
 return {
 id: `ema-forecast-${forecast.region}-${Date.now()}`,
 type: 'velocity_spike' as const,
 title: `EMA Forecast: ${forecast.region}`,
 description: `Risk ${forecast.risk24h}% (${forecast.trending}, ${forecast.deviation.toFixed(1)}σ above baseline)`,
 confidence: Math.min(0.95, forecast.risk24h / 100),
 timestamp: new Date(),
 data: {
 newsVelocity: forecast.currentCount,
 baseline: forecast.ema,
 multiplier: forecast.deviation,
 relatedTopics: [forecast.region],
 explanation: `EMA deviation ${forecast.deviation.toFixed(1)}σ — 24h escalation risk ${forecast.risk24h}%`,
 placeIds: countryIso3 ? [countryIso3.toUpperCase()] : [],
 placeSummary: forecast.region,
 },
 };
 });
 addToSignalHistory(signals);
 situationEngine.observeSignals(signals);
 }
  }

  async loadGlobalWeather(): Promise<void> { return utilityLoaders.loadGlobalWeather(this.ctx); }
  async loadOpenSanctions(): Promise<void> { return utilityLoaders.loadOpenSanctions(this.ctx); }
  async loadEdgarFilings(): Promise<void> { return utilityLoaders.loadEdgarFilings(this.ctx); }

  async loadIranEvents(): Promise<void> {
 try {
 const events = await fetchIranEvents();
 this.ctx.intelligenceCache.iranEvents = events;
 this.ctx.map?.setIranEvents(events);
 this.ctx.map?.setLayerReady('iranAttacks', events.length > 0);
 signalAggregator.ingestConflictEvents(events);
 ingestStrikesForCII(events);
 (this.ctx.panels.cii as CIIPanel)?.refresh();
 } catch {
 this.ctx.map?.setLayerReady('iranAttacks', false);
 }
  }

  async loadAisSignals(): Promise<void> {
 try {
 const { disruptions, density } = await fetchAisSignals();
 const aisStatus = getAisStatus();
 if (import.meta.env.DEV) console.log('[Ships] Events:', { disruptions: disruptions.length, density: density.length, vessels: aisStatus.vessels });  
 this.ctx.map?.setAisData(disruptions, density);
 signalAggregator.ingestAisDisruptions(disruptions);
 ingestAisDisruptionsForCII(disruptions);
 ingestAisToDarkVessel(disruptions);
 ingestObservations(aisDisruptionsToObservations(disruptions));
 (this.ctx.panels.cii as CIIPanel)?.refresh();
 updateAndCheck([
 { type: 'ais_gaps', region: 'global', count: disruptions.length },
 ]).then(anomalies => {
 if (anomalies.length > 0) {
 signalAggregator.ingestTemporalAnomalies(anomalies);
 ingestTemporalAnomaliesForCII(anomalies);
 (this.ctx.panels.cii as CIIPanel)?.refresh();
 }
 }).catch(() => {});

 const hasData = disruptions.length > 0 || density.length > 0;
 this.ctx.map?.setLayerReady('ais', hasData);

 const shippingCount = disruptions.length + density.length;
 const shippingStatus = shippingCount > 0 ? 'ok' : (aisStatus.connected ? 'warning' : 'error');
 this.ctx.statusPanel?.updateFeed('Shipping', {
 status: shippingStatus,
 itemCount: shippingCount,
 errorMessage: !aisStatus.connected && shippingCount === 0 ? 'AIS snapshot unavailable' : undefined,
 });
 this.ctx.statusPanel?.updateApi('AISStream', {
 status: aisStatus.connected ? 'ok' : 'warning',
 });
 if (hasData) {
 dataFreshness.recordUpdate('ais', shippingCount);
 }
 this.pushObservationsToSidecar();
 } catch (error) {
 this.ctx.map?.setLayerReady('ais', false);
 this.ctx.statusPanel?.updateFeed('Shipping', { status: 'error', errorMessage: String(error) });
 this.ctx.statusPanel?.updateApi('AISStream', { status: 'error' });
 dataFreshness.recordError('ais', String(error));
 }
  }

  waitForAisData(): void {
 const maxAttempts = 30;
 let attempts = 0;

 const checkData = () => {
 if (this.ctx.isDestroyed) return;
 attempts++;
 const status = getAisStatus();

 if (status.vessels > 0 || status.connected) {
 this.loadAisSignals();
 this.ctx.map?.setLayerLoading('ais', false);
 return;
 }

 if (attempts >= maxAttempts) {
 this.ctx.map?.setLayerLoading('ais', false);
 this.ctx.map?.setLayerReady('ais', false);
 this.ctx.statusPanel?.updateFeed('Shipping', {
 status: 'error',
 errorMessage: 'Connection timeout'
 });
 return;
 }

 setTimeout(checkData, 1000);
 };

 checkData();
  }

  async loadCableActivity(): Promise<void> {
 try {
 const activity = await fetchCableActivity();
 this.ctx.map?.setCableActivity(activity.advisories, activity.repairShips);
 const itemCount = activity.advisories.length + activity.repairShips.length;
 this.ctx.statusPanel?.updateFeed('CableOps', { status: 'ok', itemCount });
 } catch {
 this.ctx.statusPanel?.updateFeed('CableOps', { status: 'error' });
 }
  }

  async loadCableHealth(): Promise<void> {
 try {
 const healthData = await fetchCableHealth();
 this.ctx.map?.setCableHealth(healthData.cables);
 ingestCableToSigint(healthData.cables);
 ingestCableToTopology(healthData.cables);
 const cableIds = Object.keys(healthData.cables);
 const faultCount = cableIds.filter((id) => healthData.cables[id]?.status === 'fault').length;
 const degradedCount = cableIds.filter((id) => healthData.cables[id]?.status === 'degraded').length;
 this.ctx.statusPanel?.updateFeed('CableHealth', { status: 'ok', itemCount: faultCount + degradedCount });
 } catch {
 this.ctx.statusPanel?.updateFeed('CableHealth', { status: 'error' });
 }
  }

  async loadProtests(): Promise<void> {
 if (this.ctx.intelligenceCache.protests) {
 const protestData = this.ctx.intelligenceCache.protests;
 const cachedObservations = this.dedupeConflictObservations(
   unrestEventsToObservations(protestData.events),
 );
 if (cachedObservations.length > 0) ingestObservations(cachedObservations);
 this.ctx.map?.setProtests(protestData.events);
 this.ctx.map?.setLayerReady('protests', protestData.events.length > 0);
 const status = getProtestStatus();
 this.ctx.statusPanel?.updateFeed('Protests', {
 status: 'ok',
 itemCount: protestData.events.length,
 errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
 });
 if (status.acledConfigured === true) {
 this.ctx.statusPanel?.updateApi('ACLED', { status: 'ok' });
 } else if (status.acledConfigured === null) {
 this.ctx.statusPanel?.updateApi('ACLED', { status: 'warning' });
 }
 this.ctx.statusPanel?.updateApi('GDELT Doc', { status: 'ok' });
 if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt_doc', protestData.sources.gdelt);
 return;
 }
 try {
 const protestData = await fetchProtestEvents();
 this.ctx.intelligenceCache.protests = protestData;
 this.ctx.map?.setProtests(protestData.events);
 this.ctx.map?.setLayerReady('protests', protestData.events.length > 0);
 ingestProtests(protestData.events);
 const unrestObservations = this.dedupeConflictObservations(
   unrestEventsToObservations(protestData.events),
 );
 if (unrestObservations.length > 0) ingestObservations(unrestObservations);
 ingestProtestsForCII(protestData.events);
 signalAggregator.ingestProtests(protestData.events);
 const protestCount = protestData.sources.acled + protestData.sources.gdelt;
 if (protestCount > 0) dataFreshness.recordUpdate('acled', protestCount);
 if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt', protestData.sources.gdelt);
 if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt_doc', protestData.sources.gdelt);
 (this.ctx.panels.cii as CIIPanel)?.refresh();
 const status = getProtestStatus();
 this.ctx.statusPanel?.updateFeed('Protests', {
 status: 'ok',
 itemCount: protestData.events.length,
 errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
 });
 if (status.acledConfigured === true) {
 this.ctx.statusPanel?.updateApi('ACLED', { status: 'ok' });
 } else if (status.acledConfigured === null) {
 this.ctx.statusPanel?.updateApi('ACLED', { status: 'warning' });
 }
 this.ctx.statusPanel?.updateApi('GDELT Doc', { status: 'ok' });
 } catch (error) {
 this.ctx.map?.setLayerReady('protests', false);
 this.ctx.statusPanel?.updateFeed('Protests', { status: 'error', errorMessage: String(error) });
 this.ctx.statusPanel?.updateApi('ACLED', { status: 'error' });
 this.ctx.statusPanel?.updateApi('GDELT Doc', { status: 'error' });
 dataFreshness.recordError('gdelt_doc', String(error));
 }
  }

  async loadFlightDelays(): Promise<void> {
 try {
 const delays = await fetchFlightDelays();
 this.ctx.map?.setFlightDelays(delays);
 this.ctx.map?.setLayerReady('flights', delays.length > 0);
 this.ctx.intelligenceCache.flightDelays = delays;
 const severe = delays.filter(d => d.severity === 'major' || d.severity === 'severe' || d.delayType === 'closure');
 if (severe.length > 0) ingestAviationForCII(severe);
 this.ctx.statusPanel?.updateFeed('Flights', {
 status: 'ok',
 itemCount: delays.length,
 });
 this.ctx.statusPanel?.updateApi('FAA', { status: 'ok' });
 } catch (error) {
 this.ctx.map?.setLayerReady('flights', false);
 this.ctx.statusPanel?.updateFeed('Flights', { status: 'error', errorMessage: String(error) });
 this.ctx.statusPanel?.updateApi('FAA', { status: 'error' });
 }
  }

  async loadMilitary(): Promise<void> {
 if (this.ctx.intelligenceCache.military) {
 const { flights, flightClusters, vessels, vesselClusters } = this.ctx.intelligenceCache.military;
 this.ctx.map?.setMilitaryFlights(flights, flightClusters);
 this.ctx.map?.setMilitaryVessels(vessels, vesselClusters);
 this.ctx.map?.updateMilitaryForEscalation(flights, vessels);
 this.loadCachedPosturesForBanner();
 const insightsPanel = this.ctx.panels.insights as InsightsPanel | undefined;
 insightsPanel?.setMilitaryFlights(flights);
 const hasData = flights.length > 0 || vessels.length > 0;
 this.ctx.map?.setLayerReady('military', hasData);
 const militaryCount = flights.length + vessels.length;
 this.ctx.statusPanel?.updateFeed('Military', {
 status: militaryCount > 0 ? 'ok' : 'warning',
 itemCount: militaryCount,
 errorMessage: militaryCount === 0 ? 'No military activity in view' : undefined,
 });
 this.ctx.statusPanel?.updateApi('OpenSky', { status: 'ok' });
 return;
 }
 try {
 if (isMilitaryVesselTrackingConfigured()) {
 initMilitaryVesselStream();
 }
 const [flightResult, vesselResult] = await Promise.all([
 withOfflineCache('military-signals', () => fetchMilitaryFlights(), 1 * 60 * 60 * 1000),
 withOfflineCache('military-vessels', () => fetchMilitaryVessels(), 1 * 60 * 60 * 1000),
 ]);
 const flightData = flightResult.data;
 const vesselData = vesselResult.data;
 this.ctx.intelligenceCache.military = {
 flights: flightData.flights,
 flightClusters: flightData.clusters,
 vessels: vesselData.vessels,
 vesselClusters: vesselData.clusters,
 };
 fetchUSNIFleetReport().then((report) => {
 if (report) this.ctx.intelligenceCache.usniFleet = report;
 }).catch(() => {});
 this.ctx.map?.setMilitaryFlights(flightData.flights, flightData.clusters);
 this.ctx.map?.setMilitaryVessels(vesselData.vessels, vesselData.clusters);
 ingestFlights(flightData.flights);
 ingestVessels(vesselData.vessels);
 ingestMilitaryForCII(flightData.flights, vesselData.vessels);
 signalAggregator.ingestFlights(flightData.flights);
 signalAggregator.ingestVessels(vesselData.vessels);
 updateAndCheck([
 { type: 'military_flights', region: 'global', count: flightData.flights.length },
 { type: 'vessels', region: 'global', count: vesselData.vessels.length },
 ]).then(anomalies => {
 if (anomalies.length > 0) {
 signalAggregator.ingestTemporalAnomalies(anomalies);
 ingestTemporalAnomaliesForCII(anomalies);
 (this.ctx.panels.cii as CIIPanel)?.refresh();
 }
 }).catch(() => {});
 this.ctx.map?.updateMilitaryForEscalation(flightData.flights, vesselData.vessels);
 (this.ctx.panels.cii as CIIPanel)?.refresh();
 if (!isInLearningMode()) {
 const surgeAlerts = analyzeFlightsForSurge(flightData.flights);
 if (surgeAlerts.length > 0) {
 const surgeSignals = surgeAlerts.map(surgeAlertToSignal);
 addToSignalHistory(surgeSignals);
 situationEngine.observeSignals(surgeSignals);
 (this.ctx.panels['alert-center'] as AlertCenterPanel)?.addSignals(surgeSignals);
 if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(surgeSignals);
 }
 const foreignAlerts = detectForeignMilitaryPresence(flightData.flights);
 if (foreignAlerts.length > 0) {
 const foreignSignals = foreignAlerts.map(foreignPresenceToSignal);
 addToSignalHistory(foreignSignals);
 situationEngine.observeSignals(foreignSignals);
 (this.ctx.panels['alert-center'] as AlertCenterPanel)?.addSignals(foreignSignals);
 if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(foreignSignals);
 }
 }

 // Compute local theater postures from live flight data — used as fallback
 // when the upstream cloud API is unreachable.
 ingestLocalPostures(getTheaterPostureSummaries(flightData.flights));

 this.loadCachedPosturesForBanner();
 const insightsPanel = this.ctx.panels.insights as InsightsPanel | undefined;
 insightsPanel?.setMilitaryFlights(flightData.flights);

 const hasData = flightData.flights.length > 0 || vesselData.vessels.length > 0;
 this.ctx.map?.setLayerReady('military', hasData);
 const militaryCount = flightData.flights.length + vesselData.vessels.length;
 this.ctx.statusPanel?.updateFeed('Military', {
 status: militaryCount > 0 ? 'ok' : 'warning',
 itemCount: militaryCount,
 errorMessage: militaryCount === 0 ? 'No military activity in view' : undefined,
 });
 this.ctx.statusPanel?.updateApi('OpenSky', { status: 'ok' });
 dataFreshness.recordUpdate('opensky', flightData.flights.length);
 } catch (error) {
 this.ctx.map?.setLayerReady('military', false);
 this.ctx.statusPanel?.updateFeed('Military', { status: 'error', errorMessage: String(error) });
 this.ctx.statusPanel?.updateApi('OpenSky', { status: 'error' });
 dataFreshness.recordError('opensky', String(error));
 }
  }

  private async loadCachedPosturesForBanner(): Promise<void> {
 try {
 const data = await fetchCachedTheaterPosture();
 if (data && data.postures.length > 0) {
 this.callbacks.renderCriticalBanner(data.postures);
 const posturePanel = this.ctx.panels['strategic-posture'] as StrategicPosturePanel | undefined;
 posturePanel?.updatePostures(data);
 }
 } catch (error) {
 console.warn('[App] Failed to load cached postures for banner:', error);
 }
  }

  async loadFredData(): Promise<void> {
 const economicPanel = this.ctx.panels.economic as EconomicPanel;
 const cbInfo = getCircuitBreakerCooldownInfo('FRED Economic');
 if (cbInfo.onCooldown) {
 economicPanel?.setErrorState(true, `Temporarily unavailable (retry in ${cbInfo.remainingSeconds}s)`);
 this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
 return;
 }

 try {
 economicPanel?.setLoading(true);
 const { data } = await withOfflineCache('economic-data', () => fetchFredData(), 4 * 60 * 60 * 1000);

 const postInfo = getCircuitBreakerCooldownInfo('FRED Economic');
 if (postInfo.onCooldown) {
 economicPanel?.setErrorState(true, `Temporarily unavailable (retry in ${postInfo.remainingSeconds}s)`);
 this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
 return;
 }

 if (data.length === 0) {
 if (!isFeatureAvailable('economicFred')) {
 if (economicPanel) showApiKeyGate(economicPanel, 'FRED_API_KEY', () => { void this.loadFredData(); });
 this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
 return;
 }
 economicPanel?.showRetrying();
 await new Promise(r => setTimeout(r, 20_000));
 const retryData = await fetchFredData();
 if (retryData.length === 0) {
 economicPanel?.setErrorState(true, 'FRED data temporarily unavailable — will retry');
 this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
 return;
 }
 economicPanel?.setErrorState(false);
 economicPanel?.update(retryData);
 this.ctx.statusPanel?.updateApi('FRED', { status: 'ok' });
 dataFreshness.recordUpdate('economic', retryData.length);
 return;
 }

 economicPanel?.setErrorState(false);
 economicPanel?.update(data);
 this.ctx.statusPanel?.updateApi('FRED', { status: 'ok' });
 dataFreshness.recordUpdate('economic', data.length);
 } catch {
 if (isFeatureAvailable('economicFred')) {
 economicPanel?.showRetrying();
 try {
 await new Promise(r => setTimeout(r, 20_000));
 const retryData = await fetchFredData();
 if (retryData.length > 0) {
 economicPanel?.setErrorState(false);
 economicPanel?.update(retryData);
 this.ctx.statusPanel?.updateApi('FRED', { status: 'ok' });
 dataFreshness.recordUpdate('economic', retryData.length);
 return;
 }
 } catch { /* fall through */ }
 }
 this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
 economicPanel?.setErrorState(true, 'FRED data temporarily unavailable — will retry');
 economicPanel?.setLoading(false);
 }
  }

  async loadOilAnalytics(): Promise<void> {
 const economicPanel = this.ctx.panels.economic as EconomicPanel;
 try {
 const data = await fetchOilAnalytics();
 economicPanel?.updateOil(data);
 const hasData = !!(data.wtiPrice || data.brentPrice || data.usProduction || data.usInventory);
 this.ctx.statusPanel?.updateApi('EIA', { status: hasData ? 'ok' : 'error' });
 if (hasData) {
 const metricCount = [data.wtiPrice, data.brentPrice, data.usProduction, data.usInventory].filter(Boolean).length;
 dataFreshness.recordUpdate('oil', metricCount || 1);
 } else {
 dataFreshness.recordError('oil', 'Oil analytics returned no values');
 }
 } catch (error) {
 console.error('[App] Oil analytics failed:', error);
 this.ctx.statusPanel?.updateApi('EIA', { status: 'error' });
 dataFreshness.recordError('oil', String(error));
 }
  }

  async loadGovernmentSpending(): Promise<void> {
 const economicPanel = this.ctx.panels.economic as EconomicPanel;
 try {
 const data = await fetchRecentAwards({ daysBack: 7, limit: 15 });
 economicPanel?.updateSpending(data);
 this.ctx.statusPanel?.updateApi('USASpending', { status: data.awards.length > 0 ? 'ok' : 'error' });
 if (data.awards.length > 0) {
 dataFreshness.recordUpdate('spending', data.awards.length);
 } else {
 dataFreshness.recordError('spending', 'No awards returned');
 }
 } catch (error) {
 console.error('[App] Government spending failed:', error);
 this.ctx.statusPanel?.updateApi('USASpending', { status: 'error' });
 dataFreshness.recordError('spending', String(error));
 }
  }

  async loadDodContracts(): Promise<void> {
 const panel = this.ctx.panels['dod-contracts'] as DodContractsPanel | undefined;
 try {
 const snap = await fetchDodContracts({ days: 7, limit: 20 });
 panel?.update(snap);
 if (snap.awards.length > 0) {
 dataFreshness.recordUpdate('dod-contracts', snap.awards.length);
 } else {
 dataFreshness.recordError('dod-contracts', 'no awards in window');
 }
 } catch (error) {
 dataFreshness.recordError('dod-contracts', error instanceof Error ? error.message : 'fetch failed');
 }
  }

  async loadWikidataBases(): Promise<void> {
 const panel = this.ctx.panels['wikidata-bases'] as WikidataBasesPanel | undefined;
 try {
 const snap = await fetchWikidataBases(2000);
 panel?.update(snap);
 if (snap.bases.length > 0) {
 dataFreshness.recordUpdate('wikidata-bases', snap.bases.length);
 } else {
 dataFreshness.recordError('wikidata-bases', 'empty result');
 }
 } catch (error) {
 dataFreshness.recordError('wikidata-bases', error instanceof Error ? error.message : 'fetch failed');
 }
  }

  async loadBisData(): Promise<void> {
 const economicPanel = this.ctx.panels.economic as EconomicPanel;
 try {
 const data = await fetchBisData();
 economicPanel?.updateBis(data);
 const hasData = data.policyRates.length > 0;
 this.ctx.statusPanel?.updateApi('BIS', { status: hasData ? 'ok' : 'error' });
 if (hasData) {
 dataFreshness.recordUpdate('bis', data.policyRates.length);
 }
 } catch (error) {
 console.error('[App] BIS data failed:', error);
 this.ctx.statusPanel?.updateApi('BIS', { status: 'error' });
 dataFreshness.recordError('bis', String(error));
 }
  }

  async loadTradePolicy(): Promise<void> {
 const tradePanel = this.ctx.panels['trade-policy'] as TradePolicyPanel | undefined;
 if (!tradePanel) return;

 try {
 const [restrictions, tariffs, flows, barriers] = await Promise.all([
 fetchTradeRestrictions([], 50),
 fetchTariffTrends('840', '156', '', 10),
 fetchTradeFlows('840', '156', 10),
 fetchTradeBarriers([], '', 50),
 ]);

 tradePanel.updateRestrictions(restrictions);
 tradePanel.updateTariffs(tariffs);
 tradePanel.updateFlows(flows);
 tradePanel.updateBarriers(barriers);

 const totalItems = restrictions.restrictions.length + tariffs.datapoints.length + flows.flows.length + barriers.barriers.length;
 const anyUnavailable = restrictions.upstreamUnavailable || tariffs.upstreamUnavailable || flows.upstreamUnavailable || barriers.upstreamUnavailable;

 this.ctx.statusPanel?.updateApi('WTO', { status: anyUnavailable ? 'warning' : (totalItems > 0 ? 'ok' : 'error') });

 if (totalItems > 0) {
 dataFreshness.recordUpdate('wto_trade', totalItems);
 } else if (anyUnavailable) {
 dataFreshness.recordError('wto_trade', 'WTO upstream temporarily unavailable');
 }
 } catch (error) {
 console.error('[App] Trade policy failed:', error);
 this.ctx.statusPanel?.updateApi('WTO', { status: 'error' });
 dataFreshness.recordError('wto_trade', String(error));
 }
  }

  async loadSupplyChain(): Promise<void> {
 const scPanel = this.ctx.panels['supply-chain'] as SupplyChainPanel | undefined;
 if (!scPanel) return;

 try {
 const [shipping, chokepoints, minerals] = await Promise.allSettled([
 fetchShippingRates(),
 fetchChokepointStatus(),
 fetchCriticalMinerals(),
 ]);

 const shippingData = shipping.status === 'fulfilled' ? shipping.value : null;
 const chokepointData = chokepoints.status === 'fulfilled' ? chokepoints.value : null;
 const mineralsData = minerals.status === 'fulfilled' ? minerals.value : null;

 if (shippingData) scPanel.updateShippingRates(shippingData);
 if (chokepointData) scPanel.updateChokepointStatus(chokepointData);
 if (mineralsData) scPanel.updateCriticalMinerals(mineralsData);

 const totalItems = (shippingData?.indices.length || 0) + (chokepointData?.chokepoints.length || 0) + (mineralsData?.minerals.length || 0);
 const anyUnavailable = shippingData?.upstreamUnavailable || chokepointData?.upstreamUnavailable || mineralsData?.upstreamUnavailable;

 this.ctx.statusPanel?.updateApi('SupplyChain', { status: anyUnavailable ? 'warning' : (totalItems > 0 ? 'ok' : 'error') });

 if (totalItems > 0) {
 dataFreshness.recordUpdate('supply_chain', totalItems);
 } else if (anyUnavailable) {
 dataFreshness.recordError('supply_chain', 'Supply chain upstream temporarily unavailable');
 }
 } catch (error) {
 console.error('[App] Supply chain failed:', error);
 this.ctx.statusPanel?.updateApi('SupplyChain', { status: 'error' });
 dataFreshness.recordError('supply_chain', String(error));
 }
  }

  updateMonitorResults(): void {
 const monitorPanel = this.ctx.panels.monitors as MonitorPanel;
 monitorPanel.renderResults(this.ctx.allNews);
  }

  async runCorrelationAnalysis(): Promise<void> {
 try {
 if (this.ctx.latestClusters.length === 0 && this.ctx.allNews.length > 0) {
 this.ctx.latestClusters = mlWorker.isAvailable
 ? await clusterNewsHybrid(this.ctx.allNews)
 : await analysisWorker.clusterNews(this.ctx.allNews);
 }

 if (this.ctx.latestClusters.length > 0) {
 ingestNewsForCII(this.ctx.latestClusters);
 dataFreshness.recordUpdate('gdelt', this.ctx.latestClusters.length);
 (this.ctx.panels.cii as CIIPanel)?.refresh();
 }

 const signals = await analysisWorker.analyzeCorrelations(
 this.ctx.latestClusters,
 this.ctx.latestPredictions,
 this.ctx.latestMarkets
 );

 let geoSignals: ReturnType<typeof geoConvergenceToSignal>[] = [];
 if (!isInLearningMode()) {
 const geoAlerts = detectGeoConvergence(this.ctx.seenGeoAlerts);
 geoSignals = geoAlerts.map(geoConvergenceToSignal);
 }

 const keywordSpikeSignals = drainTrendingSignals();
 const allSignals = [...signals, ...geoSignals, ...keywordSpikeSignals];
 if (allSignals.length > 0) {
 addToSignalHistory(allSignals);
 situationEngine.observeSignals(allSignals);
 (this.ctx.panels['alert-center'] as AlertCenterPanel)?.addSignals(allSignals);
 if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(allSignals);
 }
 } catch (error) {
 console.error('[App] Correlation analysis failed:', error);
 }
  }

  async loadFirmsData(): Promise<void> {
 try {
 const fireResult = await fetchAllFires(1);
 if (fireResult.skipped) {
 const firesPanel = this.ctx.panels['satellite-fires'];
 if (firesPanel) {
 showApiKeyGate(firesPanel, 'NASA_FIRMS_API_KEY', () => { void this.loadFirmsData(); });
 }
 this.ctx.statusPanel?.updateApi('FIRMS', { status: 'error' });
 return;
 }
 const { regions, totalCount } = fireResult;
 if (totalCount > 0) {
 const flat = flattenFires(regions);
 const stats = computeRegionStats(regions);
 const satelliteFires = flat.map(f => ({
 lat: f.location?.latitude ?? 0,
 lon: f.location?.longitude ?? 0,
 brightness: f.brightness,
 frp: f.frp,
 region: f.region,
 acq_date: new Date(f.detectedAt).toISOString().slice(0, 10),
 }));

 signalAggregator.ingestSatelliteFires(satelliteFires);
 ingestSatelliteFiresForCII(satelliteFires);
 (this.ctx.panels.cii as CIIPanel)?.refresh();

 this.ctx.map?.setFires(toMapFires(flat));

 (this.ctx.panels['satellite-fires'] as SatelliteFiresPanel)?.update(stats, totalCount);

 dataFreshness.recordUpdate('firms', totalCount);

 updateAndCheck([
 { type: 'satellite_fires', region: 'global', count: totalCount },
 ]).then(anomalies => {
 if (anomalies.length > 0) {
 signalAggregator.ingestTemporalAnomalies(anomalies);
 ingestTemporalAnomaliesForCII(anomalies);
 (this.ctx.panels.cii as CIIPanel)?.refresh();
 }
 }).catch(() => {});
 } else {
 ingestSatelliteFiresForCII([]);
 (this.ctx.panels.cii as CIIPanel)?.refresh();
 (this.ctx.panels['satellite-fires'] as SatelliteFiresPanel)?.update([], 0);
 }
 this.ctx.statusPanel?.updateApi('FIRMS', { status: 'ok' });
 } catch (error) {
 console.warn('[App] FIRMS load failed:', error);
 (this.ctx.panels['satellite-fires'] as SatelliteFiresPanel)?.update([], 0);
 this.ctx.statusPanel?.updateApi('FIRMS', { status: 'error' });
 dataFreshness.recordError('firms', String(error));
 }
  }

  async loadInpeFires(): Promise<void> {
 try {
 const hotspots = await fetchInpeFires();
 (this.ctx.panels['satellite-fires'] as SatelliteFiresPanel | undefined)?.updateInpe(hotspots);
 } catch (error) {
 console.warn('[inpe-fires] fetch failed', error);
 (this.ctx.panels['satellite-fires'] as SatelliteFiresPanel | undefined)?.updateInpe([]);
 }
  }

  async loadPizzInt(): Promise<void> {
 try {
 const [status, tensions] = await Promise.all([
 fetchPizzIntStatus(),
 fetchGdeltTensions()
 ]);

 if (status.locationsMonitored === 0) {
 this.ctx.statusPanel?.updateApi('PizzINT', { status: 'error' });
 dataFreshness.recordError('pizzint', 'No monitored locations returned');
 return;
 }

 this.ctx.pizzintIndicator?.show();
 this.ctx.pizzintIndicator?.updateStatus(status);
 this.ctx.pizzintIndicator?.updateTensions(tensions);
 this.ctx.statusPanel?.updateApi('PizzINT', { status: 'ok' });
 dataFreshness.recordUpdate('pizzint', Math.max(status.locationsMonitored, tensions.length));
 } catch (error) {
 console.error('[App] PizzINT load failed:', error);
 this.ctx.statusPanel?.updateApi('PizzINT', { status: 'error' });
 dataFreshness.recordError('pizzint', String(error));
 }
  }

  syncDataFreshnessWithLayers(): void {
 for (const [layer, sourceIds] of Object.entries(LAYER_TO_SOURCE)) {
 const enabled = this.ctx.mapLayers[layer as keyof MapLayers] ?? false;
 for (const sourceId of sourceIds) {
 dataFreshness.setEnabled(sourceId as DataSourceId, enabled);
 }
 }

 if (!isAisConfigured()) {
 dataFreshness.setEnabled('ais', false);
 }
 if (isOutagesConfigured() === false) {
 dataFreshness.setEnabled('outages', false);
 }
  }

  private static readonly HAPPY_ITEMS_CACHE_KEY = 'happy-all-items';

  async hydrateHappyPanelsFromCache(): Promise<void> {
 try {
 type CachedItem = Omit<NewsItem, 'pubDate'> & { pubDate: number };
 const entry = await getPersistentCache<CachedItem[]>(DataLoaderManager.HAPPY_ITEMS_CACHE_KEY);
 if (!entry?.data || entry.data.length === 0) return;
 if (Date.now() - entry.updatedAt > 24 * 60 * 60 * 1000) return;

 const items: NewsItem[] = entry.data.map(item => ({
 ...item,
 pubDate: new Date(item.pubDate),
 }));

 const scienceSources = new Set(['GNN Science', 'ScienceDaily', 'Nature News', 'Live Science', 'New Scientist', 'Singularity Hub', 'Human Progress', 'Greater Good (Berkeley)']);
 this.ctx.breakthroughsPanel?.setItems(
 items.filter(item => scienceSources.has(item.source) || item.happyCategory === 'science-health')
 );
 this.ctx.heroPanel?.setHeroStory(
 items.filter(item => item.happyCategory === 'humanity-kindness')
 .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())[0]
 );
 this.ctx.digestPanel?.setStories(
 [...items].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime()).slice(0, 5)
 );
 this.ctx.positivePanel?.renderPositiveNews(items);
 } catch (error) {
 console.warn('[App] Happy panel cache hydration failed:', error);
 }
  }

  private async loadHappySupplementaryAndRender(): Promise<void> {
 if (!this.ctx.positivePanel) return;

 const curated = [...this.ctx.happyAllItems];
 this.ctx.positivePanel.renderPositiveNews(curated);

 let supplementary: NewsItem[] = [];
 try {
 const gdeltTopics = await fetchAllPositiveTopicIntelligence();
 const gdeltItems: NewsItem[] = gdeltTopics.flatMap(topic =>
 topic.articles.map(article => ({
 source: 'GDELT',
 title: article.title,
 link: article.url,
 pubDate: article.date ? new Date(article.date) : new Date(),
 isAlert: false,
 imageUrl: article.image || undefined,
 happyCategory: classifyNewsItem('GDELT', article.title),
 }))
 );

 supplementary = await filterBySentiment(gdeltItems);
 } catch (error) {
 console.warn('[App] Happy supplementary pipeline failed, using curated only:', error);
 }

 if (supplementary.length > 0) {
 const merged = [...curated, ...supplementary];
 merged.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
 this.ctx.positivePanel.renderPositiveNews(merged);
 }

 const scienceSources = new Set(['GNN Science', 'ScienceDaily', 'Nature News', 'Live Science', 'New Scientist', 'Singularity Hub', 'Human Progress', 'Greater Good (Berkeley)']);
 const scienceItems = this.ctx.happyAllItems.filter(item =>
 scienceSources.has(item.source) || item.happyCategory === 'science-health'
 );
 this.ctx.breakthroughsPanel?.setItems(scienceItems);

 const heroItem = this.ctx.happyAllItems
 .filter(item => item.happyCategory === 'humanity-kindness')
 .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())[0];
 this.ctx.heroPanel?.setHeroStory(heroItem);

 const digestItems = [...this.ctx.happyAllItems]
 .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
 .slice(0, 5);
 this.ctx.digestPanel?.setStories(digestItems);

 setPersistentCache(
 DataLoaderManager.HAPPY_ITEMS_CACHE_KEY,
 this.ctx.happyAllItems.map(item => ({ ...item, pubDate: item.pubDate.getTime() }))
 ).catch(() => {});
  }

  private async loadPositiveEvents(): Promise<void> {
 const gdeltEvents = await fetchPositiveGeoEvents();
 const rssEvents = geocodePositiveNewsItems(
 this.ctx.happyAllItems.map(item => ({
 title: item.title,
 category: item.happyCategory,
 }))
 );
 const seen = new Set<string>();
 const merged = [...gdeltEvents, ...rssEvents].filter(e => {
 if (seen.has(e.name)) return false;
 seen.add(e.name);
 return true;
 });
 this.ctx.map?.setPositiveEvents(merged);
  }

  private loadKindnessData(): void {
 const kindnessItems = fetchKindnessData(
 this.ctx.happyAllItems.map(item => ({
 title: item.title,
 happyCategory: item.happyCategory,
 }))
 );
 this.ctx.map?.setKindnessData(kindnessItems);
  }

  private async loadProgressData(): Promise<void> {
 const datasets = await fetchProgressData();
 this.ctx.progressPanel?.setData(datasets);
  }

  private async loadSpeciesData(): Promise<void> {
 const species = await fetchConservationWins();
 this.ctx.speciesPanel?.setData(species);
 this.ctx.map?.setSpeciesRecoveryZones(species);
 if (SITE_VARIANT === 'happy' && species.length > 0) {
 checkMilestones({
 speciesRecoveries: species.map(s => ({ name: s.commonName, status: s.recoveryStatus })),
 newSpeciesCount: species.length,
 });
 }
  }

  private async loadRenewableData(): Promise<void> {
 const data = await fetchRenewableEnergyData();
 this.ctx.renewablePanel?.setData(data);
 if (SITE_VARIANT === 'happy' && data?.globalPercentage) {
 checkMilestones({
 renewablePercent: data.globalPercentage,
 });
 }
 try {
 const capacity = await fetchEnergyCapacity();
 this.ctx.renewablePanel?.setCapacityData(capacity);
 } catch {
 // EIA failure does not break the existing World Bank gauge
 }
  }

  async loadSecurityAdvisories(): Promise<void> {
 try {
 const result = await fetchSecurityAdvisories();
 if (result.ok) {
 (this.ctx.panels['security-advisories'] as SecurityAdvisoriesPanel)?.setData(result.advisories);
 this.ctx.intelligenceCache.advisories = result.advisories;
 ingestAdvisoriesForCII(result.advisories);
 }
 } catch (error) {
 console.error('[App] Security advisories fetch failed:', error);
 }
  }

  async loadTelegramIntel(): Promise<void> {
 try {
 const result = await fetchTelegramFeed();
 (this.ctx.panels['telegram-intel'] as TelegramIntelPanel)?.setData(result);
 } catch (error) {
 console.error('[App] Telegram intel fetch failed:', error);
 }
  }

  async loadTsunamiAlerts(): Promise<void> {
 try {
 const { fetchTsunamiAlerts } = await import('@/services/tsunami-alerts');
 const { data } = await withOfflineCache('tsunami-alerts', () => fetchTsunamiAlerts(), 1 * 60 * 60 * 1000);
 (this.ctx.panels['tsunami-alerts'] as TsunamiAlertsPanel | undefined)?.update(data);
 unifiedAlertStore.ingest(data.map(normalizeTsunamiAlert));
 } catch (error) {
 console.error('[App] Tsunami alerts fetch failed:', error);
 }
  }

  async loadTropicalCyclones(): Promise<void> {
 try {
 const stormContext = getStormPreparednessContext();
 const [cyclonesResult, buoyResult, reconResult] = await Promise.allSettled([
 fetchTropicalCyclones(),
 fetchBuoyAlerts(),
 fetchHurricaneRecon(),
 ]);
 const data = cyclonesResult.status === 'fulfilled' ? cyclonesResult.value : stormContext.tropicalCyclones;
 const buoyAlerts = buoyResult.status === 'fulfilled' ? buoyResult.value : stormContext.buoyAlerts;
 const reconFixes = reconResult.status === 'fulfilled' ? reconResult.value : stormContext.reconFixes;
 (this.ctx.panels['tropical-cyclones'] as TropicalCyclonesPanel | undefined)?.update(data);
 updateStormPreparednessContext({
 tropicalCyclones: data,
 buoyAlerts,
 reconFixes,
 });
 } catch (error) {
 console.error('[App] Tropical cyclones fetch failed:', error);
 }
  }

  async loadFoodInsecurity(): Promise<void> {
 try {
 const { fetchFoodInsecurityAlerts: fetchFoodInsecurity } = await import('@/services/food-insecurity');
 const data = await fetchFoodInsecurity();
 (this.ctx.panels['food-insecurity'] as FoodInsecurityPanel | undefined)?.update(data);
 } catch (error) {
 console.error('[App] Food insecurity fetch failed:', error);
 }
  }

  async loadAdsb(): Promise<void> {
 try {
 const snapshot = await fetchAdsbSnapshot();
 this.ctx.map?.setAdsbFlights(snapshot.flights);
 this.ctx.map?.setLayerReady?.('adsb', snapshot.flights.length > 0);
 (this.ctx.panels['air-traffic'] as AirTrafficPanel | undefined)?.update(snapshot);
 // Feed the confidence-scored multi-provider tracks into the intelligence layer
 // (low-confidence / stale ADS-B tracks become observations). Aggregate path only.
 if (snapshot.aggregate?.tracks?.length) {
 const obs = snapshot.aggregate.tracks
 .map((t) => adsbTrackToObservation(t))
 .filter((o): o is NonNullable<typeof o> => o != null);
 if (obs.length > 0) ingestObservations(obs);
 }
 } catch (error) {
 this.ctx.map?.setLayerReady?.('adsb', false);
 dataFreshness.recordError('adsb', error instanceof Error ? error.message : 'Unknown error');
 }
  }

  async loadFAACameras(): Promise<void> {
 try {
 const [raw, nwsResult, gdacsResult] = await Promise.all([
 fetchFAACameras(),
 withOfflineCache('nws-alerts', () => fetchNWSAlerts(), 1 * 60 * 60 * 1000),
 withOfflineCache('gdacs-events', () => fetchGDACSEvents(), 1 * 60 * 60 * 1000),
 ]);
 const scored = scoreCamerasAgainstAlerts(raw, nwsResult.data, gdacsResult.data);
 this.ctx.map?.setFAACameras(scored);
 (this.ctx.panels['faa-weather-cams'] as FAAWeatherCamsPanel | undefined)?.refresh();
 const alertCams = scored.filter(c => c.alertProximityMi !== null);
 if (alertCams.length >= 2) {
 void fetch(`${getApiBaseUrl()}/api/faa-cam-digest`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 cameras: alertCams.slice(0, 6).map(c => ({
 name: c.name,
 location: c.state,
 alertLabel: c.alertLabel,
 })),
 }),
 signal: AbortSignal.timeout(25000),
 })
 .then(r => r.ok ? r.json() : null)
 .then((data: { digest?: string } | null) => {
 if (data?.digest) {
 (this.ctx.panels['faa-weather-cams'] as FAAWeatherCamsPanel | undefined)
 ?.setDigest(data.digest);
 }
 })
 .catch(() => {});
 }
 } catch (error) {
 console.error('[App] FAA cameras fetch failed:', error);
 }
  }

  async loadInfrastructure(): Promise<void> {
 try {
 const assets = await fetchNearbyInfrastructure(50);
 (this.ctx.panels['infrastructure'] as InfrastructurePanel | undefined)?.update(assets);
 } catch (error) {
 console.warn('[infrastructure] fetch failed', error);
 (this.ctx.panels['infrastructure'] as InfrastructurePanel | undefined)?.update([]);
 }
  }

  // Warms the internet-outages cache (via the sidecar) so the survival comms
  // axis reads live IODA data through getCachedIodaOutages. No panel consumes it;
  // fetchIodaOutages is fail-closed (never throws, keeps prior cache on error).
  // Eventual-consistency by design: the comms axis picks up this data on the next
  // storm-posture refresh (weather cadence) — the same pattern the health axis
  // (loadDiseaseIntel) and financial/security axes (getForecastSnapshot) use,
  // rather than coupling this loader back into refreshStormPosture (re-entrancy).
  async loadInternetOutages(): Promise<void> {
 await fetchIodaOutages();
  }

  async loadIswReports(): Promise<void> {
 try {
 const reports = await fetchIswReports();
 (this.ctx.panels['isw-reports'] as IswReportsPanel | undefined)?.updateReports(reports);
 } catch (error) {
 console.warn('[isw-reports] fetch failed', error);
 (this.ctx.panels['isw-reports'] as IswReportsPanel | undefined)?.updateReports([]);
 }
  }

  async loadNatoNews(): Promise<void> {
 try {
 const items = await fetchNatoNews();
 (this.ctx.panels['nato-news'] as NatoNewsPanel | undefined)?.updateNews(items);
 } catch (error) {
 console.warn('[nato-news] fetch failed', error);
 (this.ctx.panels['nato-news'] as NatoNewsPanel | undefined)?.updateNews([]);
 }
  }

  async loadDodNews(): Promise<void> {
 try {
 const items = await fetchDodNews();
 (this.ctx.panels['dod-news'] as DodNewsPanel | undefined)?.updateNews(items);
 } catch (error) {
 console.warn('[dod-news] fetch failed', error);
 (this.ctx.panels['dod-news'] as DodNewsPanel | undefined)?.updateNews([]);
 }
  }

  async loadReliefWebCrises(): Promise<void> {
 try {
 const crises = await fetchReliefWebCrises();
 (this.ctx.panels['reliefweb'] as ReliefWebPanel | undefined)?.updateReports(crises);
 } catch (error) {
 console.warn('[reliefweb] fetch failed', error);
 (this.ctx.panels['reliefweb'] as ReliefWebPanel | undefined)?.updateReports([]);
 }
  }

  async loadBellingcat(): Promise<void> {
 try {
 const posts = await fetchBellingcatOsint();
 (this.ctx.panels['bellingcat'] as BellingcatPanel | undefined)?.updatePosts(posts);
 } catch (error) {
 console.warn('[bellingcat] fetch failed', error);
 (this.ctx.panels['bellingcat'] as BellingcatPanel | undefined)?.updatePosts([]);
 }
  }

  async loadTravelWarnings(): Promise<void> {
 try {
 const [fcdo, dfat, gac, convergence] = await Promise.all([
 fetchFcdoWarnings(),
 fetchDfatWarnings(),
 fetchGacWarnings(),
 fetchGovWarningConvergence(),
 ]);
 const alerts = getConvergenceAlerts(convergence);
 (this.ctx.panels['fcdo-warnings'] as FcdoWarningsPanel | undefined)?.updateWarnings(fcdo);
 (this.ctx.panels['dfat-warnings'] as DfatWarningsPanel | undefined)?.updateWarnings(dfat);
 (this.ctx.panels['gac-warnings'] as GacWarningsPanel | undefined)?.updateWarnings(gac);
 (this.ctx.panels['gov-convergence'] as GovConvergencePanel | undefined)?.updateResults(alerts);
 } catch (error) {
 console.warn('[travel-warnings] fetch failed', error);
 }
  }

  async loadEmscSeismic(): Promise<void> {
 try {
 const events = await fetchEmscSeismic();
 (this.ctx.panels['emsc-seismic'] as EmscSeismicPanel | undefined)?.updateEvents(events);
 recordDomainObservations('emsc-seismic', emscEventsToObservations(events), true);
 } catch (error) {
 console.warn('[emsc-seismic] fetch failed', error);
 (this.ctx.panels['emsc-seismic'] as EmscSeismicPanel | undefined)?.updateEvents([]);
 recordDomainObservations('emsc-seismic', [], false);
 }
  }

  async loadAcapsCrises(): Promise<void> {
 try {
 const crises = await fetchAcapsCrises();
 (this.ctx.panels['acaps'] as AcapsPanel | undefined)?.updateCrises(crises);
 } catch (error) {
 console.warn('[acaps] fetch failed', error);
 (this.ctx.panels['acaps'] as AcapsPanel | undefined)?.updateCrises([]);
 }
  }

  async loadLiveUaMap(): Promise<void> {
 try {
 const events = await fetchLiveUaMap();
 (this.ctx.panels['liveuamap'] as LiveUaMapPanel | undefined)?.updateEvents(events);
 } catch (error) {
 console.warn('[liveuamap] fetch failed', error);
 (this.ctx.panels['liveuamap'] as LiveUaMapPanel | undefined)?.updateEvents([]);
 }
  }

  async loadDebrisReentries(): Promise<void> {
 try {
 const report = await fetchDebrisReentries();
 (this.ctx.panels['aerospace-reentry'] as AerospaceReentryPanel | undefined)?.updatePredictions(report.predictions);
 } catch (error) {
 console.warn('[aerospace-reentry] fetch failed', error);
 (this.ctx.panels['aerospace-reentry'] as AerospaceReentryPanel | undefined)?.updatePredictions([]);
 }
  }

  async loadAmtrakAlerts(): Promise<void> {
 try {
 const alerts = await fetchAmtrakAlerts();
 (this.ctx.panels['amtrak-alerts'] as AmtrakAlertsPanel | undefined)?.updateAlerts(alerts);
 } catch (error) {
 console.warn('[amtrak-alerts] fetch failed', error);
 (this.ctx.panels['amtrak-alerts'] as AmtrakAlertsPanel | undefined)?.updateAlerts([]);
 }
  }

  async loadAvalancheHazard(): Promise<void> {
 try {
 const report = await fetchAvalancheHazard();
 (this.ctx.panels['avalanche-hazard'] as AvalancheHazardPanel | undefined)?.updateForecasts(report.forecasts);
 } catch (error) {
 console.warn('[avalanche-hazard] fetch failed', error);
 (this.ctx.panels['avalanche-hazard'] as AvalancheHazardPanel | undefined)?.updateForecasts([]);
 }
  }

  async loadArmsTransfers(): Promise<void> {
 try {
 const transfers = await fetchArmsTransfers();
 (this.ctx.panels['dsca-arms'] as DscaArmsPanel | undefined)?.updateTransfers(transfers);
 } catch (error) {
 console.warn('[dsca-arms] fetch failed', error);
 (this.ctx.panels['dsca-arms'] as DscaArmsPanel | undefined)?.updateTransfers([]);
 }
  }

  async loadEcdcSurveillance(): Promise<void> {
 try {
 const alerts = await fetchEcdcAlerts();
 (this.ctx.panels['ecdc-surveillance'] as EcdcSurveillancePanel | undefined)?.updateAlerts(alerts);
 } catch (error) {
 console.warn('[ecdc-surveillance] fetch failed', error);
 (this.ctx.panels['ecdc-surveillance'] as EcdcSurveillancePanel | undefined)?.updateAlerts([]);
 }
  }

  async loadFdicFailures(): Promise<void> {
 try {
 const summary = await fetchBankFailures();
 (this.ctx.panels['fdic-failures'] as FdicFailuresPanel | undefined)?.updateSummary(summary);
 } catch (error) {
 console.warn('[fdic-failures] fetch failed', error);
 }
  }

  async loadHabsos(): Promise<void> {
 try {
 const observations = await fetchHabObservations();
 (this.ctx.panels['habsos'] as HabsosPanel | undefined)?.updateObservations(observations);
 } catch (error) {
 console.warn('[habsos] fetch failed', error);
 (this.ctx.panels['habsos'] as HabsosPanel | undefined)?.updateObservations([]);
 }
  }

  async loadUnSecurityCouncil(): Promise<void> {
 try {
 const items = await fetchUnSecurityCouncil();
 (this.ctx.panels['un-security-council'] as UnSecurityCouncilPanel | undefined)?.updateItems(items);
 } catch (error) {
 console.warn('[un-security-council] fetch failed', error);
 (this.ctx.panels['un-security-council'] as UnSecurityCouncilPanel | undefined)?.updateItems([]);
 }
  }

  async loadWildfireSmoke(): Promise<void> {
 try {
 const report = await fetchWildfireSmoke();
 (this.ctx.panels['wildfire-smoke'] as WildfireSmokePanel | undefined)?.updateReport(report);
 } catch (error) {
 console.warn('[wildfire-smoke] fetch failed', error);
 }
  }

  async loadCentralBankCalendar(): Promise<void> {
 try {
 const meetings = getUpcomingMeetings();
 (this.ctx.panels['central-bank-calendar'] as CentralBankCalendarPanel | undefined)?.updateMeetings(meetings);
 } catch (error) {
 console.warn('[central-bank-calendar] load failed', error);
 }
  }

  async loadCongressDefense(): Promise<void> {
 try {
 const items = await fetchCongressDefense();
 (this.ctx.panels['congress-defense'] as any)?.update(items);
 } catch (error) {
 console.warn('[congress-defense] fetch failed', error);
 (this.ctx.panels['congress-defense'] as any)?.update([]);
 }
  }

  async loadCombatantCommands(): Promise<void> {
 try {
 const releases = await fetchCombatantCommands();
 (this.ctx.panels['combatant-commands'] as any)?.update(releases);
 } catch (error) {
 console.warn('[combatant-commands] fetch failed', error);
 (this.ctx.panels['combatant-commands'] as any)?.update([]);
 }
  }

  async loadForeignMilNews(): Promise<void> {
 try {
 const items = await fetchForeignMilNews();
 (this.ctx.panels['foreign-mil-news'] as any)?.update(items);
 } catch (error) {
 console.warn('[foreign-mil-news] fetch failed', error);
 (this.ctx.panels['foreign-mil-news'] as any)?.update([]);
 }
  }

  async loadSpcMesoscale(): Promise<void> {
 try {
 const discussions = await fetchMesoscaleDiscussions();
 (this.ctx.panels['spc-mesoscale'] as any)?.update(discussions);
 } catch (error) {
 console.warn('[spc-mesoscale] fetch failed', error);
 (this.ctx.panels['spc-mesoscale'] as any)?.update([]);
 }
  }

  async loadThreatIntelHub(): Promise<void> {
 try {
 const [greyNoise, otxPulses, abuseIp, urlscan] = await Promise.all([
 fetchGreyNoise(),
 fetchOtxPulses(),
 fetchAbuseIpDb(),
 fetchUrlscanFeed(),
 ]);
 (this.ctx.panels['threat-intel-hub'] as ThreatIntelHubPanel | undefined)?.update({
 greyNoise, otxPulses, abuseIp, urlscan,
 });
 } catch (error) {
 console.error('[ThreatIntelHub] load error:', error);
 }
  }

  async loadGeoIntel(): Promise<void> {
 try {
 const [acled, military] = await Promise.all([
 fetchAcledEvents(),
 fetchAdsbMilitary(),
 ]);
 this.ctx.acledEvents = acled;
 this.ctx.adsbMilitary = military;
 (this.ctx.panels['geo-intel'] as GeoIntelPanel | undefined)?.update({
 acled,
 military,
 });
 } catch (error) {
 console.error('[GeoIntel] load error:', error);
 }
  }

  async loadExtendedForecast(): Promise<void> {
 const panel = this.ctx.panels['extended-forecast'] as ExtendedForecastPanel | undefined;
 // Pick the user's first saved place when available; fall back to
 // NYC only when no saved places are configured. Old behavior
 // always loaded NYC even for Indiana users.
 let lat = 40.71, lon = -74.01, label = 'New York';
 try {
 const { getSavedPlaces } = await import('@/services/saved-places');
 const home = getSavedPlaces()[0];
 if (home) {
 lat = home.lat; lon = home.lon; label = home.name;
 }
 } catch { /* fall back to NYC */ }
 try {
 const forecast = await fetchExtendedForecast(lat, lon, label);
 panel?.update(forecast);
 } catch (error) {
 console.warn('[extended-forecast] fetch failed', error);
 // Surface the empty state instead of leaving the panel stuck on
 // its initial 'Fetching forecast data...' loading banner.
 panel?.update(null);
 }
  }

  async loadWeatherRadar(): Promise<void> {
 try {
 const state = await fetchRadarFrames();
 (this.ctx.panels['weather-radar'] as WeatherRadarPanel | undefined)?.update(state);
 this.ctx.map?.setRadarState(state);
 } catch (error) {
 console.warn('[weather-radar] fetch failed', error);
 }
  }

  async loadTidePredictions(): Promise<void> {
 const panel = this.ctx.panels['tide-predictions'] as TidePredictionsPanel | undefined;
 try {
 const defaultStation = TIDE_STATIONS[0]!;
 const data = await fetchTidePredictions(defaultStation.id);
 panel?.update(data);
 } catch (error) {
 console.warn('[tide-predictions] fetch failed', error);
 // Surface the empty state instead of staying stuck on the
 // initial 'Fetching tide data...' loading banner.
 panel?.update(null);
 }
  }

  async loadPollenData(): Promise<void> {
 try {
 const readings = await fetchPollenData();
 (this.ctx.panels['pollen'] as PollenPanel | undefined)?.update(readings);
 } catch (error) {
 console.warn('[pollen] fetch failed', error);
 }
  }

  async loadNeoTracker(): Promise<void> {
 // The panel owns its own fetch (/api/space/neo); the tick just refreshes it.
 await (this.ctx.panels['neo-tracker'] as NeoTrackerPanel | undefined)?.update();
  }

  async loadGoesSatellite(): Promise<void> {
 // The panel owns its own fetch (it refetches on band/sector switch via
 // /api/satellite/goes-imagery). The loader tick just asks it to refresh.
 (this.ctx.panels['goes-satellite'] as GoesSatellitePanel | undefined)?.update();
  }

  async loadFloodMonitor(): Promise<void> {
 try {
 const [gaugesRes, warningsRes] = await Promise.allSettled([
 fetch('/api/floods/gauges').then(r => r.ok ? r.json() : null),
 fetch('/api/floods/warnings').then(r => r.ok ? r.json() : null),
 ]);
 const panel = this.ctx.panels['flood-monitor'] as FloodMonitorPanel | undefined;
 if (gaugesRes.status === 'fulfilled' && gaugesRes.value) panel?.updateGauges(gaugesRes.value);
 if (warningsRes.status === 'fulfilled' && warningsRes.value) panel?.updateWarnings(warningsRes.value);
 } catch (error) {
 console.warn('[flood-monitor] fetch failed', error);
 }
  }

  async loadIntelligenceFeed(): Promise<void> {
 try {
 const r = await fetch('/api/intelligence/prioritized?limit=100');
 if (!r.ok) return;
 const data = await r.json() as { events?: ObservationEvent[] };
 const events = data?.events;
 if (Array.isArray(events) && events.length > 0) {
 // Normalize entityIds: external API responses may omit it if the sidecar
 // returns data from an older schema. All downstream callers (personal-
 // relevance, observation-graph, correlation-rules) call .map/.some/.filter
 // on entityIds without null-guarding, so ensure it's always an array here.
 const normalized = events.map((e) => Array.isArray(e.entityIds) ? e : { ...e, entityIds: [] });
 ingest(normalized);
 void (this.ctx.panels['intelligence-feed'] as IntelligenceFeedPanel | undefined)?.fetchFeed();
 }
 } catch (error) {
 console.warn('[intelligence-feed] fetch failed', error);
 }
  }

  async loadLightning(): Promise<void> {
 try {
 const strikes = await fetchLightningStrikes();
 this.ctx.map?.setLightningStrikes(strikes);
 } catch (error) {
 console.warn('[lightning] fetch failed', error);
 }
  }

  async loadRedFlagWarnings(): Promise<void> {
 try {
 const [warnings] = await Promise.all([
 fetchRedFlagWarnings(),
 fetchFireWeatherOutlook(),
 ]);
 this.ctx.map?.setRedFlagWarnings(warnings);
 } catch (error) {
 console.warn('[red-flag-warnings] fetch failed', error);
 }
  }

  async loadSatellites(): Promise<void> {
 try {
 const catalog = await fetchSatelliteCatalog();
 if (catalog.length === 0) return;

 satellitePropagator.start(catalog);
 satellitePropagator.onPositions((positions) => {
 this.ctx.map?.setSatellitePositions(positions, catalog);
 });
 } catch (error) {
 console.warn('[satellites] fetch failed', error);
 }
  }

  async loadWorldBankBaselines(): Promise<void> {
    try {
      const keyCodes = ['USA', 'CHN', 'RUS', 'IND', 'DEU', 'GBR', 'FRA', 'JPN', 'BRA', 'SAU', 'IRN', 'UKR', 'ISR', 'TWN', 'KOR'];
      await Promise.allSettled(keyCodes.map(iso => fetchWorldBankProfile(iso)));
    } catch (error) {
      console.error('[App] World Bank baselines fetch failed:', error);
    }
  }

  async loadDarkWeb(): Promise<void> {
 try {
 const [breaches, tor] = await Promise.all([
 fetchHibpBreaches(),
 fetchTorMetrics(),
 ]);
 (this.ctx.panels['dark-web'] as DarkWebPanel | undefined)?.update({
 breaches, tor,
 });
 } catch (error) {
 console.error('[DarkWeb] load error:', error);
 }
  }

  async loadRipeAtlas(): Promise<void> {
 try {
 const data = await fetchRipeAtlasStatus();
 (this.ctx.panels['ripe-atlas'] as RipeAtlasPanel | undefined)?.update(data);
 } catch (error) {
 console.error('[App] RIPE Atlas fetch failed:', error);
 }
  }

  async loadRipeNcc(): Promise<void> {
 try {
 const data = await fetchRipeNccStatus();
 (this.ctx.panels['ripe-ncc'] as RipeNccPanel | undefined)?.update(data);
 } catch (error) {
 console.error('[App] RIPE NCC fetch failed:', error);
 }
  }

  pushObservationsToSidecar(): void {
 const recent = getRecentObservations(200);
 if (recent.length === 0) return;
 void fetch(`${getApiBaseUrl()}/api/intelligence/observations`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(recent),
 }).catch(() => {});
  }
}
