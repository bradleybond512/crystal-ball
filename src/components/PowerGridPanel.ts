import { Panel } from './Panel';
import { renderStatusCard } from './StatusCard';
import type { GridStatus, GridAlert } from '@/services/power-grid';

export class PowerGridPanel extends Panel {
  constructor() {
 super({ id: 'power-grid', title: 'Power Grid' });
 this.showLoading('Fetching power grid data...');
  }

  update(data: GridStatus[] | null): void {
 if (!data || data.length === 0) {
 this._renderError();
 return;
 }
 this._render(data);
  }

  private _render(regions: GridStatus[]): void {
 const el = this.getContentElement();

 // Collect all alerts across regions sorted by severity
 const SEVERITY_ORDER: Record<string, number> = { emergency: 0, warning: 1, watch: 2, info: 3 };
 const allAlerts: GridAlert[] = regions
 .flatMap(r => r.alerts)
 .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4));

 // Determine overall status
 const maxUtil = Math.max(...regions.map(r => r.utilizationPct));
 const hasEmergency = allAlerts.some(a => a.severity === 'emergency');
 const hasWarning = allAlerts.some(a => a.severity === 'warning');
 const overallSeverity: 'normal' | 'warning' | 'critical' =
 hasEmergency || maxUtil > 85 ? 'critical'
 : hasWarning || maxUtil > 70 ? 'warning'
 : 'normal';

 const BANNER_BG: Record<string, string> = {
 normal: 'rgba(34,197,94,', warning: 'rgba(234,179,8,', critical: 'rgba(239,68,68,',
 };
 const TEXT_C: Record<string, string> = {
 normal: '#22c55e', warning: '#eab308', critical: '#ef4444',
 };
 const bc = BANNER_BG[overallSeverity] ?? BANNER_BG.warning;
 const tc = TEXT_C[overallSeverity] ?? TEXT_C.warning;
 const label = overallSeverity === 'normal' ? 'NORMAL' : (overallSeverity === 'warning' ? 'ELEVATED' : 'CRITICAL');

 const totalDemand = regions.reduce((sum, r) => sum + r.demand, 0);
 const totalCapacity = regions.reduce((sum, r) => sum + r.capacity, 0);
 const totalPct = totalCapacity > 0 ? Math.round((totalDemand / totalCapacity) * 1000) / 10 : 0;
 const summary = `${esc(formatMW(totalDemand))} / ${esc(formatMW(totalCapacity))} (${totalPct}%)`;

 const dot = `<div style="width:9px;height:9px;border-radius:50%;background:${tc};box-shadow:0 0 5px ${tc};flex-shrink:0;"></div>`;

 // Region utilization bars
 const regionBars = regions.map(r => {
 const pct = r.utilizationPct;
 const barColor = pct > 85 ? '#ef4444' : pct > 70 ? '#eab308' : '#22c55e';
 const barBg = pct > 85 ? 'rgba(239,68,68,0.15)' : pct > 70 ? 'rgba(234,179,8,0.15)' : 'rgba(34,197,94,0.12)';
 return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0;">
 <div style="width:80px;font-size:0.68rem;opacity:0.8;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.region)}">${esc(r.region)}</div>
 <div style="flex:1;height:14px;background:${barBg};border-radius:3px;overflow:hidden;position:relative;">
 <div style="height:100%;width:${Math.min(pct, 100)}%;background:${barColor};border-radius:3px;transition:width 0.3s;"></div>
 </div>
 <div style="width:42px;font-size:0.68rem;text-align:right;color:${barColor};font-weight:600;">${pct}%</div>
 </div>`;
 }).join('');

 // Alert cards
 const ALERT_COLORS: Record<string, string> = {
 emergency: '#ef4444', warning: '#eab308', watch: '#f97316', info: '#94a3b8',
 };
 const alertCards = allAlerts.slice(0, 8).map(a => {
 const ac = ALERT_COLORS[a.severity] ?? '#94a3b8';
 const ts = new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
 return `<div style="padding:0.35rem 0.5rem;background:rgba(${a.severity === 'emergency' ? '239,68,68' : a.severity === 'warning' ? '234,179,8' : '148,163,184'},0.08);border-left:3px solid ${ac};border-radius:3px;margin-bottom:0.3rem;">
 <div style="display:flex;justify-content:space-between;align-items:center;">
 <span style="font-size:0.62rem;font-weight:600;color:${ac};text-transform:uppercase;">${esc(a.severity)}</span>
 <span style="font-size:0.6rem;opacity:0.45;">${esc(ts)}</span>
 </div>
 <div style="font-size:0.7rem;margin-top:0.15rem;">${esc(a.title)}</div>
 <div style="font-size:0.6rem;opacity:0.5;margin-top:0.1rem;">${esc(a.region)}</div>
 </div>`;
 }).join('');

 // Summary cards
 const demandCard = renderStatusCard({
 label: 'Total Demand', value: formatMW(totalDemand), severity: overallSeverity,
 sublabel: `${regions.length} regions`,
 });
 const capacityCard = renderStatusCard({
 label: 'Total Capacity', value: formatMW(totalCapacity), severity: 'normal',
 sublabel: `${totalPct}% utilized`,
 });

 el.innerHTML = `
<div style="padding:0.8rem;display:flex;flex-direction:column;gap:0.7rem;">
  <div style="display:flex;align-items:center;gap:0.55rem;padding:0.55rem 0.7rem;background:${bc}0.08);border:1px solid ${bc}0.28);border-radius:6px;">
 ${dot}
 <div style="flex:1;">
 <div style="font-size:0.8rem;font-weight:600;color:${tc};">Grid Status: ${label}</div>
 <div style="font-size:0.68rem;opacity:0.55;">${summary}</div>
 </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.42rem;">
 ${demandCard}${capacityCard}
  </div>
  <div style="padding:0 0.2rem;">
 <div style="font-size:0.7rem;font-weight:600;opacity:0.7;margin-bottom:0.35rem;">Regional Utilization</div>
 ${regionBars}
  </div>
  ${allAlerts.length > 0 ? `
  <div style="padding:0 0.2rem;">
 <div style="font-size:0.7rem;font-weight:600;opacity:0.7;margin-bottom:0.35rem;">Grid Alerts (${allAlerts.length})</div>
 ${alertCards}
 ${allAlerts.length > 8 ? `<div style="font-size:0.6rem;opacity:0.4;text-align:center;">+${allAlerts.length - 8} more</div>` : ''}
  </div>` : ''}
</div>`;
  }

  private _renderError(): void {
 const el = this.getContentElement();
 el.innerHTML = `<div style="padding:1rem;">${renderStatusCard({ label: 'Power Grid', value: 'Data unavailable', severity: 'unknown', wide: true })}</div>`;
  }
}

function esc(v: string | number): string {
  return String(v)
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;');
}

function formatMW(mw: number): string {
  if (mw >= 1000) return `${(mw / 1000).toFixed(1)} GW`;
  return `${Math.round(mw)} MW`;
}
