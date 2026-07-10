/**
 * After-Action Review (AAR) Panel
 *
 * Post-incident analysis workflow. Create, review, and finalize AARs
 * with timelines, lessons learned, and recommendations.
 */

import { Panel } from './Panel';
import { getAars, getAarCount, type AarEntry } from '@/services/after-action-review';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

const STATUS_BADGES: Record<string, string> = {
  draft: '\uD83D\uDCDD Draft',
  in_review: '\uD83D\uDD0D In Review',
  finalized: '\u2705 Finalized',
};

export class AarPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private expandedAarId: string | null = null;

  constructor() {
 super({
 id: 'after-action-review',
 title: 'After-Action Review',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Post-incident After-Action Review workflow. Document incident timelines, capture what worked and what failed, and track lessons learned and recommendations for future response.',
 });
 this.showLoading('Loading AARs\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 5 * 60 * 1000);
  }

  private render(): void {
 const aars = getAars();
 const count = getAarCount();

 this.setCount(count);

 if (aars.length === 0) {
 this.setContent(`
 <div class="panel-empty">
 No After-Action Reviews created. AARs help document incident response timelines, capture lessons learned, and improve future preparedness.
 </div>
 `);
 return;
 }

 const draftCount = aars.filter(a => a.status === 'draft').length;
 const finalCount = aars.filter(a => a.status === 'finalized').length;

 const statsHtml = `<div class="aar-stats">
 <span>${count} total</span>
 <span class="aar-sep">\u2502</span>
 <span>${draftCount} drafts</span>
 <span class="aar-sep">\u2502</span>
 <span>${finalCount} finalized</span>
 </div>`;

 const cards = aars.slice(0, 15).map(a => this.renderAar(a)).join('');

 this.setContent(`
 <div style="padding:8px 12px;">
 ${statsHtml}
 <div class="aar-list">${cards}</div>
 </div>
 `);

 this.getContentElement().querySelectorAll('.aar-card').forEach(card => {
 card.addEventListener('click', () => {
 const id = card.getAttribute('data-aar-id');
 this.expandedAarId = this.expandedAarId === id ? null : id;
 this.render();
 });
 });
  }

  private renderAar(aar: AarEntry): string {
 const expanded = this.expandedAarId === aar.id;
 const title = escapeHtml(aar.title);
 const status = STATUS_BADGES[aar.status] ?? aar.status;
 const incDate = formatTime(new Date(aar.incidentDate));
 const mode = escapeHtml(aar.mode);

 const detailHtml = expanded ? `
 <div class="aar-expanded">
 <div class="aar-summary-text">${escapeHtml(aar.summary)}</div>
 ${aar.timeline.length > 0 ? `
 <div class="aar-section-title">TIMELINE</div>
 <div class="aar-timeline">${aar.timeline.map(t =>
 `<div class="aar-tl-entry">
 <span class="aar-tl-time">${formatTime(new Date(t.timestamp))}</span>
 <span class="aar-tl-desc">${escapeHtml(t.description)}</span>
 </div>`
 ).join('')}</div>
 ` : ''}
 ${aar.whatWorked.length > 0 ? `
 <div class="aar-section-title">\u2705 WHAT WORKED</div>
 <ul class="aar-items">${aar.whatWorked.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
 ` : ''}
 ${aar.whatFailed.length > 0 ? `
 <div class="aar-section-title">\u274C WHAT FAILED</div>
 <ul class="aar-items">${aar.whatFailed.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
 ` : ''}
 ${aar.recommendations.length > 0 ? `
 <div class="aar-section-title">\uD83D\uDCA1 RECOMMENDATIONS</div>
 <ul class="aar-items">${aar.recommendations.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
 ` : ''}
 ${aar.lessonsLearned.length > 0 ? `
 <div class="aar-section-title">\uD83D\uDCDA LESSONS LEARNED</div>
 <ul class="aar-items">${aar.lessonsLearned.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
 ` : ''}
 </div>
 ` : '';

 return `<div class="aar-card" data-aar-id="${aar.id}">
 <div class="aar-card-header">
 <span class="aar-title">${title}</span>
 <span class="aar-status-badge">${status}</span>
 </div>
 <div class="aar-card-meta">
 <span class="aar-mode">${mode} mode</span>
 <span class="aar-incident-date">Incident: ${incDate}</span>
 <span class="aar-tl-count">${aar.timeline.length} events</span>
 </div>
 ${detailHtml}
 </div>`;
  }

  public override destroy(): void {
 if (this.refreshTimer) {
 clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }
}
