/**
 * StateFragilityPanel — deep view of state-collapse risk.
 *
 * Six sections:
 *   1. FSI Composite Index — Fund-for-Peace-style 0–120 score with
 *      hottest-pillar callout for the top-10 most fragile states.
 *   2. Governance Indicators — corruption / judicial capture / press
 *      freedom / public services / postponed elections.
 *   3. Security Apparatus Breakdown — military fracture, paramilitary
 *      rise, security-force defection, territory loss.
 *   4. Economic Decline Markers — hyperinflation, currency collapse,
 *      sovereign default, FX-reserve depletion.
 *   5. Refugee / IDP Displacement — UNHCR-style internal + cross-border
 *      counts with trend deltas.
 *   6. Elite Fracture & Legitimacy — coups, purges, defections, and
 *      legitimacy-erosion proxies (protests, contested elections, etc).
 *
 * All pure logic lives in `state-fragility-helpers.ts`; this file is
 * the thin DOM-touching wrapper.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  FRAGILE_STATES,
  GOVERNANCE_SIGNALS,
  SECURITY_SIGNALS,
  ECONOMIC_MARKERS,
  DISPLACEMENT_PRESSURES,
  ELITE_FRACTURES,
  LEGITIMACY_PROXIES,
  fsiTier,
  fsiTierColor,
  fsiTierLabel,
  hottestIndicator,
  legitimacyScoreSeverity,
  severityColor,
  severityLabel,
  formatDelta,
  deltaColor,
  formatCount,
  formatTimeAgo,
  governanceLabel,
  securityLabel,
  economicLabel,
  displacementLabel,
  fractureLabel,
  legitimacyLabel,
  fragilityHeadlineCount,
  type FragileState,
  type GovernanceSignal,
  type SecurityBreakdownSignal,
  type EconomicMarker,
  type DisplacementPressure,
  type EliteFractureEvent,
  type LegitimacyProxy,
} from './state-fragility-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

export class StateFragilityPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'state-fragility',
      title: 'State Fragility',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Fund-for-Peace-style fragile-states composite: governance, security apparatus, economic decline, displacement pressure, elite fracture, and legitimacy erosion. 1-hour refresh.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private render(): void {
    this.setCount(fragilityHeadlineCount(FRAGILE_STATES, ELITE_FRACTURES, ECONOMIC_MARKERS));
    this.setContent(
      this.buildFsiSection()
      + this.buildGovernanceSection()
      + this.buildSecuritySection()
      + this.buildEconomicSection()
      + this.buildDisplacementSection()
      + this.buildEliteAndLegitimacySection(),
    );
  }

  private sectionHeader(title: string, source: string): string {
    return `<div style="display:flex;align-items:baseline;justify-content:space-between;margin:14px 0 6px;">
      <strong style="font-size:13px;">${escapeHtml(title)}</strong>
      <span style="font-size:10px;opacity:0.6;">Source: ${escapeHtml(source)}</span>
    </div>`;
  }

  // ── Section 1: FSI composite ─────────────────────────────────────────

  private buildFsiSection(): string {
    const sorted = [...FRAGILE_STATES].sort((a, b) => b.fsiScore - a.fsiScore).slice(0, 10);
    const rows = sorted.map((s: FragileState) => {
      const tier = fsiTier(s.fsiScore);
      const tierColor = fsiTierColor(tier);
      const hot = hottestIndicator(s);
      const hotLabel = hot === undefined ? '—' : `${hot.label} (${hot.score.toFixed(1)})`;
      const deltaC = deltaColor(s.yearDelta);
      return `<tr>
        <td style="padding:3px 6px;font-size:11px;opacity:0.7;width:24px;">#${s.rank}</td>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;">${escapeHtml(s.country)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:12px;font-weight:bold;color:${tierColor};width:50px;">${s.fsiScore.toFixed(1)}</td>
        <td style="padding:3px 6px;font-size:10px;text-transform:uppercase;color:${tierColor};width:120px;">${escapeHtml(fsiTierLabel(tier))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;color:${deltaC};width:60px;">${escapeHtml(formatDelta(s.yearDelta))}</td>
        <td style="padding:3px 6px;font-size:11px;opacity:0.8;">Hot driver: ${escapeHtml(hotLabel)}</td>
      </tr>`;
    }).join('');
    return `${this.sectionHeader('FSI Composite Index', 'Fund for Peace / FSI 2025')}
      <div style="font-size:11px;opacity:0.65;margin-bottom:4px;">12-indicator 0–120 composite; top 10 by score.</div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>`;
  }

  // ── Section 2: Governance ────────────────────────────────────────────

  private buildGovernanceSection(): string {
    const sorted = [...GOVERNANCE_SIGNALS].sort((a, b) => b.severity - a.severity);
    const rows = sorted.map((g: GovernanceSignal) => {
      const c = severityColor(g.severity);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${c};width:120px;">${escapeHtml(g.country)}</td>
        <td style="padding:3px 6px;font-size:11px;">${escapeHtml(governanceLabel(g.kind))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${c};width:80px;">${escapeHtml(severityLabel(g.severity))}</td>
      </tr>
      <tr>
        <td colspan="3" style="padding:0 6px 4px 6px;font-size:10px;opacity:0.65;border-bottom:1px solid #222;">${escapeHtml(g.detail)}</td>
      </tr>`;
    }).join('');
    return `${this.sectionHeader('Governance Indicators', 'V-Dem / RSF / TI / EIU')}
      <table style="width:100%;border-collapse:collapse;">${rows}</table>`;
  }

  // ── Section 3: Security apparatus ────────────────────────────────────

  private buildSecuritySection(): string {
    const sorted = [...SECURITY_SIGNALS].sort((a, b) => b.severity - a.severity);
    const rows = sorted.map((s: SecurityBreakdownSignal) => {
      const c = severityColor(s.severity);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${c};width:120px;">${escapeHtml(s.country)}</td>
        <td style="padding:3px 6px;font-size:11px;">${escapeHtml(securityLabel(s.kind))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${c};width:80px;">${escapeHtml(severityLabel(s.severity))}</td>
      </tr>
      <tr>
        <td colspan="3" style="padding:0 6px 4px 6px;font-size:10px;opacity:0.65;border-bottom:1px solid #222;">${escapeHtml(s.detail)}</td>
      </tr>`;
    }).join('');
    return `${this.sectionHeader('Security Apparatus Breakdown', 'ACLED / Crisis Group')}
      <table style="width:100%;border-collapse:collapse;">${rows}</table>`;
  }

  // ── Section 4: Economic decline ──────────────────────────────────────

  private buildEconomicSection(): string {
    const sorted = [...ECONOMIC_MARKERS].sort((a, b) => b.severity - a.severity);
    const rows = sorted.map((e: EconomicMarker) => {
      const c = severityColor(e.severity);
      const formatted = Number.isInteger(e.value) ? String(e.value) : e.value.toFixed(1);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${c};width:120px;">${escapeHtml(e.country)}</td>
        <td style="padding:3px 6px;font-size:11px;">${escapeHtml(economicLabel(e.kind))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;font-weight:600;color:${c};width:90px;">${escapeHtml(formatted)} ${escapeHtml(e.unit)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${c};width:80px;">${escapeHtml(severityLabel(e.severity))}</td>
      </tr>
      <tr>
        <td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;opacity:0.65;border-bottom:1px solid #222;">${escapeHtml(e.detail)}</td>
      </tr>`;
    }).join('');
    return `${this.sectionHeader('Economic Decline Markers', 'IMF / World Bank / national CB')}
      <table style="width:100%;border-collapse:collapse;">${rows}</table>`;
  }

  // ── Section 5: Displacement ──────────────────────────────────────────

  private buildDisplacementSection(): string {
    const sorted = [...DISPLACEMENT_PRESSURES].sort((a, b) => b.count - a.count);
    const rows = sorted.map((d: DisplacementPressure) => {
      const c = severityColor(d.severity);
      const trendC = deltaColor(d.trendDelta);
      let trendStr = '±0';
      if (d.trendDelta > 0) trendStr = `+${formatCount(d.trendDelta)}`;
      else if (d.trendDelta < 0) trendStr = `−${formatCount(Math.abs(d.trendDelta))}`;
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${c};width:120px;">${escapeHtml(d.country)}</td>
        <td style="padding:3px 6px;font-size:11px;">${escapeHtml(displacementLabel(d.kind))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;font-weight:600;width:80px;">${escapeHtml(formatCount(d.count))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;color:${trendC};width:60px;">${escapeHtml(trendStr)}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${c};width:80px;">${escapeHtml(severityLabel(d.severity))}</td>
      </tr>`;
    }).join('');
    return `${this.sectionHeader('Refugee & IDP Pressure', 'UNHCR / IOM DTM')}
      <div style="font-size:11px;opacity:0.65;margin-bottom:4px;">Trend = monthly delta; positive = worsening.</div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>`;
  }

  // ── Section 6: Elite fracture + legitimacy ───────────────────────────

  private buildEliteAndLegitimacySection(): string {
    const sortedF = [...ELITE_FRACTURES].sort((a, b) => b.severity - a.severity || b.timestamp - a.timestamp);
    const fractureRows = sortedF.map((f: EliteFractureEvent) => {
      const c = severityColor(f.severity);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;color:${c};width:120px;">${escapeHtml(f.country)}</td>
        <td style="padding:3px 6px;font-size:11px;">${escapeHtml(fractureLabel(f.kind))}</td>
        <td style="padding:3px 6px;font-size:11px;opacity:0.7;width:80px;">${escapeHtml(formatTimeAgo(f.timestamp))}</td>
        <td style="padding:3px 6px;text-align:right;font-size:10px;text-transform:uppercase;color:${c};width:80px;">${escapeHtml(severityLabel(f.severity))}</td>
      </tr>
      <tr>
        <td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;opacity:0.65;border-bottom:1px solid #222;">${escapeHtml(f.detail)}</td>
      </tr>`;
    }).join('');

    const sortedL = [...LEGITIMACY_PROXIES].sort((a, b) => b.score - a.score);
    const legitimacyRows = sortedL.map((l: LegitimacyProxy) => {
      const sev = legitimacyScoreSeverity(l.score);
      const c = severityColor(sev);
      const barWidth = Math.min(100, l.score);
      return `<tr>
        <td style="padding:3px 6px;font-size:12px;font-weight:600;width:120px;">${escapeHtml(l.country)}</td>
        <td style="padding:3px 6px;font-size:11px;">${escapeHtml(legitimacyLabel(l.kind))}</td>
        <td style="padding:3px 6px;width:80px;">
          <div style="background:#222;border-radius:2px;height:6px;">
            <div style="background:${c};width:${barWidth}%;height:6px;border-radius:2px;"></div>
          </div>
        </td>
        <td style="padding:3px 6px;text-align:right;font-size:11px;font-weight:600;color:${c};width:40px;">${l.score}</td>
      </tr>
      <tr>
        <td colspan="4" style="padding:0 6px 4px 6px;font-size:10px;opacity:0.65;border-bottom:1px solid #222;">${escapeHtml(l.detail)}</td>
      </tr>`;
    }).join('');

    return `${this.sectionHeader('Elite Fracture Events', 'ACLED / Polity / news ledger')}
      <table style="width:100%;border-collapse:collapse;">${fractureRows}</table>
      ${this.sectionHeader('Legitimacy Erosion Proxies', 'V-Dem / RSF / CIVICUS')}
      <div style="font-size:11px;opacity:0.65;margin-bottom:4px;">0 stable → 100 collapsing.</div>
      <table style="width:100%;border-collapse:collapse;">${legitimacyRows}</table>`;
  }
}
