import { Panel } from './Panel';
import {
  getChokepointStatus,
  getActiveDisruptions,
  getImpactForecast,
  refreshSupplyChainImpact,
  type ChokepointStatus,
  type SupplyDisruption,
  type ImpactForecast,
  type DisruptionLevel,
} from '@/services/supply-chain-impact';
import { escapeHtml } from '@/utils/sanitize';

type TabId = 'chokepoints' | 'disruptions' | 'consumer';

export class SupplyChainImpactPanel extends Panel {
  private statuses: ChokepointStatus[] = [];
  private disruptions: SupplyDisruption[] = [];
  private forecasts: ImpactForecast[] = [];
  private activeTab: TabId = 'chokepoints';
  private loading = false;
  private lastError: string | null = null;

  constructor() {
 super({ id: 'supply-chain-impact', title: 'Supply Chain Impact' });
 this.content.addEventListener('click', (e) => {
 const tabTarget = (e.target as HTMLElement).closest('.economic-tab') as HTMLElement | null;
 if (tabTarget) {
 const tabId = tabTarget.dataset.tab as TabId | undefined;
 if (tabId && tabId !== this.activeTab) {
 this.activeTab = tabId;
 this.render();
 }
 return;
 }
 const refreshBtn = (e.target as HTMLElement).closest('.sci-refresh-btn') as HTMLElement | null;
 if (refreshBtn) {
 void this.loadData(true);
 }
 });
  }

  /** Call after panel is mounted to begin data fetch. */
  public init(): void {
 void this.loadData(false);
  }

  private async loadData(forceRefresh: boolean): Promise<void> {
 this.loading = true;
 this.lastError = null;
 this.render();

 try {
 if (forceRefresh) {
 await refreshSupplyChainImpact();
 }
 const [statuses, disruptions, forecasts] = await Promise.all([
 getChokepointStatus(),
 getActiveDisruptions(),
 getImpactForecast(),
 ]);
 this.statuses = statuses;
 this.disruptions = disruptions;
 this.forecasts = forecasts;
 } catch (error) {
 this.lastError = error instanceof Error ? error.message : 'Failed to load supply chain data';
 } finally {
 this.loading = false;
 this.render();
 }
  }

  /** Called externally by data-loader to push new chokepoint data. */
  public updateStatuses(statuses: ChokepointStatus[]): void {
 this.statuses = statuses;
 this.render();
  }

  /** Called externally by data-loader to push new disruption data. */
  public updateDisruptions(disruptions: SupplyDisruption[]): void {
 this.disruptions = disruptions;
 this.render();
  }

  /** Called externally by data-loader to push new forecast data. */
  public updateForecasts(forecasts: ImpactForecast[]): void {
 this.forecasts = forecasts;
 this.render();
  }

  private render(): void {
 if (this.loading) {
 this.setContent('<div class="economic-empty">Loading supply chain data...</div>');
 return;
 }

 if (this.lastError) {
 this.setContent(`<div class="economic-warning">${escapeHtml(this.lastError)}</div>`);
 return;
 }

 const disruptionCount = this.disruptions.length;
 const disruptionBadge = disruptionCount > 0
 ? `<span class="trade-badge" style="background:var(--color-danger,#e53935);color:#fff;margin-left:6px">${disruptionCount} active</span>`
 : '';

 const tabsHtml = `
 <div class="economic-tabs">
 <button class="economic-tab ${this.activeTab === 'chokepoints' ? 'active' : ''}" data-tab="chokepoints">
 Chokepoints
 </button>
 <button class="economic-tab ${this.activeTab === 'disruptions' ? 'active' : ''}" data-tab="disruptions">
 Disruptions${disruptionBadge}
 </button>
 <button class="economic-tab ${this.activeTab === 'consumer' ? 'active' : ''}" data-tab="consumer">
 What This Means For You
 </button>
 </div>
 `;

 let contentHtml = '';
 switch (this.activeTab) {
 case 'chokepoints': { contentHtml = this.renderChokepoints(); break;
 }
 case 'disruptions': { contentHtml = this.renderDisruptions(); break;
 }
 case 'consumer': { contentHtml = this.renderConsumer(); break;
 }
 }

 this.setContent(`
 ${tabsHtml}
 <div class="economic-content">${contentHtml}</div>
 <div class="economic-footer">
 <span class="economic-source">Sources: ACLED, GDACS, AIS, AI analysis</span>
 <button class="sci-refresh-btn" style="margin-left:auto;cursor:pointer;background:none;border:1px solid var(--border-color,#444);border-radius:4px;padding:2px 8px;color:inherit;font-size:11px">Refresh</button>
 </div>
 `);
  }

  // ── Chokepoints Tab ────────────────────────────────────────────────────────

  private renderChokepoints(): string {
 if (this.statuses.length === 0) {
 return '<div class="economic-empty">No chokepoint data available</div>';
 }

 const cards = this.statuses.map((s) => {
 const levelClass = this.levelToCssClass(s.level);
 const dotClass = this.levelToDotClass(s.level);
 const commodityTags = s.chokepoint.commodities
 .map((c) => `<span class="sci-commodity-tag">${escapeHtml(c.replace(/-/g, ' '))}</span>`)
 .join(' ');

 const signalSummary = s.signals.length > 0
 ? `<div class="trade-description" style="margin-top:4px">${s.signals.length} signal${s.signals.length > 1 ? 's' : ''} detected</div>`
 : '';

 return `<div class="trade-restriction-card">
 <div class="trade-restriction-header">
 <span class="trade-country">${escapeHtml(s.chokepoint.name)}</span>
 <span class="sc-status-dot ${dotClass}"></span>
 <span class="trade-badge">${s.throughputPct}% flow</span>
 <span class="trade-status ${levelClass}">${escapeHtml(s.level)}</span>
 </div>
 <div class="trade-restriction-body">
 <div class="sci-commodity-tags">${commodityTags}</div>
 <div class="trade-sector">${s.chokepoint.dailyTrafficVolume} vessels/day &middot; ${s.chokepoint.globalTradeSharePct}% global trade</div>
 ${signalSummary}
 </div>
 </div>`;
 }).join('');

 return `<div class="trade-restrictions-list">${cards}</div>`;
  }

  // ── Disruptions Tab ────────────────────────────────────────────────────────

  private renderDisruptions(): string {
 if (this.disruptions.length === 0) {
 return '<div class="economic-empty">No active disruptions detected</div>';
 }

 const cards = this.disruptions.map((d) => {
 const levelClass = this.levelToCssClass(d.level);

 const impactRows = d.commodityImpacts
 .filter((ci) => ci.estimatedPriceImpactPct > 0)
 .sort((a, b) => b.estimatedPriceImpactPct - a.estimatedPriceImpactPct)
 .map((ci) => {
 const commodity = ci.commodity.replace(/-/g, ' ');
 const shortage = ci.timelineToShortageWeeks
 ? `${ci.timelineToShortageWeeks}w`
 : '&mdash;';
 const regions = ci.affectedRegions.slice(0, 2).join(', ');
 return `<tr>
 <td>${escapeHtml(commodity)}</td>
 <td class="sci-price-impact">+${ci.estimatedPriceImpactPct.toFixed(1)}%</td>
 <td>${shortage}</td>
 <td>${escapeHtml(regions)}</td>
 </tr>`;
 }).join('');

 const signalList = d.signals.slice(0, 3).map((s) => {
 const icon = s.source === 'acled' ? '&#9876;' : s.source === 'gdacs' ? '&#9888;' : '&#9875;';
 return `<div class="sci-signal">${icon} <span class="trade-description">${escapeHtml(s.description.slice(0, 120))}</span></div>`;
 }).join('');

 return `<div class="trade-restriction-card">
 <div class="trade-restriction-header">
 <span class="trade-country">${escapeHtml(d.chokepointName)}</span>
 <span class="trade-status ${levelClass}">${escapeHtml(d.level)}</span>
 </div>
 <div class="trade-restriction-body">
 ${signalList}
 ${impactRows ? `<table class="sci-impact-table">
 <thead><tr><th>Commodity</th><th>Price</th><th>Shortage</th><th>Regions</th></tr></thead>
 <tbody>${impactRows}</tbody>
 </table>` : ''}
 <div class="sci-narrative">${escapeHtml(d.narrative)}</div>
 </div>
 </div>`;
 }).join('');

 return `<div class="trade-restrictions-list">${cards}</div>`;
  }

  // ── Consumer Impact Tab ────────────────────────────────────────────────────

  private renderConsumer(): string {
 if (this.forecasts.length === 0 && this.disruptions.length === 0) {
 return `<div class="economic-empty">
 <div style="font-size:24px;margin-bottom:8px">&#10004;</div>
 All major shipping chokepoints operating normally. No consumer impact expected.
 </div>`;
 }

 let forecastCards = '';
 if (this.forecasts.length > 0) {
 const sortedForecasts = [...this.forecasts].sort(
 (a, b) => b.aggregatePriceImpactPct - a.aggregatePriceImpactPct,
 );

 forecastCards = sortedForecasts.map((f) => {
 const commodity = f.commodity.replace(/-/g, ' ');
 const severityClass = f.aggregatePriceImpactPct > 10 ? 'sc-risk-critical'
 : f.aggregatePriceImpactPct > 5 ? 'sc-risk-high'
 : f.aggregatePriceImpactPct > 2 ? 'sc-risk-moderate'
 : 'sc-risk-low';

 const timeline = f.timelineWeeks
 ? `<span class="trade-badge">~${f.timelineWeeks}w to shortage</span>`
 : '';

 return `<div class="trade-restriction-card">
 <div class="trade-restriction-header">
 <span class="trade-country" style="text-transform:capitalize">${escapeHtml(commodity)}</span>
 <span class="${severityClass}">+${f.aggregatePriceImpactPct.toFixed(1)}%</span>
 ${timeline}
 </div>
 <div class="trade-restriction-body">
 <div class="trade-description">${escapeHtml(f.consumerSummary)}</div>
 <div class="trade-sector">${f.currentDisruptions} chokepoint${f.currentDisruptions > 1 ? 's' : ''} affected</div>
 </div>
 </div>`;
 }).join('');
 }

 // AI narrative section from disruptions
 let narrativeSection = '';
 const narratives = this.disruptions
 .filter((d) => d.narrative.length > 0)
 .map((d) => d.narrative);
 if (narratives.length > 0) {
 narrativeSection = `
 <div class="sci-ai-section">
 <div class="sci-ai-header">AI Assessment</div>
 ${narratives.map((n) => `<div class="sci-ai-narrative">${escapeHtml(n)}</div>`).join('')}
 </div>`;
 }

 return `<div class="trade-restrictions-list">
 ${forecastCards}
 ${narrativeSection}
 </div>`;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private levelToCssClass(level: DisruptionLevel): string {
 switch (level) {
 case 'blocked': { return 'status-active';
 }
 case 'disrupted': { return 'status-active';
 }
 case 'stressed': { return 'status-notified';
 }
 case 'open': { return 'status-terminated';
 }
 }
  }

  private levelToDotClass(level: DisruptionLevel): string {
 switch (level) {
 case 'blocked': { return 'sc-dot-red';
 }
 case 'disrupted': { return 'sc-dot-red';
 }
 case 'stressed': { return 'sc-dot-yellow';
 }
 case 'open': { return 'sc-dot-green';
 }
 }
  }
}
