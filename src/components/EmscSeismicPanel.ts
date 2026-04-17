import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { EmscEvent } from '@/services/emsc-seismic';

export class EmscSeismicPanel extends Panel {
  constructor() {
 super({ id: 'emsc-seismic', title: 'Nuclear Test Watch', showCount: true, trackActivity: false });
 this.showLoading('Loading seismic data...');
  }

  updateEvents(events: EmscEvent[]): void {
 this.setCount(events.length);
 if (events.length === 0) {
 this.setContent('<div class="panel-empty">No seismic events.</div>');
 return;
 }
 const rows = events.map(e => {
 const isSuspected = e.suspectedNuclearTest;
 const rowStyle = isSuspected ? 'background:rgba(220,50,50,0.12);' : '';
 const mag = e.magnitude === null ? 'M?' : `M${e.magnitude.toFixed(1)}`;
 const region = e.region ?? 'Unknown';
 const badgeBg = isSuspected ? '#c0392b' : '#555';
 const badgeLabel = isSuspected ? 'NUCLEAR?' : (e.magnitudeType ?? 'SEISMIC');
 const site = e.nearTestSite ? ` · near ${e.nearTestSite.label}` : '';
 return `<div style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.06);${rowStyle}">
 <div style="display:flex;align-items:center;gap:6px">
 <span class="sev-badge" style="background:${badgeBg};color:#fff;font-size:9px;padding:1px 5px;border-radius:3px">${escapeHtml(badgeLabel)}</span>
 <span style="font-weight:600;font-size:11px">${escapeHtml(mag)} — ${escapeHtml(region)}</span>
 </div>
 <div style="font-size:10px;opacity:0.6;margin-top:2px">Depth: ${e.depth === null ? '?' : `${e.depth}km`}${escapeHtml(site)}</div>
 </div>`;
 }).join('');
 this.setContent(`<div style="overflow-y:auto;max-height:100%">${rows}</div>`);
  }
}
