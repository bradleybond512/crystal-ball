/**
 * CounterterrorismPanel — active terrorism incidents by region and group,
 * attack vectors, threat tiers, 30-day frequency trends, and CT effectiveness.
 *
 * Data: deterministic mock for offline use. Refresh: 30 minutes.
 */

import { Panel } from './Panel';
import {
  buildRenderData,
  getMockIncidents,
  TIER_COLORS,
  VECTOR_LABELS,
  tierLabel,
  escapeHtmlSimple,
  classifyThreatTier,
  type CounterterrorismRenderData,
  type RegionRisk,
  type GroupActivity,
  type AttackVectorSummary,
} from './counterterrorism-helpers';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

function ctTrendArrow(trend: RegionRisk['trend']): string {
  if (trend === 'increasing') return '&#8593;';
  if (trend === 'decreasing') return '&#8595;';
  return '&#8594;';
}

function ctTrendColor(trend: RegionRisk['trend']): string {
  if (trend === 'increasing') return '#ff453a';
  if (trend === 'decreasing') return '#4caf50';
  return '#9e9e9e';
}

export class CounterterrorismPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'counterterrorism',
      title: 'Counterterrorism Monitor',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Active terrorism incidents by region and threat group. ' +
        'Shows 30-day rolling frequency, attack vectors, 5-tier threat level, ' +
        'casualties, and CT operation success rate. Data refreshes every 30 minutes.',
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
    try {
      const incidents = getMockIncidents();
      const data = buildRenderData(incidents, Date.now());
      const criticalCount = data.regions.filter((r) => r.tier === 'critical').length;
      const highCount = data.regions.filter((r) => r.tier === 'high').length;
      this.setCount(criticalCount + highCount);
      this.setContent(this.buildHtml(data));
    } catch {
      this.showError('Failed to load counterterrorism data');
    }
  }

  private buildHtml(data: CounterterrorismRenderData): string {
    return `
      ${this.buildSummaryBar(data)}
      <div style="padding:0 0 4px 0;">
        ${this.buildRegionTable(data.regions)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid var(--border-subtle,#222);">
        <div style="border-right:1px solid var(--border-subtle,#222);">
          ${this.buildGroupSection(data.groups)}
        </div>
        <div>
          ${this.buildVectorSection(data.vectors)}
        </div>
      </div>
      ${this.buildFooter(data)}
    `;
  }

  private buildSummaryBar(data: CounterterrorismRenderData): string {
    const tierColor = TIER_COLORS[data.overallTier];
    let freqLabel: string;
    if (data.frequency.trend === 'increasing') {
      freqLabel = `↑ ${Math.abs(Math.round(data.frequency.trendPct))}% vs prior 30d`;
    } else if (data.frequency.trend === 'decreasing') {
      freqLabel = `↓ ${Math.abs(Math.round(data.frequency.trendPct))}% vs prior 30d`;
    } else {
      freqLabel = 'stable vs prior 30d';
    }
    const ctLabel = `CT success: ${Math.round(data.ctEffectiveness.rate * 100)}% (${data.ctEffectiveness.label})`;

    const topCas = data.topCasualty;
    const topCasText = topCas.total > 0
      ? `Worst: ${topCas.killed}k / ${topCas.wounded}w`
      : 'No casualties';

    let alertBar = '';
    const critRegions = data.regions.filter((r) => r.tier === 'critical');
    if (critRegions.length > 0) {
      const names = critRegions.map((r) => escapeHtmlSimple(r.region)).join(', ');
      alertBar = `<div style="padding:5px 12px;background:rgba(255, 69, 58,0.12);border-bottom:1px solid rgba(255, 69, 58,0.3);
        font-size:11px;font-weight:700;color:#ff453a;letter-spacing:0.04em;">
        &#9888; CRITICAL THREAT: ${names}
      </div>`;
    }

    return `${alertBar}
    <div style="display:flex;align-items:center;gap:12px;padding:8px 12px;
      border-bottom:1px solid var(--border-subtle,#222);flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="padding:3px 8px;border-radius:4px;font-size:11px;font-weight:800;letter-spacing:0.06em;
          background:${tierColor}22;color:${tierColor};border:1px solid ${tierColor}55;">
          ${tierLabel(data.overallTier)}
        </span>
        <span style="font-size:12px;color:#e5e5e5;font-weight:600;">Overall score: ${data.overallScore}</span>
      </div>
      <span style="font-size:11px;color:#9e9e9e;">&#183;</span>
      <span style="font-size:11px;color:#bbb;">${data.frequency.count30d} incidents / 30d &nbsp;${escapeHtmlSimple(freqLabel)}</span>
      <span style="font-size:11px;color:#9e9e9e;">&#183;</span>
      <span style="font-size:11px;color:#bbb;">${escapeHtmlSimple(ctLabel)}</span>
      <span style="font-size:11px;color:#9e9e9e;">&#183;</span>
      <span style="font-size:11px;color:#bbb;">${escapeHtmlSimple(topCasText)}</span>
    </div>`;
  }

  private buildRegionTable(regions: RegionRisk[]): string {
    const rows = regions.map((r) => {
      const color = TIER_COLORS[r.tier];
      const trendArrow = ctTrendArrow(r.trend);
      const trendColor = ctTrendColor(r.trend);
      const ctPct = Math.round(r.ctSuccessRate * 100);
      return `<tr style="border-bottom:1px solid var(--border-subtle,#1a1a1a);">
        <td style="padding:5px 10px;font-size:12px;color:#e5e5e5;">${escapeHtmlSimple(r.region)}</td>
        <td style="padding:5px 6px;">
          <span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;
            background:${color}22;color:${color};border:1px solid ${color}44;white-space:nowrap;">
            ${tierLabel(r.tier)}
          </span>
        </td>
        <td style="padding:5px 8px;font-size:11px;color:#bbb;text-align:right;">${r.score}</td>
        <td style="padding:5px 8px;font-size:11px;color:#bbb;text-align:right;">${r.incidentCount30d}</td>
        <td style="padding:5px 10px;font-size:11px;color:#9e9e9e;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtmlSimple(r.topGroup)}</td>
        <td style="padding:5px 6px;font-size:10px;color:#666;">${escapeHtmlSimple(VECTOR_LABELS[r.topVector] ?? r.topVector)}</td>
        <td style="padding:5px 4px;font-size:12px;color:${trendColor};text-align:center;">${trendArrow}</td>
        <td style="padding:5px 8px;font-size:11px;color:#bbb;text-align:right;">${ctPct}%</td>
      </tr>`;
    }).join('');

    return `<table role="table" style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead>
        <tr style="text-align:left;color:var(--text-secondary,#666);border-bottom:1px solid var(--border-subtle,#333);">
          <th scope="col" style="padding:4px 10px;font-weight:600;font-size:10px;">Region</th>
          <th scope="col" style="padding:4px 6px;font-weight:600;font-size:10px;">Tier</th>
          <th scope="col" style="padding:4px 8px;font-weight:600;font-size:10px;text-align:right;">Score</th>
          <th scope="col" style="padding:4px 8px;font-weight:600;font-size:10px;text-align:right;">30d</th>
          <th scope="col" style="padding:4px 10px;font-weight:600;font-size:10px;">Top Group</th>
          <th scope="col" style="padding:4px 6px;font-weight:600;font-size:10px;">Vector</th>
          <th scope="col" style="padding:4px 4px;font-weight:600;font-size:10px;text-align:center;">Trend</th>
          <th scope="col" style="padding:4px 8px;font-weight:600;font-size:10px;text-align:right;">CT%</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  private buildGroupSection(groups: GroupActivity[]): string {
    const items = groups.slice(0, 8).map((g) => {
      const tier = classifyThreatTier(g.activityScore);
      const color = TIER_COLORS[tier];
      const barWidth = `${g.activityScore}%`;
      return `<div style="padding:5px 10px;border-bottom:1px solid var(--border-subtle,#1a1a1a);">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
          <span style="width:6px;height:6px;border-radius:50%;background:${color};flex:0 0 auto;"></span>
          <span style="flex:1;font-size:11px;color:#e5e5e5;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtmlSimple(g.group)}</span>
          <span style="font-size:10px;color:#ff6d00;font-weight:700;">${g.activityScore}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="flex:1;height:3px;background:#1a1a1a;border-radius:2px;overflow:hidden;">
            <div style="width:${barWidth};height:100%;background:${color};border-radius:2px;"></div>
          </div>
          <span style="font-size:9px;color:#666;white-space:nowrap;">${g.incidentCount30d}inc · ${g.casualtiesTotal}cas</span>
        </div>
      </div>`;
    }).join('');

    return `<div style="padding:4px 10px 2px;font-size:10px;font-weight:700;color:#666;letter-spacing:0.06em;border-bottom:1px solid var(--border-subtle,#222);">
        THREAT GROUPS
      </div>
      ${items}`;
  }

  private buildVectorSection(vectors: AttackVectorSummary[]): string {
    const total = vectors.reduce((s, v) => s + v.count, 0);
    const items = vectors.slice(0, 6).map((v) => {
      const pct = total > 0 ? Math.round((v.count / total) * 100) : 0;
      return `<div style="padding:4px 10px;border-bottom:1px solid var(--border-subtle,#1a1a1a);
        display:flex;align-items:center;gap:6px;">
        <span style="flex:1;font-size:10px;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtmlSimple(VECTOR_LABELS[v.vector] ?? v.vector)}</span>
        <span style="font-size:10px;color:#9e9e9e;">${v.count}</span>
        <div style="width:32px;height:3px;background:#1a1a1a;border-radius:2px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:#ff6d00;border-radius:2px;"></div>
        </div>
        <span style="font-size:9px;color:#555;width:26px;text-align:right;">${pct}%</span>
      </div>`;
    }).join('');

    return `<div style="padding:4px 10px 2px;font-size:10px;font-weight:700;color:#666;letter-spacing:0.06em;border-bottom:1px solid var(--border-subtle,#222);">
        ATTACK VECTORS
      </div>
      ${items}`;
  }

  private buildFooter(data: CounterterrorismRenderData): string {
    const ts = new Date(data.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div style="padding:4px 10px;font-size:10px;color:var(--text-secondary,#555);
      border-top:1px solid var(--border-subtle,#222);display:flex;justify-content:space-between;">
      <span>Mock data &middot; ${data.regions.length} regions &middot; ${data.groups.length} groups</span>
      <span>Updated ${ts} &middot; refreshes every 30m</span>
    </div>`;
  }
}
