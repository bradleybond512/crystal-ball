/**
 * ConflictEscalationPanel — defensive monitoring surface for active
 * conflicts and escalation/de-escalation indicators.
 *
 * Seven sections, refreshed every 30 minutes:
 *   1. War Risk Index            — composite 0..100 + top driver + de-esc deduction
 *   2. Active Conflicts          — per-dyad intensity + 30d casualties
 *   3. Ceasefires                — status + violations + days-holding
 *   4. Intensity Trends          — 30-day delta direction + magnitude
 *   5. Escalation Ladder         — 7-rung position + step-change
 *   6. De-escalation Signals     — weighted optimism roll-up
 *
 * Pure helpers in `conflict-escalation-helpers.ts` so unit tests exercise
 * the same code paths the panel renders. `set*` setters inject live
 * data; without them the panel renders "awaiting data" rows.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  bandForWarRisk,
  ceasefireStatusColor,
  ceasefireStatusLabel,
  computeWarRiskIndex,
  countActiveWars,
  countCollapsedCeasefires,
  countEscalatingTrends,
  countHighRungs,
  deEscalationRollupScore,
  intensityColor,
  rungColor,
  summarizeActiveConflicts,
  summarizeCeasefires,
  summarizeDeEscalationSignals,
  summarizeEscalationLadder,
  summarizeIntensityTrends,
  trendColor,
  warRiskBandColor,
  warRiskBandLabel,
  type Ceasefire,
  type CeasefireRow,
  type ConflictDyad,
  type ConflictDyadRow,
  type ConflictIntensityRow,
  type ConflictIntensitySample,
  type DeEscalationSignal,
  type DeEscalationSignalRow,
  type EscalationLadderEntry,
  type EscalationLadderRow,
  type WarRiskIndex,
  type WarRiskInput,
} from './conflict-escalation-helpers';

const REFRESH_MS = 30 * 60_000;

const EMPTY_INPUT: WarRiskInput = {
  activeConflictScore: 0,
  ceasefireFragilityScore: 0,
  intensityTrendScore: 0,
  escalationLadderScore: 0,
  deEscalationScore: 0,
  crossDomainPressureScore: 0,
};

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export class ConflictEscalationPanel extends Panel {
  private conflicts: ConflictDyad[] = [];
  private ceasefires: Ceasefire[] = [];
  private intensitySamples: ConflictIntensitySample[] = [];
  private ladderEntries: EscalationLadderEntry[] = [];
  private deEscalationSignals: DeEscalationSignal[] = [];
  private warRiskInput: WarRiskInput = EMPTY_INPUT;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'conflict-escalation',
      title: 'Conflict Escalation Monitor',
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

  setConflicts(c: readonly ConflictDyad[]): void { this.conflicts = [...c]; safe(() => this.refresh(), undefined); }
  setCeasefires(c: readonly Ceasefire[]): void { this.ceasefires = [...c]; safe(() => this.refresh(), undefined); }
  setIntensitySamples(s: readonly ConflictIntensitySample[]): void { this.intensitySamples = [...s]; safe(() => this.refresh(), undefined); }
  setLadderEntries(e: readonly EscalationLadderEntry[]): void { this.ladderEntries = [...e]; safe(() => this.refresh(), undefined); }
  setDeEscalationSignals(s: readonly DeEscalationSignal[]): void { this.deEscalationSignals = [...s]; safe(() => this.refresh(), undefined); }
  setWarRiskInput(input: Partial<WarRiskInput>): void {
    this.warRiskInput = { ...this.warRiskInput, ...input };
    safe(() => this.refresh(), undefined);
  }

  refresh(): void {
    const now = Date.now();
    const conflictRows = summarizeActiveConflicts(this.conflicts, now);
    const ceasefireRows = summarizeCeasefires(this.ceasefires, now);
    const trendRows = summarizeIntensityTrends(this.intensitySamples, now);
    const ladderRows = summarizeEscalationLadder(this.ladderEntries, now);
    const deEscRows = summarizeDeEscalationSignals(this.deEscalationSignals, now);
    const warRisk = computeWarRiskIndex(this.warRiskInput);

    this.setContent(this.buildHtml({
      warRisk,
      conflictRows,
      ceasefireRows,
      trendRows,
      ladderRows,
      deEscRows,
    }));

    const stress =
      countActiveWars(conflictRows) +
      countCollapsedCeasefires(ceasefireRows) +
      countEscalatingTrends(trendRows) +
      countHighRungs(ladderRows);
    this.setCount(stress);
    this.markFresh();
  }

  private buildHtml(data: {
    warRisk: WarRiskIndex;
    conflictRows: ConflictDyadRow[];
    ceasefireRows: CeasefireRow[];
    trendRows: ConflictIntensityRow[];
    ladderRows: EscalationLadderRow[];
    deEscRows: DeEscalationSignalRow[];
  }): string {
    return `<div class="conflict-escalation">
      ${this.buildWarRiskSection(data.warRisk)}
      ${this.buildConflictSection(data.conflictRows)}
      ${this.buildCeasefireSection(data.ceasefireRows)}
      ${this.buildTrendSection(data.trendRows)}
      ${this.buildLadderSection(data.ladderRows)}
      ${this.buildDeEscalationSection(data.deEscRows)}
    </div>`;
  }

  private buildWarRiskSection(t: WarRiskIndex): string {
    const band = bandForWarRisk(t.score);
    const driver = t.topDriver === null
      ? 'No active drivers'
      : `Top driver: ${escapeHtml(t.topDriver)}`;
    const deduction = t.deEscalationDeduction > 0
      ? `<span class="ce-deduction">−${t.deEscalationDeduction} from de-escalation</span>`
      : '';
    return `<section class="ce-section ce-risk">
      <h3>War Risk Index</h3>
      <div class="ce-risk-row">
        <span class="ce-score" style="color:${warRiskBandColor(band)}">${t.score}/100</span>
        <span class="ce-band" style="color:${warRiskBandColor(band)}">${escapeHtml(warRiskBandLabel(band).toUpperCase())}</span>
        <span class="ce-driver">${escapeHtml(driver)}</span>
        ${deduction}
      </div>
    </section>`;
  }

  private buildConflictSection(rows: ConflictDyadRow[]): string {
    const body = rows.length === 0
      ? '<div class="ce-empty">Awaiting active conflict data</div>'
      : rows.map((r) => `
        <div class="ce-conflict-item">
          <span class="ce-dyad">${escapeHtml(r.dyad)}</span>
          <span class="ce-region">${escapeHtml(r.region)}</span>
          <span class="ce-kind">${escapeHtml(r.kindLabel)}</span>
          <span class="ce-intensity" style="color:${intensityColor(r.intensity)}">${escapeHtml(r.intensityLabel)}</span>
          <span class="ce-casualties">${r.battleDeaths30d.toLocaleString()} bd · ${r.civilianCasualties30d.toLocaleString()} civ (30d)</span>
          <span class="ce-age">${escapeHtml(r.ageLabel)}</span>
        </div>`).join('');
    return `<section class="ce-section"><h3>Active Conflicts (by dyad)</h3>${body}</section>`;
  }

  private buildCeasefireSection(rows: CeasefireRow[]): string {
    const body = rows.length === 0
      ? '<div class="ce-empty">Awaiting ceasefire monitoring data</div>'
      : rows.map((r) => `
        <div class="ce-ceasefire-item">
          <span class="ce-dyad">${escapeHtml(r.dyad)}</span>
          <span class="ce-region">${escapeHtml(r.region)}</span>
          <span class="ce-status" style="color:${ceasefireStatusColor(r.status)}">${escapeHtml(ceasefireStatusLabel(r.status))}</span>
          <span class="ce-holding">${r.daysHolding}d holding</span>
          <span class="ce-violations">${r.violations24h}/24h · ${r.violations7d}/7d</span>
          ${r.accelerating ? '<span class="ce-accelerating" style="color:var(--severity-high,#fb923c)">⚠ accelerating</span>' : ''}
          <span class="ce-age">${escapeHtml(r.ageLabel)}</span>
        </div>`).join('');
    return `<section class="ce-section"><h3>Ceasefire Status</h3>${body}</section>`;
  }

  private signed(n: number): string {
    return n > 0 ? `+${n}` : `${n}`;
  }

  private pctLabel(pctChange: number | null): string {
    if (pctChange === null) return '—';
    return `${this.signed(pctChange)}%`;
  }

  private buildTrendSection(rows: ConflictIntensityRow[]): string {
    const body = rows.length === 0
      ? '<div class="ce-empty">Awaiting intensity-trend samples</div>'
      : rows.map((r) => `
        <div class="ce-trend-item">
          <span class="ce-dyad">${escapeHtml(r.dyad)}</span>
          <span class="ce-region">${escapeHtml(r.region)}</span>
          <span class="ce-direction" style="color:${trendColor(r.direction)}">${escapeHtml(r.directionLabel)}</span>
          <span class="ce-delta">${r.scoreBaseline} → ${r.scoreNow} (Δ${this.signed(r.delta)}, ${this.pctLabel(r.pctChange)})</span>
          <span class="ce-age">${escapeHtml(r.ageLabel)}</span>
        </div>`).join('');
    return `<section class="ce-section"><h3>Conflict Intensity Trends (30-day)</h3>${body}</section>`;
  }

  private stepChangeLabel(stepChange: number | null): string {
    if (stepChange === null) return '';
    if (stepChange === 0) return '→ no change';
    const magnitude = Math.abs(stepChange);
    const arrow = stepChange > 0 ? '↑' : '↓';
    return `${arrow} ${magnitude} rung${magnitude === 1 ? '' : 's'}`;
  }

  private buildLadderSection(rows: EscalationLadderRow[]): string {
    const body = rows.length === 0
      ? '<div class="ce-empty">Awaiting escalation-ladder observations</div>'
      : rows.map((r) => `
        <div class="ce-ladder-item">
          <span class="ce-dyad">${escapeHtml(r.dyad)}</span>
          <span class="ce-region">${escapeHtml(r.region)}</span>
          <span class="ce-rung" style="color:${rungColor(r.rung)}">${escapeHtml(r.rungLabel)}</span>
          <span class="ce-step">${escapeHtml(this.stepChangeLabel(r.stepChange))}</span>
          <span class="ce-age">${escapeHtml(r.ageLabel)}</span>
        </div>`).join('');
    return `<section class="ce-section"><h3>Escalation Ladder (7-rung)</h3>${body}</section>`;
  }

  private buildDeEscalationSection(rows: DeEscalationSignalRow[]): string {
    const rollup = deEscalationRollupScore(rows);
    const header = `<div class="ce-deesc-header">Cumulative de-escalation strength: ${rollup}/100</div>`;
    const body = rows.length === 0
      ? '<div class="ce-empty">Awaiting de-escalation observations</div>'
      : rows.map((r) => `
        <div class="ce-deesc-item">
          <span class="ce-dyad">${escapeHtml(r.dyad)}</span>
          <span class="ce-region">${escapeHtml(r.region)}</span>
          <span class="ce-kind">${escapeHtml(r.kindLabel)}</span>
          <span class="ce-weight">weight ${r.weight}</span>
          <span class="ce-confidence">conf ${r.confidence.toFixed(2)}</span>
          <span class="ce-description">${escapeHtml(r.description)}</span>
          <span class="ce-age">${escapeHtml(r.ageLabel)}</span>
        </div>`).join('');
    return `<section class="ce-section">
      <h3>De-escalation Signals</h3>
      ${header}
      ${body}
    </section>`;
  }
}
