/**
 * Course-of-Action (COA) Panel
 *
 * Displays 2-3 concrete action plans when the app enters an elevated
 * threat mode (war, disaster, ghost). Each COA has steps, risks,
 * resources, and links to related panels.
 *
 * Inspired by Palantir AIP decision-support and OODA loop logic.
 */

import { Panel } from './Panel';
import { generateCoas, getCurrentCoas, type CourseOfAction } from '@/services/course-of-action';
import { getMode, type AppMode } from '@/services/mode-manager';
import { escapeHtml } from '@/utils/sanitize';
import { getHomeLocationLabel } from '@/components/location-gate';

const PRIORITY_ICONS: Record<string, string> = {
  immediate: '\uD83D\uDD34', // 🔴
  'near-term': '\uD83D\uDFE0',  // 🟠
  contingency: '\uD83D\uDFE2',  // 🟢
};

export class CourseOfActionPanel extends Panel {
  private modeListener: ((e: Event) => void) | null = null;
  private expandedId: string | null = null;

  constructor() {
 super({
 id: 'course-of-action',
 title: 'Course of Action',
 showCount: false,
 trackActivity: true,
 infoTooltip: 'AI-assisted action plans for the current threat situation. Generates 2-3 concrete Courses of Action (COAs) with steps, risks, and resource requirements when an elevated threat mode is detected.',
 });
 this.init();
  }

  private init(): void {
 // Generate initial COAs
 this.generateForMode(getMode());

 // Re-generate when mode changes
 this.modeListener = (e: Event) => {
 const detail = (e as CustomEvent).detail as { mode?: AppMode | null } | undefined;
 this.generateForMode(detail?.mode ?? null);
 };
 window.addEventListener('wm:mode-changed', this.modeListener);
  }

  private generateForMode(mode: AppMode | null): void {
 const location = getHomeLocationLabel();
 generateCoas(mode, location ?? undefined);
 this.render();
  }

  private render(): void {
 const coaSet = getCurrentCoas();

 if (!coaSet || coaSet.options.length === 0) {
 this.setContent(`
 <div class="panel-empty">
 No action plans needed in Peace mode. COAs will be generated automatically when the threat mode escalates to War, Disaster, or Ghost.
 </div>
 `);
 return;
 }

 const modeName = coaSet.mode ?? 'default';
 const modeLabel = modeName.charAt(0).toUpperCase() + modeName.slice(1);
 const locLabel = coaSet.location ? ` \u2014 ${escapeHtml(coaSet.location)}` : '';

 const headerHtml = `<div class="coa-header">
 <span class="coa-mode-badge coa-mode-${modeName}">${modeLabel} Mode${locLabel}</span>
 <span class="coa-count">${coaSet.options.length} options</span>
 </div>`;

 const cardsHtml = coaSet.options.map(coa => this.renderCoa(coa)).join('');

 this.setContent(`
 <div style="padding:8px 12px;">
 ${headerHtml}
 <div class="coa-list">${cardsHtml}</div>
 </div>
 `);

 // Wire click handlers for expand/collapse
 this.getContentElement().querySelectorAll('.coa-card').forEach(card => {
 card.addEventListener('click', () => {
 const id = card.getAttribute('data-coa-id');
 this.expandedId = this.expandedId === id ? null : id;
 this.render();
 });
 });
  }

  private renderCoa(coa: CourseOfAction): string {
 const icon = PRIORITY_ICONS[coa.priority] ?? '\u2B55';
 const expanded = this.expandedId === coa.id;

 const stepsHtml = expanded ? `
 <div class="coa-expanded">
 <div class="coa-section-title">STEPS</div>
 <ol class="coa-steps">${coa.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
 <div class="coa-section-title">RISKS</div>
 <ul class="coa-risks">${coa.risks.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
 <div class="coa-section-title">RESOURCES NEEDED</div>
 <ul class="coa-resources">${coa.resources.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
 <div class="coa-time">\u23F1 ${escapeHtml(coa.timeEstimate)}</div>
 </div>
 ` : '';

 return `<div class="coa-card ${expanded ? 'coa-card-expanded' : ''}" data-coa-id="${coa.id}">
 <div class="coa-card-header">
 <span>${icon}</span>
 <span class="coa-title">${escapeHtml(coa.title)}</span>
 <span class="coa-priority">${escapeHtml(coa.priority)}</span>
 </div>
 <div class="coa-summary">${escapeHtml(coa.summary)}</div>
 ${stepsHtml}
 </div>`;
  }

  public override destroy(): void {
 if (this.modeListener) {
 window.removeEventListener('wm:mode-changed', this.modeListener);
 this.modeListener = null;
 }
 super.destroy();
  }
}
