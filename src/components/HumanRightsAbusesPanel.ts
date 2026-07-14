import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { buildRenderData, type CountryRiskProfile } from './human-rights-abuses-helpers';

const REFRESH_MS = 300_000;

type AbuseTier = 'critical' | 'high' | 'medium' | 'low';

const TIER_COLOR: Record<AbuseTier, string> = {
  critical: '#ff453a',
  high:     '#ff5722',
  medium:   '#ff9800',
  low:      '#4caf50',
};

function tierForScore(score: number): AbuseTier {
  if (score >= 85) return 'critical';
  if (score >= 70) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

function trendArrow(trend: CountryRiskProfile['trend']): string {
  if (trend === 'worsening') return '↑';
  if (trend === 'improving') return '↓';
  return '→';
}

export class HumanRightsAbusesPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastError: string | null = null;

  constructor() {
    super({
      id: 'human-rights-abuses',
      title: 'Human Rights Abuses',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Country-level human rights abuse risk scores, impunity indices, trend directions, and dominant abuse categories derived from tracked incident data.',
    });
    this.start();
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private start(): void {
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  private refresh(): void {
    try {
      const data = buildRenderData();
      this.lastError = null;
      const criticalOrHigh = data.profiles.filter(
        (p) => tierForScore(p.abuseRiskScore) === 'critical' || tierForScore(p.abuseRiskScore) === 'high',
      ).length;
      this.setCount(criticalOrHigh);
      this.setContent(this.buildHtml(data));
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Unknown error';
      this.setContent(this.buildErrorHtml(this.lastError));
    }
  }

  private buildHtml(data: ReturnType<typeof buildRenderData>): string {
    const headerBlock = this.renderHeader(data.totalIncidents, data.systematicCount);
    const rows = data.profiles.slice(0, 12).map((p) => this.renderRow(p)).join('');
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${headerBlock}
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderHeader(totalIncidents: number, systematicCount: number): string {
    return `<div style="display:flex;gap:16px;flex-wrap:wrap;">
      <div style="display:flex;flex-direction:column;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Incidents Tracked</span>
        <span style="font-size:18px;font-weight:700;font-family:ui-monospace,monospace;">${totalIncidents}</span>
      </div>
      <div style="display:flex;flex-direction:column;">
        <span style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Systematic Patterns</span>
        <span style="font-size:18px;font-weight:700;font-family:ui-monospace,monospace;color:#ff9800;">${systematicCount}</span>
      </div>
    </div>`;
  }

  private renderRow(p: CountryRiskProfile): string {
    const tier = tierForScore(p.abuseRiskScore);
    const color = TIER_COLOR[tier];
    const arrow = trendArrow(p.trend);
    const impunityPct = Math.round(p.impunityIndex * 100);
    let trendColor: string;
    if (p.trend === 'worsening') { trendColor = '#ff453a'; }
    else if (p.trend === 'improving') { trendColor = '#4caf50'; }
    else { trendColor = 'var(--text-secondary,#aaa)'; }
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;font-size:11px;gap:8px;">
      <div style="min-width:0;flex:1;">
        <div style="font-weight:600;">${escapeHtml(p.country)}</div>
        <div style="color:var(--text-secondary,#aaa);font-size:10px;margin-top:1px;">${escapeHtml(p.dominantCategory)} · ${impunityPct}% impunity</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <span style="font-size:12px;color:${trendColor};">${arrow}</span>
        <div style="font-weight:700;color:${color};font-family:ui-monospace,monospace;">${p.abuseRiskScore}</div>
        <div style="font-size:10px;font-weight:600;color:${color};text-transform:uppercase;letter-spacing:0.05em;min-width:46px;text-align:right;">${tier}</div>
      </div>
    </div>`;
  }

  private buildErrorHtml(message: string): string {
    return `<div style="padding:12px;">
      <div style="font-size:11px;color:#ff9800;">&#9888; ${escapeHtml(message)}</div>
    </div>`;
  }
}
