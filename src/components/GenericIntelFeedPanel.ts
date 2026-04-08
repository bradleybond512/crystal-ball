import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

export interface IntelItem {
  title: string | null;
  link: string | null;
  date: string | null;
  summary: string | null;
  source: string;
  badge?: string;
}

const SOURCE_COLORS: Record<string, string> = {
  ISW: '#4a90e2',
  NATO: '#003865',
  DoD: '#1a4a1a',
  Pentagon: '#1a4a1a',
  OSINT: '#7c3aed',
  Bellingcat: '#7c3aed',
  ReliefWeb: '#e67e22',
  FCDO: '#012169',
  DFAT: '#00843d',
  GAC: '#d80621',
  ACAPS: '#c0392b',
  LiveUAMap: '#e74c3c',
  ECDC: '#003399',
  FDIC: '#1a237e',
  'UN SC': '#009edb',
  HABSOS: '#16a085',
  DSCA: '#2c3e50',
  Amtrak: '#004b87',
  Avalanche: '#2980b9',
  Congress: '#8b0000',
  COCOM: '#2c3e50',
  SPC: '#c0392b',
};

function badgeColor(source: string): string {
  return SOURCE_COLORS[source] ?? '#555';
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export class GenericIntelFeedPanel extends Panel {
  constructor(options: ConstructorParameters<typeof Panel>[0]) {
 super(options);
 this.showLoading('Loading...');
  }

  public update(items: IntelItem[]): void {
 this.setCount(items.length);
 if (items.length === 0) {
 this.setContent('<div class="panel-empty">No items available.</div>');
 return;
 }
 const rows = items.map(item => {
 const color = badgeColor(item.badge ?? item.source);
 const badge = `<span class="sev-badge" style="background:${color};color:#fff;font-size:9px;padding:1px 5px;border-radius:3px;vertical-align:middle">${escapeHtml(item.badge ?? item.source)}</span>`;
 const title = item.title ? escapeHtml(item.title) : '(no title)';
 const titleHtml = item.link
 ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none;font-weight:600">${title}</a>`
 : `<span style="font-weight:600">${title}</span>`;
 const ago = timeAgo(item.date);
 const summary = item.summary
 ? `<div style="opacity:0.6;font-size:10px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:420px">${escapeHtml(item.summary.slice(0, 200))}</div>`
 : '';
 return `<div class="intel-feed-row" style="padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.06)">
 <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
 ${badge}
 <span style="font-size:11px;flex:1">${titleHtml}</span>
 ${ago ? `<span style="font-size:10px;opacity:0.45;white-space:nowrap">${escapeHtml(ago)}</span>` : ''}
 </div>
 ${summary}
 </div>`;
 }).join('');
 this.setContent(`<div class="intel-feed-list" style="overflow-y:auto;max-height:100%">${rows}</div>`);
  }
}
