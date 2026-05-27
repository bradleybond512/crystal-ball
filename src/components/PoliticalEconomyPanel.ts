/**
 * Political Economy Panel — democratic backsliding, kleptocracy risk,
 * state capacity, elite capture, and sovereign wealth fund opacity.
 *
 * Data model: PoliticalEconomySnapshot injected via setSnapshot(). The panel
 * renders deterministically from the snapshot; no live fetch occurs here.
 *
 * Refresh: set by panel-layout.ts at 1-hour cadence. Alerts are emitted
 * for crisis-tier backsliding, extreme kleptocracy, and opaque high-AUM SWFs.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  generateAlerts,
  rankCountriesByRisk,
  type PoliticalEconomySnapshot,
  type DemocraticBackslidingScore,
  type PoliticalStabilityIndicator,
  type SovereignWealthFundProfile,
  type StateCapacityScore,
  type BackslidingTrend,
  type KleptocracyRisk,
  type SovereignFundOpacity,
  type PoliticalEconomyAlert,
} from '@/services/political-economy/political-economy-helpers';

// ── Color palettes ─────────────────────────────────────────────────────────

const TREND_INDICATOR: Record<BackslidingTrend, { icon: string; color: string }> = {
  improving:     { icon: '🟢', color: '#4caf50' },
  stable:        { icon: '🟡', color: '#ffeb3b' },
  deteriorating: { icon: '🔴', color: '#ff9800' },
  crisis:        { icon: '🔴', color: '#d50000' },
};

const KLEPTOCRACY_COLOR: Record<KleptocracyRisk, string> = {
  low:      '#4caf50',
  moderate: '#ffeb3b',
  high:     '#ff9800',
  extreme:  '#d50000',
};

const OPACITY_COLOR: Record<SovereignFundOpacity, string> = {
  transparent: '#4caf50',
  partial:     '#ffeb3b',
  opaque:      '#ff9800',
  unknown:     '#888',
};

const FRAGILITY_COLOR: Record<StateCapacityScore['fragileStateRisk'], string> = {
  stable:   '#4caf50',
  warning:  '#ffeb3b',
  alert:    '#ff9800',
  critical: '#d50000',
};

const FRESHNESS_LABEL: Record<PoliticalEconomySnapshot['dataFreshness'], string> = {
  fresh:      '● Fresh',
  stale:      '◐ Stale',
  very_stale: '○ Very stale',
};

const FRESHNESS_COLOR: Record<PoliticalEconomySnapshot['dataFreshness'], string> = {
  fresh:      '#4caf50',
  stale:      '#ffeb3b',
  very_stale: '#ff9800',
};

const ALERT_BG: Record<PoliticalEconomyAlert['severity'], string> = {
  info:     'rgba(33,150,243,0.10)',
  warning:  'rgba(255,152,0,0.12)',
  critical: 'rgba(213,0,0,0.12)',
};

const ALERT_BORDER: Record<PoliticalEconomyAlert['severity'], string> = {
  info:     'rgba(33,150,243,0.30)',
  warning:  'rgba(255,152,0,0.35)',
  critical: 'rgba(213,0,0,0.35)',
};

const ALERT_ICON: Record<PoliticalEconomyAlert['severity'], string> = {
  info:     'ℹ️',
  warning:  '⚠️',
  critical: '🔴',
};

// ── Panel ─────────────────────────────────────────────────────────────────

export class PoliticalEconomyPanel extends Panel {
  private snapshot: PoliticalEconomySnapshot | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'political-economy',
      title: 'Political Economy',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Democratic backsliding index, state capacity, kleptocracy risk, elite capture signals, ' +
        'and sovereign wealth fund opacity across monitored countries. ' +
        'Score 0–100: higher = more democratic. Alerts fire for crisis-tier backsliding (<30), ' +
        'extreme kleptocracy, opaque SWFs >$50B AUM.',
    });

    this.showLoading('Loading political economy data…');
  }

  /** Inject a new snapshot and re-render. */
  public setSnapshot(snapshot: PoliticalEconomySnapshot): void {
    this.snapshot = snapshot;
    this.render();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private render(): void {
    if (!this.snapshot) {
      this.showLoading('Awaiting data…');
      return;
    }

    const snap = this.snapshot;
    const alerts = generateAlerts(snap);
    const criticalAlerts = alerts.filter((a) => a.severity === 'critical');
    const warningAlerts  = alerts.filter((a) => a.severity === 'warning');

    this.setCount(criticalAlerts.length + warningAlerts.length);

    const rankedCodes = rankCountriesByRisk(snap.highRiskCountries, snap.stabilityIndicators);

    const html = [
      this.buildStatusBar(snap, alerts),
      alerts.length > 0 ? this.buildAlertBanner(alerts) : '',
      this.buildBackslidingSection(snap, rankedCodes),
      this.buildStateCapacitySection(snap),
      this.buildStabilitySection(snap, rankedCodes),
      this.buildSWFSection(snap),
    ].join('');

    this.setContent(html);
  }

  // ── Status bar ────────────────────────────────────────────────────────

  private buildStatusBar(
    snap: PoliticalEconomySnapshot,
    alerts: PoliticalEconomyAlert[],
  ): string {
    const freshnessColor = FRESHNESS_COLOR[snap.dataFreshness];
    const freshnessLabel = FRESHNESS_LABEL[snap.dataFreshness];
    const confidencePct  = (snap.systemConfidence * 100).toFixed(0);
    const indexScore     = snap.globalBackslidingIndex.toFixed(1);

    // Global index traffic light
    const indexColor =
      snap.globalBackslidingIndex >= 60 ? '#4caf50' :
      snap.globalBackslidingIndex >= 40 ? '#ffeb3b' :
      snap.globalBackslidingIndex >= 25 ? '#ff9800' : '#d50000';

    const alertSummary = alerts.length === 0
      ? '<span style="color:#4caf50;font-weight:600;">No alerts</span>'
      : `<span style="color:#ff9800;font-weight:600;">${alerts.length} alert${alerts.length === 1 ? '' : 's'}</span>`;

    return `
      <div style="
        display:flex;flex-wrap:wrap;gap:8px;align-items:center;
        padding:10px 12px;border-bottom:1px solid var(--border-subtle,#2a2a2a);
        background:var(--bg-elevated,rgba(255,255,255,0.02));
        font-size:11px;
      ">
        <div style="display:flex;flex-direction:column;min-width:90px;">
          <span style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;">Global Index</span>
          <span style="color:${indexColor};font-weight:700;font-size:18px;font-family:ui-monospace,monospace;line-height:1.2;">${indexScore}</span>
          <span style="color:#666;font-size:10px;">out of 100</span>
        </div>
        <div style="flex:1;display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:flex-end;">
          <span>${alertSummary}</span>
          <span style="color:#666;">Confidence:
            <strong style="color:#ccc;">${confidencePct}%</strong>
          </span>
          <span style="color:${freshnessColor};font-size:10px;">${escapeHtml(freshnessLabel)}</span>
        </div>
      </div>`;
  }

  // ── Alert banner ──────────────────────────────────────────────────────

  private buildAlertBanner(alerts: PoliticalEconomyAlert[]): string {
    const rows = alerts
      .slice(0, 6)
      .map((a) => {
        const bg     = ALERT_BG[a.severity];
        const border = ALERT_BORDER[a.severity];
        const icon   = ALERT_ICON[a.severity];
        return `
          <div style="
            background:${bg};border:1px solid ${border};
            border-radius:3px;padding:7px 10px;margin:4px 0;
          ">
            <div style="font-weight:600;font-size:11px;margin-bottom:2px;">
              ${icon} ${escapeHtml(a.title)}
            </div>
            <div style="color:#aaa;font-size:10px;">${escapeHtml(a.detail)}</div>
          </div>`;
      })
      .join('');

    return `
      <div style="padding:8px 10px;border-bottom:1px solid var(--border-subtle,#2a2a2a);">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-bottom:4px;">Active Alerts</div>
        ${rows}
      </div>`;
  }

  // ── Democratic backsliding section ────────────────────────────────────

  private buildBackslidingSection(
    snap: PoliticalEconomySnapshot,
    rankedCodes: string[],
  ): string {
    const sorted = [...snap.highRiskCountries].sort((a, b) => {
      const ra = rankedCodes.indexOf(a.countryCode);
      const rb = rankedCodes.indexOf(b.countryCode);
      return (ra === -1 ? 999 : ra) - (rb === -1 ? 999 : rb);
    });

    if (sorted.length === 0) {
      return this.buildEmptySection('Democratic Backsliding Index', 'No country data loaded.');
    }

    const rows = sorted
      .slice(0, 10)
      .map((c) => this.buildBackslidingRow(c))
      .join('');

    return `
      <div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#2a2a2a);">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-bottom:6px;">
          Democratic Backsliding Index
        </div>
        <table role="table" style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr style="color:#666;border-bottom:1px solid var(--border-subtle,#222);">
              <th scope="col" style="padding:4px 6px;font-weight:600;text-align:left;">Country</th>
              <th scope="col" style="padding:4px 6px;font-weight:600;text-align:right;">Score</th>
              <th scope="col" style="padding:4px 6px;font-weight:600;text-align:center;">Trend</th>
              <th scope="col" style="padding:4px 6px;font-weight:600;text-align:right;">Confidence</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  private buildBackslidingRow(c: DemocraticBackslidingScore): string {
    const { icon, color } = TREND_INDICATOR[c.trend];
    const scoreColor =
      c.score >= 60 ? '#4caf50' :
      c.score >= 40 ? '#ffeb3b' :
      c.score >= 25 ? '#ff9800' : '#d50000';
    const confidencePct = (c.confidence * 100).toFixed(0);
    const deltaSign = c.trendDelta >= 0 ? '+' : '';

    return `
      <tr style="border-bottom:1px solid var(--border-subtle,#1e1e1e);">
        <td style="padding:5px 6px;font-weight:600;">${escapeHtml(c.countryName)}
          <span style="color:#555;font-size:9px;margin-left:3px;">${escapeHtml(c.countryCode)}</span>
        </td>
        <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,monospace;font-weight:700;color:${scoreColor};">
          ${c.score.toFixed(0)}
          <span style="color:#555;font-size:9px;margin-left:2px;">(${deltaSign}${c.trendDelta.toFixed(1)})</span>
        </td>
        <td style="padding:5px 6px;text-align:center;" title="${escapeHtml(c.trend)}">
          ${icon} <span style="color:${color};font-size:9px;">${escapeHtml(c.trend)}</span>
        </td>
        <td style="padding:5px 6px;text-align:right;color:#888;">${confidencePct}%</td>
      </tr>`;
  }

  // ── State capacity section ────────────────────────────────────────────

  private buildStateCapacitySection(snap: PoliticalEconomySnapshot): string {
    if (snap.stateCapacityAlerts.length === 0) {
      return this.buildEmptySection('State Capacity', 'No state capacity data loaded.');
    }

    const sorted = [...snap.stateCapacityAlerts].sort((a, b) => a.overallScore - b.overallScore);

    const rows = sorted
      .slice(0, 8)
      .map((cap) => {
        const color = FRAGILITY_COLOR[cap.fragileStateRisk];
        return `
          <tr style="border-bottom:1px solid var(--border-subtle,#1e1e1e);">
            <td style="padding:5px 6px;font-weight:600;">${escapeHtml(cap.countryName)}</td>
            <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,monospace;color:${color};font-weight:700;">
              ${cap.overallScore.toFixed(0)}
            </td>
            <td style="padding:5px 6px;">
              <span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em;padding:1px 4px;border:1px solid ${color};border-radius:2px;">
                ${escapeHtml(cap.fragileStateRisk)}
              </span>
            </td>
            <td style="padding:5px 6px;text-align:right;color:#888;">${(cap.confidence * 100).toFixed(0)}%</td>
          </tr>`;
      })
      .join('');

    return `
      <div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#2a2a2a);">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-bottom:6px;">
          State Capacity
        </div>
        <table role="table" style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr style="color:#666;border-bottom:1px solid var(--border-subtle,#222);">
              <th scope="col" style="padding:4px 6px;font-weight:600;text-align:left;">Country</th>
              <th scope="col" style="padding:4px 6px;font-weight:600;text-align:right;">Score</th>
              <th scope="col" style="padding:4px 6px;font-weight:600;">Fragility</th>
              <th scope="col" style="padding:4px 6px;font-weight:600;text-align:right;">Confidence</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  // ── Stability / kleptocracy heat map section ──────────────────────────

  private buildStabilitySection(
    snap: PoliticalEconomySnapshot,
    rankedCodes: string[],
  ): string {
    if (snap.stabilityIndicators.length === 0) {
      return this.buildEmptySection('Kleptocracy & Elite Capture', 'No stability data loaded.');
    }

    const sorted = [...snap.stabilityIndicators].sort((a, b) => {
      const ra = rankedCodes.indexOf(a.countryCode);
      const rb = rankedCodes.indexOf(b.countryCode);
      return (ra === -1 ? 999 : ra) - (rb === -1 ? 999 : rb);
    });

    const cards = sorted
      .slice(0, 8)
      .map((ind) => this.buildKleptocracyCard(ind))
      .join('');

    return `
      <div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#2a2a2a);">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-bottom:6px;">
          Kleptocracy &amp; Elite Capture Heat Map
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${cards}
        </div>
      </div>`;
  }

  private buildKleptocracyCard(ind: PoliticalStabilityIndicator): string {
    const color = KLEPTOCRACY_COLOR[ind.kleptocracyRisk];
    const capturePct = (ind.eliteCaptureProbability * 100).toFixed(0);
    return `
      <div style="
        background:rgba(255,255,255,0.03);border:1px solid ${color}55;
        border-radius:4px;padding:7px 9px;min-width:120px;flex:1;
        border-left:3px solid ${color};
      ">
        <div style="font-weight:600;font-size:11px;margin-bottom:2px;">${escapeHtml(ind.countryName)}</div>
        <div style="font-size:10px;color:${color};font-weight:700;text-transform:uppercase;letter-spacing:0.05em;">
          ${escapeHtml(ind.kleptocracyRisk)} kleptocracy
        </div>
        <div style="font-size:10px;color:#888;margin-top:3px;">
          CPI ${ind.corruptionPerceptionIndex}
          · Elite capture ${capturePct}%
          · ${ind.sanctionedEntities} sanctioned
        </div>
      </div>`;
  }

  // ── Sovereign wealth fund section ─────────────────────────────────────

  private buildSWFSection(snap: PoliticalEconomySnapshot): string {
    if (snap.sovereignFunds.length === 0) {
      return this.buildEmptySection('Sovereign Wealth Fund Opacity', 'No fund data loaded.');
    }

    const sorted = [...snap.sovereignFunds].sort((a, b) => {
      // Sort by sanction risk desc, then AUM desc
      if (b.sanctionRisk !== a.sanctionRisk) return b.sanctionRisk - a.sanctionRisk;
      return b.estimatedAumBillions - a.estimatedAumBillions;
    });

    const rows = sorted
      .slice(0, 8)
      .map((fund) => this.buildSWFRow(fund))
      .join('');

    return `
      <div style="padding:10px 12px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-bottom:6px;">
          Sovereign Wealth Fund Opacity
        </div>
        <table role="table" style="width:100%;border-collapse:collapse;font-size:11px;">
          <thead>
            <tr style="color:#666;border-bottom:1px solid var(--border-subtle,#222);">
              <th scope="col" style="padding:4px 6px;font-weight:600;text-align:left;">Fund</th>
              <th scope="col" style="padding:4px 6px;font-weight:600;text-align:right;">AUM $B</th>
              <th scope="col" style="padding:4px 6px;font-weight:600;">Opacity</th>
              <th scope="col" style="padding:4px 6px;font-weight:600;text-align:right;">Sanction Risk</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  private buildSWFRow(fund: SovereignWealthFundProfile): string {
    const color = OPACITY_COLOR[fund.opacity];
    const sanctionPct = (fund.sanctionRisk * 100).toFixed(0);
    const sanctionColor =
      fund.sanctionRisk >= 0.7 ? '#d50000' :
      fund.sanctionRisk >= 0.4 ? '#ff9800' : '#888';
    return `
      <tr style="border-bottom:1px solid var(--border-subtle,#1e1e1e);">
        <td style="padding:5px 6px;">
          <div style="font-weight:600;">${escapeHtml(fund.fundName)}</div>
          <div style="color:#666;font-size:10px;">${escapeHtml(fund.country)} · ${escapeHtml(fund.geopoliticAlignment)}</div>
        </td>
        <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,monospace;font-weight:700;">
          ${fund.estimatedAumBillions.toFixed(0)}
        </td>
        <td style="padding:5px 6px;">
          <span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.04em;padding:1px 4px;border:1px solid ${color};border-radius:2px;">
            ${escapeHtml(fund.opacity)}
          </span>
          <span style="color:#666;font-size:9px;margin-left:3px;">LMTI ${fund.lieqaFundScore}/10</span>
        </td>
        <td style="padding:5px 6px;text-align:right;font-family:ui-monospace,monospace;font-weight:700;color:${sanctionColor};">
          ${sanctionPct}%
        </td>
      </tr>`;
  }

  // ── Utility ───────────────────────────────────────────────────────────

  private buildEmptySection(title: string, message: string): string {
    return `
      <div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#2a2a2a);">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-bottom:4px;">
          ${escapeHtml(title)}
        </div>
        <div style="color:#555;font-size:11px;padding:6px 0;">${escapeHtml(message)}</div>
      </div>`;
  }
}
