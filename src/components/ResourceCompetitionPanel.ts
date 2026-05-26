import { Panel } from './Panel';
import {
  RARE_EARTH_DEPENDENCY,
  STRATEGIC_MINERAL_EVENTS,
  ARCTIC_DISPUTES,
  DEEP_SEA_MINING,
  NATIONALISM_EVENTS,
  BATTERY_MINERAL_RISK,
  countCriticalConcentration,
  countActiveNationalizations,
  countContestedArcticClaims,
  countVulnerableBatteryMinerals,
  renderRareEarthSection,
  renderStrategicMineralsSection,
  renderArcticDisputesSection,
  renderDeepSeaMiningSection,
  renderNationalismSection,
  renderBatteryMineralsSection,
} from './resource-competition-helpers';
import type {
  RareEarthDependency,
  StrategicMineralEvent,
  ArcticDispute,
  DeepSeaMiningContract,
  NationalismEvent,
  BatteryMineralRisk,
} from './resource-competition-helpers';

const REFRESH_MS = 60 * 60 * 1000;

export interface ResourceCompetitionInputs {
  rareEarth?: RareEarthDependency[];
  strategicMinerals?: StrategicMineralEvent[];
  arcticDisputes?: ArcticDispute[];
  deepSeaMining?: DeepSeaMiningContract[];
  nationalism?: NationalismEvent[];
  batteryMinerals?: BatteryMineralRisk[];
}

export class ResourceCompetitionPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private inputs: Required<ResourceCompetitionInputs> = {
    rareEarth: RARE_EARTH_DEPENDENCY,
    strategicMinerals: STRATEGIC_MINERAL_EVENTS,
    arcticDisputes: ARCTIC_DISPUTES,
    deepSeaMining: DEEP_SEA_MINING,
    nationalism: NATIONALISM_EVENTS,
    batteryMinerals: BATTERY_MINERAL_RISK,
  };

  constructor() {
    super({
      id: 'resource-competition',
      title: 'Resource Competition',
      showCount: true,
      trackActivity: true,
    });
    this.render();
    if (typeof setInterval !== 'undefined') {
      this.refreshTimer = setInterval(() => { this.render(); }, REFRESH_MS);
    }
  }

  setInputs(partial: ResourceCompetitionInputs): void {
    this.inputs = {
      rareEarth: partial.rareEarth ?? this.inputs.rareEarth,
      strategicMinerals: partial.strategicMinerals ?? this.inputs.strategicMinerals,
      arcticDisputes: partial.arcticDisputes ?? this.inputs.arcticDisputes,
      deepSeaMining: partial.deepSeaMining ?? this.inputs.deepSeaMining,
      nationalism: partial.nationalism ?? this.inputs.nationalism,
      batteryMinerals: partial.batteryMinerals ?? this.inputs.batteryMinerals,
    };
    this.render();
  }

  private criticalCount(): number {
    return (
      countCriticalConcentration(this.inputs.rareEarth) +
      countActiveNationalizations(this.inputs.nationalism) +
      countContestedArcticClaims(this.inputs.arcticDisputes) +
      countVulnerableBatteryMinerals(this.inputs.batteryMinerals)
    );
  }

  private render(): void {
    const html =
      renderRareEarthSection(this.inputs.rareEarth) +
      renderBatteryMineralsSection(this.inputs.batteryMinerals) +
      renderStrategicMineralsSection(this.inputs.strategicMinerals) +
      renderNationalismSection(this.inputs.nationalism) +
      renderArcticDisputesSection(this.inputs.arcticDisputes) +
      renderDeepSeaMiningSection(this.inputs.deepSeaMining);

    this.setContent(`<div class="resource-competition-panel">${html}</div>`);
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
