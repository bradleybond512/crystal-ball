import { Panel } from './Panel';
import {
  buildRenderData,
} from './economic-espionage-helpers';
import type {
  EspionageOperation,
  SectorRisk,
  ActorCountry,
} from './economic-espionage-helpers';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtUSD(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}

function actorColor(actor: ActorCountry): string {
  switch (actor) {
    case 'China': return '#e05c5c';
    case 'Russia': return '#e08f5c';
    case 'Iran': return '#c45ce0';
    case 'North Korea': return '#5c9ce0';
  }
}

function riskColor(score: number): string {
  if (score >= 90) return '#e05c5c';
  if (score >= 80) return '#e0a05c';
  if (score >= 70) return '#e0d45c';
  return '#5ce08f';
}

function renderSummaryBar(data: ReturnType<typeof buildRenderData>): string {
  const { totalValueStolen, topActor, recentOps } = data;
  const color = actorColor(topActor);
  return `
    <div style="display:flex;gap:var(--space-3,12px);flex-wrap:wrap;margin-bottom:var(--space-3,12px);">
      <div style="flex:1;min-width:120px;background:var(--bg-secondary,#1a1a2e);border-radius:6px;padding:10px;text-align:center;">
        <div style="font-size:11px;color:var(--text-muted,#888);text-transform:uppercase;letter-spacing:.05em;">Total IP Stolen</div>
        <div style="font-size:18px;font-weight:700;color:#e05c5c;margin-top:4px;">${esc(fmtUSD(totalValueStolen))}</div>
      </div>
      <div style="flex:1;min-width:120px;background:var(--bg-secondary,#1a1a2e);border-radius:6px;padding:10px;text-align:center;">
        <div style="font-size:11px;color:var(--text-muted,#888);text-transform:uppercase;letter-spacing:.05em;">Top Actor</div>
        <div style="font-size:16px;font-weight:700;color:${esc(color)};margin-top:4px;">${esc(topActor)}</div>
      </div>
      <div style="flex:1;min-width:120px;background:var(--bg-secondary,#1a1a2e);border-radius:6px;padding:10px;text-align:center;">
        <div style="font-size:11px;color:var(--text-muted,#888);text-transform:uppercase;letter-spacing:.05em;">Recent Ops</div>
        <div style="font-size:18px;font-weight:700;color:var(--text-primary,#eee);margin-top:4px;">${esc(recentOps.length)}</div>
      </div>
    </div>`;
}

function renderSectorRiskTable(sectors: SectorRisk[]): string {
  const rows = sectors.map(s => {
    const actors = s.primaryActors.map(a =>
      `<span style="color:${esc(actorColor(a))};font-size:10px;margin-right:4px;">${esc(a)}</span>`
    ).join('');
    const barPct = s.riskScore;
    const color = riskColor(s.riskScore);
    return `
      <tr>
        <td style="padding:6px 8px;font-size:12px;color:var(--text-primary,#eee);white-space:nowrap;">${esc(s.sector)}</td>
        <td style="padding:6px 8px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <div style="flex:1;background:var(--bg-tertiary,#111);border-radius:3px;height:6px;overflow:hidden;">
              <div style="width:${esc(barPct)}%;height:100%;background:${esc(color)};border-radius:3px;"></div>
            </div>
            <span style="font-size:11px;color:${esc(color)};font-weight:600;min-width:24px;">${esc(s.riskScore)}</span>
          </div>
        </td>
        <td style="padding:6px 8px;font-size:11px;color:var(--text-muted,#888);">${esc(fmtUSD(s.avgValueStolen))}/op</td>
        <td style="padding:6px 8px;">${actors}</td>
      </tr>`;
  }).join('');

  return `
    <div style="margin-bottom:var(--space-4,16px);">
      <div style="font-size:11px;font-weight:600;color:var(--text-muted,#888);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">Sector Risk Index</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid var(--border,#333);">
            <th style="padding:4px 8px;font-size:10px;color:var(--text-muted,#666);text-align:left;font-weight:500;">SECTOR</th>
            <th style="padding:4px 8px;font-size:10px;color:var(--text-muted,#666);text-align:left;font-weight:500;">RISK</th>
            <th style="padding:4px 8px;font-size:10px;color:var(--text-muted,#666);text-align:left;font-weight:500;">AVG VALUE</th>
            <th style="padding:4px 8px;font-size:10px;color:var(--text-muted,#666);text-align:left;font-weight:500;">ACTORS</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderRecentOps(ops: EspionageOperation[]): string {
  const cards = ops.map(op => {
    const color = actorColor(op.actor);
    const indictmentBadge = op.indictments > 0
      ? `<span style="background:#e05c5c22;color:#e05c5c;border-radius:4px;padding:1px 5px;font-size:10px;margin-left:4px;">${esc(op.indictments)} indicted</span>`
      : '';
    return `
      <div style="background:var(--bg-secondary,#1a1a2e);border-radius:6px;padding:8px 10px;border-left:3px solid ${esc(color)};">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <span style="font-size:11px;font-weight:600;color:${esc(color)};">${esc(op.actor)}</span>
            <span style="font-size:11px;color:var(--text-muted,#888);margin:0 4px;">→</span>
            <span style="font-size:11px;color:var(--text-primary,#eee);">${esc(op.targetCountry)} / ${esc(op.targetSector)}</span>
            ${indictmentBadge}
          </div>
          <span style="font-size:10px;color:var(--text-muted,#666);">${esc(op.detectionDate)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;">
          <span style="font-size:10px;color:var(--text-muted,#888);background:var(--bg-tertiary,#111);border-radius:3px;padding:1px 5px;">${esc(op.vector)}</span>
          <span style="font-size:11px;font-weight:600;color:#e0a05c;">${esc(fmtUSD(op.estimatedValueUSD))}</span>
        </div>
      </div>`;
  }).join('');

  return `
    <div>
      <div style="font-size:11px;font-weight:600;color:var(--text-muted,#888);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">Recent Operations</div>
      <div style="display:flex;flex-direction:column;gap:6px;">${cards}</div>
    </div>`;
}

export class EconomicEspionagePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'economic-espionage',
      title: 'Economic Espionage Tracker',
      showCount: true,
      trackActivity: true,
    });
    this.render();
    if (typeof setInterval !== 'undefined') {
      this.refreshTimer = setInterval(() => { this.render(); }, REFRESH_MS);
    }
  }

  private render(): void {
    try {
      const data = buildRenderData();
      this.setCount(data.recentOps.length);
      const html = [
        renderSummaryBar(data),
        renderSectorRiskTable(data.topSectors),
        renderRecentOps(data.recentOps),
      ].join('');
      this.setContent(`<div style="padding:var(--space-3,12px);display:flex;flex-direction:column;gap:var(--space-2,8px);">${html}</div>`);
      this.setDataBadge('live', 'mock');
    } catch (err) {
      this.showError(`Economic Espionage Tracker failed to render: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }
}
