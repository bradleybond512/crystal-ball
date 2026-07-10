/**
 * PoliticalEconomyPanel — kleptocracy risk and state capacity tracker.
 *
 * Tracks 15 high-risk countries across five dimensions:
 *   kleptocracy score · state capacity · institutional quality ·
 *   crony-capture index · sanctions-evasion risk
 *
 * Refreshes every hour. Cards are sorted by composite risk score
 * (highest first). Clicking a card expands the full breakdown.
 */

import { Panel } from './Panel.js';

import {
  buildRenderData,
  type CountryPoliticalProfile,
  type PoliticalEconomyRenderData,
  type RiskTier,
} from './political-economy-helpers.js';

const REFRESH_MS = 3_600_000; // 1 hour

// ── Colour palette ─────────────────────────────────────────────────────────

const TIER_COLOR: Record<RiskTier, string> = {
  critical: '#d50000',
  high:     '#ff9800',
  elevated: '#ffeb3b',
  moderate: '#4caf50',
  low:      '#29b6f6',
};

const TIER_LABEL: Record<RiskTier, string> = {
  critical: 'CRITICAL',
  high:     'HIGH',
  elevated: 'ELEVATED',
  moderate: 'MODERATE',
  low:      'LOW',
};

// ── Helpers ────────────────────────────────────────────────────────────────

function scoreBar(value: number, color: string): string {
  const pct = Math.min(100, Math.max(0, value));
  return `<div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;margin-top:2px;">
    <div style="height:100%;width:${pct}%;background:${color};border-radius:2px;"></div>
  </div>`;
}

function metricRow(label: string, value: number, color: string): string {
  return `<div style="margin-bottom:6px;">
    <div style="display:flex;justify-content:space-between;font-size:10px;color:#aaa;">
      <span>${label}</span>
      <span style="font-family:ui-monospace,monospace;color:${color};font-weight:700;">${value}</span>
    </div>
    ${scoreBar(value, color)}
  </div>`;
}

// ── Panel class ────────────────────────────────────────────────────────────

export class PoliticalEconomyPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private expanded = new Set<string>();

  constructor() {
    super({
      id: 'political-economy',
      title: 'Political Economy Risk',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Kleptocracy risk, state capacity, institutional quality, crony-capture index, and sanctions-evasion risk for 15 high-risk countries. Composite score 0–100 sorted highest risk first.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('click', this.onCardToggle);
      document.removeEventListener('keydown', this.onCardKey);
    }
    super.destroy();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('click', this.onCardToggle);
      document.addEventListener('keydown', this.onCardKey);
    }
  }

  private readonly onCardToggle = (ev: Event): void => {
    const card = (ev.target as Element | null)?.closest('[data-pe-country]');
    if (!card) return;
    const country = card.getAttribute('data-pe-country');
    if (!country) return;
    this.toggleExpanded(country);
  };

  private readonly onCardKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const card = (ev.target as Element | null)?.closest('[data-pe-country]');
    if (!card) return;
    ev.preventDefault();
    const country = card.getAttribute('data-pe-country');
    if (!country) return;
    this.toggleExpanded(country);
  };

  private toggleExpanded(country: string): void {
    if (this.expanded.has(country)) this.expanded.delete(country);
    else this.expanded.add(country);
    this.render();
  }

  private render(): void {
    try {
      const data = buildRenderData();
      this.setCount(data.criticalCount + data.highCount);
      this.setContent(this.buildHtml(data));
    } catch (error) {
      this.showError('Failed to render Political Economy data');
      // eslint-disable-next-line no-console
      console.error('[PoliticalEconomyPanel] render error', error);
    }
  }

  private buildHtml(data: PoliticalEconomyRenderData): string {
    const banner = (data.criticalCount + data.highCount) > 0
      ? this.buildBanner(data)
      : '';

    const cards = data.profiles.map((p) => this.buildCard(p)).join('');

    return `${banner}
      <div style="padding:6px 10px;font-size:11px;color:var(--text-secondary,#888);">
        ${data.profiles.length} countries · sorted by composite risk · kleptocracy + state capacity + institutional quality
      </div>
      <div style="padding:0 6px 8px;">${cards}</div>`;
  }

  private buildBanner(data: PoliticalEconomyRenderData): string {
    const bits: string[] = [];
    if (data.criticalCount > 0) bits.push(`${data.criticalCount} CRITICAL`);
    if (data.highCount > 0) bits.push(`${data.highCount} HIGH`);
    return `<div style="padding:6px 12px;background:rgba(213,0,0,0.12);border-bottom:1px solid rgba(213,0,0,0.3);font-size:11px;font-weight:700;color:#d50000;letter-spacing:0.04em;">
      ⚠ KLEPTOCRACY ALERTS: ${bits.join(' · ')}
    </div>`;
  }

  private buildCard(p: CountryPoliticalProfile): string {
    const isOpen = this.expanded.has(p.country);
    const color = TIER_COLOR[p.tier];
    const tierLabel = TIER_LABEL[p.tier];
    const detail = isOpen ? this.buildDetail(p) : '';

    return `<div
      data-pe-country="${p.country}"
      role="button"
      tabindex="0"
      aria-expanded="${isOpen}"
      style="margin:4px 0;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;padding:8px 10px;cursor:pointer;background:var(--bg-elevated,rgba(255,255,255,0.02));"
    >
      <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:10px;color:#888;font-family:ui-monospace,monospace;min-width:22px;">${p.iso2}</span>
          <span style="font-weight:700;font-size:13px;color:#e5e5e5;">${p.country}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.06em;padding:1px 5px;border:1px solid ${color};border-radius:2px;">${tierLabel}</span>
          <span style="font-family:ui-monospace,monospace;font-weight:700;font-size:15px;color:${color};">${p.overallScore}</span>
          <span style="color:#666;font-size:10px;">${isOpen ? '▲' : '▼'}</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:6px;">
        <div style="font-size:10px;">
          <div style="color:#888;margin-bottom:1px;">Kleptocracy</div>
          ${scoreBar(p.kleptocracy.overall, color)}
          <div style="color:${color};font-family:ui-monospace,monospace;font-size:11px;font-weight:700;">${p.kleptocracy.overall}</div>
        </div>
        <div style="font-size:10px;">
          <div style="color:#888;margin-bottom:1px;">State Capacity</div>
          ${scoreBar(100 - p.stateCapacity.overall, color)}
          <div style="color:${color};font-family:ui-monospace,monospace;font-size:11px;font-weight:700;">${p.stateCapacity.overall} cap</div>
        </div>
        <div style="font-size:10px;">
          <div style="color:#888;margin-bottom:1px;">Crony Capture</div>
          ${scoreBar(p.cronyCaptureIndex, color)}
          <div style="color:${color};font-family:ui-monospace,monospace;font-size:11px;font-weight:700;">${p.cronyCaptureIndex}</div>
        </div>
      </div>
      ${detail}
    </div>`;
  }

  private buildDetail(p: CountryPoliticalProfile): string {
    const color = TIER_COLOR[p.tier];
    const iq = p.institutionalQuality;
    const avgIQ = Math.round(
      (iq.voiceAccountability + iq.politicalStability + iq.governmentEffectiveness +
       iq.regulatoryQuality + iq.ruleOfLaw + iq.controlOfCorruption) / 6,
    );

    return `<div style="margin-top:10px;border-top:1px solid var(--border-subtle,#333);padding-top:10px;">
      <div style="font-size:10px;color:#aaa;font-style:italic;margin-bottom:8px;line-height:1.4;">${p.kleptocracy.summary}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-bottom:5px;font-weight:600;">Kleptocracy Breakdown</div>
          ${metricRow('Asset Looting', p.kleptocracy.assetLooting, color)}
          ${metricRow('Judicial Capture', p.kleptocracy.judicialCapture, color)}
          ${metricRow('Capital Flight', p.kleptocracy.capitalFlight, color)}
          ${metricRow('Media Suppression', p.kleptocracy.mediaSuppression, color)}
        </div>
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-bottom:5px;font-weight:600;">State Capacity</div>
          ${metricRow('Public Goods', p.stateCapacity.publicGoodsDelivery, '#29b6f6')}
          ${metricRow('Fiscal', p.stateCapacity.fiscalCapacity, '#29b6f6')}
          ${metricRow('Security Monopoly', p.stateCapacity.securityMonopoly, '#29b6f6')}
          ${metricRow('Bureaucratic', p.stateCapacity.bureaucraticCapacity, '#29b6f6')}
        </div>
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-bottom:5px;font-weight:600;">Institutional Quality <span style="color:${color};">(avg ${avgIQ})</span></div>
          ${metricRow('Voice & Accountability', iq.voiceAccountability, '#ab47bc')}
          ${metricRow('Political Stability', iq.politicalStability, '#ab47bc')}
          ${metricRow('Gov. Effectiveness', iq.governmentEffectiveness, '#ab47bc')}
          ${metricRow('Rule of Law', iq.ruleOfLaw, '#ab47bc')}
        </div>
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-bottom:5px;font-weight:600;">Risk Indices</div>
          ${metricRow('Crony Capture', p.cronyCaptureIndex, color)}
          ${metricRow('Resource Curse', p.resourceCurseScore, color)}
          ${metricRow('Oligarch Concentration', p.oligarchConcentration, color)}
          ${metricRow('Sanctions Evasion', p.sanctionsEvasionRisk, '#ff9800')}
        </div>
      </div>
    </div>`;
  }
}
