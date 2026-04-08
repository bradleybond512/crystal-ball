/**
 * Correlation Matrix Panel
 *
 * Displays a region-by-domain risk correlation matrix with color-coded
 * scores, global risk score, hotspot identification, and trend indicators.
 */

import { Panel } from './Panel';
import {
  getMatrix,
  getHotspots,
  getGlobalScore,
  getTrends,
  type MatrixRow,
  type MatrixCell,
  type MatrixRegion,
  type MatrixDomain,
} from '@/services/correlation-matrix';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

const REGION_LABELS: Record<MatrixRegion, string> = {
  'North America': 'N. America',
  'Europe': 'Europe',
  'East Asia': 'E. Asia',
  'South Asia': 'S. Asia',
  'Middle East': 'Middle East',
  'Sub-Saharan Africa': 'Africa',
  'Latin America': 'S. America',
  'Oceania': 'Oceania',
  'Central Asia': 'C. Asia',
  'Southeast Asia': 'SE Asia',
  'Arctic': 'Arctic',
};

const DOMAIN_LABELS: Record<MatrixDomain, string> = {
  military: 'MIL',
  cyber: 'CYB',
  weather: 'WX',
  infrastructure: 'INF',
  financial: 'FIN',
  health: 'HLT',
  conflict: 'CON',
  nuclear: 'NUC',
};

const TREND_ICONS: Record<string, string> = {
  rising: '\u2191',
  stable: '\u2192',
  falling: '\u2193',
};

function getCellColor(score: number): string {
  if (score >= 75) return '#f44336';
  if (score >= 50) return '#ff9800';
  if (score >= 25) return '#ffeb3b';
  return '#4caf50';
}

function getCellBg(score: number): string {
  if (score >= 75) return 'rgba(244,67,54,0.2)';
  if (score >= 50) return 'rgba(255,152,0,0.15)';
  if (score >= 25) return 'rgba(255,235,59,0.1)';
  return 'rgba(76,175,80,0.08)';
}

export class CorrelationMatrixPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({
 id: 'correlation-matrix',
 title: 'Correlation Matrix',
 showCount: false,
 trackActivity: true,
 infoTooltip: 'Region-by-domain risk correlation matrix. Highlights hotspots where multiple threat domains converge in a single region.',
 });
 this.showLoading('Building correlation matrix\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.render(), 60_000);
  }

  private render(): void {
 const snapshot = getMatrix();
 const hotspots = getHotspots(50);
 const globalScore = getGlobalScore();
 const trends = getTrends();

 if (!snapshot || snapshot.rows.length === 0) {
 this.setContent('<div class="panel-empty">No correlation data available.</div>');
 return;
 }

 const color = getCellColor(globalScore);
 const label = globalScore >= 75 ? 'CRITICAL' : globalScore >= 50 ? 'HIGH' : globalScore >= 25 ? 'ELEVATED' : 'NORMAL';
 const time = formatTime(new Date(snapshot.generatedAt));

 const globalHtml = `<div style="text-align:center;padding:10px 0 8px;">
 <div style="display:inline-block;width:72px;height:72px;border-radius:50%;border:4px solid ${color};position:relative;">
 <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
 <span style="font-size:22px;font-weight:700;color:${color};">${globalScore}</span>
 <span style="font-size:9px;font-weight:600;color:${color};">${label}</span>
 </div>
 </div>
 <div style="font-size:11px;color:var(--text-secondary,#aaa);margin-top:4px;">Global Correlation Score</div>
 <div style="font-size:10px;color:var(--text-muted,#888);margin-top:2px;">${escapeHtml(time)}</div>
 </div>`;

 const domains: MatrixDomain[] = ['military', 'cyber', 'weather', 'infrastructure', 'financial', 'health', 'conflict', 'nuclear'];
 const headerCells = domains.map(d => `<th style="font-size:9px;font-weight:600;padding:3px 4px;text-align:center;">${DOMAIN_LABELS[d]}</th>`).join('');

 const bodyRows = snapshot.rows.map((row: MatrixRow) => {
 const regionLabel = REGION_LABELS[row.region] ?? escapeHtml(row.region);
 const trend = trends.get(row.region) ?? 'stable';
 const trendIcon = TREND_ICONS[trend] ?? '\u2192';
 const trendCol = trend === 'rising' ? '#f44336' : trend === 'falling' ? '#4caf50' : '#888';

 const cellMap = new Map<MatrixDomain, MatrixCell>();
 for (const cell of row.cells) cellMap.set(cell.domain, cell);

 const cells = domains.map(d => {
 const cell = cellMap.get(d);
 const score = cell?.score ?? 0;
 return `<td style="text-align:center;padding:3px 4px;background:${getCellBg(score)};">
 <span style="font-size:11px;font-weight:600;color:${getCellColor(score)};">${score}</span>
 </td>`;
 }).join('');

 return `<tr>
 <td style="font-size:10px;padding:3px 4px;white-space:nowrap;">${escapeHtml(regionLabel)} <span style="color:${trendCol};">${trendIcon}</span></td>
 ${cells}
 </tr>`;
 }).join('');

 const matrixHtml = `<div style="margin-top:8px;overflow-x:auto;">
 <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Region \u00D7 Domain</div>
 <table style="width:100%;border-collapse:collapse;">
 <thead><tr><th style="font-size:9px;font-weight:600;padding:3px 4px;text-align:left;">Region</th>${headerCells}</tr></thead>
 <tbody>${bodyRows}</tbody>
 </table>
 </div>`;

 const hotspotsHtml = hotspots.length > 0 ? `<div style="margin-top:10px;">
 <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Hotspots (${hotspots.length})</div>
 ${hotspots.slice(0, 8).map(h => {
 const hColor = getCellColor(h.score);
 return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border-subtle,#333);">
 <span style="font-size:11px;font-weight:700;color:${hColor};width:28px;text-align:right;">${h.score}</span>
 <span style="font-size:11px;">${escapeHtml(REGION_LABELS[h.region] ?? h.region)}</span>
 <span style="font-size:10px;color:var(--text-muted,#888);">\u00B7</span>
 <span style="font-size:11px;color:var(--text-secondary,#aaa);">${escapeHtml(DOMAIN_LABELS[h.domain] ?? h.domain)}</span>
 </div>`;
 }).join('')}
 </div>` : '';

 this.setContent(`<div style="padding:8px 12px;">${globalHtml}${matrixHtml}${hotspotsHtml}</div>`);
  }

  public override destroy(): void {
 if (this.refreshTimer) {
 clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }
}
