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

export type { WatchWindowEvaluation, WatchWindowInput } from './watch-window';
export {
  evaluateWatchWindow,
  applyWatchWindowEvaluation,
} from './watch-window';
