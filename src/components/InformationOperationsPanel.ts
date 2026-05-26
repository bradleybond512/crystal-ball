/**
 * InformationOperationsPanel — defensive monitoring surface for
 * observed information operations and disinformation activity.
 *
 * STRICTLY ANALYTICAL / DEFENSIVE FRAMING. The panel surfaces detection
 * signals, takedown reports, and attribution assessments — it never
 * generates content, runs campaigns, or recommends offensive action.
 *
 * Six sections, refreshed every 30 minutes:
 *   1. Threat Index                 — composite 0..100 + top driver
 *   2. Coordinated Inauthentic      — platform takedown / CIB reports
 *   3. Foreign State Media          — observed influence campaigns
 *   4. Narrative Warfare by Region  — intensity + polarization roll-up
 *   5. Manipulation Signals         — defensive detector outputs
 *   6. State Actor Campaigns        — observed strategic-comms campaigns
 *   7. Attribution Assessments      — disinformation attribution confidence
 *
 * Pure helpers live in `information-operations-helpers.ts` so the unit
 * tests exercise the same code paths the panel renders. Live data
 * injection is via the `set*` setters; without them the panel renders
 * "awaiting data" rows so it can ship before the upstream feed is wired.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  attributionMethodLabel,
  attributionTierColor,
  attributionTierLabel,
  bandForInfoThreat,
  computeInfoThreatIndex,
  countCriticalCib,
  countEscalatingForeignCampaigns,
  countFracturedRegions,
  countHighSeverityManipulation,
  countLikelyOrHighAttribution,
  infoThreatBandColor,
  intensityLabel as intensityLabelFn,
  polarizationBandColor,
  polarizationBandLabel,
  severityColor,
  severityLabel,
  summarizeAttributionAssessments,
  summarizeCibEvents,
  summarizeForeignMediaCampaigns,
  summarizeManipulationSignals,
  summarizeNarrativeRegions,
  summarizeStateActorCampaigns,
  trajectoryColor,
  trajectoryLabel,
  type AttributionAssessment,
  type AttributionAssessmentRow,
  type CibEvent,
  type CibRow,
  type ForeignMediaCampaign,
  type ForeignMediaCampaignRow,
  type InfoThreatIndex,
  type InfoThreatInput,
  type ManipulationSignal,
  type ManipulationSignalRow,
  type NarrativeRegion,
  type NarrativeRegionRow,
  type StateActorCampaign,
  type StateActorCampaignRow,
} from './information-operations-helpers';

const REFRESH_MS = 30 * 60_000;

const EMPTY_INPUT: InfoThreatInput = {
  cibScore: 0,
  foreignMediaScore: 0,
  narrativeWarfareScore: 0,
  manipulationSignalScore: 0,
  stateActorCampaignScore: 0,
  attributionConfidenceScore: 0,
};

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export class InformationOperationsPanel extends Panel {
  private cibEvents: CibEvent[] = [];
  private foreignCampaigns: ForeignMediaCampaign[] = [];
  private narrativeRegions: NarrativeRegion[] = [];
  private manipulationSignals: ManipulationSignal[] = [];
  private stateActorCampaigns: StateActorCampaign[] = [];
  private attributionAssessments: AttributionAssessment[] = [];
  private threatInput: InfoThreatInput = EMPTY_INPUT;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'information-operations',
      title: 'Information Operations',
      showCount: true,
      trackActivity: true,
    });
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      safe(() => this.refresh(), undefined);
    }, REFRESH_MS);
  }

  setCibEvents(events: readonly CibEvent[]): void {
    this.cibEvents = [...events];
    safe(() => this.refresh(), undefined);
  }

  setForeignMediaCampaigns(campaigns: readonly ForeignMediaCampaign[]): void {
    this.foreignCampaigns = [...campaigns];
    safe(() => this.refresh(), undefined);
  }

  setNarrativeRegions(regions: readonly NarrativeRegion[]): void {
    this.narrativeRegions = [...regions];
    safe(() => this.refresh(), undefined);
  }

  setManipulationSignals(signals: readonly ManipulationSignal[]): void {
    this.manipulationSignals = [...signals];
    safe(() => this.refresh(), undefined);
  }

  setStateActorCampaigns(campaigns: readonly StateActorCampaign[]): void {
    this.stateActorCampaigns = [...campaigns];
    safe(() => this.refresh(), undefined);
  }

  setAttributionAssessments(assessments: readonly AttributionAssessment[]): void {
    this.attributionAssessments = [...assessments];
    safe(() => this.refresh(), undefined);
  }

  setThreatInput(input: Partial<InfoThreatInput>): void {
    this.threatInput = { ...this.threatInput, ...input };
    safe(() => this.refresh(), undefined);
  }

  refresh(): void {
    const now = Date.now();
    const cibRows = summarizeCibEvents(this.cibEvents, now);
    const foreignRows = summarizeForeignMediaCampaigns(this.foreignCampaigns, now);
    const regionRows = summarizeNarrativeRegions(this.narrativeRegions);
    const manipulationRows = summarizeManipulationSignals(this.manipulationSignals, now);
    const stateActorRows = summarizeStateActorCampaigns(this.stateActorCampaigns, now);
    const attributionRows = summarizeAttributionAssessments(this.attributionAssessments, now);
    const threat = computeInfoThreatIndex(this.threatInput);

    this.setContent(this.buildHtml({
      threat,
      cibRows,
      foreignRows,
      regionRows,
      manipulationRows,
      stateActorRows,
      attributionRows,
    }));

    const stress =
      countCriticalCib(cibRows) +
      countEscalatingForeignCampaigns(foreignRows) +
      countFracturedRegions(regionRows) +
      countHighSeverityManipulation(manipulationRows) +
      countLikelyOrHighAttribution(attributionRows);
    this.setCount(stress);
    this.markFresh();
  }

  private buildHtml(data: {
    threat: InfoThreatIndex;
    cibRows: CibRow[];
    foreignRows: ForeignMediaCampaignRow[];
    regionRows: NarrativeRegionRow[];
    manipulationRows: ManipulationSignalRow[];
    stateActorRows: StateActorCampaignRow[];
    attributionRows: AttributionAssessmentRow[];
  }): string {
    return `<div class="info-ops">
      ${this.buildThreatSection(data.threat)}
      ${this.buildCibSection(data.cibRows)}
      ${this.buildForeignMediaSection(data.foreignRows)}
      ${this.buildNarrativeSection(data.regionRows)}
      ${this.buildManipulationSection(data.manipulationRows)}
      ${this.buildStateActorSection(data.stateActorRows)}
      ${this.buildAttributionSection(data.attributionRows)}
    </div>`;
  }

  private buildThreatSection(t: InfoThreatIndex): string {
    const band = bandForInfoThreat(t.score);
    const driver = t.topDriver === null
      ? 'No active drivers'
      : `Top driver: ${escapeHtml(t.topDriver)}`;
    return `<section class="io-section io-threat">
      <h3>Information Threat Index</h3>
      <div class="io-threat-row">
        <span class="io-score" style="color:${infoThreatBandColor(band)}">${t.score}/100</span>
        <span class="io-band" style="color:${infoThreatBandColor(band)}">${escapeHtml(band.toUpperCase())}</span>
        <span class="io-driver">${escapeHtml(driver)}</span>
      </div>
    </section>`;
  }

  private buildCibSection(rows: CibRow[]): string {
    const body = rows.length === 0
      ? '<div class="io-empty">Awaiting platform takedown reports</div>'
      : rows.map((r) => `
        <div class="io-cib-item">
          <span class="io-platform">${escapeHtml(r.platform)}</span>
          <span class="io-attribution">${escapeHtml(r.attribution)}</span>
          <span class="io-count">${r.accountCount.toLocaleString()} assets</span>
          <span class="io-severity" style="color:${severityColor(r.severity)}">${escapeHtml(severityLabel(r.severity))}</span>
          <span class="io-confidence">conf ${r.confidence.toFixed(2)}</span>
          <span class="io-target">target: ${escapeHtml(r.targetAudience)}</span>
          <span class="io-narrative">${escapeHtml(r.narrative)}</span>
          <span class="io-age">${escapeHtml(r.ageLabel)}</span>
        </div>`).join('');
    return `<section class="io-section"><h3>Coordinated Inauthentic Behavior (analytic)</h3>${body}</section>`;
  }

  private buildForeignMediaSection(rows: ForeignMediaCampaignRow[]): string {
    const body = rows.length === 0
      ? '<div class="io-empty">Awaiting foreign-state-media observations</div>'
      : rows.map((r) => `
        <div class="io-foreign-item">
          <span class="io-state">${escapeHtml(r.originState)}</span>
          <span class="io-outlet">${escapeHtml(r.outlet)}</span>
          <span class="io-theme">${escapeHtml(r.theme)}</span>
          <span class="io-intensity">int ${r.intensity}/5 · ${escapeHtml(intensityLabelFn(r.intensity))}</span>
          <span class="io-trajectory" style="color:${trajectoryColor(r.trajectory)}">${escapeHtml(trajectoryLabel(r.trajectory))}</span>
          <span class="io-regions">targets: ${escapeHtml(r.regionsTargeted.join(', '))}</span>
          <span class="io-age">${escapeHtml(r.ageLabel)}</span>
        </div>`).join('');
    return `<section class="io-section"><h3>Foreign State Media Influence</h3>${body}</section>`;
  }

  private buildNarrativeSection(rows: NarrativeRegionRow[]): string {
    const body = rows.length === 0
      ? '<div class="io-empty">Awaiting regional narrative-warfare observations</div>'
      : rows.map((r) => `
        <div class="io-region-item">
          <span class="io-region">${escapeHtml(r.region)}</span>
          <span class="io-narrative">${escapeHtml(r.topNarrative)}</span>
          <span class="io-intensity">int ${r.intensity}/100</span>
          <span class="io-polarization" style="color:${polarizationBandColor(r.polarizationBand)}">${escapeHtml(polarizationBandLabel(r.polarizationBand))} ${r.polarization}/100</span>
          <span class="io-volume">${r.volume24h.toLocaleString()} obs/24h</span>
          <span class="io-mix">state ${r.sourceMix.stateAlignedPct}% · partisan ${r.sourceMix.partisanMediaPct}% · organic ${r.sourceMix.organicPct}%</span>
          <span class="io-dominant">dominant: ${escapeHtml(r.dominantSource)}</span>
        </div>`).join('');
    return `<section class="io-section"><h3>Narrative Warfare by Region</h3>${body}</section>`;
  }

  private buildManipulationSection(rows: ManipulationSignalRow[]): string {
    const body = rows.length === 0
      ? '<div class="io-empty">Awaiting manipulation detector output</div>'
      : rows.map((r) => `
        <div class="io-manip-item">
          <span class="io-platform">${escapeHtml(r.platform)}</span>
          <span class="io-kind">${escapeHtml(r.kindLabel)}</span>
          <span class="io-magnitude">mag ${r.magnitude}/100</span>
          <span class="io-confidence">conf ${r.confidence.toFixed(2)}</span>
          <span class="io-severity" style="color:${severityColor(r.severity)}">${escapeHtml(severityLabel(r.severity))}</span>
          <span class="io-description">${escapeHtml(r.description)}</span>
          <span class="io-age">${escapeHtml(r.ageLabel)}</span>
        </div>`).join('');
    return `<section class="io-section"><h3>Manipulation Signals (defensive detection)</h3>${body}</section>`;
  }

  private buildStateActorSection(rows: StateActorCampaignRow[]): string {
    const body = rows.length === 0
      ? '<div class="io-empty">Awaiting state-actor campaign observations</div>'
      : rows.map((r) => `
        <div class="io-state-item">
          <span class="io-actor">${escapeHtml(r.actor)}</span>
          <span class="io-campaign">${escapeHtml(r.campaign)}</span>
          <span class="io-theme">${escapeHtml(r.theme)}</span>
          <span class="io-audience">target: ${escapeHtml(r.targetAudience)}</span>
          <span class="io-mediums">mediums (${r.mediumCount}): ${escapeHtml(r.mediums.join(', '))}</span>
          <span class="io-intent">intent: ${escapeHtml(r.intentInference)}</span>
          <span class="io-age">${escapeHtml(r.ageLabel)}</span>
        </div>`).join('');
    return `<section class="io-section"><h3>Strategic Communication Campaigns (state actor, observed)</h3>${body}</section>`;
  }

  private buildAttributionSection(rows: AttributionAssessmentRow[]): string {
    const body = rows.length === 0
      ? '<div class="io-empty">Awaiting attribution assessments</div>'
      : rows.map((r) => `
        <div class="io-attr-item">
          <span class="io-claim">${escapeHtml(r.claim)}</span>
          <span class="io-actor">${escapeHtml(r.suspectedActor)}</span>
          <span class="io-method">${escapeHtml(attributionMethodLabel(r.method))}</span>
          <span class="io-confidence">conf ${r.confidence.toFixed(2)}</span>
          <span class="io-tier" style="color:${attributionTierColor(r.tier)}">${escapeHtml(attributionTierLabel(r.tier))}</span>
          <span class="io-corrob">corroboration: ${r.corroborationCount}</span>
          ${r.dissent ? '<span class="io-dissent" style="color:var(--severity-high,#fb923c)">⚠ dissenting analysis</span>' : ''}
          <span class="io-age">${escapeHtml(r.ageLabel)}</span>
        </div>`).join('');
    return `<section class="io-section"><h3>Disinformation Attribution Assessments</h3>${body}</section>`;
  }
}
