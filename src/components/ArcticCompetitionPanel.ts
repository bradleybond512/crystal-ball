import { Panel } from './Panel';
import {
  buildArcticRenderData,
  formatScore,
  getRiskColor,
} from './arctic-competition-helpers';
import type { ArcticRenderData } from './arctic-competition-helpers';

const REFRESH_MS = 60 * 60 * 1000;

export class ArcticCompetitionPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private data: ArcticRenderData;

  constructor() {
    super({
      id: 'arctic-competition',
      title: 'Arctic Competition',
      showCount: true,
      trackActivity: true,
    });
    this.data = buildArcticRenderData();
    this.render();
    if (typeof setInterval !== 'undefined') {
      this.refreshTimer = setInterval(() => {
        this.data = buildArcticRenderData();
        this.render();
      }, REFRESH_MS);
    }
  }

  private disputeCount(): number {
    return this.data.disputes.filter((d) => d.contested).length;
  }

  private render(): void {
    const d = this.data;
    const tensionColor = getRiskColor(
      d.overallTensionScore >= 75 ? 'critical'
      : d.overallTensionScore >= 50 ? 'high'
      : d.overallTensionScore >= 25 ? 'medium'
      : 'low',
    );

    const html = [
      renderTensionHeader(d, tensionColor),
      renderDisputesSection(d),
      renderMilitaryTable(d),
      renderResourceCards(d),
      renderShippingLanes(d),
      renderSeaIceAndTreaty(d),
    ].join('');

    this.setContent(`<div class="arctic-competition-panel" style="padding:var(--space-3,12px);display:flex;flex-direction:column;gap:var(--space-4,16px);">${html}</div>`);
    this.setCount(this.disputeCount());
    this.markFresh();
  }

  override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }
}

// ── Section renderers (HTML string builders) ──────────────────────────────

function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTensionHeader(d: ArcticRenderData, tensionColor: string): string {
  return `
    <div style="display:flex;align-items:center;gap:var(--space-3,12px);flex-wrap:wrap;">
      <div style="background:${esc(tensionColor)};color:#fff;border-radius:6px;padding:4px 10px;font-weight:700;font-size:var(--text-sm,13px);letter-spacing:.02em;">
        ${esc(d.tensionLabel.toUpperCase())}
      </div>
      <div style="font-size:var(--text-2xl,22px);font-weight:700;color:#e5e5e5;">${esc(d.overallTensionScore)}</div>
      <div style="font-size:var(--text-xs,11px);color:#888;">Overall Tension Score / 100</div>
      <div style="margin-left:auto;font-size:var(--text-xs,11px);color:#666;">Updated ${esc(new Date(d.lastUpdated).toLocaleTimeString())}</div>
    </div>
  `;
}

function renderDisputesSection(d: ArcticRenderData): string {
  const rows = d.disputes.map((dispute) => {
    const color = getRiskColor(
      dispute.tensionLevel >= 0.75 ? 'critical'
      : dispute.tensionLevel >= 0.50 ? 'high'
      : dispute.tensionLevel >= 0.25 ? 'medium'
      : 'low',
    );
    const pct = Math.round(dispute.tensionLevel * 100);
    const badge = dispute.contested
      ? `<span style="background:#ef444422;color:#ef4444;border-radius:4px;padding:1px 5px;font-size:10px;margin-left:4px;">CONTESTED</span>`
      : `<span style="background:#22c55e22;color:#22c55e;border-radius:4px;padding:1px 5px;font-size:10px;margin-left:4px;">SETTLED</span>`;
    return `
      <div style="padding:6px 0;border-bottom:1px solid #333;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div style="font-size:var(--text-sm,13px);font-weight:600;color:#e5e5e5;">${esc(dispute.region)}${badge}</div>
          <div style="font-size:var(--text-xs,11px);font-weight:700;color:${esc(color)};">${esc(pct)}%</div>
        </div>
        <div style="font-size:var(--text-xs,11px);color:#888;margin-top:2px;">
          Claimants: ${esc(dispute.claimants.join(', '))} &mdash; ${esc(dispute.legalBasis)}
        </div>
        <div style="background:#1e1e1e;border-radius:2px;height:3px;margin-top:4px;overflow:hidden;">
          <div style="width:${esc(pct)}%;height:100%;background:${esc(color)};transition:width .3s;"></div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div>
      <div style="font-size:var(--text-xs,11px);font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Sovereignty Disputes</div>
      ${rows}
    </div>
  `;
}

function renderMilitaryTable(d: ArcticRenderData): string {
  const rows = d.militaryPresences
    .slice()
    .sort((a, b) => b.presenceScore - a.presenceScore)
    .map((m) => {
      const pct = Math.round(m.presenceScore * 100);
      const color = getRiskColor(
        pct >= 75 ? 'critical'
        : pct >= 50 ? 'high'
        : pct >= 25 ? 'medium'
        : 'low',
      );
      return `
        <tr style="border-bottom:1px solid #2a2a2a;">
          <td style="padding:5px 6px;font-size:var(--text-sm,13px);color:#e5e5e5;font-weight:600;">${esc(m.nation)}</td>
          <td style="padding:5px 6px;font-size:var(--text-xs,11px);color:#aaa;text-align:center;">${esc(m.bases)}</td>
          <td style="padding:5px 6px;font-size:var(--text-xs,11px);color:#aaa;text-align:center;">${esc(m.icebreakers)}</td>
          <td style="padding:5px 6px;font-size:var(--text-xs,11px);color:#aaa;text-align:center;">${esc(m.submarines)}</td>
          <td style="padding:5px 6px;font-size:var(--text-xs,11px);color:${esc(color)};font-weight:700;text-align:center;">${esc(pct)}%</td>
        </tr>
      `;
    }).join('');

  return `
    <div>
      <div style="font-size:var(--text-xs,11px);font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Military Presence</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid #444;">
            <th style="padding:4px 6px;font-size:10px;color:#666;text-align:left;font-weight:600;">Nation</th>
            <th style="padding:4px 6px;font-size:10px;color:#666;text-align:center;font-weight:600;">Bases</th>
            <th style="padding:4px 6px;font-size:10px;color:#666;text-align:center;font-weight:600;">Icebreakers</th>
            <th style="padding:4px 6px;font-size:10px;color:#666;text-align:center;font-weight:600;">Subs</th>
            <th style="padding:4px 6px;font-size:10px;color:#666;text-align:center;font-weight:600;">Score</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderResourceCards(d: ArcticRenderData): string {
  const top4 = d.resources.slice(0, 4);
  const cards = top4.map((r) => {
    const color = getRiskColor(
      r.competitionLevel >= 0.75 ? 'critical'
      : r.competitionLevel >= 0.50 ? 'high'
      : r.competitionLevel >= 0.25 ? 'medium'
      : 'low',
    );
    const pct = Math.round(r.competitionLevel * 100);
    const typeLabel = r.type === 'rare_earth' ? 'Rare Earth'
      : r.type === 'oil' ? 'Oil'
      : r.type === 'gas' ? 'Gas'
      : 'Shipping';
    const stageLabel = r.developmentStage.replace(/_/g, ' ');
    return `
      <div style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;padding:8px 10px;flex:1 1 160px;min-width:0;">
        <div style="font-size:var(--text-sm,13px);font-weight:600;color:#e5e5e5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(r.name)}</div>
        <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;">
          <span style="font-size:10px;background:#333;color:#aaa;border-radius:4px;padding:1px 5px;">${esc(typeLabel)}</span>
          <span style="font-size:10px;background:#333;color:#aaa;border-radius:4px;padding:1px 5px;">${esc(stageLabel)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
          <div style="font-size:var(--text-xs,11px);color:#888;">$${esc(r.estimatedValue)}B</div>
          <div style="font-size:var(--text-xs,11px);font-weight:700;color:${esc(color)};">Competition ${esc(pct)}%</div>
        </div>
        <div style="background:#111;border-radius:2px;height:3px;margin-top:4px;overflow:hidden;">
          <div style="width:${esc(pct)}%;height:100%;background:${esc(color)};transition:width .3s;"></div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div>
      <div style="font-size:var(--text-xs,11px);font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Resource Sectors (Top 4)</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">${cards}</div>
    </div>
  `;
}

function renderShippingLanes(d: ArcticRenderData): string {
  const rows = d.shippingLanes.map((lane) => {
    const color = getRiskColor(lane.riskLevel);
    const routeLabel = lane.route === 'northwest_passage' ? 'Northwest Passage'
      : lane.route === 'northern_sea_route' ? 'Northern Sea Route'
      : 'Transpolar Route';
    return `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid #2a2a2a;">
        <div style="width:8px;height:8px;border-radius:50%;background:${esc(color)};margin-top:4px;flex-shrink:0;"></div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:var(--text-sm,13px);font-weight:600;color:#e5e5e5;">${esc(routeLabel)}</div>
          <div style="font-size:var(--text-xs,11px);color:#888;">
            Controlled by ${esc(lane.controlledBy)} &mdash;
            Open ${esc(lane.openMonthsPerYear)} mo/yr &mdash;
            ${esc(lane.commercialTransits)} commercial transits
          </div>
        </div>
        <div style="font-size:var(--text-xs,11px);font-weight:700;color:${esc(color)};text-transform:capitalize;flex-shrink:0;">${esc(lane.riskLevel)}</div>
      </div>
    `;
  }).join('');

  return `
    <div>
      <div style="font-size:var(--text-xs,11px);font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Shipping Lanes</div>
      ${rows}
    </div>
  `;
}

function renderSeaIceAndTreaty(d: ArcticRenderData): string {
  const ice = d.seaIceTrend;
  const iceColor = ice.trend === 'rapid_decline' ? '#7c3aed'
    : ice.trend === 'declining' ? '#ef4444'
    : '#22c55e';
  const trendLabel = ice.trend.replace(/_/g, ' ');
  const treatyColor = getRiskColor(
    d.treatyComplianceScore < 50 ? 'critical'
    : d.treatyComplianceScore < 65 ? 'high'
    : d.treatyComplianceScore < 80 ? 'medium'
    : 'low',
  );

  return `
    <div style="display:flex;gap:12px;flex-wrap:wrap;">
      <div style="flex:1;min-width:120px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;padding:8px 10px;">
        <div style="font-size:10px;font-weight:700;color:#666;letter-spacing:.06em;text-transform:uppercase;">Sea Ice Extent</div>
        <div style="font-size:var(--text-xl,20px);font-weight:700;color:${esc(iceColor)};margin-top:4px;">${esc(ice.septemberExtentMkm2)}M km²</div>
        <div style="font-size:var(--text-xs,11px);color:#888;">${esc(ice.year)} September &mdash; ${esc(ice.anomalyPercent)}% anomaly</div>
        <div style="font-size:var(--text-xs,11px);color:${esc(iceColor)};text-transform:capitalize;margin-top:2px;">${esc(trendLabel)}</div>
      </div>
      <div style="flex:1;min-width:120px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:6px;padding:8px 10px;">
        <div style="font-size:10px;font-weight:700;color:#666;letter-spacing:.06em;text-transform:uppercase;">Treaty Compliance</div>
        <div style="font-size:var(--text-xl,20px);font-weight:700;color:${esc(treatyColor)};margin-top:4px;">${esc(formatScore(d.treatyComplianceScore))}</div>
        <div style="font-size:var(--text-xs,11px);color:#888;">Arctic Council + UNCLOS adherence</div>
        <div style="background:#111;border-radius:2px;height:4px;margin-top:6px;overflow:hidden;">
          <div style="width:${esc(d.treatyComplianceScore)}%;height:100%;background:${esc(treatyColor)};transition:width .3s;"></div>
        </div>
      </div>
    </div>
  `;
}
