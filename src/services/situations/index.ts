/**
 * High-Impact Situation Intelligence — Phase 1 entry point.
 *
 * Re-exports the public surface so consumers can `import {...}` from
 * `@/services/situations` without reaching into individual files.
 */

export type {
  Situation,
  SituationDomain,
  SituationSeverity,
  SituationPhase,
  SituationEvidence,
  SourceAgreement,
  ExpectedSignal,
  InvalidationSignal,
  RecommendedAction,
  TimelineEvent,
  PersonalImpact,
  DiagnosticsTrace,
  PredictionOutcome,
} from './situation-types';

export {
  rankingScore,
  severityFromScore,
  SEVERITY_RANK,
} from './situation-types';

export type { SituationStore, SituationListener } from './situation-store';
export {
  createSituationStore,
  getSituationStore,
  resetSituationStoreForTests,
} from './situation-store';

export type {
  TheaterPosture,
  TheaterPostureInput,
  MilitaryAdapterInput,
} from './military-adapter';
export { militaryPosturesToSituations } from './military-adapter';

export type {
  CyberLifecycleStage,
  CyberSector,
  CyberThreatInput,
  CyberAdapterUserContext,
  CyberAdapterInput,
} from './cyber-adapter';
export { cyberThreatsToSituations } from './cyber-adapter';

export type { WeatherAdapterInput } from './weather-adapter';
export { weatherAlertsToSituations } from './weather-adapter';

// ── Phase 2: Personal Exposure Graph ─────────────────────────────────────
export type {
  ExposureGraph,
  ExposureSavedPlace,
  ExposureWatchlist,
  ExposureDevice,
  ExposureScore,
} from './exposure-graph';
export {
  scoreGeoExposure,
  scoreCyberExposure,
  scoreCountryExposure,
  exposureToLevel,
  setExposureGraph,
  getExposureGraph,
  resetExposureGraphForTests,
} from './exposure-graph';

// ── Phase 3: Watch Windows ───────────────────────────────────────────────
export type { WatchWindowEvaluation, WatchWindowInput } from './watch-window';
export {
  evaluateWatchWindow,
  applyWatchWindowEvaluation,
} from './watch-window';

// ── Phase 4: Domain Superpowers ──────────────────────────────────────────
export type {
  MilitaryPatternId,
  MilitaryPatternFeature,
  MilitaryPatternMatch,
  MilitaryPatternDefinition,
} from './military-patterns';
export {
  matchMilitaryPattern,
  matchAllMilitaryPatterns,
  DEFAULT_MILITARY_PATTERNS,
} from './military-patterns';

export type { CyberStormModePayload } from './cyber-storm-mode';
export { buildCyberStormMode } from './cyber-storm-mode';

export type {
  NowcastSignal,
  NowcastSignalKind,
  NowcastEvaluation,
  NowcastInput,
} from './weather-nowcast';
export { evaluateWeatherNowcast } from './weather-nowcast';

// ── Phase 5: Compound Threat Engine ──────────────────────────────────────
export type {
  CascadePathId,
  CascadePathDefinition,
  CompoundDetectionInput,
  CompoundDetectionResult,
} from './compound-threat';
export {
  detectCompoundThreats,
  DEFAULT_CASCADE_PATHS,
} from './compound-threat';

// ── Phase 6: After-Action + Self-Learning ────────────────────────────────
export type {
  GroundTruthObservation,
  AfterActionInput,
  AfterActionReport,
  AfterActionRecommendation,
} from './after-action';
export {
  reviewSituation,
  applyAfterActionReview,
} from './after-action';
