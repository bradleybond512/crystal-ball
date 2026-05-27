/* eslint-disable sonarjs/no-nested-conditional, unicorn/no-nested-ternary */
import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  assessPandemicPreparedness,
  computeRiskTier,
  isStockpileConcerning,
  scoreLabel,
  DEFAULT_PANDEMIC_INPUT,
  type PandemicInput,
  type PandemicPreparednessAssessment,
  type PandemicRiskTier,
  type GhsIndexScore,
  type VaccineStockpile,
  type SurgeCapacity,
  type EarlyWarningCoverage,
  type CrossBorderCoordination,
} from '../services/pandemic/pandemic-preparedness-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

const TIER_COLOR: Record<PandemicRiskTier, string> = {
  critical: '#d50000',
  high:     '#ff9800',
  moderate: '#ffeb3b',
  low:      '#4caf50',
  minimal:  '#1565c0',
};

const TIER_LABEL: Record<PandemicRiskTier, string> = {
  critical: 'CRITICAL',
  high:     'HIGH',
  moderate: 'MODERATE',
  low:      'LOW',
  minimal:  'MINIMAL',
};

export class PandemicPreparednessPanel extends Panel {
  private assessment: PandemicPreparednessAssessment | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'pandemic-preparedness',
      title: 'Pandemic Preparedness',
      showCount: false,
      trackActivity: false,
      infoTooltip:
        'Global pandemic preparedness based on GHS Index scores, vaccine stockpile adequacy, ' +
        'surge capacity, IHR compliance, early-warning coverage, and cross-border coordination. ' +
        'Refreshed every hour from static baseline data (2023-2024 GHS/WHO).',
    });
    this.refresh();
    this.refreshTimer = setInterval(() => { this.refresh(); }, REFRESH_MS);
  }

  public override dispose(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** Allow the host / tests to inject live data instead of defaults. */
  public setInput(input: PandemicInput): void {
    this.assessment = assessPandemicPreparedness(input);
    this.render();
  }

  private refresh(): void {
    this.assessment = assessPandemicPreparedness(DEFAULT_PANDEMIC_INPUT);
    this.render();
  }

  private render(): void {
    if (!this.assessment) {
      this.setContent('<div class="panel-empty">Loading pandemic preparedness data…</div>');
      return;
    }
    this.setContent(this.buildHtml(this.assessment));
  }

  private buildHtml(a: PandemicPreparednessAssessment): string {
    return `
<div class="pp-panel" style="font-size:12px;line-height:1.45;">
  ${this.renderHeader(a)}
  ${this.renderVulnerabilities(a)}
  ${this.renderGhsTables(a)}
  ${this.renderVaccineStockpiles(a)}
  ${this.renderSurgeCapacity(a)}
  ${this.renderIhrCompliance(a)}
  ${this.renderEarlyWarning(a)}
  ${this.renderCoordination(a)}
  <div class="fires-footer" style="margin-top:8px;">
    <span class="fires-source">GHS Index 2023 · WHO IHR · CDC/ECDC</span>
    <span class="fires-updated">As of ${escapeHtml(a.lastUpdated)}</span>
  </div>
</div>`.trim();
  }

  // ── Header ──────────────────────────────────────────────────────────────

  private renderHeader(a: PandemicPreparednessAssessment): string {
    const color = TIER_COLOR[a.riskTier];
    const label = TIER_LABEL[a.riskTier];
    return `
<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,0.04);border-radius:6px;margin-bottom:8px;">
  <div style="flex:1;">
    <div style="font-size:13px;font-weight:600;color:var(--text-primary,#fff);">Global Readiness</div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);">${escapeHtml(scoreLabel(a.globalReadinessScore))}</div>
  </div>
  <div style="text-align:right;">
    <span class="sev-badge" style="background:${color};color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;">${escapeHtml(label)}</span>
    <div style="font-size:22px;font-weight:700;color:${color};line-height:1.2;">${a.globalReadinessScore}</div>
    <div style="font-size:10px;color:var(--text-secondary,#aaa);">/ 100</div>
  </div>
</div>`.trim();
  }

  // ── Vulnerabilities ──────────────────────────────────────────────────────

  private renderVulnerabilities(a: PandemicPreparednessAssessment): string {
    if (a.topVulnerabilities.length === 0) {
      return '<div style="margin-bottom:8px;color:var(--text-secondary,#aaa);font-style:italic;">No critical vulnerabilities identified.</div>';
    }
    const items = a.topVulnerabilities
      .map(v => `<li style="margin-bottom:3px;">${escapeHtml(v)}</li>`)
      .join('');
    return `
<div style="margin-bottom:8px;">
  <div class="pp-section-title" style="font-weight:600;margin-bottom:4px;color:#ff9800;">Top Vulnerabilities</div>
  <ul style="margin:0;padding-left:16px;color:var(--text-primary,#e0e0e0);">${items}</ul>
</div>`.trim();
  }

  // ── GHS Tables ───────────────────────────────────────────────────────────

  private renderGhsTables(a: PandemicPreparednessAssessment): string {
    return `
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
  ${this.renderGhsTable('Leaders', a.ghsLeaders, true)}
  ${this.renderGhsTable('Laggards', a.ghsLaggards, false)}
</div>`.trim();
  }

  private renderGhsTable(title: string, scores: GhsIndexScore[], isLeader: boolean): string {
    const headerColor = isLeader ? '#4caf50' : '#f44336';
    const rows = scores.map(s => {
      const barWidth = Math.round(s.overallScore);
      const barColor = isLeader ? '#4caf50' : '#f44336';
      return `<tr>
        <td style="padding:2px 4px;white-space:nowrap;">${escapeHtml(s.iso3)}</td>
        <td style="padding:2px 4px;width:100%;">
          <div style="background:rgba(255,255,255,0.08);border-radius:2px;height:8px;position:relative;">
            <div style="background:${barColor};width:${barWidth}%;height:100%;border-radius:2px;"></div>
          </div>
        </td>
        <td style="padding:2px 4px;text-align:right;font-weight:600;">${s.overallScore.toFixed(0)}</td>
      </tr>`;
    }).join('');

    return `
<div>
  <div style="font-weight:600;color:${headerColor};margin-bottom:4px;">GHS ${escapeHtml(title)}</div>
  <table style="width:100%;border-collapse:collapse;font-size:11px;">
    <tbody>${rows}</tbody>
  </table>
</div>`.trim();
  }

  // ── Vaccine Stockpiles ───────────────────────────────────────────────────

  private renderVaccineStockpiles(a: PandemicPreparednessAssessment): string {
    const rows = a.vaccineAdequacy.map(v => this.renderStockpileRow(v)).join('');
    return `
<div style="margin-bottom:8px;">
  <div class="pp-section-title" style="font-weight:600;margin-bottom:4px;">Vaccine Stockpiles</div>
  <table style="width:100%;border-collapse:collapse;font-size:11px;">
    <thead>
      <tr style="color:var(--text-secondary,#aaa);border-bottom:1px solid rgba(255,255,255,0.08);">
        <th style="text-align:left;padding:2px 4px;">Pathogen</th>
        <th style="text-align:center;padding:2px 4px;">Coverage</th>
        <th style="text-align:center;padding:2px 4px;">Stock</th>
        <th style="text-align:center;padding:2px 4px;">Expiry</th>
        <th style="text-align:center;padding:2px 4px;">Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>`.trim();
  }

  private renderStockpileRow(v: VaccineStockpile): string {
    const concerning = isStockpileConcerning(v);
    const statusColor = concerning ? '#ff9800' : '#4caf50';
    const statusLabel = concerning ? 'GAP' : 'OK';
    const expiryColor = v.expiryRisk === 'high' ? '#f44336' : v.expiryRisk === 'medium' ? '#ff9800' : '#4caf50';
    const coveragePct = Math.round(v.dosesCoverage * 100);
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
      <td style="padding:3px 4px;">${escapeHtml(v.pathogen)}</td>
      <td style="padding:3px 4px;text-align:center;">${coveragePct}%</td>
      <td style="padding:3px 4px;text-align:center;">${v.daysOfStock}d</td>
      <td style="padding:3px 4px;text-align:center;color:${expiryColor};font-weight:600;">${escapeHtml(v.expiryRisk.toUpperCase())}</td>
      <td style="padding:3px 4px;text-align:center;color:${statusColor};font-weight:600;">${statusLabel}</td>
    </tr>`;
  }

  // ── Surge Capacity ───────────────────────────────────────────────────────

  private renderSurgeCapacity(a: PandemicPreparednessAssessment): string {
    const rows = a.surgeCapacities.map(r => this.renderSurgeRow(r)).join('');
    return `
<div style="margin-bottom:8px;">
  <div class="pp-section-title" style="font-weight:600;margin-bottom:4px;">Surge Capacity by Region</div>
  <table style="width:100%;border-collapse:collapse;font-size:11px;">
    <thead>
      <tr style="color:var(--text-secondary,#aaa);border-bottom:1px solid rgba(255,255,255,0.08);">
        <th style="text-align:left;padding:2px 4px;">Region</th>
        <th style="text-align:center;padding:2px 4px;">ICU/M</th>
        <th style="text-align:center;padding:2px 4px;">Vent/100k</th>
        <th style="text-align:center;padding:2px 4px;">HW/1k</th>
        <th style="text-align:center;padding:2px 4px;">Score</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>`.trim();
  }

  private renderSurgeRow(r: SurgeCapacity): string {
    const tier = computeRiskTier(r.surgeReadinessScore);
    const color = TIER_COLOR[tier];
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
      <td style="padding:3px 4px;">${escapeHtml(r.region)}</td>
      <td style="padding:3px 4px;text-align:center;">${r.icuBedsPerMillion}</td>
      <td style="padding:3px 4px;text-align:center;">${r.ventilatorsPer100k}</td>
      <td style="padding:3px 4px;text-align:center;">${r.healthWorkersPerThousand.toFixed(1)}</td>
      <td style="padding:3px 4px;text-align:center;color:${color};font-weight:600;">${r.surgeReadinessScore}</td>
    </tr>`;
  }

  // ── IHR Compliance ───────────────────────────────────────────────────────

  private renderIhrCompliance(a: PandemicPreparednessAssessment): string {
    const rows = a.ihrCompliance.map(r => {
      const tier = computeRiskTier(r.capacityScore);
      const color = TIER_COLOR[tier];
      return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
        <td style="padding:3px 4px;">${escapeHtml(r.country)}</td>
        <td style="padding:3px 4px;text-align:center;">${r.surveillanceScore}</td>
        <td style="padding:3px 4px;text-align:center;">${r.responseScore}</td>
        <td style="padding:3px 4px;text-align:center;">${r.coordinationScore}</td>
        <td style="padding:3px 4px;text-align:center;color:${color};font-weight:600;">${r.capacityScore}</td>
        <td style="padding:3px 4px;text-align:center;color:var(--text-secondary,#aaa);">${r.lastReportYear}</td>
      </tr>`;
    }).join('');
    return `
<div style="margin-bottom:8px;">
  <div class="pp-section-title" style="font-weight:600;margin-bottom:4px;">IHR Compliance</div>
  <table style="width:100%;border-collapse:collapse;font-size:11px;">
    <thead>
      <tr style="color:var(--text-secondary,#aaa);border-bottom:1px solid rgba(255,255,255,0.08);">
        <th style="text-align:left;padding:2px 4px;">Country</th>
        <th style="text-align:center;padding:2px 4px;">Surv.</th>
        <th style="text-align:center;padding:2px 4px;">Resp.</th>
        <th style="text-align:center;padding:2px 4px;">Coord.</th>
        <th style="text-align:center;padding:2px 4px;">Score</th>
        <th style="text-align:center;padding:2px 4px;">Year</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>`.trim();
  }

  // ── Early Warning ────────────────────────────────────────────────────────

  private renderEarlyWarning(a: PandemicPreparednessAssessment): string {
    const rows = a.earlyWarningCoverage.map(w => this.renderWarningRow(w)).join('');
    return `
<div style="margin-bottom:8px;">
  <div class="pp-section-title" style="font-weight:600;margin-bottom:4px;">Early Warning Coverage</div>
  <table style="width:100%;border-collapse:collapse;font-size:11px;">
    <thead>
      <tr style="color:var(--text-secondary,#aaa);border-bottom:1px solid rgba(255,255,255,0.08);">
        <th style="text-align:left;padding:2px 4px;">Region</th>
        <th style="text-align:center;padding:2px 4px;">Sentinel</th>
        <th style="text-align:center;padding:2px 4px;">Lab Net</th>
        <th style="text-align:center;padding:2px 4px;">Timeliness</th>
        <th style="text-align:center;padding:2px 4px;">Zoonotic</th>
        <th style="text-align:center;padding:2px 4px;">EBS</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>`.trim();
  }

  private renderWarningRow(w: EarlyWarningCoverage): string {
    const sentinelPct = Math.round(w.sentinelSitesCoverage * 100);
    const labPct = Math.round(w.labNetworkCoverage * 100);
    const yesNo = (v: boolean) =>
      v ? '<span style="color:#4caf50;">Yes</span>' : '<span style="color:#f44336;">No</span>';
    const timeColor = w.reportingTimelinessScore >= 70 ? '#4caf50' : w.reportingTimelinessScore >= 50 ? '#ff9800' : '#f44336';
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
      <td style="padding:3px 4px;">${escapeHtml(w.region)}</td>
      <td style="padding:3px 4px;text-align:center;">${sentinelPct}%</td>
      <td style="padding:3px 4px;text-align:center;">${labPct}%</td>
      <td style="padding:3px 4px;text-align:center;color:${timeColor};font-weight:600;">${w.reportingTimelinessScore}</td>
      <td style="padding:3px 4px;text-align:center;">${yesNo(w.zoonoticSurveillance)}</td>
      <td style="padding:3px 4px;text-align:center;">${yesNo(w.eventBasedSurveillance)}</td>
    </tr>`;
  }

  // ── Cross-Border Coordination ────────────────────────────────────────────

  private renderCoordination(a: PandemicPreparednessAssessment): string {
    const rows = a.crossBorderCoordination.map(c => this.renderCoordRow(c)).join('');
    return `
<div style="margin-bottom:8px;">
  <div class="pp-section-title" style="font-weight:600;margin-bottom:4px;">Cross-Border Coordination</div>
  <table style="width:100%;border-collapse:collapse;font-size:11px;">
    <thead>
      <tr style="color:var(--text-secondary,#aaa);border-bottom:1px solid rgba(255,255,255,0.08);">
        <th style="text-align:left;padding:2px 4px;">Region</th>
        <th style="text-align:center;padding:2px 4px;">Exercises</th>
        <th style="text-align:center;padding:2px 4px;">Agreements</th>
        <th style="text-align:center;padding:2px 4px;">RRT</th>
        <th style="text-align:center;padding:2px 4px;">Score</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>`.trim();
  }

  private renderCoordRow(c: CrossBorderCoordination): string {
    const tier = computeRiskTier(c.coordinationScore);
    const color = TIER_COLOR[tier];
    const rrt = c.rapidResponseTeamAvailable
      ? '<span style="color:#4caf50;">Yes</span>'
      : '<span style="color:#f44336;">No</span>';
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
      <td style="padding:3px 4px;">${escapeHtml(c.region)}</td>
      <td style="padding:3px 4px;text-align:center;">${c.jointExercisesLast2Years}</td>
      <td style="padding:3px 4px;text-align:center;">${c.informationSharingAgreements}</td>
      <td style="padding:3px 4px;text-align:center;">${rrt}</td>
      <td style="padding:3px 4px;text-align:center;color:${color};font-weight:600;">${c.coordinationScore}</td>
    </tr>`;
  }
}
