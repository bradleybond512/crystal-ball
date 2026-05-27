import { Panel } from './Panel';
import {
  ATTACK_VECTOR_STATS,
  COUNTRY_ASSESSMENTS,
  HIGH_IMPACT_EVENTS,
  INCIDENT_TRENDS,
  THREAT_GROUPS,
  aggregateFatalities,
  aggregateIncidents,
  countActiveThreatGroups,
  countHighImpactEvents,
  countHighThreatCountries,
  renderAttackVectorsSection,
  renderCountryAssessmentsSection,
  renderHighImpactEventsSection,
  renderIncidentTrendsSection,
  renderThreatGroupsSection,
} from './counterterrorism-helpers';
import type {
  AttackVectorStat,
  CountryThreatAssessment,
  HighImpactEvent,
  TerrorismIncidentTrend,
  ThreatGroup,
} from './counterterrorism-helpers';

const REFRESH_MS = 30 * 60 * 1000;

export interface CounterterrorismInputs {
  trends?: TerrorismIncidentTrend[];
  groups?: ThreatGroup[];
  vectors?: AttackVectorStat[];
  assessments?: CountryThreatAssessment[];
  events?: HighImpactEvent[];
}

export class CounterterrorismPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private inputs: Required<CounterterrorismInputs> = {
    trends: INCIDENT_TRENDS,
    groups: THREAT_GROUPS,
    vectors: ATTACK_VECTOR_STATS,
    assessments: COUNTRY_ASSESSMENTS,
    events: HIGH_IMPACT_EVENTS,
  };

  constructor() {
    super({
      id: 'counterterrorism',
      title: 'Counterterrorism Intelligence',
      showCount: true,
      trackActivity: true,
    });
    this.render();
    if (typeof setInterval !== 'undefined') {
      this.refreshTimer = setInterval(() => { this.render(); }, REFRESH_MS);
    }
  }

  setInputs(partial: CounterterrorismInputs): void {
    this.inputs = {
      trends:      partial.trends      ?? this.inputs.trends,
      groups:      partial.groups      ?? this.inputs.groups,
      vectors:     partial.vectors     ?? this.inputs.vectors,
      assessments: partial.assessments ?? this.inputs.assessments,
      events:      partial.events      ?? this.inputs.events,
    };
    this.render();
  }

  private criticalCount(): number {
    return (
      countActiveThreatGroups(this.inputs.groups) +
      countHighThreatCountries(this.inputs.assessments) +
      countHighImpactEvents(this.inputs.events)
    );
  }

  private render(): void {
    try {
      const html =
        renderIncidentTrendsSection(this.inputs.trends) +
        renderThreatGroupsSection(this.inputs.groups) +
        renderAttackVectorsSection(this.inputs.vectors) +
        renderCountryAssessmentsSection(this.inputs.assessments) +
        renderHighImpactEventsSection(this.inputs.events);

      this.setContent(`<div class="counterterrorism-panel">${html}</div>`);
      this.setCount(this.criticalCount());
      this.markFresh();
    } catch (err) {
      this.showError('Failed to render counterterrorism data');
    }
  }

  override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }
}
