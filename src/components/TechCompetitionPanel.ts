/**
 * Tech Competition panel — seven sections covering the surfaces that
 * shape great-power technology rivalry:
 *
 *   1. Semiconductor export control events
 *   2. AI compute restriction signals
 *   3. 5G infrastructure battles by country
 *   4. Quantum computing milestone tracker
 *   5. Tech decoupling indicators
 *   6. Dual-use tech transfer cases
 *   7. Chip fab capacity distribution
 *
 * Live observation-store queries are wrapped in safe() so the panel always
 * renders from static data even before any live data has loaded.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { query } from '@/services/intelligence/observation-store';
import {
  severityColor,
  postureColor,
  postureLabel,
  exportScopeLabel,
  aiRestrictionLabel,
  vendorLabel,
  quantumMilestoneLabel,
  decouplingDomainLabel,
  dualUseDomainLabel,
  trendArrow,
  trendColor,
  formatThreshold,
  formatSharePct,
  formatQubits,
  totalEscalationCount,
  EXPORT_CONTROL_EVENTS,
  AI_COMPUTE_RESTRICTIONS,
  FIVEG_COUNTRY_STATUS,
  QUANTUM_MILESTONES,
  DECOUPLING_INDICATORS,
  DUAL_USE_TRANSFER_CASES,
  CHIP_FAB_CAPACITY,
  type ExportControlEvent,
  type AiComputeRestriction,
  type FiveGCountryStatus,
  type QuantumMilestone,
  type DecouplingIndicator,
  type DualUseTransferCase,
  type ChipFabCapacity,
} from './tech-competition-helpers';

const REFRESH_MS = 30 * 60 * 1000;

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

export class TechCompetitionPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'tech-competition',
      title: 'Tech Competition',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Great-power tech rivalry: semiconductor controls, AI compute restrictions, 5G, quantum, decoupling, dual-use transfers, fab capacity.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  private render(): void {
    const liveEvents = safe(() => query({ domain: 'cyber', limit: 50 })) ?? [];
    const liveHigh = liveEvents.filter((e) => e.severity === 'HIGH' || e.severity === 'CRITICAL').length;

    const badge = totalEscalationCount({
      exportControls: EXPORT_CONTROL_EVENTS,
      aiRestrictions: AI_COMPUTE_RESTRICTIONS,
      fiveG: FIVEG_COUNTRY_STATUS,
      quantum: QUANTUM_MILESTONES,
      decoupling: DECOUPLING_INDICATORS,
      transfers: DUAL_USE_TRANSFER_CASES,
    });

    this.setCount(badge + liveHigh);
    this.setContent(this.buildHtml());
  }

  private buildHtml(): string {
    return `<div class="tcp-root">${[
      this.buildExportControlSection(),
      this.buildAiRestrictionSection(),
      this.buildFiveGSection(),
      this.buildQuantumSection(),
      this.buildDecouplingSection(),
      this.buildTransferSection(),
      this.buildFabCapacitySection(),
    ].join('')}</div>`;
  }

  // ── Section 1: Semiconductor Export Controls ─────────────────────────

  private buildExportControlSection(): string {
    const rows = EXPORT_CONTROL_EVENTS.map((e: ExportControlEvent) => {
      const sev = severityColor(e.severity);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${sev}">${escapeHtml(e.issuingCountry)} → ${escapeHtml(e.targetCountry)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(exportScopeLabel(e.scope))}</td>
        <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(e.reference)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;color:#9e9e9e">${escapeHtml(e.announcedAt)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${sev}">${e.severity}</td>
      </tr>
      <tr>
        <td colspan="5" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(e.detail)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="tcp-section">
        <div class="tcp-section-header">Semiconductor Export Controls</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Issuer → Target · scope · reference · date</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 2: AI Compute Restrictions ───────────────────────────────

  private buildAiRestrictionSection(): string {
    const rows = AI_COMPUTE_RESTRICTIONS.map((r: AiComputeRestriction) => {
      const sev = severityColor(r.severity);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${sev}">${escapeHtml(aiRestrictionLabel(r.kind))}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(r.issuingCountry)} → ${escapeHtml(r.targetCountry)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;color:#ccc">${escapeHtml(formatThreshold(r.thresholdValue, r.thresholdUnit))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${sev}">${r.severity}</td>
      </tr>
      <tr>
        <td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(r.detail)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="tcp-section">
        <div class="tcp-section-header">AI Compute Restrictions</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Restriction type · issuer → target · threshold</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 3: 5G Infrastructure ─────────────────────────────────────

  private buildFiveGSection(): string {
    const rows = FIVEG_COUNTRY_STATUS.map((s: FiveGCountryStatus) => {
      const color = postureColor(s.huaweiPosture);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(s.countryName)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(vendorLabel(s.primaryVendor))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;color:#ccc">${s.coveragePct}%</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${color}">${escapeHtml(postureLabel(s.huaweiPosture))}</td>
      </tr>
      <tr>
        <td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(s.note)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="tcp-section">
        <div class="tcp-section-header">5G Infrastructure by Country</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Country · primary vendor · coverage · Huawei posture</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 4: Quantum Milestones ────────────────────────────────────

  private buildQuantumSection(): string {
    const rows = QUANTUM_MILESTONES.map((m: QuantumMilestone) => {
      const verifiedColor = m.peerReviewed ? '#43a047' : '#fb8c00';
      const verifiedLabel = m.peerReviewed ? 'verified' : 'unverified';
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(m.org)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(m.countryCode)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(quantumMilestoneLabel(m.kind))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;color:#ccc">${escapeHtml(formatQubits(m.qubits))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${verifiedColor}">${verifiedLabel}</td>
      </tr>
      <tr>
        <td colspan="5" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(m.announcedAt)} · ${escapeHtml(m.detail)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="tcp-section">
        <div class="tcp-section-header">Quantum Computing Milestones</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Org · country · kind · qubits · verification</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 5: Decoupling Indicators ─────────────────────────────────

  private buildDecouplingSection(): string {
    const rows = DECOUPLING_INDICATORS.map((d: DecouplingIndicator) => {
      let intensityColor = '#43a047';
      if (d.intensity >= 60) intensityColor = '#b71c1c';
      else if (d.intensity >= 30) intensityColor = '#fb8c00';
      const tColor = trendColor(d.trend);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(d.countryPair)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(decouplingDomainLabel(d.domain))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;color:${intensityColor}">${d.intensity}</td>
        <td style="padding:3px 6px;text-align:right;font-size:13px;color:${tColor}">${trendArrow(d.trend)}</td>
      </tr>
      <tr>
        <td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(d.detail)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="tcp-section">
        <div class="tcp-section-header">Decoupling Indicators</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Country pair · domain · intensity (0-100) · trend</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 6: Dual-Use Transfer Cases ───────────────────────────────

  private buildTransferSection(): string {
    const rows = DUAL_USE_TRANSFER_CASES.map((c: DualUseTransferCase) => {
      const sev = severityColor(c.severity);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${sev}">${escapeHtml(c.caseId)}</td>
        <td style="padding:3px 6px;font-size:11px;color:#ccc">${escapeHtml(dualUseDomainLabel(c.domain))}</td>
        <td style="padding:3px 6px;font-size:11px;color:#9e9e9e">${escapeHtml(c.originCountry)} → ${escapeHtml(c.destinationCountry)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:#ccc">${escapeHtml(c.status)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${sev}">${c.severity}</td>
      </tr>
      <tr>
        <td colspan="5" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(c.detail)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="tcp-section">
        <div class="tcp-section-header">Dual-Use Transfer Cases</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Case ID · domain · origin → destination · status</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }

  // ── Section 7: Chip Fab Capacity ─────────────────────────────────────

  private buildFabCapacitySection(): string {
    const rows = CHIP_FAB_CAPACITY.map((f: ChipFabCapacity) => {
      let leadColor = '#9e9e9e';
      if (f.leadingEdgeShare >= 50) leadColor = '#b71c1c';
      else if (f.leadingEdgeShare >= 5) leadColor = '#fb8c00';
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600">${escapeHtml(f.countryName)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;color:${leadColor}">${escapeHtml(formatSharePct(f.leadingEdgeShare))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;color:#ccc">${escapeHtml(formatSharePct(f.matureNodeShare))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;color:#ccc">${f.leadingEdgeFabs}</td>
      </tr>
      <tr>
        <td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222">${escapeHtml(f.note)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="tcp-section">
        <div class="tcp-section-header">Chip Fab Capacity Distribution</div>
        <div style="font-size:11px;color:#9e9e9e;margin-bottom:4px">Leading-edge share · mature-node share · sub-7nm fabs</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
  }
}
