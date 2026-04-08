import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { GovConvergenceResult } from '@/services/travel-warnings';

export class GovConvergencePanel extends Panel {
  constructor() {
 super({ id: 'gov-convergence', title: 'Multi-Gov Alert Convergence', showCount: true, trackActivity: false });
 this.showLoading('Loading...');
  }

  updateResults(results: GovConvergenceResult[]): void {
 const alerts = results.filter(r => r.isConvergenceAlert);
 this.setCount(alerts.length);
 if (alerts.length === 0) {
 this.setContent('<div class="panel-empty">No multi-government convergence alerts.</div>');
 return;
 }
 const rows = alerts.map(a => {
 const sources = a.recentSources.join(', ') || a.sources.join(', ');
 return `<div style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.06)">
 <div style="display:flex;align-items:center;gap:6px">
 <span class="sev-badge" style="background:#c0392b;color:#fff;font-size:9px;padding:1px 5px;border-radius:3px">${a.recentCount}+ GOV</span>
 <span style="font-weight:600;font-size:11px">${escapeHtml(a.country)}</span>
 </div>
 <div style="font-size:10px;opacity:0.6;margin-top:2px">${escapeHtml(sources)}</div>
 </div>`;
 }).join('');
 this.setContent(`<div style="overflow-y:auto;max-height:100%">${rows}</div>`);
  }
}
