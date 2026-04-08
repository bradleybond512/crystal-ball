/**
 * Unified Alert Inbox Panel
 *
 * Single sortable, filterable view that merges ALL alert sources into one
 * prioritized stream. Replaces the need to check 7+ separate panels.
 *
 * Features:
 *  - Ingests from: breaking news, NWS, GDACS, tsunami, hazards, correlation, OREF
 *  - Sort by: relevance (default), severity, time, distance
 *  - Filter by: source type, severity level, unread/all
 *  - Acknowledge (dismiss) and pin (star) individual alerts
 *  - Keyboard shortcuts: J/K navigate, A acknowledge, P pin
 *  - Badge count for unread alerts in sidebar
 */

import { Panel } from './Panel';
import {
  unifiedAlertStore,
  type UnifiedAlert,
  type AlertSeverity,
  type AlertSource,
} from '@/services/unified-alerts';
import { scoreAndSort } from '@/services/relevance-scoring';
import { EvidenceDrawer } from './EvidenceDrawer';

type SortMode = 'relevance' | 'severity' | 'time' | 'distance';
type FilterShow = 'unread' | 'all';

const NEAR_ME_RADIUS_KEY = 'wm-near-me-radius';
const NEAR_ME_ACTIVE_KEY = 'wm-near-me-active';
const KM_PER_MI = 1.609_34;
const RADIUS_OPTIONS_MI = [50, 100, 250, 500, 1000] as const;

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  critical: 5, high: 4, medium: 3, low: 2, info: 1,
};

const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  critical: 'CRIT', high: 'HIGH', medium: 'MED', low: 'LOW', info: 'INFO',
};

const SOURCE_LABELS: Record<AlertSource, string> = {
  'breaking-news': 'News',
  nws: 'NWS',
  gdacs: 'GDACS',
  tsunami: 'Tsunami',
  volcano: 'Volcano',
  oref: 'OREF',
  hazard: 'Hazard',
  correlation: 'Signal',
  cyber: 'Cyber',
  resource: 'Resource',
};

export class UnifiedAlertInboxPanel extends Panel {
  private sortMode: SortMode = 'relevance';
  private filterShow: FilterShow = 'unread';
  private filterSources: Set<AlertSource> | null = null; // null = all
  private filterMinSeverity: AlertSeverity = 'info';
  private nearMeActive: boolean;
  private nearMeRadiusMi: number;
  private selectedIndex = -1;
  private readonly evidenceDrawer = new EvidenceDrawer();
  private readonly unsubscribe: () => void;
  private readonly boundOnClick: (e: Event) => void;
  private readonly boundOnKeydown: (e: Event) => void;

  constructor() {
 super({
 id: 'unified-alert-inbox',
 title: 'Alert Inbox',
 showCount: true,
 trackActivity: true,
 infoTooltip:
 'Unified view of all alerts sorted by relevance. Combines breaking news, weather, disasters, hazards, and intelligence signals.',
 });

 // Restore Near Me state from localStorage
 this.nearMeActive = localStorage.getItem(NEAR_ME_ACTIVE_KEY) === 'true';
 this.nearMeRadiusMi = Number.parseInt(localStorage.getItem(NEAR_ME_RADIUS_KEY) ?? '500', 10) || 500;

 // Subscribe to store changes
 this.unsubscribe = unifiedAlertStore.subscribe(() => {
 this.updateBadge();
 this.render();
 });

 // Delegated click handler
 this.boundOnClick = (e: Event) => this.handleClick(e);
 this.content.addEventListener('click', this.boundOnClick);

 // Keyboard navigation
 this.boundOnKeydown = (e: Event) => this.handleKeydown(e as KeyboardEvent);
 this.element.addEventListener('keydown', this.boundOnKeydown);
 this.element.setAttribute('tabindex', '0');

 this.updateBadge();
 this.render();
  }

  override destroy(): void {
 this.unsubscribe();
 this.content.removeEventListener('click', this.boundOnClick);
 this.element.removeEventListener('keydown', this.boundOnKeydown);
 super.destroy();
  }

  /** Called when panel becomes visible */
  onActivate(): void {
 this.updateBadge();
  }

  /** External entry point: ingest new unified alerts */
  public ingestAlerts(alerts: UnifiedAlert[]): void {
 unifiedAlertStore.ingest(alerts);
  }

  // ── Filtering & Sorting ─────────────────────────────────────────────────

  private getFilteredAlerts(): UnifiedAlert[] {
 let alerts = unifiedAlertStore.getAll();

 // Filter: show unread only
 if (this.filterShow === 'unread') {
 alerts = alerts.filter(a => !a.acknowledged || a.pinned);
 }

 // Filter: source types
 if (this.filterSources) {
 const sources = this.filterSources;
 alerts = alerts.filter(a => sources.has(a.source));
 }

 // Filter: minimum severity
 const minSev = SEVERITY_ORDER[this.filterMinSeverity];
 if (minSev > 1) {
 alerts = alerts.filter(a => SEVERITY_ORDER[a.severity] >= minSev);
 }

 // Filter: Near Me radius
 if (this.nearMeActive) {
 const radiusKm = this.nearMeRadiusMi * KM_PER_MI;
 alerts = alerts.filter(a => a.distanceKm != null && a.distanceKm <= radiusKm);
 }

 // Sort
 switch (this.sortMode) {
 case 'relevance': {
 return scoreAndSort(alerts);
 }
 case 'severity': {
 return alerts.sort((a, b) => {
 if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
 return SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || b.timestamp - a.timestamp;
 });
 }
 case 'time': {
 return alerts.sort((a, b) => {
 if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
 return b.timestamp - a.timestamp;
 });
 }
 case 'distance': {
 return alerts.sort((a, b) => {
 if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
 const da = a.distanceKm ?? Infinity;
 const db = b.distanceKm ?? Infinity;
 return da - db;
 });
 }
 default: {
 return scoreAndSort(alerts);
 }
 }
  }

  private updateBadge(): void {
 this.setCount(unifiedAlertStore.getUnacknowledgedCount());
  }

  // ── Event Handlers ──────────────────────────────────────────────────────

  private handleClick(e: Event): void {
 const target = e.target as HTMLElement;

 if (this.handleToolbarClick(target)) return;
 if (this.handleNearMeClick(target)) return;
 if (this.handleAlertActionClick(e, target)) return;
  }

  /** Handle sort, filter-show, severity, source filter, clear, ack-all toolbar clicks. */
  private handleToolbarClick(target: HTMLElement): boolean {
 const sortBtn = target.closest('[data-sort]') as HTMLElement | null;
 if (sortBtn) {
 this.sortMode = sortBtn.dataset.sort as SortMode;
 this.render();
 return true;
 }

 const showBtn = target.closest('[data-filter-show]') as HTMLElement | null;
 if (showBtn) {
 this.filterShow = showBtn.dataset.filterShow as FilterShow;
 this.render();
 return true;
 }

 const sevBtn = target.closest('[data-filter-sev]') as HTMLElement | null;
 if (sevBtn) {
 this.filterMinSeverity = sevBtn.dataset.filterSev as AlertSeverity;
 this.render();
 return true;
 }

 const srcBtn = target.closest('[data-filter-src]') as HTMLElement | null;
 if (srcBtn) {
 const src = srcBtn.dataset.filterSrc as AlertSource;
 if (!this.filterSources) {
 this.filterSources = new Set([src]);
 } else if (this.filterSources.has(src)) {
 this.filterSources.delete(src);
 if (this.filterSources.size === 0) this.filterSources = null;
 } else {
 this.filterSources.add(src);
 }
 this.render();
 return true;
 }

 if (target.closest('[data-clear-src]')) {
 this.filterSources = null;
 this.render();
 return true;
 }

 if (target.closest('[data-ack-all]')) {
 unifiedAlertStore.acknowledgeAll();
 return true;
 }

 return false;
  }

  /** Handle Near Me toggle and radius selector clicks. */
  private handleNearMeClick(target: HTMLElement): boolean {
 if (target.closest('[data-near-me-toggle]')) {
 this.nearMeActive = !this.nearMeActive;
 localStorage.setItem(NEAR_ME_ACTIVE_KEY, String(this.nearMeActive));
 if (this.nearMeActive) this.sortMode = 'distance';
 this.render();
 return true;
 }

 const radiusBtn = target.closest('[data-near-me-radius]') as HTMLElement | null;
 if (radiusBtn) {
 this.nearMeRadiusMi = Number.parseInt(radiusBtn.dataset.nearMeRadius!, 10);
 localStorage.setItem(NEAR_ME_RADIUS_KEY, String(this.nearMeRadiusMi));
 this.render();
 return true;
 }

 return false;
  }

  /** Handle per-alert actions: ack, pin, evidence drawer. */
  private handleAlertActionClick(e: Event, target: HTMLElement): boolean {
 const ackBtn = target.closest('[data-ack]') as HTMLElement | null;
 if (ackBtn) {
 e.stopPropagation();
 unifiedAlertStore.acknowledge(ackBtn.dataset.ack!);
 return true;
 }

 const pinBtn = target.closest('[data-pin]') as HTMLElement | null;
 if (pinBtn) {
 e.stopPropagation();
 unifiedAlertStore.togglePin(pinBtn.dataset.pin!);
 return true;
 }

 const whyBtn = target.closest('.uai-why-btn') as HTMLElement | null;
 if (whyBtn) {
 e.stopPropagation();
 const alertId = whyBtn.dataset.alertId;
 if (!alertId) return true;
 const alerts = unifiedAlertStore.getAll();
 const alert = alerts.find(a => a.id === alertId);
 if (!alert?.evidence) return true;
 this.evidenceDrawer.show({
 title: alert.title,
 subtitle: alert.body,
 evidence: alert.evidence,
 });
 return true;
 }

 return false;
  }

  private handleKeydown(e: KeyboardEvent): void {
 const alerts = this.getFilteredAlerts();
 if (alerts.length === 0) return;

 switch (e.key) {
 case 'j':
 case 'ArrowDown': {
 e.preventDefault();
 this.selectedIndex = Math.min(this.selectedIndex + 1, alerts.length - 1);
 this.render();
 break;
 }
 case 'k':
 case 'ArrowUp': {
 e.preventDefault();
 this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
 this.render();
 break;
 }
 case 'a': {
 const ackTarget = alerts[this.selectedIndex];
 if (ackTarget) unifiedAlertStore.acknowledge(ackTarget.id);
 break;
 }
 case 'p': {
 const pinTarget = alerts[this.selectedIndex];
 if (pinTarget) unifiedAlertStore.togglePin(pinTarget.id);
 break;
 }
 }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  private render(): void {
 const alerts = this.getFilteredAlerts();
 const totalCount = unifiedAlertStore.getAll().length;

 if (totalCount === 0) {
 this.setContent(
 '<div class="panel-empty">No alerts yet. Alerts from all sources will appear here.</div>',
 );
 return;
 }

 const toolbar = this.renderToolbar();
 const rows = alerts.map((a, i) => this.renderRow(a, i)).join('');

 this.setContent(`
 <div class="uai-container">
 ${toolbar}
 <div class="uai-list">
 <table class="eq-table ct-table uai-table">
 <thead>
 <tr>
 <th class="uai-th-sev">Sev</th>
 <th class="uai-th-src">Src</th>
 <th>Alert</th>
 <th class="uai-th-score">Score</th>
 <th class="uai-th-dist">Dist</th>
 <th class="uai-th-age">Age</th>
 <th class="uai-th-act"></th>
 </tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 </div>
 <div class="fires-footer">
 <span class="fires-source">Unified Alert Inbox \u00B7 ${alerts.length} of ${totalCount}</span>
 <span class="fires-updated">Sort: ${this.sortMode} \u00B7 J/K navigate \u00B7 A ack \u00B7 P pin</span>
 </div>
 </div>
 `);
  }

  private renderToolbar(): string {
 const sortLabelMap: Record<SortMode, string> = { relevance: 'Rel', severity: 'Sev', time: 'Time', distance: 'Dist' };
 const sortBtns = (['relevance', 'severity', 'time', 'distance'] as const)
 .map(
 s =>
 `<button class="uai-toolbar-btn${this.sortMode === s ? ' uai-active' : ''}" data-sort="${s}">${sortLabelMap[s]}</button>`,
 )
 .join('');

 const showBtns = (['unread', 'all'] as const)
 .map(
 s =>
 `<button class="uai-toolbar-btn${this.filterShow === s ? ' uai-active' : ''}" data-filter-show="${s}">${s === 'unread' ? 'Unread' : 'All'}</button>`,
 )
 .join('');

 const sevBtns = (['info', 'low', 'medium', 'high', 'critical'] as const)
 .map(
 s =>
 `<button class="uai-toolbar-btn uai-sev-btn${this.filterMinSeverity === s ? ' uai-active' : ''}" data-filter-sev="${s}">${s === 'info' ? 'All' : SEVERITY_LABELS[s]}+</button>`,
 )
 .join('');

 const srcFilter = this.filterSources
 ? `<button class="uai-toolbar-btn uai-clear-btn" data-clear-src>Clear (${this.filterSources.size})</button>`
 : '';

 const nearMeToggle = `<button class="uai-toolbar-btn${this.nearMeActive ? ' uai-active' : ''}" data-near-me-toggle title="Filter alerts near your location">Near Me</button>`;

 const radiusSelector = this.nearMeActive
 ? RADIUS_OPTIONS_MI.map(
 r =>
 `<button class="uai-toolbar-btn${this.nearMeRadiusMi === r ? ' uai-active' : ''}" data-near-me-radius="${r}">${r}mi</button>`,
 ).join('')
 : '';

 return `
 <div class="uai-toolbar">
 <div class="uai-toolbar-group">
 <span class="uai-toolbar-label">Sort:</span>${sortBtns}
 </div>
 <div class="uai-toolbar-group">
 <span class="uai-toolbar-label">Show:</span>${showBtns}
 </div>
 <div class="uai-toolbar-group">
 <span class="uai-toolbar-label">Min:</span>${sevBtns}
 </div>
 <div class="uai-toolbar-group">
 ${nearMeToggle}${radiusSelector}
 </div>
 <div class="uai-toolbar-group">
 ${srcFilter}
 <button class="uai-toolbar-btn" data-ack-all title="Acknowledge all">Ack All</button>
 </div>
 </div>
 `;
  }

  private renderRow(alert: UnifiedAlert, index: number): string {
 const sevPill = `<span class="ac-pill ac-pill-${alert.severity}">${SEVERITY_LABELS[alert.severity]}</span>`;
 const srcTag = `<span class="uai-src-tag uai-src-${alert.source}" data-filter-src="${alert.source}" title="Filter: ${alert.source}">${SOURCE_LABELS[alert.source] ?? alert.source}</span>`;

 const scoreBar = this.renderScoreBar(alert.relevanceScore);
 const distMi = alert.distanceKm == null ? undefined : alert.distanceKm / KM_PER_MI;
 let dist = '\u2014';
 if (distMi != null) {
 const formatted = distMi < 10 ? distMi.toFixed(1) : String(Math.round(distMi));
 dist = `${formatted}mi`;
 }
 const age = timeAgo(alert.timestamp);

 const safeLink = alert.link?.startsWith('https://') ? alert.link : null;
 const title = safeLink
 ? `<a href="${esc(safeLink)}" target="_blank" rel="noopener noreferrer">${esc(alert.title)}</a>`
 : esc(alert.title);

 const whyBtn = alert.evidence
 ? `<button class="uai-why-btn" data-alert-id="${esc(alert.id)}" type="button">Why</button>`
 : '';

 const pinIcon = alert.pinned ? '&#9733;' : '&#9734;';
 const ackIcon = alert.acknowledged ? '&#10003;' : '&#10005;';

 const rowClasses = [
 rowSevClass(alert.severity),
 alert.pinned ? 'uai-pinned' : '',
 alert.acknowledged ? 'uai-acked' : '',
 index === this.selectedIndex ? 'uai-selected' : '',
 ]
 .filter(Boolean)
 .join(' ');

 return `<tr class="${rowClasses}" data-alert-index="${index}">
 <td class="ac-sev">${sevPill}</td>
 <td class="uai-src-cell">${srcTag}</td>
 <td class="uai-title-cell">
 <div class="uai-title">${title}</div>
 <div class="uai-body">${esc(alert.body)}${whyBtn}</div>
 </td>
 <td class="uai-score-cell">${scoreBar}</td>
 <td class="uai-dist-cell">${dist}</td>
 <td class="ac-age">${age}</td>
 <td class="uai-actions">
 <button class="uai-act-btn" data-pin="${esc(alert.id)}" title="${alert.pinned ? 'Unpin' : 'Pin'}">${pinIcon}</button>
 <button class="uai-act-btn" data-ack="${esc(alert.id)}" title="${alert.acknowledged ? 'Acknowledged' : 'Acknowledge'}">${ackIcon}</button>
 </td>
 </tr>`;
  }

  private renderScoreBar(score: number): string {
 const pct = Math.round(score * 100);
 let hue = 120; // green
 if (score > 0.7) hue = 0; // red
 else if (score > 0.4) hue = 30; // orange
 return `<div class="uai-score-bar" title="Relevance: ${pct}%">
 <div class="uai-score-fill" style="width:${pct}%;background:hsl(${hue},70%,50%)"></div>
 <span class="uai-score-label">${pct}</span>
 </div>`;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;');
}

function rowSevClass(s: AlertSeverity): string {
  return (
 {
 critical: 'eq-row eq-major',
 high: 'eq-row eq-strong',
 medium: 'eq-row eq-moderate',
 low: 'eq-row',
 info: 'eq-row',
 }[s] ?? 'eq-row'
  );
}

function timeAgo(ts: number): string {
  try {
 const secs = Math.floor((Date.now() - ts) / 1000);
 if (secs < 0) return 'now';
 if (secs < 60) return `${secs}s`;
 const mins = Math.floor(secs / 60);
 if (mins < 60) return `${mins}m`;
 const hrs = Math.floor(mins / 60);
 if (hrs < 24) return `${hrs}h`;
 return `${Math.floor(hrs / 24)}d`;
  } catch {
 return '\u2014';
  }
}
