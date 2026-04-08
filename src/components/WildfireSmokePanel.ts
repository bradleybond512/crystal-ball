import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { WildfireSmokeReport } from '@/services/wildfire-smoke';

export class WildfireSmokePanel extends Panel {
  constructor() {
 super({ id: 'wildfire-smoke', title: 'Wildfire Smoke', showCount: true, trackActivity: false });
 this.showLoading('Loading smoke data...');
  }

  updateReport(report: WildfireSmokeReport): void {
 this.setCount(report.polygons.length);
 if (report.polygons.length === 0) {
 this.setContent('<div class="panel-empty">No smoke polygons detected.</div>');
 return;
 }
 const densityBg: Record<string, string> = { Heavy: '#c0392b', Medium: '#e67e22', Light: '#f39c12' };
 const rows = report.polygons.slice(0, 40).map(p => {
 const bg = densityBg[p.density] ?? '#555';
 const centroid = p.centroid ? `${p.centroid[1].toFixed(1)}°N, ${p.centroid[0].toFixed(1)}°W` : '';
 return `<div style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:8px">
 <span class="sev-badge" style="background:${bg};color:#fff;font-size:9px;padding:1px 5px;border-radius:3px">${escapeHtml(p.density)}</span>
 <span style="font-size:11px">${escapeHtml(centroid || p.id)}</span>
 </div>`;
 }).join('');
 const summary = `<div style="padding:6px 8px;font-size:10px;opacity:0.6">Heavy: ${report.heavyCount} · Medium: ${report.mediumCount} · Light: ${report.lightCount} · Date: ${escapeHtml(report.date)}</div>`;
 this.setContent(`<div style="overflow-y:auto;max-height:100%">${summary}${rows}</div>`);
  }
}
