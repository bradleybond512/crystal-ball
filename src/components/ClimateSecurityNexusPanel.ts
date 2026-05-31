import { Panel } from './Panel';
import {
  ADAPTATION_FAILURES,
  CARBON_STATE_FRAGILITY,
  CLIMATE_CONFLICT_EVENTS,
  MIGRATION_PRESSURES,
  NEXUS_STRESS_SCORES,
  SEA_LEVEL_INSTALLATIONS,
  WEATHER_AMPLIFICATIONS,
  countAmplifiedConflicts,
  countCriticalNexusRegions,
  countCriticalSeaLevelInstallations,
  countEscalatingConflicts,
  countExtremeCarbonDependents,
  countFailingAdaptationPrograms,
  countHighMigrationFlows,
  renderAdaptationFailureSection,
  renderCarbonStateSection,
  renderConflictEventsSection,
  renderMigrationSection,
  renderNexusStressSection,
  renderSeaLevelInstallationsSection,
  renderWeatherAmplificationSection,
} from './climate-security-nexus-helpers';
import type {
  AdaptationFailureSignal,
  CarbonStateFragility,
  ClimateConflictEvent,
  MigrationPressure,
  NexusStressScore,
  SeaLevelInstallationRisk,
  WeatherAmplifiedConflict,
} from './climate-security-nexus-helpers';

const REFRESH_MS = 60 * 60 * 1000;

export interface ClimateSecurityNexusInputs {
  conflicts?: ClimateConflictEvent[];
  nexus?: NexusStressScore[];
  migration?: MigrationPressure[];
  amplification?: WeatherAmplifiedConflict[];
  adaptation?: AdaptationFailureSignal[];
  carbonStates?: CarbonStateFragility[];
  installations?: SeaLevelInstallationRisk[];
}

export class ClimateSecurityNexusPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private inputs: Required<ClimateSecurityNexusInputs> = {
    conflicts: CLIMATE_CONFLICT_EVENTS,
    nexus: NEXUS_STRESS_SCORES,
    migration: MIGRATION_PRESSURES,
    amplification: WEATHER_AMPLIFICATIONS,
    adaptation: ADAPTATION_FAILURES,
    carbonStates: CARBON_STATE_FRAGILITY,
    installations: SEA_LEVEL_INSTALLATIONS,
  };

  constructor() {
    super({
      id: 'climate-security-nexus',
      title: 'Climate Security Nexus',
      showCount: true,
      trackActivity: true,
    });
    this.render();
    if (typeof setInterval !== 'undefined') {
      this.refreshTimer = setInterval(() => { this.render(); }, REFRESH_MS);
    }
  }

  setInputs(partial: ClimateSecurityNexusInputs): void {
    this.inputs = {
      conflicts: partial.conflicts ?? this.inputs.conflicts,
      nexus: partial.nexus ?? this.inputs.nexus,
      migration: partial.migration ?? this.inputs.migration,
      amplification: partial.amplification ?? this.inputs.amplification,
      adaptation: partial.adaptation ?? this.inputs.adaptation,
      carbonStates: partial.carbonStates ?? this.inputs.carbonStates,
      installations: partial.installations ?? this.inputs.installations,
    };
    this.render();
  }

  private criticalCount(): number {
    return (
      countEscalatingConflicts(this.inputs.conflicts) +
      countCriticalNexusRegions(this.inputs.nexus) +
      countHighMigrationFlows(this.inputs.migration) +
      countAmplifiedConflicts(this.inputs.amplification) +
      countFailingAdaptationPrograms(this.inputs.adaptation) +
      countExtremeCarbonDependents(this.inputs.carbonStates) +
      countCriticalSeaLevelInstallations(this.inputs.installations)
    );
  }

  private render(): void {
    const html =
      renderConflictEventsSection(this.inputs.conflicts) +
      renderNexusStressSection(this.inputs.nexus) +
      renderMigrationSection(this.inputs.migration) +
      renderWeatherAmplificationSection(this.inputs.amplification) +
      renderAdaptationFailureSection(this.inputs.adaptation) +
      renderCarbonStateSection(this.inputs.carbonStates) +
      renderSeaLevelInstallationsSection(this.inputs.installations);

    this.setContent(`<div class="climate-security-nexus-panel">${html}</div>`);
    this.setCount(this.criticalCount());
    this.markFresh();
  }

  override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }
}
