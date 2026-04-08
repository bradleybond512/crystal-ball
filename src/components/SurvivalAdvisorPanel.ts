/**
 * Survival Advisor Panel
 *
 * Displays AI-generated (or static fallback) survival advice organised by
 * category with priority-coloured borders, a top-level safety status bar,
 * resource and family summaries, and a manual refresh button.
 */

import { Panel } from './Panel';
import {
  generateSurvivalAdvice,
  getCachedAdvice,
  subscribeSurvivalAdvice,
  type SurvivalAdvice,
  type AdviceItem,
  type AdvicePriority,
  type AdviceCategory,
} from '@/services/survival-advisor';

// ── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<AdvicePriority, string> = {
  critical: '#ef4444', // red
  high: '#f97316', // orange
  medium: '#eab308', // yellow
  low: '#22c55e', // green
};

const PRIORITY_LABELS: Record<AdvicePriority, string> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
};

const CATEGORY_ICONS: Record<AdviceCategory, string> = {
  'immediate-actions': '\u26A1',
  'resource-management': '\uD83C\uDF92',
  'evacuation-assessment': '\uD83D\uDEE3\uFE0F',
  'family-safety': '\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66',
  '72-hour-outlook': '\uD83D\uDD2E',
};

const CATEGORY_LABELS: Record<AdviceCategory, string> = {
  'immediate-actions': 'Immediate Actions',
  'resource-management': 'Resource Management',
  'evacuation-assessment': 'Evacuation Assessment',
  'family-safety': 'Family Safety',
  '72-hour-outlook': '72-Hour Outlook',
};

const STATUS_COLORS: Record<string, string> = {
  'SAFE': '#22c55e',
  'AT RISK': '#f97316',
  'IN DANGER': '#ef4444',
};

import { escapeHtml as esc } from '@/utils/sanitize';

// ── Panel ────────────────────────────────────────────────────────────────────

export class SurvivalAdvisorPanel extends Panel {
  private _advice: SurvivalAdvice | null = null;
  private _loading = false;
  private _unsubscribe: (() => void) | null = null;

  constructor() {
 super({
 id: 'survival-advisor',
 title: 'Survival Advisor',
 infoTooltip: 'AI-powered survival guidance based on your location, resources, family status, active alerts, and threat conditions. Refreshes automatically when conditions change.',
 });

 this._advice = getCachedAdvice();
 if (this._advice) {
 this._render();
 } else {
 this.showLoading('Generating survival guidance...');
 }

 this._unsubscribe = subscribeSurvivalAdvice((advice) => {
 this._advice = advice;
 this._loading = false;
 this._render();
 });
  }

  /** Call after panel is mounted to begin initial fetch if no cache. */
  public init(): void {
 if (!this._advice) this._refresh();
  }

  private _refresh(): void {
 if (this._loading) return;
 this._loading = true;
 this._renderLoading();
 void generateSurvivalAdvice()
 .then((advice) => {
 this._advice = advice;
 this._loading = false;
 this._render();
 })
 .catch(() => {
 this._loading = false;
 this.showError('Failed to generate survival advice. Check your network connection.');
 });
  }

  private _renderLoading(): void {
 this.showLoading('Analysing survival context...');
  }

  private _render(): void {
 const advice = this._advice;
 if (!advice) {
 this._renderLoading();
 return;
 }

 const statusColor = STATUS_COLORS[advice.status] ?? '#9ca3af';
 const sourceLabel = advice.source === 'ai' ? 'AI-generated' : 'Checklist mode';
 const ageMinutes = Math.round((Date.now() - advice.generatedAt) / 60_000);
 const ageLabel = ageMinutes < 1 ? 'just now' : `${ageMinutes}m ago`;

 // Group items by category (maintain order)
 const categoryOrder: AdviceCategory[] = [
 'immediate-actions',
 'resource-management',
 'evacuation-assessment',
 'family-safety',
 '72-hour-outlook',
 ];
 const grouped = new Map<AdviceCategory, AdviceItem[]>();
 for (const cat of categoryOrder) {
 grouped.set(cat, []);
 }
 for (const item of advice.items) {
 const arr = grouped.get(item.category);
 if (arr) arr.push(item);
 }

 // Build HTML
 const parts: string[] = [];

 // Status bar
 parts.push(`
 <div class="sa-status-bar" style="background:${statusColor}; color:#fff; padding:8px 12px; border-radius:6px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
 <span style="font-weight:700; font-size:14px;">You are ${esc(advice.status)}</span>
 <span style="font-size:11px; opacity:0.85;">${esc(sourceLabel)} \u00B7 ${esc(ageLabel)}</span>
 </div>
 `);

 // Resource summary row
 if (advice.resourceSummary.length > 0) {
 const resParts = advice.resourceSummary.slice(0, 4).map(r => {
 const d = r.daysLeft;
 const color = d < 3 ? '#ef4444' : (d <= 7 ? '#eab308' : '#22c55e');
 return `<span style="color:${color}; font-weight:600;">${esc(r.name)}: ${d.toFixed(0)}d</span>`;
 });
 parts.push(`
 <div class="sa-summary-row" style="font-size:12px; padding:6px 10px; background:rgba(255,255,255,0.03); border-radius:4px; margin-bottom:6px; display:flex; gap:12px; flex-wrap:wrap;">
 <span style="opacity:0.6;">\uD83C\uDF92</span> ${resParts.join(' <span style="opacity:0.3;">|</span> ')}
 </div>
 `);
 }

 // Family summary row
 if (advice.familySummary.total > 0) {
 const famColor = advice.familySummary.safe === advice.familySummary.total ? '#22c55e' : '#f97316';
 parts.push(`
 <div class="sa-summary-row" style="font-size:12px; padding:6px 10px; background:rgba(255,255,255,0.03); border-radius:4px; margin-bottom:10px;">
 <span style="opacity:0.6;">\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66</span>
 <span style="color:${famColor}; font-weight:600;">${advice.familySummary.safe}/${advice.familySummary.total} family members safe</span>
 </div>
 `);
 }

 // Advice sections
 for (const cat of categoryOrder) {
 const items = grouped.get(cat);
 if (!items || items.length === 0) continue;

 const icon = CATEGORY_ICONS[cat];
 const label = CATEGORY_LABELS[cat];

 parts.push(`
 <div class="sa-category" style="margin-bottom:12px;">
 <div style="font-size:12px; font-weight:600; opacity:0.7; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px;">
 ${icon} ${esc(label)}
 </div>
 `);

 for (const item of items) {
 const borderColor = PRIORITY_COLORS[item.priority];
 const priorityLabel = PRIORITY_LABELS[item.priority];
 const itemId = `sa-item-${Math.random().toString(36).slice(2, 8)}`;

 parts.push(`
 <div class="sa-advice-card" style="border-left:3px solid ${borderColor}; padding:8px 10px; margin-bottom:6px; background:rgba(255,255,255,0.02); border-radius:0 4px 4px 0; cursor:pointer;" data-sa-toggle="${itemId}">
 <div style="display:flex; align-items:center; gap:8px;">
 <span class="sa-priority-badge" style="font-size:9px; font-weight:700; color:${borderColor}; min-width:55px;">${priorityLabel}</span>
 <span style="font-size:13px; flex:1;">${esc(item.action)}</span>
 <span class="sa-chevron" style="font-size:10px; opacity:0.4; transition:transform 0.2s;">&#9660;</span>
 </div>
 <div id="${itemId}" class="sa-rationale" style="display:none; font-size:11px; opacity:0.6; margin-top:6px; padding-left:63px;">
 ${esc(item.rationale)}
 </div>
 </div>
 `);
 }

 parts.push('</div>');
 }

 // Refresh button
 parts.push(`
 <div style="text-align:center; margin-top:8px;">
 <button class="sa-refresh-btn" style="font-size:12px; padding:6px 16px; border-radius:4px; border:1px solid rgba(255,255,255,0.15); background:rgba(255,255,255,0.05); color:inherit; cursor:pointer;">
 \u21BB Refresh Advice
 </button>
 </div>
 `);

 this.setContent(`<div class="sa-wrap" style="padding:4px;">${parts.join('')}</div>`);
 this._attachListeners();
  }

  private _attachListeners(): void {
 const el = this.getContentElement();
 if (!el) return;

 // Collapsible rationale cards
 el.querySelectorAll<HTMLElement>('[data-sa-toggle]').forEach(card => {
 card.addEventListener('click', () => {
 const targetId = card.getAttribute('data-sa-toggle');
 if (!targetId) return;
 const rationale = el.querySelector<HTMLElement>(`#${targetId}`);
 if (!rationale) return;
 const isOpen = rationale.style.display !== 'none';
 rationale.style.display = isOpen ? 'none' : 'block';
 const chevron = card.querySelector<HTMLElement>('.sa-chevron');
 if (chevron) {
 chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
 }
 });
 });

 // Refresh button
 el.querySelector('.sa-refresh-btn')?.addEventListener('click', () => {
 this._refresh();
 });
  }

  public override destroy(): void {
 if (this._unsubscribe) {
 this._unsubscribe();
 this._unsubscribe = null;
 }
 super.destroy();
  }
}
