import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { CbMeeting } from '@/services/central-bank-calendar';

export class CentralBankCalendarPanel extends Panel {
  constructor() {
 super({ id: 'central-bank-calendar', title: 'Central Bank Calendar', showCount: true, trackActivity: false });
 this.showLoading('Loading calendar...');
  }

  updateMeetings(meetings: CbMeeting[]): void {
 this.setCount(meetings.length);
 if (meetings.length === 0) {
 this.setContent('<div class="panel-empty">No upcoming central bank meetings.</div>');
 return;
 }
 const rows = meetings.map(m => {
 const urgency = m.daysUntil <= 7 ? '#c0392b' : m.daysUntil <= 30 ? '#e67e22' : '#555';
 const daysLabel = m.daysUntil === 0 ? 'TODAY' : `${m.daysUntil}d`;
 const dateStr = m.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
 return `<div style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:8px">
 <span class="sev-badge" style="background:${urgency};color:#fff;font-size:9px;padding:1px 5px;border-radius:3px;min-width:36px;text-align:center">${escapeHtml(daysLabel)}</span>
 <span style="font-weight:600;font-size:11px">${escapeHtml(m.shortName)}</span>
 <span style="font-size:10px;opacity:0.6">${escapeHtml(m.bank)}</span>
 <span style="font-size:10px;opacity:0.5;margin-left:auto">${escapeHtml(dateStr)}</span>
 </div>`;
 }).join('');
 this.setContent(`<div style="overflow-y:auto;max-height:100%">${rows}</div>`);
  }
}
