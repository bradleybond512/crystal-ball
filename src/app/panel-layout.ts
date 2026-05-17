import type { AppContext, AppModule } from '@/app/app-context';
import type { RelatedAsset } from '@/types';
import type { TheaterPostureSummary } from '@/services/military-surge';
import {
  MapContainer,
  NewsPanel,
  MarketPanel,
  HeatmapPanel,
  CommoditiesPanel,
  CryptoPanel,
  PredictionPanel,
  MonitorPanel,
  EconomicPanel,
  GdeltIntelPanel,
  LiveNewsPanel,
  LiveWebcamsPanel,
  CIIPanel,
  CascadePanel,
  StrategicRiskPanel,
  StrategicPosturePanel,
  TechEventsPanel,
  ServiceStatusPanel,
  InsightsPanel,
  TechReadinessPanel,
  MacroSignalsPanel,
  ETFFlowsPanel,
  StablecoinPanel,
  UcdpEventsPanel,
  DisplacementPanel,
  ClimateAnomalyPanel,
  PopulationExposurePanel,
  TsunamiAlertsPanel,
  TropicalCyclonesPanel,
  FoodInsecurityPanel,
  OfflineMapPanel,
  EvacuationPanel,
  FamilyTrackerPanel,
  InvestmentsPanel,
  TradePolicyPanel,
  SupplyChainPanel,
  SecurityAdvisoriesPanel,
  NetworkRulesPanel,
  S2UIntelPanel,
  SynthesisPanel,
  CyberGeoPanel,
  EconomicIntelPanel,
  OrefSirensPanel,
  TelegramIntelPanel,
  WatchlistPanel,
  SavedPlacesPanel,
  WatchlistLocationsPanel,
  LocalLogisticsPanel,
  CommsPlanPanel,
  StoicQuotePanel,
  BiblicalQuotePanel,
  AlanWattsQuotePanel,
  McKennaQuotePanel,
  DailyWisdomPanel,
} from '@/components';
import { SatelliteFiresPanel } from '@/components/SatelliteFiresPanel';
import { TriageBar } from '@/components/TriageBar';
import { EEWStatusBar } from '@/components/EEWStatusBar';
import { CorrelationAlertBanner } from '@/components/CorrelationAlertBanner';
import { startSpaceWeatherStatusBarPoller } from '@/services/spaceweather/status-bar-poller';
import { JustInRail } from '@/components/JustInRail';
import { startPanelNarrator } from '@/services/panel-narrator';
import { TodayView } from '@/components/TodayView';
import { WatchlistEditor } from '@/components/WatchlistEditor';
import { CommandPalettePanel } from '@/components/CommandPalettePanel';
import { getCommandRegistry } from '@/services/command-palette/command-registry';
import { registerBuiltinCommands } from '@/services/command-palette/built-in-commands';
import { HelpOverlay } from '@/components/HelpOverlay';
import { installShortcuts } from '@/services/keyboard/shortcut-bootstrap';
import { startDockBadge } from '@/services/native/dock-badge';
import { startMenubarStatus } from '@/services/native/menubar-status';
import { startSituationAlertBridge } from '@/services/situation-alert-bridge';
import { startRulesEngineBootstrap } from '@/services/intelligence/rules-bootstrap';
import { startSilenceDetector } from '@/services/silence-detector';
import { startSourceFeedback } from '@/services/source-feedback';
import { startCorrelationFeedback } from '@/services/correlation-feedback';
import { startInfrastructureAlertBridge } from '@/services/infrastructure-alert-bridge';
import { startIntelChannelsBridge } from '@/services/intel-channels-bridge';
import { startAnomalyBaselines } from '@/services/anomaly-baselines';
import { startCompoundAlertBridge } from '@/services/compound-alert-bridge';
import { startAlertLifecycle } from '@/services/alert-lifecycle';
import { startSituationFeed } from '@/services/situation-feed';
import { startForecastAccuracy } from '@/services/forecast-accuracy';
import { startWatchlistProximity } from '@/services/watchlist-proximity';
import { CrystalBallSays } from '@/components/CrystalBallSays';
import { RelatedStrip } from '@/components/RelatedStrip';
import { startAlertGeoClustering } from '@/services/alert-geo-cluster';
import { startSeverityRecalibration } from '@/services/severity-recalibration';
import { startAlertFatigue } from '@/services/alert-fatigue';
import { initSnoozeLearning } from '@/services/snooze-learning';
import { initCustomCorrelationRules } from '@/services/custom-correlation-rules';
import { startPatternMemory } from '@/services/pattern-memory';
import { initSourceReliability } from '@/services/source-reliability';
import { initAlertAnnotations } from '@/services/alert-annotations';
import { initAlertBookmarks } from '@/services/alert-bookmarks';
import { initExportBriefing, exportBriefingToClipboard } from '@/services/export-briefing';
import { startGeofenceAlerts } from '@/services/geofence-alerts';
import { startProximityCascade } from '@/services/proximity-cascade';
import { startThreatCorridor } from '@/services/threat-corridor';
import { startPeriodicityDetector } from '@/services/periodicity-detector';
import { startSilenceAnomaly } from '@/services/silence-anomaly';
import { ShiftHandoffCard } from '@/components/ShiftHandoffCard';
import { AlertReplayScrubber } from '@/components/AlertReplayScrubber';
import { EntityHeatRail } from '@/components/EntityHeatRail';
import { AlertTimeline } from '@/components/AlertTimeline';
import { StatusOverlay } from '@/components/StatusOverlay';
import { startBlackoutSignature } from '@/services/blackout-signature';
import { DigestOverlay } from '@/components/DigestOverlay';
import { shouldShowDigest, markDigestShown, generateDigest } from '@/services/crystal-ball-chat';
import { startAlertReactions, flashPanel, jumpToPanel } from '@/services/alert-reactions';
import { startAnalystLoop } from '@/services/analyst-loop';
import { startModeForecast } from '@/services/mode-forecast';
import { startRelevanceLearner } from '@/services/relevance-learner';
import { startHypothesisAccuracy } from '@/services/hypothesis-accuracy';
import { startAutoBrief } from '@/services/auto-brief';
import { startHypothesisThreads } from '@/services/hypothesis-threads';
import { startHypothesisEntities } from '@/services/hypothesis-entities';
import { startHypothesisSkeptic } from '@/services/hypothesis-skeptic';
import { startPressureHistory } from '@/services/pressure-history';
import { startSidecarPusher } from '@/services/sidecar-pusher';
import { startAnalystCommandListener } from '@/services/analyst-command-listener';
import { startActionMemory } from '@/services/action-memory';
import { startPressureBaselines } from '@/services/pressure-baselines';
import { startBriefingArchive } from '@/services/briefing-archive';
import { startHypothesisNotifier } from '@/services/hypothesis-notifier';
import { startSnapshotArchive } from '@/services/snapshot-archive';
import { startReasoningDebug } from '@/services/reasoning-debug';
import { startReasoningMetrics } from '@/services/reasoning-metrics';
import { AnalystHUD } from '@/components/AnalystHUD';
import { ReasoningDebugOverlay, ensureReasoningDebugCss } from '@/components/ReasoningDebugOverlay';
import { startSidebarHeat } from '@/services/sidebar-heat';
import { startAlertCorrelator } from '@/services/alert-correlator';
import { startAlertDebug } from '@/services/alert-debug';
import { startAlertActivityLog } from '@/services/alert-activity-log';
import { EarthquakesPanel } from '@/components/EarthquakesPanel';
import { CyberThreatPanel } from '@/components/CyberThreatPanel';
import { LocalIDSPanel } from '@/components/LocalIDSPanel';
import { LittleSnitchPanel } from '@/components/LittleSnitchPanel';
import { AlertCenterPanel } from '@/components/AlertCenterPanel';
import { SituationPanel } from '@/components/SituationPanel';
import { SpaceWeatherPanel } from '@/components/SpaceWeatherPanel';
import { SpaceflightNewsPanel } from '@/components/SpaceflightNewsPanel';
import { SpaceLaunchesPanel } from '@/components/SpaceLaunchesPanel';
import { DiseaseOutbreakPanel } from '@/components/DiseaseOutbreakPanel';
import { HumanitarianCrisisPanel } from '@/components/HumanitarianCrisisPanel';
import { GlobalWeatherPanel } from '@/components/GlobalWeatherPanel';
import { ExtendedForecastPanel } from '@/components/ExtendedForecastPanel';
import { WeatherRadarPanel } from '@/components/WeatherRadarPanel';
import { TidePredictionsPanel } from '@/components/TidePredictionsPanel';
import { PollenPanel } from '@/components/PollenPanel';
import { OpenSanctionsPanel } from '@/components/OpenSanctionsPanel';
import { SanctionsPanel } from '@/components/SanctionsPanel';
// OSINT panels are lazy-loaded so they land in their own chunk. They are
// rarely the first thing a user opens, and pulling their dependencies
// (parsers, URL validators, threat-feed clients) into the main panels chunk
// costs ~70KB gzipped at boot. See loadOsintPanels() below.
import { EdgarFilingsPanel } from '@/components/EdgarFilingsPanel';
import { AirQualityPanel } from '@/components/AirQualityPanel';
import { OpenaqMonitorPanel } from '@/components/OpenaqMonitorPanel';
import { WhatChangedPanel } from '@/components/WhatChangedPanel';
import { MediastackNewsPanel } from '@/components/MediastackNewsPanel';
import { WildfireIncidentsPanel } from '@/components/WildfireIncidentsPanel';
import { WildfireIntelPanel } from '@/components/WildfireIntelPanel';
import { HazmatIncidentsPanel } from '@/components/HazmatIncidentsPanel';
import { OilSpillPanel } from '@/components/OilSpillPanel';
import { HazardAlertsPanel } from '@/components/HazardAlertsPanel';
import { InfrastructurePanel } from '@/components/InfrastructurePanel';
import { GridIntelligencePanel } from '@/components/GridIntelligencePanel';
import { startGridIntelligenceLoader } from '@/services/infrastructure/grid-intelligence-loader';
import { AirstrikesPanel } from '@/components/AirstrikesPanel';
import { StrikePackagePanel } from '@/components/StrikePackagePanel';
import { DodContractsPanel } from '@/components/DodContractsPanel';
import { WikidataBasesPanel } from '@/components/WikidataBasesPanel';
import { GDACSAlertsPanel } from '@/components/GDACSAlertsPanel';
import { VolcanoAlertsPanel } from '@/components/VolcanoAlertsPanel';
import { VolcanoMonitorPanel } from '@/components/VolcanoMonitorPanel';
import { SevereWeatherPanel } from '@/components/SevereWeatherPanel';
import { ShakeAlertPanel } from '@/components/ShakeAlertPanel';
import { NWSAlertsPanel } from '@/components/NWSAlertsPanel';
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
import { CongressDefensePanel } from '@/components/CongressDefensePanel';
import { CombatantCommandsPanel } from '@/components/CombatantCommandsPanel';
import { ForeignMilNewsPanel } from '@/components/ForeignMilNewsPanel';
import { SpcMesoscalePanel } from '@/components/SpcMesoscalePanel';
import { FAAWeatherCamsPanel } from '@/components/FAAWeatherCamsPanel';
import { UnifiedWebcamPanel } from '@/components/UnifiedWebcamPanel';
import { CommsHealthPanel } from '@/components/CommsHealthPanel';
import { PowerGridPanel } from '@/components/PowerGridPanel';
import { FearGreedPanel } from '@/components/FearGreedPanel';
import { InternetDisruptionsPanel } from '@/components/InternetDisruptionsPanel';
import { NationalDebtPanel } from '@/components/NationalDebtPanel';
import { FuelPricesPanel } from '@/components/FuelPricesPanel';
import { AirTrafficPanel } from '@/components/AirTrafficPanel';
import { ThreatIntelHubPanel } from '@/components/ThreatIntelHubPanel';
import { GeoIntelPanel } from '@/components/GeoIntelPanel';
import { DarkWebPanel } from '@/components/DarkWebPanel';
import { IntelligenceBriefingPanel } from '@/components/IntelligenceBriefingPanel';
import { AskCrystalBallPanel } from '@/components/AskCrystalBallPanel';
import { SurvivalAdvisorPanel } from '@/components/SurvivalAdvisorPanel';
import { ThreatSynthesisPanel } from '@/components/ThreatSynthesisPanel';
import { ScenarioSimulatorPanel } from '@/components/ScenarioSimulatorPanel';
import { EscalationForecastPanel } from '@/components/EscalationForecastPanel';
import { AnomalyDetectionPanel } from '@/components/AnomalyDetectionPanel';
import { FinancialContagionPanel } from '@/components/FinancialContagionPanel';
import { SupplyChainImpactPanel } from '@/components/SupplyChainImpactPanel';
import { WaterQualityPanel } from '@/components/WaterQualityPanel';
import { NuclearMonitorPanel } from '@/components/NuclearMonitorPanel';
import { NotificationDigestPanel } from '@/components/NotificationDigestPanel';
import { NotificationHistoryPanel } from '@/components/NotificationHistoryPanel';
import { NotificationAuditPanel } from '@/components/NotificationAuditPanel';
import { TrustBudgetPanel } from '@/components/TrustBudgetPanel';
import { NotificationSettingsPanel } from '@/components/NotificationSettingsPanel';
import { NotificationPreferencesPanel } from '@/components/NotificationPreferencesPanel';
import { SituationStorePanel } from '@/components/SituationStorePanel';
import { ObservationRulesPanel } from '@/components/ObservationRulesPanel';
import { PatternOfLifePanel } from '@/components/PatternOfLifePanel';
import { SigintPanel } from '@/components/SigintPanel';
import { DarkVesselPanel } from '@/components/DarkVesselPanel';
import { CourseOfActionPanel } from '@/components/CourseOfActionPanel';
import { KillChainPanel } from '@/components/KillChainPanel';
import { IcsOtDashboardPanel } from '@/components/IcsOtDashboardPanel';
import { IocManagerPanel } from '@/components/IocManagerPanel';
import { OrbatPanel } from '@/components/OrbatPanel';
import { AarPanel } from '@/components/AarPanel';
import { NetworkTopologyPanel } from '@/components/NetworkTopologyPanel';
import { GeofencePanel } from '@/components/GeofencePanel';
import { StixTaxiiPanel } from '@/components/StixTaxiiPanel';
import { EntityLinkGraphPanel } from '@/components/EntityLinkGraphPanel';
import { TimelineScrubberPanel } from '@/components/TimelineScrubberPanel';
import { IntelReportPanel } from '@/components/IntelReportPanel';
import { SanctionsCrossRefPanel } from '@/components/SanctionsCrossRefPanel';
import { CompoundThreatPanel } from '@/components/CompoundThreatPanel';
import { CorrelationMatrixPanel } from '@/components/CorrelationMatrixPanel';
import { CorrelationMapPanel } from '@/components/CorrelationMapPanel';
import { StrikePackagesPanel } from '@/components/StrikePackagesPanel';
import { ApiDiagnosticPanel } from '@/components/ApiDiagnosticPanel';
import { FeedHealthPanel } from '@/components/FeedHealthPanel';
import { CveTrackerPanel } from '@/components/CveTrackerPanel';
import { VulnersCvePanel } from '@/components/VulnersCvePanel';
import { SystemDiagnosticPanel } from '@/components/SystemDiagnosticPanel';
import { AssumptionPanel } from '@/components/AssumptionPanel';
import { DomainScorecardPanel } from '@/components/DomainScorecardPanel';
import { QualityDebtPanel } from '@/components/QualityDebtPanel';
import { DiagnosticSelfTestPanel } from '@/components/DiagnosticSelfTestPanel';
import { SelfTestRunnerPanel } from '@/components/SelfTestRunnerPanel';
import { OperatorModePanel } from '@/components/OperatorModePanel';
import { CommandCenterPanel } from '@/components/CommandCenterPanel';
import { RepairRecommendationsPanel } from '@/components/RepairRecommendationsPanel';
import { HypothesisPanel } from '@/components/HypothesisPanel';
import { MetaConfidencePanel } from '@/components/MetaConfidencePanel';
import { ShadowModePanel } from '@/components/ShadowModePanel';
import { getShadowRunner } from '@/services/intelligence/shadow-runner';
import { builtInShadowAlgorithms } from '@/services/intelligence/built-in-shadow-algorithms';
import { AlgorithmDiagnosticPanel } from '@/components/AlgorithmDiagnosticPanel';
import { OutcomeLedgerPanel } from '@/components/OutcomeLedgerPanel';
import { BiasDetectionPanel } from '@/components/BiasDetectionPanel';
import { ActiveLearningPanel } from '@/components/ActiveLearningPanel';
import { SchedulerPanel } from '@/components/SchedulerPanel';
import { AlgoEvalPanel } from '@/components/AlgoEvalPanel';
import { BacktestPanel } from '@/components/BacktestPanel';
import { SafetyCaseDashboard } from '@/components/SafetyCaseDashboard';
import { MultiAgentReviewPanel } from '@/components/MultiAgentReviewPanel';
import { AlertTracePanel } from '@/components/AlertTracePanel';
import { AlertExplanationPanel } from '@/components/AlertExplanationPanel';
import { PersonalRelevancePanel } from '@/components/PersonalRelevancePanel';
import { ScenarioReplayPanel } from '@/components/ScenarioReplayPanel';
import { EvidenceGraphPanel } from '@/components/EvidenceGraphPanel';
import { EntityRegistryPanel } from '@/components/EntityRegistryPanel';
import { PlaybookPanel } from '@/components/PlaybookPanel';
import { SmsSettingsPanel } from '@/components/SmsSettingsPanel';
import { ThreatDashboard } from '@/components/ThreatDashboard';
import { startThreatAggregator } from '@/services/synthesis/threat-aggregator';
import { AviationIntelPanel } from '@/components/AviationIntelPanel';
import { IntelligenceFeedPanel } from '@/components/IntelligenceFeedPanel';
import { ShortageRadarPanel } from '@/components/ShortageRadarPanel';
import { ShortageDetailPanel } from '@/components/ShortageDetailPanel';
import { WeatherHazardPanel } from '@/components/WeatherHazardPanel';
import { MaritimeIntelPanel } from '@/components/MaritimeIntelPanel';
import { SupplyChainDisruptionPanel } from '@/components/SupplyChainDisruptionPanel';
import { InfraRiskMatrixPanel } from '@/components/InfraRiskMatrixPanel';
import { EarthquakeSuperPanel } from '@/components/EarthquakeSuperPanel';
import { IntelligenceTimelinePanel } from '@/components/IntelligenceTimelinePanel';
import { CascadeSimulatorPanel } from '@/components/CascadeSimulatorPanel';
import { EmergencyBroadcastPanel } from '@/components/EmergencyBroadcastPanel';
import { SatelliteChangePanel } from '@/components/SatelliteChangePanel';
import { SatelliteIntelPanel } from '@/components/SatelliteIntelPanel';
import { EconomicStressPanel } from '@/components/EconomicStressPanel';
import { FederalRegisterPanel } from '@/components/FederalRegisterPanel';
import { NuclearRiskPanel } from '@/components/NuclearRiskPanel';
import { RadiationDecayPanel } from '@/components/RadiationDecayPanel';
import { ResourceInventoryPanel } from '@/components/ResourceInventoryPanel';
import { WorldClockPanel } from '@/components/WorldClockPanel';
import { PinnedWebcamsPanel } from '@/components/PinnedWebcamsPanel';
import { PositiveNewsFeedPanel } from '@/components/PositiveNewsFeedPanel';
import { CountersPanel } from '@/components/CountersPanel';
import { ProgressChartsPanel } from '@/components/ProgressChartsPanel';
import { BreakthroughsTickerPanel } from '@/components/BreakthroughsTickerPanel';
import { HeroSpotlightPanel } from '@/components/HeroSpotlightPanel';
import { GoodThingsDigestPanel } from '@/components/GoodThingsDigestPanel';
import { SpeciesComebackPanel } from '@/components/SpeciesComebackPanel';
import { RenewableEnergyPanel } from '@/components/RenewableEnergyPanel';
import { GeoHubsPanel } from '@/components/GeoHubsPanel';
import { TechHubsPanel } from '@/components/TechHubsPanel';
import { RegulationPanel } from '@/components/RegulationPanel';
import { GivingPanel } from '@/components';
import { UnifiedAlertInboxPanel } from '@/components/UnifiedAlertInboxPanel';
import { AlertRulesPanel } from '@/components/AlertRulesPanel';
import { StalenessBanner } from '@/components/StalenessBanner';
import { focusInvestmentOnMap } from '@/services/investments-focus';
import { debounce, rafSchedule, saveToStorage } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';
import {
  FEEDS,
  INTEL_SOURCES,
  DEFAULT_PANELS,
  STORAGE_KEYS,
  SITE_VARIANT,
} from '@/config';
import { t } from '@/services/i18n';
import { trackCriticalBannerAction } from '@/services/analytics';
import { alertFamily, getMode, toggleGhostMode, type AppMode } from '@/services/mode-manager';
import {
  initSituationalMode, setMode as setSituationalMode,
  setAutoMode, getAutoMode, isAutoMode, clearManualMode,
  type SituationalMode, type SituationalModeChangedDetail,
} from '@/app/mode-manager';
import { unifiedAlertStore } from '@/services/unified-alerts';
import { isLowPowerMode, setLowPowerMode } from '@/services/low-power';
import { tryInvokeTauri, invokeTauri } from '@/services/tauri-bridge';
import { initModeTransitionCards } from '@/services/mode-transition-card';
import { initPanelCorrelation } from '@/services/panel-correlation';
import { getPrimarySavedPlace, getSavedPlace } from '@/services/saved-places';
import { SavedPlaceModal } from '@/components/SavedPlaceModal';
import type { GeoHubActivity } from '@/services/geo-activity';
import type { TechHubActivity } from '@/services/tech-activity';
import { RipeAtlasPanel } from '@/components/RipeAtlasPanel';
import { GoesSatellitePanel } from '@/components/GoesSatellitePanel';
import { FloodMonitorPanel } from '@/components/FloodMonitorPanel';
// HTML builders (app shell + map + sidebar) live in a sibling module.
import * as htmlBuilders from '@/app/layout/html';

export interface PanelLayoutCallbacks {
  openCountryStory: (code: string, name: string) => void;
  openCountryBriefByCode: (code: string, country: string) => void;
  getCountryWatchSnapshot: (code: string, country: string) => import('@/components/WatchlistPanel').WatchCountrySnapshot | null;
  loadAllData: () => Promise<void>;
  updateMonitorResults: () => void;
  loadSecurityAdvisories?: () => Promise<void>;
}

export class PanelLayoutManager implements AppModule {
  private ctx: AppContext;
  private callbacks: PanelLayoutCallbacks;
  private panelDragCleanupHandlers: (() => void)[] = [];
  private criticalBannerEl: HTMLElement | null = null;
  private readonly applyTimeRangeFilterDebounced: () => void;
  private readonly _onUpdateState = () => { this.renderSidebarUpdateBtn(); };

  /** Saved panel order from before a Ghost-mode switch so the default state can restore it. */
  private _preModeOrder: string[] = [];

  /** Panels always kept at the top regardless of mode (video feeds / live streams). */
  private static readonly MODE_ANCHORS = ['command-center', 'threat-dashboard', 'watchlist', 'alert-center', 'live-news', 'live-webcams'];

  /** localStorage key for last-viewed panel (boot scroll restore). */
  private static readonly LAST_VIEWED_KEY = 'cb-last-viewed-panel';

  /** Panels floated to top in Finance Mode. */
  private static readonly FINANCE_PRIORITY = [
 'crypto', 'markets', 'stablecoins', 'commodities',
 'macro-signals', 'heatmap', 'etf-flows', 'economic', 'economic-stress',
  ];

  /** Panels floated to top in War Mode. */
  private static readonly WAR_PRIORITY = [
 'alert-center', 'cyber-threats', 'oref-sirens', 'telegram-intel',
 'gdelt-intel', 'cascade', 'strategic-posture', 'strategic-risk',
 'cii', 'satellite-fires', 'ucdp-events', 'displacement', 'space-weather', 'comms-health',
  ];

  /** Panels floated to top in Disaster Mode. */
  private static readonly DISASTER_PRIORITY = [
 'hazard-alerts',
 'alert-center', 'saved-places', 'tropical-cyclones', 'nws-alerts',
 'global-weather', 'weather-radar', 'earthquakes', 'gdacs-alerts', 'satellite-fires',
 'volcano-alerts', 'displacement', 'oref-sirens', 'air-quality',
 'wildfire-incidents', 'hazmat-incidents', 'oil-spill',
 'comms-health', 'economic-stress',
  ];

  constructor(ctx: AppContext, callbacks: PanelLayoutCallbacks) {
 this.ctx = ctx;
 this.callbacks = callbacks;
 this.applyTimeRangeFilterDebounced = debounce(() => {
 this.applyTimeRangeFilterToNewsPanels();
 }, 120);
  }

  private stalenessBanner: StalenessBanner | null = null;

  init(): void {
 this.renderLayout();
 document.addEventListener('wm:update-state', this._onUpdateState);
 this.stalenessBanner = StalenessBanner.mount();
  }

  destroy(): void {
 document.removeEventListener('wm:update-state', this._onUpdateState);
 this.panelDragCleanupHandlers.forEach((cleanup) => cleanup());
 this.panelDragCleanupHandlers = [];
 if (this.criticalBannerEl) {
 this.criticalBannerEl.remove();
 this.criticalBannerEl = null;
 }
 if (this.stalenessBanner) {
 this.stalenessBanner.destroy();
 this.stalenessBanner = null;
 }
 // Clean up happy variant panels
 this.ctx.tvMode?.destroy();
 this.ctx.tvMode = null;
 this.ctx.countersPanel?.destroy();
 this.ctx.progressPanel?.destroy();
 this.ctx.breakthroughsPanel?.destroy();
 this.ctx.heroPanel?.destroy();
 this.ctx.digestPanel?.destroy();
 this.ctx.speciesPanel?.destroy();
 this.ctx.renewablePanel?.destroy();
  }

  renderLayout(): void {
 // Tauri uses the macOS sidebar+toolbar shell; web (any browser) uses the
 // header-bar layout that has its own settings gear and version display.
 // Earlier attempts to put web on the desktop shell hit too many edge
 // cases (hidden .header from is-desktop-macos, sidebar collapse from a
 // stale localStorage flag, toolbar drag regions reading as "menu bars"),
 // so we keep the two layouts strictly separated.
 this.ctx.container.innerHTML = this.ctx.isDesktopApp ? this.buildDesktopLayout() : this.buildWebLayout();
 if (this.ctx.isDesktopApp) {
 document.title = `Crystal Ball v${__APP_VERSION__}`;
 }
 this.createPanels();
 if (this.ctx.isDesktopApp) {
 this.renderSidebarUpdateBtn();
 }
  }

  renderSidebarUpdateBtn(): void {
 const container = document.getElementById('sidebarUpdateBtn');
 if (!container) return;
 // Safe: buildSidebarUpdateBtnHtml() uses escapeHtml() on all API-sourced strings.
 // Only other content is hardcoded markup (class names, "Installing…", "✓", button structure).
 container.innerHTML = this.buildSidebarUpdateBtnHtml(); // safe-html: escapeHtml applied to all dynamic strings

 // Re-check button: rendered when state is null (initial / after fetch
 // failure) or 'up-to-date'. Dispatches the same event the macOS Help
 // menu uses so the desktop-updater module owns the actual fetch.
 const recheckBtn = container.querySelector<HTMLButtonElement>('#sidebarUpdateRecheck');
 if (recheckBtn) {
 recheckBtn.addEventListener('click', () => {
 document.dispatchEvent(new CustomEvent('wm:check-for-updates'));
 });
 }

 const installBtn = container.querySelector<HTMLButtonElement>('#sidebarUpdateInstall');
 if (!installBtn) return;

 const state = this.ctx.updateState;
 if (state?.phase !== 'available' || !state.downloadUrl) return;

 const { version, downloadUrl, expectedSha256 } = state;
 installBtn.addEventListener('click', () => {
 this.ctx.updateState = { phase: 'installing' };
 this.renderSidebarUpdateBtn();
 invokeTauri<void>('install_update', { downloadUrl, expectedSha256 }).catch(() => {
 this.ctx.updateState = { phase: 'available', version, downloadUrl, expectedSha256 };
 this.renderSidebarUpdateBtn();
 });
 });
  }


  // HTML builders live in src/app/layout/html.ts. Only the wrappers still
  // called by the rest of this class are retained.
  private buildSidebarUpdateBtnHtml(): string { return htmlBuilders.buildSidebarUpdateBtnHtml(this.ctx); }
  private buildDesktopLayout(): string { return htmlBuilders.buildDesktopLayout(this.ctx); }
  private buildWebLayout(): string { return htmlBuilders.buildWebLayout(this.ctx); }

  renderCriticalBanner(postures: TheaterPostureSummary[]): void {
 if (this.ctx.isMobile) {
 if (this.criticalBannerEl) {
 this.criticalBannerEl.remove();
 this.criticalBannerEl = null;
 }
 document.body.classList.remove('has-critical-banner');
 return;
 }

 const dismissedAt = sessionStorage.getItem('banner-dismissed');
 if (dismissedAt && Date.now() - Number.parseInt(dismissedAt, 10) < 30 * 60 * 1000) {
 return;
 }

 const critical = postures.filter(
 (p) => p.postureLevel === 'critical' || (p.postureLevel === 'elevated' && p.strikeCapable)
 );

 if (critical.length === 0) {
 if (this.criticalBannerEl) {
 this.criticalBannerEl.remove();
 this.criticalBannerEl = null;
 document.body.classList.remove('has-critical-banner');
 }
 return;
 }

 const top = critical[0]!;
 const isCritical = top.postureLevel === 'critical';

 if (!this.criticalBannerEl) {
 this.criticalBannerEl = document.createElement('div');
 this.criticalBannerEl.className = 'critical-posture-banner';
 const header = document.querySelector('.header');
 if (header) header.insertAdjacentElement('afterend', this.criticalBannerEl);
 }

 document.body.classList.add('has-critical-banner');
 this.criticalBannerEl.className = `critical-posture-banner ${isCritical ? 'severity-critical' : 'severity-elevated'}`;
 this.criticalBannerEl.innerHTML = `
 <div class="banner-content">
 <span class="banner-icon">${isCritical ? '🚨' : '⚠️'}</span>
 <span class="banner-headline">${escapeHtml(top.headline)}</span>
 <span class="banner-stats">${top.totalAircraft} aircraft • ${escapeHtml(top.summary)}</span>
 ${top.strikeCapable ? '<span class="banner-strike">STRIKE CAPABLE</span>' : ''}
 </div>
 <button class="banner-view" data-lat="${top.centerLat}" data-lon="${top.centerLon}">View Region</button>
 <button class="banner-dismiss">×</button>
 `;

 this.criticalBannerEl.querySelector('.banner-view')?.addEventListener('click', () => {
 console.log('[Banner] View Region clicked:', top.theaterId, 'lat:', top.centerLat, 'lon:', top.centerLon);
 trackCriticalBannerAction('view', top.theaterId);
 if (typeof top.centerLat === 'number' && typeof top.centerLon === 'number') {
 this.ctx.map?.setCenter(top.centerLat, top.centerLon, 4);
 } else {
 console.error('[Banner] Missing coordinates for', top.theaterId);
 }
 });

 this.criticalBannerEl.querySelector('.banner-dismiss')?.addEventListener('click', () => {
 trackCriticalBannerAction('dismiss', top.theaterId);
 this.criticalBannerEl?.classList.add('dismissed');
 document.body.classList.remove('has-critical-banner');
 sessionStorage.setItem('banner-dismissed', Date.now().toString());
 });
  }

  applyPanelSettings(): void {
 Object.entries(this.ctx.panelSettings).forEach(([key, config]) => {
 if (key === 'map') {
 const mapSection = document.getElementById('mapSection');
 if (mapSection) {
 mapSection.classList.toggle('hidden', !config.enabled);
 }
 return;
 }
 const panel = this.ctx.panels[key];
 panel?.toggle(config.enabled);
 });
 // Sync sidebar dot states when panels are toggled
 document.querySelectorAll<HTMLElement>('.mac-sidebar-panel-item[data-panel-key]').forEach(item => {
 const key = item.dataset.panelKey;
 if (!key) return;
 const enabled = this.ctx.panelSettings[key]?.enabled ?? false;
 item.classList.toggle('is-disabled', !enabled);
 });
  }

  private createPanels(): void {
 const panelsGrid = document.getElementById('panelsGrid')!;

 // Mount the EEW status bar at the top of the body — sits above
 // everything else (above the panel grid + triage bar). Layer 9
 // of the seismic intelligence stack.
 const eewStatusBar = new EEWStatusBar();
 eewStatusBar.mount(document.body);
 startSpaceWeatherStatusBarPoller(eewStatusBar);

 // Mount the cross-domain correlation banner. Self-fetches from
 // /api/synthesis/correlations every 15s; hidden when no events.
 const correlationBanner = new CorrelationAlertBanner();
 correlationBanner.mount(document.body);

 // Mount the triage bar above the panel grid (auto-hides when nothing is hot).
 const triageBar = new TriageBar();
 triageBar.mount(panelsGrid.parentElement ?? panelsGrid);
 const justInRail = new JustInRail();
 justInRail.mount(document.body);
 startPanelNarrator();
 startAlertDebug();
 startAlertActivityLog();
 startAlertReactions();
 startSidebarHeat();
 startAlertCorrelator();
 startSituationAlertBridge();
 startRulesEngineBootstrap();
 startSilenceDetector();
 startSourceFeedback();
 startCorrelationFeedback();
 startInfrastructureAlertBridge();
  startIntelChannelsBridge();
 startAnomalyBaselines();
 startCompoundAlertBridge();
 startAlertLifecycle();
 startSituationFeed();
 startForecastAccuracy();
 startWatchlistProximity();
 startSeverityRecalibration();
 startAlertFatigue();
 initSnoozeLearning();
 initCustomCorrelationRules();
 startPatternMemory();
 initSourceReliability();
 initAlertAnnotations();
 initAlertBookmarks();
 initExportBriefing();
 startGeofenceAlerts();
 startProximityCascade();
 startThreatCorridor();
 startPeriodicityDetector();
 startSilenceAnomaly();
 // Debug + metrics first so every subsequent start() call can log.
 startReasoningDebug();
 startReasoningMetrics();
 // Subscribers FIRST — they all listen for cb:analyst-hypotheses or
 // cb:mode-advisory and would miss the first event if started after the
 // emitters. The emitters (mode-forecast, analyst-loop) also defer their
 // initial cycle to setTimeout(0), so this is belt-and-suspenders.
 startRelevanceLearner();
 startActionMemory();
 startBriefingArchive();
 startPressureHistory();
 startPressureBaselines();
 startHypothesisThreads();
 startHypothesisEntities();
 startHypothesisAccuracy();
 startHypothesisSkeptic();
 startAutoBrief();
 startSnapshotArchive();
 startHypothesisNotifier();
 startSidecarPusher();
 startAnalystCommandListener();
 // Emitters last.
 startModeForecast();
 startAnalystLoop();
 const analystHud = new AnalystHUD();
 analystHud.mount(document.body);
 ensureReasoningDebugCss();
 const debugOverlay = new ReasoningDebugOverlay();
 debugOverlay.mount(document.body);
 document.addEventListener('keydown', (e: KeyboardEvent) => {
   if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
     e.preventDefault();
     analystHud.toggle();
   }
 });
 document.addEventListener('keydown', (e: KeyboardEvent) => {
   if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'H') {
     e.preventDefault();
     exportBriefingToClipboard();
   }
 });
 const cbSays = new CrystalBallSays();
 cbSays.mount(document.body);
 const relatedStrip = new RelatedStrip();
 relatedStrip.mount(document.body);
 startAlertGeoClustering();
 const entityRail = new EntityHeatRail();
 entityRail.mount(document.body);
 const alertTimeline = new AlertTimeline();
 alertTimeline.mount(document.body);
 const statusOverlay = new StatusOverlay();
 statusOverlay.mount(document.body);
 document.addEventListener('cb:toggle-status', () => statusOverlay.toggle());
 const shiftCard = new ShiftHandoffCard(); shiftCard.mount(document.body);
 const replayScrubber = new AlertReplayScrubber(); replayScrubber.mount(document.body);
 document.addEventListener('keydown', (ev) => {
   if (ev.metaKey && ev.shiftKey && (ev.key === 'S' || ev.key === 's')) {
     ev.preventDefault();
     statusOverlay.toggle();
   }
 });
 startBlackoutSignature();
 const digestOverlay = new DigestOverlay();
 digestOverlay.mount(document.body);
 // Proactive digest — once per 8h, after data has had a chance to load.
 if (shouldShowDigest()) {
 window.setTimeout(() => {
 void generateDigest().then(text => {
 if (!text) return;
 markDigestShown();
 digestOverlay.show(text);
 });
 }, 30_000);
 }
 // On-demand digest (triggered from Cmd+K "brief").
 document.addEventListener('cb:show-digest', () => {
   digestOverlay.show('Generating brief…');
   void generateDigest().then(text => {
     if (text) { markDigestShown(); digestOverlay.show(text); }
     else digestOverlay.show('No recent activity to summarize.');
   });
 });

 // Mount Today view + wire ⌘⇧T toggle
 const todayView = new TodayView();
 todayView.mount(document.body);
 document.addEventListener('cb:toggle-today', () => todayView.toggle());

 // Mount Watchlist editor + wire ⌘⇧W toggle
 const watchlistEditor = new WatchlistEditor();
 watchlistEditor.mount(document.body);
 document.addEventListener('cb:toggle-watchlist', () => watchlistEditor.toggle());

 // Mount Cmd+K command palette — Phase 2 keyboard-first navigation.
 registerBuiltinCommands(getCommandRegistry(), {
   dispatch: (name, detail) => {
     document.dispatchEvent(new CustomEvent(name, detail === undefined ? undefined : { detail }));
   },
 });
 const cmdk = new CommandPalettePanel();
 cmdk.mount(document.body);
 document.addEventListener('cb:toggle-cmdk', () => cmdk.toggle());
 document.addEventListener('cb:navigate-panel', (e) => {
   const detail = (e as CustomEvent<{ panelKey?: string }>).detail;
   const key = detail?.panelKey;
   if (!key) return;
   jumpToPanel(key);
   flashPanel(key);
 });

 // Install the centralized shortcut registry (⌘K, ⌘/, ⌘1–9 + sidebar badges)
 // and mount the keyboard help overlay backed by the same registry.
 const shortcuts = installShortcuts();
 const helpOverlay = new HelpOverlay(shortcuts.registry);
 helpOverlay.mount(document.body);
 document.addEventListener('cb:toggle-help', () => helpOverlay.toggle());

 // Bridge a couple of palette actions to existing handlers/events.
 document.addEventListener('cb:toggle-sidebar', () => {
   document.body.classList.toggle('sidebar-collapsed');
 });
 document.addEventListener('cb:export-briefing', () => { void exportBriefingToClipboard(); });
 document.addEventListener('cb:refresh-all', () => {
   document.dispatchEvent(new CustomEvent('cb:force-refresh'));
 });

 // Native macOS polish: dock badge (unread alert count) + menubar tray
 // (overall threat level). Both no-op silently when the Tauri bridge isn't
 // available (web builds, headless tests).
 startDockBadge();
 startMenubarStatus();

 document.addEventListener('cb:focus-map', ((e: Event) => {
 const d = (e as CustomEvent).detail as { lat: number; lon: number; zoom?: number };
 this.ctx.map?.setCenter(d.lat, d.lon, d.zoom);
 }) as EventListener);

 document.addEventListener('cb:alert-pulses', ((e: Event) => {
 const detail = (e as CustomEvent).detail as Array<{ id: string; lat: number; lon: number; severity: 'critical' | 'high' | 'medium' | 'low' | 'info' }>;
 this.ctx.map?.setAlertPulses(detail);
 }) as EventListener);

 const mapContainer = document.getElementById('mapContainer') as HTMLElement;
 this.ctx.map = new MapContainer(mapContainer, {
 zoom: this.ctx.isMobile ? 2.5 : 1,
 pan: { x: 0, y: 0 },
 view: this.ctx.isMobile ? this.ctx.resolvedLocation : 'global',
 layers: this.ctx.mapLayers,
 timeRange: '7d',
 });

 this.ctx.map.initEscalationGetters();
 this.ctx.currentTimeRange = this.ctx.map.getTimeRange();

 const politicsPanel = new NewsPanel('politics', t('panels.politics'));
 this.attachRelatedAssetHandlers(politicsPanel);
 this.ctx.newsPanels.politics = politicsPanel;
 this.ctx.panels.politics = politicsPanel;

 const techPanel = new NewsPanel('tech', t('panels.tech'));
 this.attachRelatedAssetHandlers(techPanel);
 this.ctx.newsPanels.tech = techPanel;
 this.ctx.panels.tech = techPanel;

 const financePanel = new NewsPanel('finance', t('panels.finance'));
 this.attachRelatedAssetHandlers(financePanel);
 this.ctx.newsPanels.finance = financePanel;
 this.ctx.panels.finance = financePanel;

 const heatmapPanel = new HeatmapPanel();
 this.ctx.panels.heatmap = heatmapPanel;

 const marketsPanel = new MarketPanel();
 this.ctx.panels.markets = marketsPanel;

 const monitorPanel = new MonitorPanel(this.ctx.monitors);
 this.ctx.panels.monitors = monitorPanel;
 monitorPanel.onChanged((monitors) => {
 this.ctx.monitors = monitors;
 saveToStorage(STORAGE_KEYS.monitors, monitors);
 this.callbacks.updateMonitorResults();
 });

 const commoditiesPanel = new CommoditiesPanel();
 this.ctx.panels.commodities = commoditiesPanel;

 const predictionPanel = new PredictionPanel();
 this.ctx.panels.polymarket = predictionPanel;

 const govPanel = new NewsPanel('gov', t('panels.gov'));
 this.attachRelatedAssetHandlers(govPanel);
 this.ctx.newsPanels.gov = govPanel;
 this.ctx.panels.gov = govPanel;

 const intelPanel = new NewsPanel('intel', t('panels.intel'));
 this.attachRelatedAssetHandlers(intelPanel);
 this.ctx.newsPanels.intel = intelPanel;
 this.ctx.panels.intel = intelPanel;

 const cryptoPanel = new CryptoPanel();
 this.ctx.panels.crypto = cryptoPanel;

 const middleeastPanel = new NewsPanel('middleeast', t('panels.middleeast'));
 this.attachRelatedAssetHandlers(middleeastPanel);
 this.ctx.newsPanels.middleeast = middleeastPanel;
 this.ctx.panels.middleeast = middleeastPanel;

 const layoffsPanel = new NewsPanel('layoffs', t('panels.layoffs'));
 this.attachRelatedAssetHandlers(layoffsPanel);
 this.ctx.newsPanels.layoffs = layoffsPanel;
 this.ctx.panels.layoffs = layoffsPanel;

 const aiPanel = new NewsPanel('ai', t('panels.ai'));
 this.attachRelatedAssetHandlers(aiPanel);
 this.ctx.newsPanels.ai = aiPanel;
 this.ctx.panels.ai = aiPanel;

 const startupsPanel = new NewsPanel('startups', t('panels.startups'));
 this.attachRelatedAssetHandlers(startupsPanel);
 this.ctx.newsPanels.startups = startupsPanel;
 this.ctx.panels.startups = startupsPanel;

 const vcblogsPanel = new NewsPanel('vcblogs', t('panels.vcblogs'));
 this.attachRelatedAssetHandlers(vcblogsPanel);
 this.ctx.newsPanels.vcblogs = vcblogsPanel;
 this.ctx.panels.vcblogs = vcblogsPanel;

 const regionalStartupsPanel = new NewsPanel('regionalStartups', t('panels.regionalStartups'));
 this.attachRelatedAssetHandlers(regionalStartupsPanel);
 this.ctx.newsPanels.regionalStartups = regionalStartupsPanel;
 this.ctx.panels.regionalStartups = regionalStartupsPanel;

 const unicornsPanel = new NewsPanel('unicorns', t('panels.unicorns'));
 this.attachRelatedAssetHandlers(unicornsPanel);
 this.ctx.newsPanels.unicorns = unicornsPanel;
 this.ctx.panels.unicorns = unicornsPanel;

 const acceleratorsPanel = new NewsPanel('accelerators', t('panels.accelerators'));
 this.attachRelatedAssetHandlers(acceleratorsPanel);
 this.ctx.newsPanels.accelerators = acceleratorsPanel;
 this.ctx.panels.accelerators = acceleratorsPanel;

 const fundingPanel = new NewsPanel('funding', t('panels.funding'));
 this.attachRelatedAssetHandlers(fundingPanel);
 this.ctx.newsPanels.funding = fundingPanel;
 this.ctx.panels.funding = fundingPanel;

 const producthuntPanel = new NewsPanel('producthunt', t('panels.producthunt'));
 this.attachRelatedAssetHandlers(producthuntPanel);
 this.ctx.newsPanels.producthunt = producthuntPanel;
 this.ctx.panels.producthunt = producthuntPanel;

 const securityPanel = new NewsPanel('security', t('panels.security'));
 this.attachRelatedAssetHandlers(securityPanel);
 this.ctx.newsPanels.security = securityPanel;
 this.ctx.panels.security = securityPanel;

 const policyPanel = new NewsPanel('policy', t('panels.policy'));
 this.attachRelatedAssetHandlers(policyPanel);
 this.ctx.newsPanels.policy = policyPanel;
 this.ctx.panels.policy = policyPanel;

 const hardwarePanel = new NewsPanel('hardware', t('panels.hardware'));
 this.attachRelatedAssetHandlers(hardwarePanel);
 this.ctx.newsPanels.hardware = hardwarePanel;
 this.ctx.panels.hardware = hardwarePanel;

 const cloudPanel = new NewsPanel('cloud', t('panels.cloud'));
 this.attachRelatedAssetHandlers(cloudPanel);
 this.ctx.newsPanels.cloud = cloudPanel;
 this.ctx.panels.cloud = cloudPanel;

 const devPanel = new NewsPanel('dev', t('panels.dev'));
 this.attachRelatedAssetHandlers(devPanel);
 this.ctx.newsPanels.dev = devPanel;
 this.ctx.panels.dev = devPanel;

 const githubPanel = new NewsPanel('github', t('panels.github'));
 this.attachRelatedAssetHandlers(githubPanel);
 this.ctx.newsPanels.github = githubPanel;
 this.ctx.panels.github = githubPanel;

 const ipoPanel = new NewsPanel('ipo', t('panels.ipo'));
 this.attachRelatedAssetHandlers(ipoPanel);
 this.ctx.newsPanels.ipo = ipoPanel;
 this.ctx.panels.ipo = ipoPanel;

 const thinktanksPanel = new NewsPanel('thinktanks', t('panels.thinktanks'));
 this.attachRelatedAssetHandlers(thinktanksPanel);
 this.ctx.newsPanels.thinktanks = thinktanksPanel;
 this.ctx.panels.thinktanks = thinktanksPanel;

 const economicPanel = new EconomicPanel();
 this.ctx.panels.economic = economicPanel;

 if (SITE_VARIANT === 'full' || SITE_VARIANT === 'finance') {
 const tradePolicyPanel = new TradePolicyPanel();
 this.ctx.panels['trade-policy'] = tradePolicyPanel;

 const supplyChainPanel = new SupplyChainPanel();
 this.ctx.panels['supply-chain'] = supplyChainPanel;
 }

 if (SITE_VARIANT === 'tech') {
 this.ctx.panels.regulation = new RegulationPanel('regulation');
 }

 const africaPanel = new NewsPanel('africa', t('panels.africa'));
 this.attachRelatedAssetHandlers(africaPanel);
 this.ctx.newsPanels.africa = africaPanel;
 this.ctx.panels.africa = africaPanel;

 const latamPanel = new NewsPanel('latam', t('panels.latam'));
 this.attachRelatedAssetHandlers(latamPanel);
 this.ctx.newsPanels.latam = latamPanel;
 this.ctx.panels.latam = latamPanel;

 const asiaPanel = new NewsPanel('asia', t('panels.asia'));
 this.attachRelatedAssetHandlers(asiaPanel);
 this.ctx.newsPanels.asia = asiaPanel;
 this.ctx.panels.asia = asiaPanel;

 const energyPanel = new NewsPanel('energy', t('panels.energy'));
 this.attachRelatedAssetHandlers(energyPanel);
 this.ctx.newsPanels.energy = energyPanel;
 this.ctx.panels.energy = energyPanel;

 for (const key of Object.keys(FEEDS)) {
 if (this.ctx.newsPanels[key]) continue;
 if (!Array.isArray((FEEDS as Record<string, unknown>)[key])) continue;
 const altPanelKey = `${key}-news`;
 const panelKey = this.ctx.panels[key] && !this.ctx.newsPanels[key]
 ? (altPanelKey in DEFAULT_PANELS ? altPanelKey : '')
 : key;
 if (!panelKey) continue;
 if (this.ctx.panels[panelKey]) continue;
 const panelConfig = DEFAULT_PANELS[panelKey] ?? DEFAULT_PANELS[key];
 const label = panelConfig?.name ?? key.charAt(0).toUpperCase() + key.slice(1);
 const panel = new NewsPanel(panelKey, label);
 this.attachRelatedAssetHandlers(panel);
 this.ctx.newsPanels[key] = panel;
 this.ctx.panels[panelKey] = panel;
 }

 if (SITE_VARIANT === 'full') {
 let localLogisticsPanel: LocalLogisticsPanel | null = null;
 let commsPlanPanel: CommsPlanPanel | null = null;
 const focusGeoHub = (hub: GeoHubActivity) => {
 this.ctx.map?.setCenter(hub.lat, hub.lon, 4);
 this.ctx.map?.flashLocation(hub.lat, hub.lon, 3000);
 };
 const focusSavedPlace = (placeId: string) => {
 const place = getSavedPlace(placeId);
 if (!place) return;
 localLogisticsPanel?.setPlaceId(placeId);
 commsPlanPanel?.setPlaceId(placeId);
 this.ctx.map?.setCenter(place.lat, place.lon, 6);
 this.ctx.map?.flashLocation(place.lat, place.lon, 3000);
 };

 const watchlistPanel = new WatchlistPanel({
 getCountrySnapshot: (code, country) => this.callbacks.getCountryWatchSnapshot(code, country),
 openCountryBrief: (code, country) => this.callbacks.openCountryBriefByCode(code, country),
 });
 this.ctx.panels.watchlist = watchlistPanel;

 const savedPlaceModal = new SavedPlaceModal({
 onPickLocationMode: (active, callback) => {
 this.ctx.map?.setPickLocationMode(active ? callback : null);
 },
 });

 const openCreate = () => savedPlaceModal.openCreate();
 const openEdit = (placeId: string) => {
 const place = getSavedPlace(placeId);
 if (place) savedPlaceModal.openEdit(place);
 };

 const savedPlacesPanel = new SavedPlacesPanel({
 focusPlace: focusSavedPlace,
 createPlace: openCreate,
 editPlace: openEdit,
 });
 this.ctx.panels['saved-places'] = savedPlacesPanel;

 const watchlistLocationsPanel = new WatchlistLocationsPanel();
 this.ctx.panels['watchlist-locations'] = watchlistLocationsPanel;

 this.ctx.unifiedSettings?.setPlaceCallbacks(openCreate, openEdit);

 localLogisticsPanel = new LocalLogisticsPanel({
 focusNode: (lat, lon) => {
 this.ctx.map?.setCenter(lat, lon, 9);
 this.ctx.map?.flashLocation(lat, lon, 3000);
 },
 });
 localLogisticsPanel.setPlaceId(getPrimarySavedPlace()?.id ?? null);
 this.ctx.panels['local-logistics'] = localLogisticsPanel;

 commsPlanPanel = new CommsPlanPanel();
 commsPlanPanel.setPlaceId(getPrimarySavedPlace()?.id ?? null);
 this.ctx.panels['comms-plan'] = commsPlanPanel;

 const gdeltIntelPanel = new GdeltIntelPanel();
 this.ctx.panels['gdelt-intel'] = gdeltIntelPanel;

 const geoHubsPanel = new GeoHubsPanel();
 geoHubsPanel.setOnHubClick(focusGeoHub);
 this.ctx.map?.setOnGeoHubClick(focusGeoHub);
 this.ctx.panels['geo-hubs'] = geoHubsPanel;

 const ciiPanel = new CIIPanel();
 ciiPanel.setShareStoryHandler((code, name) => {
 this.callbacks.openCountryStory(code, name);
 });
 this.ctx.panels.cii = ciiPanel;

 const cascadePanel = new CascadePanel();
 this.ctx.panels.cascade = cascadePanel;

 const satelliteFiresPanel = new SatelliteFiresPanel();
 this.ctx.panels['satellite-fires'] = satelliteFiresPanel;

 const earthquakesPanel = new EarthquakesPanel();
 this.ctx.panels.earthquakes = earthquakesPanel;

 const cyberThreatPanel = new CyberThreatPanel();
 this.ctx.panels['cyber-threats'] = cyberThreatPanel;

 const localIDSPanel = new LocalIDSPanel();
 this.ctx.panels['local-ids'] = localIDSPanel;

 const littleSnitchPanel = new LittleSnitchPanel();
 this.ctx.panels['little-snitch'] = littleSnitchPanel;

 const situationPanel = new SituationPanel();
 this.ctx.panels['situation-awareness'] = situationPanel;

 const alertCenterPanel = new AlertCenterPanel();
 this.ctx.panels['alert-center'] = alertCenterPanel;

 const spaceWeatherPanel = new SpaceWeatherPanel();
 this.ctx.panels['space-weather'] = spaceWeatherPanel;

 const spaceflightNewsPanel = new SpaceflightNewsPanel();
 this.ctx.panels['spaceflight-news'] = spaceflightNewsPanel;

 const spaceLaunchesPanel = new SpaceLaunchesPanel();
 this.ctx.panels['space-launches'] = spaceLaunchesPanel;

 const diseaseOutbreakPanel = new DiseaseOutbreakPanel();
 this.ctx.panels['disease-outbreaks'] = diseaseOutbreakPanel;

 const humanitarianCrisisPanel = new HumanitarianCrisisPanel();
 this.ctx.panels['humanitarian-crisis'] = humanitarianCrisisPanel;

 const globalWeatherPanel = new GlobalWeatherPanel();
 this.ctx.panels['global-weather'] = globalWeatherPanel;

 const openSanctionsPanel = new OpenSanctionsPanel();
 this.ctx.panels['opensanctions'] = openSanctionsPanel;

 const sanctionsIntelPanel = new SanctionsPanel();
 this.ctx.panels['sanctions-intel'] = sanctionsIntelPanel;

 // Lazy-load all OSINT panels. They appear in the dataTracking category
 // but most users never open them at boot. The dynamic imports below let
 // Vite emit a shared `panels-osint` chunk that loads in parallel with
 // the first paint. Panel objects are attached to ctx.panels as soon as
 // each module resolves — Panel rendering itself is async-tolerant.
 void this.loadOsintPanels();

 const edgarFilingsPanel = new EdgarFilingsPanel();
 this.ctx.panels['edgar-filings'] = edgarFilingsPanel;

 const airQualityPanel = new AirQualityPanel();
 this.ctx.panels['air-quality'] = airQualityPanel;

 const openaqMonitorPanel = new OpenaqMonitorPanel();
 this.ctx.panels['openaq-monitor'] = openaqMonitorPanel;

 this.ctx.panels['what-changed'] = new WhatChangedPanel();

 const mediastackNewsPanel = new MediastackNewsPanel();
 this.ctx.panels['mediastack-news'] = mediastackNewsPanel;

 const wildfireIncidentsPanel = new WildfireIncidentsPanel();
 this.ctx.panels['wildfire-incidents'] = wildfireIncidentsPanel;

 const wildfireIntelPanel = new WildfireIntelPanel();
 this.ctx.panels['wildfire-intel'] = wildfireIntelPanel;

 const hazmatIncidentsPanel = new HazmatIncidentsPanel();
 this.ctx.panels['hazmat-incidents'] = hazmatIncidentsPanel;

 const oilSpillPanel = new OilSpillPanel();
 this.ctx.panels['oil-spill'] = oilSpillPanel;

 const hazardAlertsPanel = new HazardAlertsPanel();
 this.ctx.panels['hazard-alerts'] = hazardAlertsPanel;

 const infrastructurePanel = new InfrastructurePanel();
 this.ctx.panels['infrastructure'] = infrastructurePanel;

 const gridIntelPanel = new GridIntelligencePanel();
 this.ctx.panels['grid-intelligence'] = gridIntelPanel;
 startGridIntelligenceLoader(gridIntelPanel);

 const strategicRiskPanel = new StrategicRiskPanel();
 strategicRiskPanel.setLocationClickHandler((lat, lon) => {
 this.ctx.map?.setCenter(lat, lon, 4);
 });
 this.ctx.panels['strategic-risk'] = strategicRiskPanel;

 const strategicPosturePanel = new StrategicPosturePanel();
 strategicPosturePanel.setLocationClickHandler((lat, lon) => {
 console.log('[App] StrategicPosture handler called:', { lat, lon, hasMap: !!this.ctx.map });
 this.ctx.map?.setCenter(lat, lon, 4);
 });
 this.ctx.panels['strategic-posture'] = strategicPosturePanel;

 const ucdpEventsPanel = new UcdpEventsPanel();
 ucdpEventsPanel.setEventClickHandler((lat, lon) => {
 this.ctx.map?.setCenter(lat, lon, 5);
 });
 this.ctx.panels['ucdp-events'] = ucdpEventsPanel;

 this.ctx.panels['nuclear-risk'] = new NuclearRiskPanel('nuclear-risk', 'Nuclear Risk Tracker');

 const airstrikesPanel = new AirstrikesPanel();
 airstrikesPanel.setEventClickHandler((lat, lon) => {
 this.ctx.map?.setCenter(lat, lon, 6);
 });
 this.ctx.panels.airstrikes = airstrikesPanel;

 const strikePackagePanel = new StrikePackagePanel();
 strikePackagePanel.setEventClickHandler((lat, lon) => {
 this.ctx.map?.setCenter(lat, lon, 6);
 });
 this.ctx.panels['strike-package'] = strikePackagePanel;

 const gdacsAlertsPanel = new GDACSAlertsPanel();
 gdacsAlertsPanel.setEventClickHandler((lat, lon) => {
 this.ctx.map?.setCenter(lat, lon, 5);
 });
 this.ctx.panels['gdacs-alerts'] = gdacsAlertsPanel;

 this.ctx.panels['unified-alert-inbox'] = new UnifiedAlertInboxPanel();
 this.ctx.panels['alert-rules'] = new AlertRulesPanel();

 const volcanoAlertsPanel = new VolcanoAlertsPanel();
 volcanoAlertsPanel.setEventClickHandler((lat, lon) => {
 this.ctx.map?.setCenter(lat, lon, 7);
 });
 this.ctx.panels['volcano-alerts'] = volcanoAlertsPanel;

 const volcanoMonitorPanel = new VolcanoMonitorPanel();
 volcanoMonitorPanel.setEventClickHandler((lat, lon) => {
 this.ctx.map?.setCenter(lat, lon, 7);
 });
 this.ctx.panels['volcano-monitor'] = volcanoMonitorPanel;

 const severeWeatherPanel = new SevereWeatherPanel();
 severeWeatherPanel.setWarningClickHandler((lat, lon) => {
 this.ctx.map?.setCenter(lat, lon, 6);
 });
 this.ctx.panels['severe-weather'] = severeWeatherPanel;

 const shakeAlertPanel = new ShakeAlertPanel();
 shakeAlertPanel.setEventClickHandler((lat, lon) => {
 this.ctx.map?.setCenter(lat, lon, 7);
 });
 this.ctx.panels['shakealert'] = shakeAlertPanel;

 const nwsAlertsPanel = new NWSAlertsPanel();
 this.ctx.panels['nws-alerts'] = nwsAlertsPanel;

 this.ctx.panels['faa-weather-cams'] = new FAAWeatherCamsPanel();
 this.ctx.panels['unified-webcams'] = new UnifiedWebcamPanel();

 this.ctx.panels['tsunami-alerts'] = new TsunamiAlertsPanel();
 this.ctx.panels['tropical-cyclones'] = new TropicalCyclonesPanel();
 this.ctx.panels['food-insecurity'] = new FoodInsecurityPanel();
 this.ctx.panels['offline-maps'] = new OfflineMapPanel();
 this.ctx.panels['evacuation'] = new EvacuationPanel();
 this.ctx.panels['family-tracker'] = new FamilyTrackerPanel();
 this.ctx.panels['comms-health'] = new CommsHealthPanel();
 this.ctx.panels['power-grid'] = new PowerGridPanel();
 this.ctx.panels['economic-stress'] = new EconomicStressPanel();
 this.ctx.panels['federal-register'] = new FederalRegisterPanel();
 this.ctx.panels['fear-greed'] = new FearGreedPanel();
 this.ctx.panels['internet-disruptions'] = new InternetDisruptionsPanel();
 this.ctx.panels['national-debt'] = new NationalDebtPanel();
 this.ctx.panels['fuel-prices'] = new FuelPricesPanel();
 this.ctx.panels['air-traffic'] = new AirTrafficPanel();
 this.ctx.panels['threat-intel-hub'] = new ThreatIntelHubPanel();
 this.ctx.panels['geo-intel'] = new GeoIntelPanel();
 this.ctx.panels['dark-web'] = new DarkWebPanel();
 this.ctx.panels['intelligence-briefing'] = new IntelligenceBriefingPanel();
 this.ctx.panels['ask-crystal-ball'] = new AskCrystalBallPanel();
 const survivalAdvisor = new SurvivalAdvisorPanel();
 this.ctx.panels['survival-advisor'] = survivalAdvisor;
 this.ctx.panels['threat-synthesis'] = new ThreatSynthesisPanel();
 this.ctx.panels['scenario-simulator'] = new ScenarioSimulatorPanel();
 this.ctx.panels['escalation-forecast'] = new EscalationForecastPanel();
 this.ctx.panels['anomaly-detection'] = new AnomalyDetectionPanel();
 const financialContagion = new FinancialContagionPanel();
 this.ctx.panels['financial-contagion'] = financialContagion;
 const supplyChainImpact = new SupplyChainImpactPanel();
 this.ctx.panels['supply-chain-impact'] = supplyChainImpact;
 // Defer heavy init (AI/network calls) until after layout completes
 queueMicrotask(() => { survivalAdvisor.init(); financialContagion.init(); supplyChainImpact.init(); });
 this.ctx.panels['water-quality'] = new WaterQualityPanel();
 this.ctx.panels['nuclear-monitor'] = new NuclearMonitorPanel();
 this.ctx.panels['notification-digest'] = new NotificationDigestPanel();
 this.ctx.panels['notification-history'] = new NotificationHistoryPanel();
 this.ctx.panels['notification-audit'] = new NotificationAuditPanel();
 this.ctx.panels['trust-budget'] = new TrustBudgetPanel();
 this.ctx.panels['notification-settings'] = new NotificationSettingsPanel();
 this.ctx.panels['notification-preferences'] = new NotificationPreferencesPanel();
 this.ctx.panels['situations'] = new SituationStorePanel();
 this.ctx.panels['observation-rules'] = new ObservationRulesPanel();
 // Worldview / Palantir / Dragos-inspired panels
 this.ctx.panels['pattern-of-life'] = new PatternOfLifePanel();
 this.ctx.panels['sigint-panel'] = new SigintPanel();
 this.ctx.panels['dark-vessel'] = new DarkVesselPanel();
 this.ctx.panels['course-of-action'] = new CourseOfActionPanel();
 this.ctx.panels['kill-chain'] = new KillChainPanel();
 this.ctx.panels['ics-ot-dashboard'] = new IcsOtDashboardPanel();
 this.ctx.panels['ioc-manager'] = new IocManagerPanel();
 this.ctx.panels['orbat'] = new OrbatPanel();
 this.ctx.panels['after-action-review'] = new AarPanel();
 this.ctx.panels['network-topology'] = new NetworkTopologyPanel();
 this.ctx.panels['custom-geofence'] = new GeofencePanel();
 this.ctx.panels['stix-taxii'] = new StixTaxiiPanel();
 this.ctx.panels['entity-link-graph'] = new EntityLinkGraphPanel();
 this.ctx.panels['timeline-scrubber'] = new TimelineScrubberPanel();
 this.ctx.panels['intel-report'] = new IntelReportPanel();
 this.ctx.panels['sanctions-crossref'] = new SanctionsCrossRefPanel();
 this.ctx.panels['compound-threat'] = new CompoundThreatPanel();
 this.ctx.panels['correlation-matrix'] = new CorrelationMatrixPanel();
 this.ctx.panels['correlation-map'] = new CorrelationMapPanel();
 this.ctx.panels['strike-packages'] = new StrikePackagesPanel();
 this.ctx.panels['api-diagnostic'] = new ApiDiagnosticPanel();
 this.ctx.panels['feed-health'] = new FeedHealthPanel();
 this.ctx.panels['system-diagnostic'] = new SystemDiagnosticPanel();
 this.ctx.panels['assumption-tracker'] = new AssumptionPanel();
 this.ctx.panels['domain-scorecard'] = new DomainScorecardPanel();
 this.ctx.panels['quality-debt'] = new QualityDebtPanel();
 this.ctx.panels['self-test'] = new DiagnosticSelfTestPanel();
 this.ctx.panels['self-test-runner'] = new SelfTestRunnerPanel();
 this.ctx.panels['operator-mode'] = new OperatorModePanel();
 this.ctx.panels['command-center'] = new CommandCenterPanel();
 this.ctx.panels['competitive-hypothesis'] = new HypothesisPanel();
 this.ctx.panels['meta-confidence'] = new MetaConfidencePanel();
 this.ctx.panels['algorithm-diagnostic'] = new AlgorithmDiagnosticPanel();
 this.ctx.panels['outcome-ledger'] = new OutcomeLedgerPanel();
 this.ctx.panels['bias-detection'] = new BiasDetectionPanel();
 this.ctx.panels['active-learning'] = new ActiveLearningPanel();
 this.ctx.panels['improvement-scheduler'] = new SchedulerPanel();
 this.ctx.panels['algo-eval'] = new AlgoEvalPanel();
 this.ctx.panels['backtest'] = new BacktestPanel();
 this.ctx.panels['shadow-mode'] = new ShadowModePanel();
 try {
  const runner = getShadowRunner();
  for (const algo of builtInShadowAlgorithms()) runner.registerAlgorithm(algo);
 } catch { /* boot-time issue — non-critical */ }
 this.ctx.panels['safety-case'] = new SafetyCaseDashboard();
 this.ctx.panels['multi-agent-review'] = new MultiAgentReviewPanel();
 this.ctx.panels['repair-recommendations'] = new RepairRecommendationsPanel();
 this.ctx.panels['alert-trace'] = new AlertTracePanel();
 this.ctx.panels['alert-explanation'] = new AlertExplanationPanel();
 this.ctx.panels['personal-relevance'] = new PersonalRelevancePanel();
 this.ctx.panels['scenario-replay'] = new ScenarioReplayPanel();
 this.ctx.panels['evidence-graph'] = new EvidenceGraphPanel();
 this.ctx.panels['entity-registry'] = new EntityRegistryPanel();
 this.ctx.panels['playbook'] = new PlaybookPanel();
 this.ctx.panels['sms-command-interface'] = new SmsSettingsPanel();
 this.ctx.panels['threat-dashboard'] = new ThreatDashboard();
 startThreatAggregator();
 this.ctx.panels['aviation-intel'] = new AviationIntelPanel();
 this.ctx.panels['intelligence-feed'] = new IntelligenceFeedPanel();
 this.ctx.panels['shortage-radar'] = new ShortageRadarPanel();
 this.ctx.panels['shortage-detail-wheat'] = new ShortageDetailPanel('wheat');
 this.ctx.panels['shortage-detail-corn'] = new ShortageDetailPanel('corn');
 this.ctx.panels['shortage-detail-rice'] = new ShortageDetailPanel('rice');
 this.ctx.panels['shortage-detail-soybeans'] = new ShortageDetailPanel('soybeans');
 this.ctx.panels['shortage-detail-diesel'] = new ShortageDetailPanel('diesel');
 this.ctx.panels['shortage-detail-gasoline'] = new ShortageDetailPanel('gasoline');
 this.ctx.panels['shortage-detail-natural-gas'] = new ShortageDetailPanel('natural-gas');
 this.ctx.panels['shortage-detail-jet-fuel'] = new ShortageDetailPanel('jet-fuel');
 // Periodic feed of live signals (US Drought Monitor + maritime
 // chokepoint statuses + power-grid alerts) into the shortage models.
 // Without this loop the panel renders 8 empty score=0 LOW rows.
 // 5-minute cadence: USDM publishes weekly, grid alerts every ~15 min,
 // chokepoints every ~20 min, so polling faster than ~5 min just burns
 // network for unchanged data.
 void Promise.all([
 import('@/services/shortage/shortage-input-bridge'),
 import('@/services/diagnostics/recurring-loops'),
 ]).then(([{ loadShortageInputs }, { registerRecurringLoop }]) => {
 const radarPanel = this.ctx.panels['shortage-radar'] as ShortageRadarPanel | undefined;
 if (!radarPanel) return;
 registerRecurringLoop(
 'shortage-input-bridge',
 () => {
 void loadShortageInputs().then((bag) => {
 try { radarPanel.setInputs(bag); }
 catch (error) { console.warn('[shortage-bridge] setInputs failed:', error); }
 }).catch((error) => {
 console.warn('[shortage-bridge] load failed:', error);
 });
 },
 5 * 60_000,
 { priority: 'low', runImmediately: true },
 );
 });
 this.ctx.panels['weather-hazard'] = new WeatherHazardPanel();
 this.ctx.panels['maritime-intel'] = new MaritimeIntelPanel();
 this.ctx.panels['supply-chain-disruption'] = new SupplyChainDisruptionPanel();
 this.ctx.panels['infra-risk-matrix'] = new InfraRiskMatrixPanel();
 this.ctx.panels['earthquake-super'] = new EarthquakeSuperPanel();
 this.ctx.panels['intelligence-timeline'] = new IntelligenceTimelinePanel();
 // Wire saved-places into the insights state singleton so the new
 // panels see the user's home/family/travel places out of the box.
 // Re-runs whenever saved places change.
 void import('@/services/insights/data-bridge').then(({ bridgeSavedPlacesToProfile, adaptExistingSavedPlace, bridgeSourcesToProviderRedundancy }) => {
 void import('@/services/saved-places').then(({ getSavedPlaces, subscribeSavedPlaces }) => {
 const sync = () => bridgeSavedPlacesToProfile(getSavedPlaces().map((p) => adaptExistingSavedPlace(p)));
 sync();
 if (typeof subscribeSavedPlaces === 'function') subscribeSavedPlaces(sync);
 });
 // Periodic provider-snapshot bridge so Command Center's "Provider
 // Stress" + System Diagnostic's redundancy view stay current.
 // All recurring loops here go through registerRecurringLoop() so
 // they show up in System Diagnostic, dedupe across HMR, and pause
 // when document.visibilityState === 'hidden' (priority='low').
 void Promise.all([
 import('@/services/api-diagnostic'),
 import('@/services/diagnostics/recurring-loops'),
 import('@/services/diagnostics/live-diagnostics-snapshot'),
 ]).then(([{ diagnoseAll }, { registerRecurringLoop }, { setSourceCollector }]) => {
 setSourceCollector(() => diagnoseAll().sources);
 registerRecurringLoop(
 'provider-snapshot-bridge',
 () => {
 try {
 const r = diagnoseAll();
 bridgeSourcesToProviderRedundancy(r.sources);
 } catch (error) {
 console.warn('[provider-bridge] snapshot failed:', error);
 }
 },
 30_000,
 { priority: 'normal', runImmediately: true },
 );
 });
 // Periodic sidecar /api/health probe so System Diagnostic + Command
 // Center reflect actual sidecar reachability. Skips the network
 // call in the web build.
 void Promise.all([
 import('@/services/diagnostics/sidecar-probe'),
 import('@/services/diagnostics/recurring-loops'),
 ]).then(([{ probeSidecarHealth }, { registerRecurringLoop }]) => {
 registerRecurringLoop(
 'sidecar-health-probe',
 () => {
 void probeSidecarHealth().catch((error) => {
 console.warn('[sidecar-probe] tick failed:', error);
 });
 },
 30_000,
 { priority: 'normal', runImmediately: true },
 );
 });
 // Periodic quality-debt collector. Priority='low' so it pauses
 // when the document is hidden (the export bundle and System
 // Diagnostic catch up on next tick once visible again).
 void Promise.all([
 import('@/services/quality/quality-debt-state'),
 import('@/services/algorithms/algorithms-state'),
 import('@/services/algorithms/algorithm-health'),
 import('@/services/algorithms/algorithm-evaluation-ledger'),
 import('@/services/diagnostics/recurring-loops'),
 ]).then(([qualityState, algoState, algoHealth, algoLedger, { registerRecurringLoop }]) => {
 registerRecurringLoop(
 'quality-debt-collector',
 () => {
 try {
 const calibrations = algoLedger.summarizeCalibration(
 algoState.getAlgorithmEvaluationLedger().all(),
 );
 const report = algoHealth.aggregateAlgorithmHealth({
 definitions: algoState.getAlgorithmDefinitions(),
 calibrations,
 });
 qualityState.collectLiveQualityDebt({
 algorithmHealth: report.algorithms,
 smokeOutcomes: qualityState.smokeOutcomesFromLiveSnapshot(),
 });
 } catch (error) {
 console.warn('[quality-debt] tick failed:', error);
 }
 },
 60_000,
 { priority: 'low', runImmediately: true },
 );
 }).catch((error) => {
 console.warn('[quality-debt] failed to wire collector:', error);
 });
 });
 this.ctx.panels['cascade-simulator'] = new CascadeSimulatorPanel();
 this.ctx.panels['emergency-broadcast'] = new EmergencyBroadcastPanel();
 this.ctx.panels['satellite-change'] = new SatelliteChangePanel();
 this.ctx.panels['satellite-intel'] = new SatelliteIntelPanel();

 // Weather upgrade panels
 this.ctx.panels['extended-forecast'] = new ExtendedForecastPanel();
 this.ctx.panels['weather-radar'] = new WeatherRadarPanel();
 this.ctx.panels['tide-predictions'] = new TidePredictionsPanel();
 this.ctx.panels['pollen'] = new PollenPanel();
 this.ctx.panels['goes-satellite'] = new GoesSatellitePanel();
 this.ctx.panels['flood-monitor'] = new FloodMonitorPanel();

 this.ctx.panels['stoic-reflections'] = new StoicQuotePanel();
 this.ctx.panels['biblical-encouragement'] = new BiblicalQuotePanel();
 this.ctx.panels['alan-watts-reflections'] = new AlanWattsQuotePanel();
 this.ctx.panels['mckenna-visions'] = new McKennaQuotePanel();
 this.ctx.panels['daily-wisdom'] = new DailyWisdomPanel();

 this.ctx.panels['radiation-decay'] = new RadiationDecayPanel();
 this.ctx.panels['resource-inventory'] = new ResourceInventoryPanel();
 this.ctx.panels['world-clock'] = new WorldClockPanel();
 this.ctx.panels['pinned-webcams'] = new PinnedWebcamsPanel();

 const displacementPanel = new DisplacementPanel();
 displacementPanel.setCountryClickHandler((lat, lon) => {
 this.ctx.map?.setCenter(lat, lon, 4);
 });
 this.ctx.panels.displacement = displacementPanel;

 const climatePanel = new ClimateAnomalyPanel();
 climatePanel.setZoneClickHandler((lat, lon) => {
 this.ctx.map?.setCenter(lat, lon, 4);
 });
 this.ctx.panels.climate = climatePanel;

 const populationExposurePanel = new PopulationExposurePanel();
 this.ctx.panels['population-exposure'] = populationExposurePanel;

 const securityAdvisoriesPanel = new SecurityAdvisoriesPanel();
 securityAdvisoriesPanel.setRefreshHandler(() => {
 void this.callbacks.loadSecurityAdvisories?.();
 });
 this.ctx.panels['security-advisories'] = securityAdvisoriesPanel;

 this.ctx.panels['cve-tracker'] = new CveTrackerPanel();
 this.ctx.panels['vulners-cve'] = new VulnersCvePanel();

 // NetworkRulesPanel — surfaces tools/littlesnitch/crystal-ball.lsrules
 // (the bundled Little Snitch ruleset) inside the app so the user can
 // see exactly which outbound endpoints Crystal Ball needs without
 // opening Little Snitch. Reads from /api/littlesnitch-rules.
 const networkRulesPanel = new NetworkRulesPanel();
 this.ctx.panels['network-rules'] = networkRulesPanel;

 // S2UIntelPanel — surfaces the S2 Underground IRT XMPP MUC rooms
 // (PR B) and the public TAK server Marti API (PR C). Reads from
 // /api/s2u-xmpp + /api/s2u-tak-feeds. Refuses to demand creds: when
 // the sidecar reports configured=false, the panel shows a "Configure
 // in Settings" empty state.
 const s2uIntelPanel = new S2UIntelPanel();
 this.ctx.panels['s2u-intel'] = s2uIntelPanel;

 // SynthesisPanel — historical precedent matcher (TF-IDF + cosine)
 // and cross-domain leading-indicator engine (Granger F-test). Reads
 // from /api/precedents and /api/leading-indicators; sidecar returns
 // configured=false until a corpus + time-series feeder is wired in
 // a follow-up PR. Pure engines ship in Batch 1 PR 1 + 2.
 const synthesisPanel = new SynthesisPanel();
 this.ctx.panels['synthesis'] = synthesisPanel;

 // CyberGeoPanel — APT activity table + gray-zone event timeline +
 // great-power escalation meters. Reads from /api/apt-groups and
 // /api/grayzone-events. Engines ship in Batch 2 PR 1 (#290) +
 // PR 2 (#292); the sidecar returns configured=false until live
 // ingestion lands.
 const cyberGeoPanel = new CyberGeoPanel();
 this.ctx.panels['cyber-geo'] = cyberGeoPanel;

 // EconomicIntelPanel — OFR FSI gauge + commodity stress table +
 // ENSO phase + 6-month outlook. Reads from /api/financial-stress,
 // /api/commodity-stress, /api/enso. Engines ship in Batch 3 PR 1
 // (#295) + PR 2 (#297); sidecar fetcher follows.
 const economicIntelPanel = new EconomicIntelPanel();
 this.ctx.panels['economic-intel'] = economicIntelPanel;

 const orefSirensPanel = new OrefSirensPanel();
 this.ctx.panels['oref-sirens'] = orefSirensPanel;

 const telegramIntelPanel = new TelegramIntelPanel();
 this.ctx.panels['telegram-intel'] = telegramIntelPanel;

 // WW3 escalation intel panels
 this.ctx.panels['isw-reports'] = new IswReportsPanel();
 this.ctx.panels['nato-news'] = new NatoNewsPanel();
 this.ctx.panels['dod-news'] = new DodNewsPanel();
 this.ctx.panels['reliefweb-crises'] = new ReliefWebPanel();
 this.ctx.panels['bellingcat-osint'] = new BellingcatPanel();
 this.ctx.panels['fcdo-warnings'] = new FcdoWarningsPanel();
 this.ctx.panels['dfat-warnings'] = new DfatWarningsPanel();
 this.ctx.panels['gac-warnings'] = new GacWarningsPanel();
 this.ctx.panels['gov-warning-convergence'] = new GovConvergencePanel();
 this.ctx.panels['emsc-seismic'] = new EmscSeismicPanel();
 this.ctx.panels['acaps-crises'] = new AcapsPanel();
 this.ctx.panels['liveuamap'] = new LiveUaMapPanel();

 // Previously orphaned services now wired
 this.ctx.panels['aerospace-reentry'] = new AerospaceReentryPanel();
 this.ctx.panels['amtrak-alerts'] = new AmtrakAlertsPanel();
 this.ctx.panels['avalanche-hazard'] = new AvalancheHazardPanel();
 this.ctx.panels['dsca-arms-transfers'] = new DscaArmsPanel();
 this.ctx.panels['dod-contracts'] = new DodContractsPanel();
 const wikidataBasesPanel = new WikidataBasesPanel();
 wikidataBasesPanel.setEventClickHandler((lat, lon) => {
 this.ctx.map?.setCenter(lat, lon, 9);
 });
 this.ctx.panels['wikidata-bases'] = wikidataBasesPanel;
 this.ctx.panels['ecdc-surveillance'] = new EcdcSurveillancePanel();
 this.ctx.panels['fdic-failures'] = new FdicFailuresPanel();
 this.ctx.panels['habsos'] = new HabsosPanel();
 this.ctx.panels['un-security-council'] = new UnSecurityCouncilPanel();
 this.ctx.panels['wildfire-smoke'] = new WildfireSmokePanel();
 this.ctx.panels['central-bank-calendar'] = new CentralBankCalendarPanel();
 this.ctx.panels['congress-defense'] = new CongressDefensePanel();
 this.ctx.panels['combatant-commands'] = new CombatantCommandsPanel();
 this.ctx.panels['foreign-mil-news'] = new ForeignMilNewsPanel();
 this.ctx.panels['spc-mesoscale'] = new SpcMesoscalePanel();
 this.ctx.panels['ripe-atlas'] = new RipeAtlasPanel();
 }

 if (SITE_VARIANT === 'finance') {
 const investmentsPanel = new InvestmentsPanel((inv) => {
 focusInvestmentOnMap(this.ctx.map, this.ctx.mapLayers, inv.lat, inv.lon);
 });
 this.ctx.panels['gcc-investments'] = investmentsPanel;
 }

 if (SITE_VARIANT !== 'happy') {
 const liveNewsPanel = new LiveNewsPanel();
 this.ctx.panels['live-news'] = liveNewsPanel;

 const liveWebcamsPanel = new LiveWebcamsPanel();
 this.ctx.panels['live-webcams'] = liveWebcamsPanel;

 const focusTechHub = (hub: TechHubActivity) => {
 this.ctx.map?.setCenter(hub.lat, hub.lon, 4);
 this.ctx.map?.flashLocation(hub.lat, hub.lon, 3000);
 };

 const techHubsPanel = new TechHubsPanel();
 techHubsPanel.setOnHubClick(focusTechHub);
 this.ctx.map?.setOnTechHubClick(focusTechHub);
 this.ctx.panels['tech-hubs'] = techHubsPanel;

 this.ctx.panels.events = new TechEventsPanel('events');

 const serviceStatusPanel = new ServiceStatusPanel();
 this.ctx.panels['service-status'] = serviceStatusPanel;

 const techReadinessPanel = new TechReadinessPanel();
 this.ctx.panels['tech-readiness'] = techReadinessPanel;

 this.ctx.panels['macro-signals'] = new MacroSignalsPanel();
 this.ctx.panels['etf-flows'] = new ETFFlowsPanel();
 this.ctx.panels.stablecoins = new StablecoinPanel();
 }

 const insightsPanel = new InsightsPanel();
 this.ctx.panels.insights = insightsPanel;

 // Global Giving panel (all variants)
 this.ctx.panels.giving = new GivingPanel();

 // Happy variant panels
 if (SITE_VARIANT === 'happy') {
 this.ctx.positivePanel = new PositiveNewsFeedPanel();
 this.ctx.panels['positive-feed'] = this.ctx.positivePanel;

 this.ctx.countersPanel = new CountersPanel();
 this.ctx.panels.counters = this.ctx.countersPanel;
 this.ctx.countersPanel.startTicking();

 this.ctx.progressPanel = new ProgressChartsPanel();
 this.ctx.panels.progress = this.ctx.progressPanel;

 this.ctx.breakthroughsPanel = new BreakthroughsTickerPanel();
 this.ctx.panels.breakthroughs = this.ctx.breakthroughsPanel;

 this.ctx.heroPanel = new HeroSpotlightPanel();
 this.ctx.panels.spotlight = this.ctx.heroPanel;
 this.ctx.heroPanel.onLocationRequest = (lat: number, lon: number) => {
 this.ctx.map?.setCenter(lat, lon, 4);
 this.ctx.map?.flashLocation(lat, lon, 3000);
 };

 this.ctx.digestPanel = new GoodThingsDigestPanel();
 this.ctx.panels.digest = this.ctx.digestPanel;

 this.ctx.speciesPanel = new SpeciesComebackPanel();
 this.ctx.panels.species = this.ctx.speciesPanel;

 this.ctx.renewablePanel = new RenewableEnergyPanel();
 this.ctx.panels.renewable = this.ctx.renewablePanel;
 }

 const defaultOrder = Object.keys(DEFAULT_PANELS).filter(k => k !== 'map');
 const savedOrder = this.getSavedPanelOrder();
 let panelOrder = defaultOrder;
 if (savedOrder.length > 0) {
 const missing = defaultOrder.filter(k => !savedOrder.includes(k));
 const valid = savedOrder.filter(k => defaultOrder.includes(k));
 const monitorsIdx = valid.indexOf('monitors');
 if (monitorsIdx !== -1) valid.splice(monitorsIdx, 1);
 const insertIdx = valid.indexOf('politics') + 1 || 0;
 const newPanels = missing.filter(k => k !== 'monitors');
 valid.splice(insertIdx, 0, ...newPanels);
 if (SITE_VARIANT !== 'happy') {
 valid.push('monitors');
 }
 panelOrder = valid;
 }

 if (SITE_VARIANT !== 'happy') {
 const anchors = PanelLayoutManager.MODE_ANCHORS.filter((key) => panelOrder.includes(key));
 const rest = panelOrder.filter((key) => !anchors.includes(key));
 panelOrder = [...anchors, ...rest];
 }

 panelOrder.forEach((key: string) => {
 const panel = this.ctx.panels[key];
 if (panel) {
 const el = panel.getElement();
 this.makeDraggable(el, key);
 panelsGrid.append(el);
 }
 });

 // Wire sidebar panel items → scroll to panel
 if (this.ctx.isDesktopApp) {
 document.querySelectorAll<HTMLElement>('.mac-sidebar-panel-item[data-panel-key]').forEach(item => {
 item.addEventListener('click', () => {
 const key = item.dataset.panelKey;
 if (!key) return;
 const panel = this.ctx.panels[key];
 panel?.getElement().scrollIntoView({ behavior: 'smooth', block: 'start' });
 });
 });

 // Wire mode selector buttons
 this._initModeSelector();

 // Wire situational mode switcher (monitoring / alert / investigation / briefing)
 this._initSituationalModeSelector();

 // Set up JS-based window drag on toolbar + sidebar drag zone
 this._setupWindowDragRegions();

 // Wire Low Power Mode toggle
 const lpBtn = document.getElementById('lowPowerBtn');
 if (lpBtn) {
 lpBtn.classList.toggle('low-power-active', isLowPowerMode());
 lpBtn.addEventListener('click', () => {
 setLowPowerMode(!isLowPowerMode());
 lpBtn.classList.toggle('low-power-active', isLowPowerMode());
 });
 document.addEventListener('wm:low-power-changed', ((e: CustomEvent) => {
 lpBtn.classList.toggle('low-power-active', e.detail as boolean);
 }) as EventListener);
 }
 }

 this.ctx.map.onTimeRangeChanged((range) => {
 this.ctx.currentTimeRange = range;
 this.applyTimeRangeFilterDebounced();
 });

 this.applyPanelSettings();
 this.applyInitialUrlState();
 this.restoreLastViewedPanel();
 this.startLastViewedTracker();
  }

  /** Scroll to the last-viewed panel on boot, defaulting to command-center. */
  private restoreLastViewedPanel(): void {
 const key = localStorage.getItem(PanelLayoutManager.LAST_VIEWED_KEY) ?? 'command-center';
 requestAnimationFrame(() => {
 const panel = this.ctx.panels[key] ?? this.ctx.panels['command-center'];
 panel?.getElement().scrollIntoView({ behavior: 'instant', block: 'start' });
 });
  }

  /** Persist the most-visible panel to localStorage so boot restores it. */
  private startLastViewedTracker(): void {
 const panelsGrid = document.getElementById('panelsGrid');
 if (!panelsGrid || typeof IntersectionObserver === 'undefined') return;
 const observer = new IntersectionObserver(
 (entries) => {
 const visible = entries.find((e) => e.isIntersecting && e.intersectionRatio >= 0.5);
 if (visible) {
 const key = (visible.target as HTMLElement).dataset.panel;
 if (key) localStorage.setItem(PanelLayoutManager.LAST_VIEWED_KEY, key);
 }
 },
 { threshold: 0.5 },
 );
 for (const child of panelsGrid.children) {
 observer.observe(child);
 }
  }

  private _initModeSelector(): void {
 // Apply initial body class for CSS accent theming
 document.body.dataset.appMode = getMode() ?? '';

 // Alert Family button (always visible — formerly gated on War mode)
 document.getElementById('alertFamilyBtn')?.addEventListener('click', () => {
 alertFamily();
 const btn = document.getElementById('alertFamilyBtn');
 if (btn) {
 const orig = btn.textContent;
 btn.textContent = '✓ Copied to clipboard';
 setTimeout(() => { btn.textContent = orig; }, 2000);
 }
 });

 // Ghost Mode button + Tauri menu event
 document.getElementById('ghostModeBtn')?.addEventListener('click', () => {
 toggleGhostMode();
 });
 // God's Eye button — use delegation to survive any DOM rebuilds
 document.addEventListener('click', (e) => {
 const target = (e.target as HTMLElement).closest('#godsVisionBtn');
 if (target) {
 document.dispatchEvent(new CustomEvent('cb:toggle-gods-vision'));
 }
 });
 document.addEventListener('wm:toggle-ghost-mode', () => {
 toggleGhostMode();
 });
 document.addEventListener('wm:open-settings', () => {
 this.ctx.unifiedSettings?.open();
 });

 // React to mode changes: update body class + ghost button state
 document.addEventListener('wm:mode-changed', ((e: CustomEvent) => {
 const { mode } = e.detail as { mode: AppMode | null };
 document.body.dataset.appMode = mode ?? '';

 // Sync macOS menu bar mode indicator
 if (this.ctx.isDesktopApp) {
 tryInvokeTauri('update_mode_label', { mode: mode ?? '' }).catch(() => {/* silent */});
 }

 const ghostBtn = document.getElementById('ghostModeBtn');
 if (ghostBtn) ghostBtn.classList.toggle('mac-ghost-mode-active', mode === 'ghost');
 }) as EventListener);

 // EMA forecast sparklines — show top high-risk regions near the war mode button
 document.addEventListener('wm:ema-forecast', ((e: CustomEvent) => {
 const { regions } = e.detail as { regions: Array<{ region: string; risk24h: number; trending: string }> };
 let widget = document.getElementById('wm-ema-forecast-widget');
 if (!regions || regions.length === 0) {
 widget?.remove();
 return;
 }
 if (!widget) {
 widget = document.createElement('div');
 widget.id = 'wm-ema-forecast-widget';
 Object.assign(widget.style, {
 fontSize: '10px',
 color: '#9ca3af',
 padding: '4px 6px',
 marginTop: '4px',
 background: 'rgba(255,255,255,0.03)',
 borderRadius: '6px',
 lineHeight: '1.6',
 });
 const section = document.getElementById('modeSelectorSection');
 section?.appendChild(widget);
 }
 const trendIcon = (t: string) => t === 'up' ? '\u2197' : t === 'down' ? '\u2198' : '\u2192';
 const riskColor = (r: number) => r >= 80 ? '#ef4444' : r >= 65 ? '#f97316' : '#f59e0b';
 widget.innerHTML = regions.slice(0, 4).map(r =>
 `<span style="display:inline-block;margin-right:8px">` +
 `<span style="color:${riskColor(r.risk24h)}">${trendIcon(r.trending)}</span> ` +
 `${r.region} <span style="color:${riskColor(r.risk24h)};font-weight:600">${r.risk24h}%</span>` +
 `</span>`
 ).join('');
 }) as EventListener);

 // Sync initial mode to macOS menu bar
 if (this.ctx.isDesktopApp) {
 tryInvokeTauri('update_mode_label', { mode: getMode() ?? '' }).catch(() => {/* silent */});
 }

 // Apply panel reorder for the initial mode on startup
 this._applyModePanelOrder(getMode());

 // Reorder panels whenever mode changes
 document.addEventListener('wm:mode-changed', ((e: CustomEvent) => {
 this._applyModePanelOrder((e.detail as { mode: AppMode | null }).mode);
 }) as EventListener);

 // Mode transition "why" cards — explains auto-triggered mode changes
 initModeTransitionCards();

 // Panel correlation detector — fires compound alerts when 3+ panels are elevated
 initPanelCorrelation();

 // Auto-mode-activation notifications deleted in mode collapse —
 // war/disaster modes no longer exist as triggerable states.
  }

  private _initSituationalModeSelector(): void {
 // Apply initial body attribute + button states
 const initial = initSituationalMode();
 document.body.dataset.mode = initial;
 this._updateSituationalModeBtns(initial, isAutoMode());

 // Button clicks — delegate so buttons survive any DOM rebuilds
 document.addEventListener('click', (e) => {
 const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-mode-key]');
 if (!btn) return;
 const key = btn.dataset.modeKey as SituationalMode | undefined;
 if (key === 'monitoring' || key === 'alert' || key === 'investigation' || key === 'briefing') {
 setSituationalMode(key);
 }
 });

 // "Auto" label click — clear manual override and let auto-mode re-evaluate
 document.getElementById('situationalModeAutoIndicator')?.addEventListener('click', () => {
 clearManualMode();
 const auto = getAutoMode(unifiedAlertStore.getAll());
 setAutoMode(auto);
 });

 // React to mode changes: sync body attr + button highlight
 document.addEventListener('wm:situational-mode-changed', ((e: CustomEvent<SituationalModeChangedDetail>) => {
 const { mode, auto } = e.detail;
 document.body.dataset.mode = mode;
 this._updateSituationalModeBtns(mode, auto);
 }) as EventListener);

 // Auto-mode evaluation: re-run whenever the alert store changes
 unifiedAlertStore.subscribe(() => {
 if (isAutoMode()) {
 setAutoMode(getAutoMode(unifiedAlertStore.getAll()));
 }
 });
  }

  private _updateSituationalModeBtns(mode: SituationalMode, auto: boolean): void {
 for (const btn of document.querySelectorAll<HTMLElement>('[data-mode-key]')) {
 btn.classList.toggle('active', btn.dataset.modeKey === mode);
 }
 const autoEl = document.getElementById('situationalModeAutoIndicator');
 if (autoEl) {
 autoEl.style.opacity = auto ? '1' : '0.3';
 autoEl.title = auto
 ? 'Auto — system is selecting mode based on active alerts (click to re-evaluate)'
 : 'Manual — click to restore auto-selection';
 }
  }

  /**
 * Set up JS-based window dragging for all drag zones.
 *
 * Rationale: In Tauri 2 + WKWebView on macOS, `-webkit-app-region: drag`
 * intercepts mousedown events at the WebKit layer *before* JS fires, so
 * calling startDragging() from JS never gets a chance to run. The fix is to
 * remove all `-webkit-app-region` CSS from drag zones and use an explicit
 * mousedown → IPC approach instead. Also requires the
 * `core:window:allow-start-dragging` capability (not included in core:default).
 */
  private _setupWindowDragRegions(): void {
 // Interactive selectors — clicks on these must NOT start a window drag
 const NO_DRAG_SELECTOR = 'button, select, input, a, label, [role="button"], [role="option"]';

 const attachDrag = (el: Element | null, allowInteractive = false) => {
 if (!el) return;
 el.addEventListener('mousedown', (ev: Event) => {
 const e = ev as MouseEvent;
 if (e.button !== 0) return; // left button only
 if (!allowInteractive) {
 const target = e.target as Element | null;
 if (target?.closest(NO_DRAG_SELECTOR)) return;
 }
 tryInvokeTauri('plugin:window|start_dragging').catch(() => {/* silent */});
 });
 };

 // Content toolbar — skip interactive children (region select, search btn)
 attachDrag(document.querySelector('.mac-content-toolbar'));

 // Sidebar drag zone — empty div, all clicks are drag
 attachDrag(document.querySelector('.mac-sidebar-drag'), true);
  }

  /**
 * Reorder the panels grid so anchors (live-news, live-webcams) stay at
 * the top and the unified priority panel list (formerly per-mode, now
 * always-on) floats just below them. Returning to the default state
 * restores the user's original order.
 *
 * The `_mode` parameter is retained for the legacy `wm:mode-changed`
 * event listener — the only canonical modes today are Ghost and
 * Gods-Vision; Finance/War/Disaster are gone and their priority
 * lists are unioned.
 */
  private _applyModePanelOrder(_mode: AppMode | null): void {
 const grid = document.getElementById('panelsGrid');
 if (!grid) return;

 // Keys of panels currently in the DOM, in order
 const currentKeys = [...grid.children]
 .map(el => (el as HTMLElement).dataset.panel ?? '')
 .filter(k => k.length > 0);

 // The three "PRIORITY" arrays below were originally per-mode (Finance /
 // War / Disaster) but the modes were collapsed in the mode-manager
 // refactor — only Ghost and Gods-Vision survived. The arrays are kept
 // (under their historical names) and unioned into a single always-on
 // priority list. Anchors stay first, then the priority union, then
 // the rest.
 if (this._preModeOrder.length === 0) {
 this._preModeOrder = [...currentKeys];
 }

 const mergedPriority = [
 ...PanelLayoutManager.DISASTER_PRIORITY,
 ...PanelLayoutManager.WAR_PRIORITY,
 ...PanelLayoutManager.FINANCE_PRIORITY,
 ];
 const seen = new Set<string>();
 const priority = mergedPriority.filter(k => {
 if (seen.has(k)) return false;
 seen.add(k);
 return true;
 });

 const anchors = PanelLayoutManager.MODE_ANCHORS.filter(k => currentKeys.includes(k));
 const priorityPresent = priority.filter(k => currentKeys.includes(k) && !anchors.includes(k));
 const rest = currentKeys.filter(k => !anchors.includes(k) && !priorityPresent.includes(k));

 [...anchors, ...priorityPresent, ...rest].forEach(key => {
 const panel = this.ctx.panels[key];
 if (panel) grid.append(panel.getElement());
 });
  }

  private applyTimeRangeFilterToNewsPanels(): void {
 Object.entries(this.ctx.newsByCategory).forEach(([category, items]) => {
 const panel = this.ctx.newsPanels[category];
 if (!panel) return;
 const filtered = this.filterItemsByTimeRange(items);
 if (filtered.length === 0 && items.length > 0) {
 panel.renderFilteredEmpty(`No items in ${this.getTimeRangeLabel()}`);
 return;
 }
 panel.renderNews(filtered);
 });
  }

  private filterItemsByTimeRange(items: import('@/types').NewsItem[], range: import('@/components').TimeRange = this.ctx.currentTimeRange): import('@/types').NewsItem[] {
 if (range === 'all') return items;
 const ranges: Record<string, number> = {
 '1h': 60 * 60 * 1000, '6h': 6 * 60 * 60 * 1000,
 '24h': 24 * 60 * 60 * 1000, '48h': 48 * 60 * 60 * 1000,
 '7d': 7 * 24 * 60 * 60 * 1000, 'all': Infinity,
 };
 const cutoff = Date.now() - (ranges[range] ?? Infinity);
 return items.filter((item) => {
 const ts = item.pubDate instanceof Date ? item.pubDate.getTime() : new Date(item.pubDate).getTime();
 return Number.isFinite(ts) ? ts >= cutoff : true;
 });
  }

  private getTimeRangeLabel(): string {
 const labels: Record<string, string> = {
 '1h': 'the last hour', '6h': 'the last 6 hours',
 '24h': 'the last 24 hours', '48h': 'the last 48 hours',
 '7d': 'the last 7 days', 'all': 'all time',
 };
 return labels[this.ctx.currentTimeRange] ?? 'the last 7 days';
  }

  private applyInitialUrlState(): void {
 if (!this.ctx.initialUrlState || !this.ctx.map) return;

 const { view, zoom, lat, lon, timeRange, layers } = this.ctx.initialUrlState;

 if (view) {
 this.ctx.map.setView(view);
 }

 if (timeRange) {
 this.ctx.map.setTimeRange(timeRange);
 }

 if (layers) {
 this.ctx.mapLayers = layers;
 saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
 this.ctx.map.setLayers(layers);
 }

 if (lat !== undefined && lon !== undefined) {
 const effectiveZoom = zoom ?? this.ctx.map.getState().zoom;
 if (effectiveZoom > 2) this.ctx.map.setCenter(lat, lon, zoom);
 } else if (!view && zoom !== undefined) {
 this.ctx.map.setZoom(zoom);
 }

 const regionSelect = document.getElementById('regionSelect') as HTMLSelectElement;
 const currentView = this.ctx.map.getState().view;
 if (regionSelect && currentView) {
 regionSelect.value = currentView;
 }
  }

  private getSavedPanelOrder(): string[] {
 try {
 const saved = localStorage.getItem(this.ctx.PANEL_ORDER_KEY);
 return saved ? JSON.parse(saved) : [];
 } catch {
 return [];
 }
  }

  savePanelOrder(): void {
 const grid = document.getElementById('panelsGrid');
 if (!grid) return;
 const order = [...grid.children]
 .map((el) => (el as HTMLElement).dataset.panel)
 .filter((key): key is string => !!key);
 localStorage.setItem(this.ctx.PANEL_ORDER_KEY, JSON.stringify(order));
  }

  /**
   * Dynamic-import the seven OSINT panels in parallel so Vite splits them
   * into their own chunk. Each panel is registered on ctx.panels as soon
   * as its module resolves; the panel grid will display a placeholder for
   * any not-yet-loaded panel until the chunk arrives (sub-100ms on modern
   * hardware). Errors per-panel are swallowed so a single failed import
   * cannot wedge the rest.
   */
  private async loadOsintPanels(): Promise<void> {
 const slots = [
 ['hibp-breaches',   () => import('@/components/HibpBreachesPanel').then((m) => new m.HibpBreachesPanel())],
 ['ipinfo-lookup',   () => import('@/components/IpInfoPanel').then((m) => new m.IpInfoPanel())],
 ['bitcoin-abuse',   () => import('@/components/BitcoinAbusePanel').then((m) => new m.BitcoinAbusePanel())],
 ['reddit-osint',    () => import('@/components/RedditOsintPanel').then((m) => new m.RedditOsintPanel())],
 ['phishstats-feed', () => import('@/components/PhishstatsFeedPanel').then((m) => new m.PhishstatsFeedPanel())],
 ['urlscan-threats', () => import('@/components/UrlscanThreatsPanel').then((m) => new m.UrlscanThreatsPanel())],
 ['pulsedive-intel', () => import('@/components/PulsediveIntelPanel').then((m) => new m.PulsediveIntelPanel())],
 ] as const;
 await Promise.all(slots.map(async ([id, load]) => {
 try {
 this.ctx.panels[id] = await load();
 } catch (error) {
 console.warn(`[panel-layout] OSINT panel '${id}' failed to load`, error);
 }
 }));
  }

  private attachRelatedAssetHandlers(panel: NewsPanel): void {
 panel.setRelatedAssetHandlers({
 onRelatedAssetClick: (asset) => this.handleRelatedAssetClick(asset),
 onRelatedAssetsFocus: (assets) => this.ctx.map?.highlightAssets(assets),
 onRelatedAssetsClear: () => this.ctx.map?.highlightAssets(null),
 });
  }

  private handleRelatedAssetClick(asset: RelatedAsset): void {
 if (!this.ctx.map) return;

 switch (asset.type) {
 case 'pipeline': {
 this.ctx.map.enableLayer('pipelines');
 this.ctx.mapLayers.pipelines = true;
 saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
 this.ctx.map.triggerPipelineClick(asset.id);
 break;
 }
 case 'cable': {
 this.ctx.map.enableLayer('cables');
 this.ctx.mapLayers.cables = true;
 saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
 this.ctx.map.triggerCableClick(asset.id);
 break;
 }
 case 'datacenter': {
 this.ctx.map.enableLayer('datacenters');
 this.ctx.mapLayers.datacenters = true;
 saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
 this.ctx.map.triggerDatacenterClick(asset.id);
 break;
 }
 case 'base': {
 this.ctx.map.enableLayer('bases');
 this.ctx.mapLayers.bases = true;
 saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
 this.ctx.map.triggerBaseClick(asset.id);
 break;
 }
 case 'nuclear': {
 this.ctx.map.enableLayer('nuclear');
 this.ctx.mapLayers.nuclear = true;
 saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
 this.ctx.map.triggerNuclearClick(asset.id);
 break;
 }
 }
  }

  private makeDraggable(el: HTMLElement, key: string): void {
 el.dataset.panel = key;
 let isDragging = false;
 let dragStarted = false;
 let startX = 0;
 let startY = 0;
 let rafId = 0;
 const DRAG_THRESHOLD = 8;

 const onMouseDown = (e: MouseEvent) => {
 if (e.button !== 0) return;
 const target = e.target as HTMLElement;
 if (el.dataset.resizing === 'true') return;
 if (
 target.classList?.contains('panel-resize-handle') ||
 target.closest?.('.panel-resize-handle') ||
 target.classList?.contains('panel-col-resize-handle') ||
 target.closest?.('.panel-col-resize-handle')
 ) return;
 if (target.closest('button, a, input, select, textarea, .panel-content')) return;

 isDragging = true;
 dragStarted = false;
 startX = e.clientX;
 startY = e.clientY;
 e.preventDefault();
 };

 const onMouseMove = (e: MouseEvent) => {
 if (!isDragging) return;
 if (!dragStarted) {
 const dx = Math.abs(e.clientX - startX);
 const dy = Math.abs(e.clientY - startY);
 if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
 dragStarted = true;
 el.classList.add('dragging');
 }
 const cx = e.clientX;
 const cy = e.clientY;
 if (rafId) cancelAnimationFrame(rafId);
 rafId = requestAnimationFrame(() => {
 this.handlePanelDragMove(el, cx, cy);
 rafId = 0;
 });
 };

 const onMouseUp = () => {
 if (!isDragging) return;
 isDragging = false;
 if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
 if (dragStarted) {
 el.classList.remove('dragging');
 this.savePanelOrder();
 }
 dragStarted = false;
 };

 const onMouseMoveRaf = rafSchedule(onMouseMove);
 el.addEventListener('mousedown', onMouseDown);
 document.addEventListener('mousemove', onMouseMoveRaf);
 document.addEventListener('mouseup', onMouseUp);

 this.panelDragCleanupHandlers.push(() => {
 el.removeEventListener('mousedown', onMouseDown);
 document.removeEventListener('mousemove', onMouseMoveRaf);
 document.removeEventListener('mouseup', onMouseUp);
 if (rafId) {
 cancelAnimationFrame(rafId);
 rafId = 0;
 }
 isDragging = false;
 dragStarted = false;
 el.classList.remove('dragging');
 });
  }

  private handlePanelDragMove(dragging: HTMLElement, clientX: number, clientY: number): void {
 const grid = document.getElementById('panelsGrid');
 if (!grid) return;

 dragging.style.pointerEvents = 'none';
 const target = document.elementFromPoint(clientX, clientY);
 dragging.style.pointerEvents = '';

 if (!target) return;
 const targetPanel = target.closest('.panel') as HTMLElement | null;
 if (!targetPanel || targetPanel === dragging || targetPanel.classList.contains('hidden')) return;
 if (targetPanel.parentElement !== grid) return;

 const targetRect = targetPanel.getBoundingClientRect();
 const draggingRect = dragging.getBoundingClientRect();

 const children = [...grid.children];
 const dragIdx = children.indexOf(dragging);
 const targetIdx = children.indexOf(targetPanel);
 if (dragIdx === -1 || targetIdx === -1) return;

 const sameRow = Math.abs(draggingRect.top - targetRect.top) < 30;
 const targetMid = sameRow
 ? targetRect.left + targetRect.width / 2
 : targetRect.top + targetRect.height / 2;
 const cursorPos = sameRow ? clientX : clientY;

 if (dragIdx < targetIdx) {
 if (cursorPos > targetMid) {
 grid.insertBefore(dragging, targetPanel.nextSibling);
 }
 } else {
 if (cursorPos < targetMid) {
 targetPanel.before(dragging);
 }
 }
  }

  getLocalizedPanelName(panelKey: string, fallback: string): string {
 const key = panelKey.replace(/-([a-z])/g, (_match, group: string) => group.toUpperCase());
 const lookup = `panels.${key}`;
 const localized = t(lookup);
 return localized === lookup ? fallback : localized;
  }

  getAllSourceNames(): string[] {
 const sources = new Set<string>();
 Object.values(FEEDS).forEach(feeds => {
 if (feeds) feeds.forEach(f => sources.add(f.name));
 });
 INTEL_SOURCES.forEach(f => sources.add(f.name));
 return [...sources].sort((a, b) => a.localeCompare(b));
  }
}
