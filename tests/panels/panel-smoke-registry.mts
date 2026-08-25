/**
 * Panel id -> factory map. Each entry returns a freshly constructed Panel
 * instance the harness can mount. Anything not listed here is reported by
 * the harness as `skipped: no-factory` — that's the "missing factory" gap
 * audit and is itself useful output.
 *
 * The bulk of entries are auto-generated style: panels with a no-arg
 * constructor get a one-line factory. Panels with parameterised
 * constructors (NewsPanel, MonitorPanel, etc.) get a dedicated factory
 * with sensible default arguments.
 *
 * Factories are async so they can dynamically import the component
 * module, keeping the registry's module-load cost flat.
 *
 * Reducing the "skipped: no-factory" set is the regression metric the
 * harness exists to drive down.
 */

import type { Panel } from '@/components/Panel';

export interface SmokeFactory {
  create: () => Promise<Panel>;
  /** Optional: extra wait (ms) for first refresh to settle before assert. */
  waitMs?: number;
  /** Optional: minimum visible-text length on success. Defaults to 1. */
  minTextLength?: number;
  /** Optional: panel-specific reason this is included (for the report). */
  note?: string;
}

const wrap = (loader: () => Promise<Panel>): SmokeFactory => ({ create: loader, waitMs: 50 });

// News-style panels share a single class. Any id keyed by NewsPanel(id, title)
// gets a one-line entry through this helper.
function newsPanelFactory(id: string, title: string): SmokeFactory {
  return wrap(async () => {
    const mod = await import('@/components/NewsPanel');
    return new mod.NewsPanel(id, title);
  });
}

// Generic intel feed shares a class with NewsPanel-like behaviour.
function genericIntelFeedFactory(id: string, title: string): SmokeFactory {
  return wrap(async () => {
    const mod = await import('@/components/GenericIntelFeedPanel');
    return new mod.GenericIntelFeedPanel(id, title);
  });
}

export const PANEL_SMOKE_REGISTRY: Record<string, SmokeFactory> = {
  // ── No-arg constructors (auto-discoverable) ────────────────────────────
  'after-action-review': wrap(async () => { const m = await import('@/components/AarPanel'); return new m.AarPanel(); }),
  'aerospace-reentry': wrap(async () => { const m = await import('@/components/AerospaceReentryPanel'); return new m.AerospaceReentryPanel(); }),
  'air-quality': wrap(async () => { const m = await import('@/components/AirQualityPanel'); return new m.AirQualityPanel(); }),
  'air-traffic': wrap(async () => { const m = await import('@/components/AirTrafficPanel'); return new m.AirTrafficPanel(); }),
  'airstrikes': wrap(async () => { const m = await import('@/components/AirstrikesPanel'); return new m.AirstrikesPanel(); }),
  'alert-center': wrap(async () => { const m = await import('@/components/AlertCenterPanel'); return new m.AlertCenterPanel(); }),
  'alert-rules': wrap(async () => { const m = await import('@/components/AlertRulesPanel'); return new m.AlertRulesPanel(); }),
  'algorithm-diagnostic': wrap(async () => { const m = await import('@/components/AlgorithmDiagnosticPanel'); return new m.AlgorithmDiagnosticPanel(); }),
  'anomaly-detection': wrap(async () => { const m = await import('@/components/AnomalyDetectionPanel'); return new m.AnomalyDetectionPanel(); }),
  'api-diagnostic': wrap(async () => { const m = await import('@/components/ApiDiagnosticPanel'); return new m.ApiDiagnosticPanel(); }),
  'ask-crystal-ball': wrap(async () => { const m = await import('@/components/AskCrystalBallPanel'); return new m.AskCrystalBallPanel(); }),
  'avalanche-hazard': wrap(async () => { const m = await import('@/components/AvalancheHazardPanel'); return new m.AvalancheHazardPanel(); }),
  'breakthroughs': wrap(async () => { const m = await import('@/components/BreakthroughsTickerPanel'); return new m.BreakthroughsTickerPanel(); }),
  'cii': wrap(async () => { const m = await import('@/components/CIIPanel'); return new m.CIIPanel(); }),
  'cascade': wrap(async () => { const m = await import('@/components/CascadePanel'); return new m.CascadePanel(); }),
  'cascade-simulator': wrap(async () => { const m = await import('@/components/CascadeSimulatorPanel'); return new m.CascadeSimulatorPanel(); }),
  'central-bank-calendar': wrap(async () => { const m = await import('@/components/CentralBankCalendarPanel'); return new m.CentralBankCalendarPanel(); }),
  'climate': wrap(async () => { const m = await import('@/components/ClimateAnomalyPanel'); return new m.ClimateAnomalyPanel(); }),
  'command-center': wrap(async () => { const m = await import('@/components/CommandCenterPanel'); return new m.CommandCenterPanel(); }),
  'comms-health': wrap(async () => { const m = await import('@/components/CommsHealthPanel'); return new m.CommsHealthPanel(); }),
  'comms-plan': wrap(async () => { const m = await import('@/components/CommsPlanPanel'); return new m.CommsPlanPanel(); }),
  'compound-threat': wrap(async () => { const m = await import('@/components/CompoundThreatPanel'); return new m.CompoundThreatPanel(); }),
  'correlation-matrix': wrap(async () => { const m = await import('@/components/CorrelationMatrixPanel'); return new m.CorrelationMatrixPanel(); }),
  'counters': wrap(async () => { const m = await import('@/components/CountersPanel'); return new m.CountersPanel(); }),
  'course-of-action': wrap(async () => { const m = await import('@/components/CourseOfActionPanel'); return new m.CourseOfActionPanel(); }),
  'cyber-threats': wrap(async () => { const m = await import('@/components/CyberThreatPanel'); return new m.CyberThreatPanel(); }),
  'dark-vessel': wrap(async () => { const m = await import('@/components/DarkVesselPanel'); return new m.DarkVesselPanel(); }),
  'dark-web': wrap(async () => { const m = await import('@/components/DarkWebPanel'); return new m.DarkWebPanel(); }),
  'disease-intel': wrap(async () => { const m = await import('@/components/DiseaseIntelPanel'); return new m.DiseaseIntelPanel(); }),
  'disease-outbreaks': wrap(async () => { const m = await import('@/components/DiseaseOutbreakPanel'); return new m.DiseaseOutbreakPanel(); }),
  'displacement': wrap(async () => { const m = await import('@/components/DisplacementPanel'); return new m.DisplacementPanel(); }),
  'dod-contracts': wrap(async () => { const m = await import('@/components/DodContractsPanel'); return new m.DodContractsPanel(); }),
  'etf-flows': wrap(async () => { const m = await import('@/components/ETFFlowsPanel'); return new m.ETFFlowsPanel(); }),
  'earthquakes': wrap(async () => { const m = await import('@/components/EarthquakesPanel'); return new m.EarthquakesPanel(); }),
  'economic': wrap(async () => { const m = await import('@/components/EconomicPanel'); return new m.EconomicPanel(); }),
  'economic-stress': wrap(async () => { const m = await import('@/components/EconomicStressPanel'); return new m.EconomicStressPanel(); }),
  'edgar-filings': wrap(async () => { const m = await import('@/components/EdgarFilingsPanel'); return new m.EdgarFilingsPanel(); }),
  'emergency-broadcast': wrap(async () => { const m = await import('@/components/EmergencyBroadcastPanel'); return new m.EmergencyBroadcastPanel(); }),
  'emergency-readiness': {
    create: async () => { const m = await import('@/components/EmergencyReadinessPanel'); return new m.EmergencyReadinessPanel(); },
    waitMs: 200,
  },
  'emsc-seismic': wrap(async () => { const m = await import('@/components/EmscSeismicPanel'); return new m.EmscSeismicPanel(); }),
  'entity-link-graph': wrap(async () => { const m = await import('@/components/EntityLinkGraphPanel'); return new m.EntityLinkGraphPanel(); }),
  'escalation-forecast': wrap(async () => { const m = await import('@/components/EscalationForecastPanel'); return new m.EscalationForecastPanel(); }),
  'evacuation': wrap(async () => { const m = await import('@/components/EvacuationPanel'); return new m.EvacuationPanel(); }),
  'extended-forecast': wrap(async () => { const m = await import('@/components/ExtendedForecastPanel'); return new m.ExtendedForecastPanel(); }),
  'faa-weather-cams': wrap(async () => { const m = await import('@/components/FAAWeatherCamsPanel'); return new m.FAAWeatherCamsPanel(); }),
  'family-tracker': wrap(async () => { const m = await import('@/components/FamilyTrackerPanel'); return new m.FamilyTrackerPanel(); }),
  'fdic-failures': wrap(async () => { const m = await import('@/components/FdicFailuresPanel'); return new m.FdicFailuresPanel(); }),
  'fear-greed': wrap(async () => { const m = await import('@/components/FearGreedPanel'); return new m.FearGreedPanel(); }),
  'federal-register': wrap(async () => { const m = await import('@/components/FederalRegisterPanel'); return new m.FederalRegisterPanel(); }),
  'feed-health': wrap(async () => { const m = await import('@/components/FeedHealthPanel'); return new m.FeedHealthPanel(); }),
  'financial-contagion': wrap(async () => { const m = await import('@/components/FinancialContagionPanel'); return new m.FinancialContagionPanel(); }),
  'food-insecurity': wrap(async () => { const m = await import('@/components/FoodInsecurityPanel'); return new m.FoodInsecurityPanel(); }),
  'fuel-prices': wrap(async () => { const m = await import('@/components/FuelPricesPanel'); return new m.FuelPricesPanel(); }),
  'gdacs-alerts': wrap(async () => { const m = await import('@/components/GDACSAlertsPanel'); return new m.GDACSAlertsPanel(); }),
  'gdelt-intel': wrap(async () => { const m = await import('@/components/GdeltIntelPanel'); return new m.GdeltIntelPanel(); }),
  'geo-hubs': wrap(async () => { const m = await import('@/components/GeoHubsPanel'); return new m.GeoHubsPanel(); }),
  'geo-intel': wrap(async () => { const m = await import('@/components/GeoIntelPanel'); return new m.GeoIntelPanel(); }),
  'custom-geofence': wrap(async () => { const m = await import('@/components/GeofencePanel'); return new m.GeofencePanel(); }),
  'giving': wrap(async () => { const m = await import('@/components/GivingPanel'); return new m.GivingPanel(); }),
  'global-weather': wrap(async () => { const m = await import('@/components/GlobalWeatherPanel'); return new m.GlobalWeatherPanel(); }),
  'digest': wrap(async () => { const m = await import('@/components/GoodThingsDigestPanel'); return new m.GoodThingsDigestPanel(); }),
  'gov-warning-convergence': wrap(async () => { const m = await import('@/components/GovConvergencePanel'); return new m.GovConvergencePanel(); }),
  'hazard-alerts': wrap(async () => { const m = await import('@/components/HazardAlertsPanel'); return new m.HazardAlertsPanel(); }),
  'hazmat-incidents': wrap(async () => { const m = await import('@/components/HazmatIncidentsPanel'); return new m.HazmatIncidentsPanel(); }),
  'spotlight': wrap(async () => { const m = await import('@/components/HeroSpotlightPanel'); return new m.HeroSpotlightPanel(); }),
  'humanitarian-crisis': wrap(async () => { const m = await import('@/components/HumanitarianCrisisPanel'); return new m.HumanitarianCrisisPanel(); }),
  'ics-ot-dashboard': wrap(async () => { const m = await import('@/components/IcsOtDashboardPanel'); return new m.IcsOtDashboardPanel(); }),
  'infrastructure': wrap(async () => { const m = await import('@/components/InfrastructurePanel'); return new m.InfrastructurePanel(); }),
  'insights': wrap(async () => { const m = await import('@/components/InsightsPanel'); return new m.InsightsPanel(); }),
  'intel-report': wrap(async () => { const m = await import('@/components/IntelReportPanel'); return new m.IntelReportPanel(); }),
  'intelligence-briefing': wrap(async () => { const m = await import('@/components/IntelligenceBriefingPanel'); return new m.IntelligenceBriefingPanel(); }),
  'internet-disruptions': wrap(async () => { const m = await import('@/components/InternetDisruptionsPanel'); return new m.InternetDisruptionsPanel(); }),
  'ioc-manager': wrap(async () => { const m = await import('@/components/IocManagerPanel'); return new m.IocManagerPanel(); }),
  'kill-chain': wrap(async () => { const m = await import('@/components/KillChainPanel'); return new m.KillChainPanel(); }),
  'live-news': wrap(async () => { const m = await import('@/components/LiveNewsPanel'); return new m.LiveNewsPanel(); }),
  'live-webcams': wrap(async () => { const m = await import('@/components/LiveWebcamsPanel'); return new m.LiveWebcamsPanel(); }),
  'local-ids': wrap(async () => { const m = await import('@/components/LocalIDSPanel'); return new m.LocalIDSPanel(); }),
  'macro-signals': wrap(async () => { const m = await import('@/components/MacroSignalsPanel'); return new m.MacroSignalsPanel(); }),
  'maritime-superpower': wrap(async () => { const m = await import('@/components/MaritimeSuperpowerPanel'); return new m.MaritimeSuperpowerPanel(); }),
  'health-superpower': wrap(async () => { const m = await import('@/components/HealthSuperpowerPanel'); return new m.HealthSuperpowerPanel(); }),

  'personal-resilience': wrap(async () => { const m = await import('@/components/PersonalResiliencePanel'); return new m.PersonalResiliencePanel(); }),  'markets': wrap(async () => { const m = await import('@/components/MarketPanel'); return new m.MarketPanel(); }),
  'heatmap': wrap(async () => { const m = await import('@/components/MarketPanel'); return new m.HeatmapPanel(); }),
  'commodities': wrap(async () => { const m = await import('@/components/MarketPanel'); return new m.CommoditiesPanel(); }),
  'crypto': wrap(async () => { const m = await import('@/components/MarketPanel'); return new m.CryptoPanel(); }),
  'nws-alerts': wrap(async () => { const m = await import('@/components/NWSAlertsPanel'); return new m.NWSAlertsPanel(); }),
  'national-debt': wrap(async () => { const m = await import('@/components/NationalDebtPanel'); return new m.NationalDebtPanel(); }),
  'network-topology': wrap(async () => { const m = await import('@/components/NetworkTopologyPanel'); return new m.NetworkTopologyPanel(); }),
  'notification-digest': wrap(async () => { const m = await import('@/components/NotificationDigestPanel'); return new m.NotificationDigestPanel(); }),
  'nuclear-monitor': wrap(async () => { const m = await import('@/components/NuclearMonitorPanel'); return new m.NuclearMonitorPanel(); }),
  'offline-maps': wrap(async () => { const m = await import('@/components/OfflineMapPanel'); return new m.OfflineMapPanel(); }),
  'oil-spill': wrap(async () => { const m = await import('@/components/OilSpillPanel'); return new m.OilSpillPanel(); }),
  'opensanctions': wrap(async () => { const m = await import('@/components/OpenSanctionsPanel'); return new m.OpenSanctionsPanel(); }),
  'orbat': wrap(async () => { const m = await import('@/components/OrbatPanel'); return new m.OrbatPanel(); }),
  'oref-sirens': wrap(async () => { const m = await import('@/components/OrefSirensPanel'); return new m.OrefSirensPanel(); }),
  'pattern-of-life': wrap(async () => { const m = await import('@/components/PatternOfLifePanel'); return new m.PatternOfLifePanel(); }),
  'pollen': wrap(async () => { const m = await import('@/components/PollenPanel'); return new m.PollenPanel(); }),
  'population-exposure': wrap(async () => { const m = await import('@/components/PopulationExposurePanel'); return new m.PopulationExposurePanel(); }),
  'positive-feed': wrap(async () => { const m = await import('@/components/PositiveNewsFeedPanel'); return new m.PositiveNewsFeedPanel(); }),
  'power-grid': wrap(async () => { const m = await import('@/components/PowerGridPanel'); return new m.PowerGridPanel(); }),
  'polymarket': wrap(async () => { const m = await import('@/components/PredictionPanel'); return new m.PredictionPanel(); }),
  'progress': wrap(async () => { const m = await import('@/components/ProgressChartsPanel'); return new m.ProgressChartsPanel(); }),
  'radiation-decay': wrap(async () => { const m = await import('@/components/RadiationDecayPanel'); return new m.RadiationDecayPanel(); }),
  'renewable': wrap(async () => { const m = await import('@/components/RenewableEnergyPanel'); return new m.RenewableEnergyPanel(); }),
  'resource-inventory': wrap(async () => { const m = await import('@/components/ResourceInventoryPanel'); return new m.ResourceInventoryPanel(); }),
  'ripe-atlas': wrap(async () => { const m = await import('@/components/RipeAtlasPanel'); return new m.RipeAtlasPanel(); }),
  'sanctions-crossref': wrap(async () => { const m = await import('@/components/SanctionsCrossRefPanel'); return new m.SanctionsCrossRefPanel(); }),
  'satellite-change': wrap(async () => { const m = await import('@/components/SatelliteChangePanel'); return new m.SatelliteChangePanel(); }),
  'satellite-fires': wrap(async () => { const m = await import('@/components/SatelliteFiresPanel'); return new m.SatelliteFiresPanel(); }),
  'satellite-intel': wrap(async () => { const m = await import('@/components/SatelliteIntelPanel'); return new m.SatelliteIntelPanel(); }),
  'scenario-simulator': wrap(async () => { const m = await import('@/components/ScenarioSimulatorPanel'); return new m.ScenarioSimulatorPanel(); }),
  'security-advisories': wrap(async () => { const m = await import('@/components/SecurityAdvisoriesPanel'); return new m.SecurityAdvisoriesPanel(); }),
  'service-status': wrap(async () => { const m = await import('@/components/ServiceStatusPanel'); return new m.ServiceStatusPanel(); }),
  'severe-weather': wrap(async () => { const m = await import('@/components/SevereWeatherPanel'); return new m.SevereWeatherPanel(); }),
  'shakealert': wrap(async () => { const m = await import('@/components/ShakeAlertPanel'); return new m.ShakeAlertPanel(); }),
  'shortage-radar': wrap(async () => { const m = await import('@/components/ShortageRadarPanel'); return new m.ShortageRadarPanel(); }),
  'sigint-panel': wrap(async () => { const m = await import('@/components/SigintPanel'); return new m.SigintPanel(); }),
  'situation-awareness': wrap(async () => { const m = await import('@/components/SituationPanel'); return new m.SituationPanel(); }),
  'space-launches': wrap(async () => { const m = await import('@/components/SpaceLaunchesPanel'); return new m.SpaceLaunchesPanel(); }),
  'space-weather': wrap(async () => { const m = await import('@/components/SpaceWeatherPanel'); return new m.SpaceWeatherPanel(); }),
  'space-superpower': wrap(async () => { const m = await import('@/components/SpaceSuperpowerPanel'); return new m.SpaceSuperpowerPanel(); }),
  'spaceflight-news': wrap(async () => { const m = await import('@/components/SpaceflightNewsPanel'); return new m.SpaceflightNewsPanel(); }),
  'species': wrap(async () => { const m = await import('@/components/SpeciesComebackPanel'); return new m.SpeciesComebackPanel(); }),
  'stablecoins': wrap(async () => { const m = await import('@/components/StablecoinPanel'); return new m.StablecoinPanel(); }),
  'stix-taxii': wrap(async () => { const m = await import('@/components/StixTaxiiPanel'); return new m.StixTaxiiPanel(); }),
  'strategic-posture': wrap(async () => { const m = await import('@/components/StrategicPosturePanel'); return new m.StrategicPosturePanel(); }),
  'strategic-risk': wrap(async () => { const m = await import('@/components/StrategicRiskPanel'); return new m.StrategicRiskPanel(); }),
  'strike-package': wrap(async () => { const m = await import('@/components/StrikePackagePanel'); return new m.StrikePackagePanel(); }),
  'strike-packages': wrap(async () => { const m = await import('@/components/StrikePackagesPanel'); return new m.StrikePackagesPanel(); }),
  'supply-chain-impact': wrap(async () => { const m = await import('@/components/SupplyChainImpactPanel'); return new m.SupplyChainImpactPanel(); }),
  'supply-chain': wrap(async () => { const m = await import('@/components/SupplyChainPanel'); return new m.SupplyChainPanel(); }),
  'survival-advisor': wrap(async () => { const m = await import('@/components/SurvivalAdvisorPanel'); return new m.SurvivalAdvisorPanel(); }),
  'system-diagnostic': { ...wrap(async () => { const m = await import('@/components/SystemDiagnosticPanel'); return new m.SystemDiagnosticPanel(); }), waitMs: 100 },
  'tech-hubs': wrap(async () => { const m = await import('@/components/TechHubsPanel'); return new m.TechHubsPanel(); }),
  'tech-readiness': wrap(async () => { const m = await import('@/components/TechReadinessPanel'); return new m.TechReadinessPanel(); }),
  'telegram-intel': wrap(async () => { const m = await import('@/components/TelegramIntelPanel'); return new m.TelegramIntelPanel(); }),
  'threat-inbox': wrap(async () => { const m = await import('@/components/ThreatInboxPanel'); return new m.ThreatInboxPanel(); }),
  'threat-intel-hub': wrap(async () => { const m = await import('@/components/ThreatIntelHubPanel'); return new m.ThreatIntelHubPanel(); }),
  'threat-synthesis': wrap(async () => { const m = await import('@/components/ThreatSynthesisPanel'); return new m.ThreatSynthesisPanel(); }),
  'tide-predictions': wrap(async () => { const m = await import('@/components/TidePredictionsPanel'); return new m.TidePredictionsPanel(); }),
  'timeline-scrubber': wrap(async () => { const m = await import('@/components/TimelineScrubberPanel'); return new m.TimelineScrubberPanel(); }),
  'trade-policy': wrap(async () => { const m = await import('@/components/TradePolicyPanel'); return new m.TradePolicyPanel(); }),
  'tropical-cyclones': wrap(async () => { const m = await import('@/components/TropicalCyclonesPanel'); return new m.TropicalCyclonesPanel(); }),
  'tsunami-alerts': wrap(async () => { const m = await import('@/components/TsunamiAlertsPanel'); return new m.TsunamiAlertsPanel(); }),
  'ucdp-events': wrap(async () => { const m = await import('@/components/UcdpEventsPanel'); return new m.UcdpEventsPanel(); }),
  'unified-alert-inbox': wrap(async () => { const m = await import('@/components/UnifiedAlertInboxPanel'); return new m.UnifiedAlertInboxPanel(); }),
  'volcano-alerts': wrap(async () => { const m = await import('@/components/VolcanoAlertsPanel'); return new m.VolcanoAlertsPanel(); }),
  'volcano-monitor': wrap(async () => { const m = await import('@/components/VolcanoMonitorPanel'); return new m.VolcanoMonitorPanel(); }),
  'watchlist-locations': wrap(async () => { const m = await import('@/components/WatchlistLocationsPanel'); return new m.WatchlistLocationsPanel(); }),
  'water-quality': wrap(async () => { const m = await import('@/components/WaterQualityPanel'); return new m.WaterQualityPanel(); }),
  'weather-radar': wrap(async () => { const m = await import('@/components/WeatherRadarPanel'); return new m.WeatherRadarPanel(); }),
  'wikidata-bases': wrap(async () => { const m = await import('@/components/WikidataBasesPanel'); return new m.WikidataBasesPanel(); }),
  'wildfire-incidents': wrap(async () => { const m = await import('@/components/WildfireIncidentsPanel'); return new m.WildfireIncidentsPanel(); }),
  'wildfire-intel': wrap(async () => { const m = await import('@/components/WildfireIntelPanel'); return new m.WildfireIntelPanel(); }),
  'wildfire-smoke': wrap(async () => { const m = await import('@/components/WildfireSmokePanel'); return new m.WildfireSmokePanel(); }),

  // ── Inspirational quote panels (subclass-per-flavor) ───────────────────
  'stoic-reflections': wrap(async () => { const m = await import('@/components/InspirationQuotePanel'); return new m.StoicQuotePanel(); }),
  'biblical-encouragement': wrap(async () => { const m = await import('@/components/InspirationQuotePanel'); return new m.BiblicalQuotePanel(); }),
  'alan-watts-reflections': wrap(async () => { const m = await import('@/components/InspirationQuotePanel'); return new m.AlanWattsQuotePanel(); }),
  'mckenna-visions': wrap(async () => { const m = await import('@/components/InspirationQuotePanel'); return new m.McKennaQuotePanel(); }),
  'daily-wisdom': wrap(async () => { const m = await import('@/components/DailyWisdomPanel'); return new m.DailyWisdomPanel(); }),

  // ── Region/topic news (NewsPanel(id, title)) ────────────────────────────
  politics: newsPanelFactory('politics', 'World News'),
  us: newsPanelFactory('us', 'United States'),
  europe: newsPanelFactory('europe', 'Europe'),
  middleeast: newsPanelFactory('middleeast', 'Middle East'),
  africa: newsPanelFactory('africa', 'Africa'),
  latam: newsPanelFactory('latam', 'Latin America'),
  asia: newsPanelFactory('asia', 'Asia-Pacific'),
  energy: newsPanelFactory('energy', 'Energy & Resources'),
  intel: newsPanelFactory('intel', 'Intel Feed'),
  gov: newsPanelFactory('gov', 'Government'),
  thinktanks: newsPanelFactory('thinktanks', 'Think Tanks'),
  finance: newsPanelFactory('finance', 'Financial'),
  tech: newsPanelFactory('tech', 'Technology'),
  ai: newsPanelFactory('ai', 'AI/ML'),
  layoffs: newsPanelFactory('layoffs', 'Layoffs Tracker'),
  startups: newsPanelFactory('startups', 'Startups & VC'),
  vcblogs: newsPanelFactory('vcblogs', 'VC Insights'),
  regionalStartups: newsPanelFactory('regionalStartups', 'Regional Startups'),
  unicorns: newsPanelFactory('unicorns', 'Unicorn Tracker'),
  accelerators: newsPanelFactory('accelerators', 'Accelerators'),
  funding: newsPanelFactory('funding', 'Funding & VC'),
  producthunt: newsPanelFactory('producthunt', 'Product Hunt'),
  events: newsPanelFactory('events', 'Tech Events'),
  security: newsPanelFactory('security', 'Cybersecurity'),
  policy: newsPanelFactory('policy', 'Policy'),
  hardware: newsPanelFactory('hardware', 'Hardware'),
  cloud: newsPanelFactory('cloud', 'Cloud'),
  dev: newsPanelFactory('dev', 'Developer'),
  github: newsPanelFactory('github', 'GitHub Trending'),
  ipo: newsPanelFactory('ipo', 'IPO & SPAC'),
  forex: newsPanelFactory('forex', 'Forex'),
  bonds: newsPanelFactory('bonds', 'Fixed Income'),
  centralbanks: newsPanelFactory('centralbanks', 'Central Bank Watch'),
  derivatives: newsPanelFactory('derivatives', 'Derivatives'),
  fintech: newsPanelFactory('fintech', 'Fintech'),
  regulation: newsPanelFactory('regulation', 'Regulation'),
  institutional: newsPanelFactory('institutional', 'Institutional'),
  analysis: newsPanelFactory('analysis', 'Market Analysis'),
  'markets-news': newsPanelFactory('markets-news', 'Markets News'),
  'commodities-news': newsPanelFactory('commodities-news', 'Commodities News'),
  'crypto-news': newsPanelFactory('crypto-news', 'Crypto News'),
  'economic-news': newsPanelFactory('economic-news', 'Economic News'),
  'gcc-investments': newsPanelFactory('gcc-investments', 'GCC Investments'),
  gccNews: newsPanelFactory('gccNews', 'GCC News'),

  // ── Generic intel feed panels (id-driven) ───────────────────────────────
  'isw-reports': genericIntelFeedFactory('isw-reports', 'ISW Reports'),
  'reliefweb-crises': genericIntelFeedFactory('reliefweb-crises', 'UN OCHA'),
  'bellingcat-osint': genericIntelFeedFactory('bellingcat-osint', 'Bellingcat'),
  'fcdo-warnings': genericIntelFeedFactory('fcdo-warnings', 'UK FCDO'),
  'dfat-warnings': genericIntelFeedFactory('dfat-warnings', 'Australia DFAT'),
  'gac-warnings': genericIntelFeedFactory('gac-warnings', 'Canada GAC'),
  'dod-news': genericIntelFeedFactory('dod-news', 'Pentagon News'),
  'nato-news': genericIntelFeedFactory('nato-news', 'NATO Press'),
  'foreign-mil-news': genericIntelFeedFactory('foreign-mil-news', 'Foreign Military News'),
  'liveuamap': genericIntelFeedFactory('liveuamap', 'LiveUAMap'),
  'acaps-crises': genericIntelFeedFactory('acaps-crises', 'ACAPS'),
  'un-security-council': genericIntelFeedFactory('un-security-council', 'UN Security Council'),
  'combatant-commands': genericIntelFeedFactory('combatant-commands', 'Combatant Commands'),
  'congress-defense': genericIntelFeedFactory('congress-defense', 'Congress Defense'),
  'spc-mesoscale': genericIntelFeedFactory('spc-mesoscale', 'SPC Mesoscale'),
  'mediastack-news': genericIntelFeedFactory('mediastack-news', 'MediaStack'),
  'phishstats-feed': genericIntelFeedFactory('phishstats-feed', 'PhishStats'),
  'urlscan-threats': genericIntelFeedFactory('urlscan-threats', 'URLScan'),
  'bitcoin-abuse': genericIntelFeedFactory('bitcoin-abuse', 'Bitcoin Abuse'),
  'cve-tracker': genericIntelFeedFactory('cve-tracker', 'CVE Tracker'),
  'vulners-cve': genericIntelFeedFactory('vulners-cve', 'Vulners'),
  'pulsedive-intel': genericIntelFeedFactory('pulsedive-intel', 'Pulsedive'),
  'hibp-breaches': genericIntelFeedFactory('hibp-breaches', 'HIBP'),
  'reddit-osint': genericIntelFeedFactory('reddit-osint', 'Reddit OSINT'),
  'openaq-monitor': genericIntelFeedFactory('openaq-monitor', 'OpenAQ'),
  'ripe-ncc': genericIntelFeedFactory('ripe-ncc', 'RIPE NCC'),
  'ipinfo-lookup': genericIntelFeedFactory('ipinfo-lookup', 'IPInfo'),
  'amtrak-alerts': genericIntelFeedFactory('amtrak-alerts', 'Amtrak Alerts'),
  'dsca-arms-transfers': genericIntelFeedFactory('dsca-arms-transfers', 'DSCA Arms'),
  'ecdc-surveillance': genericIntelFeedFactory('ecdc-surveillance', 'ECDC'),
  'habsos': genericIntelFeedFactory('habsos', 'Harmful Algal Blooms'),

  // ── Panels with parameterised constructors ─────────────────────────────
  watchlist: wrap(async () => {
    const m = await import('@/components/WatchlistPanel');
    return new m.WatchlistPanel({
      getCountrySnapshot: () => null,
      openCountryBrief: () => {},
    });
  }),
  monitors: wrap(async () => {
    const m = await import('@/components/MonitorPanel');
    return new m.MonitorPanel([]);
  }),
  'saved-places': wrap(async () => {
    const m = await import('@/components/SavedPlacesPanel');
    return new m.SavedPlacesPanel({
      focusPlace: () => {},
      editPlace: () => {},
      createPlace: () => {},
    });
  }),
  'local-logistics': wrap(async () => {
    const m = await import('@/components/LocalLogisticsPanel');
    return new m.LocalLogisticsPanel({ focusNode: () => {} });
  }),
  'nuclear-risk': wrap(async () => {
    const m = await import('@/components/NuclearRiskPanel');
    return new m.NuclearRiskPanel('nuclear-risk', 'Nuclear Risk Tracker');
  }),
};

export function getRegisteredPanelIds(): string[] {
  return Object.keys(PANEL_SMOKE_REGISTRY).sort();
}

/**
 * Panels we deliberately do NOT exercise in the smoke harness, with the
 * reason. The Map panel needs WebGL + Cesium / DeckGL — booting it under
 * happy-dom would tell us nothing useful about silent rendering. Add
 * panels here only with a clear reason; everything else should grow a
 * factory above instead.
 */
export const PANEL_SMOKE_EXCLUSIONS: Record<string, string> = {
  map: 'requires WebGL + DeckGL/Cesium runtime — covered by e2e tests',
};
