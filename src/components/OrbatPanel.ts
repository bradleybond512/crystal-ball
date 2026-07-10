/**
 * Order of Battle (ORBAT) Panel
 *
 * Displays military force disposition with unit hierarchy,
 * echelon breakdown, and deployment status by country.
 *
 * Inspired by Palantir Gotham military intelligence.
 */

import { Panel } from './Panel';
import {
  getUnits,
  getCountries,
  getForceComposition,
} from '@/services/orbat';
import { escapeHtml } from '@/utils/sanitize';

const ECHELON_ICONS: Record<string, string> = {
  theater: '\u2605', // ★
  army_group: '\u2605',
  army: '\u2726', // ✦
  corps: '\u25C6', // ◆
  division: '\u25B2', // ▲
  brigade: '\u25CF', // ●
  battalion: '\u25CB', // ○
  company: '\u25AA', // ▪
  platoon: '\u25AB', // ▫
  squad: '\u00B7', // ·
  team: '\u00B7',
};

const STRENGTH_COLORS: Record<string, string> = {
  full: '#38a169',
  reinforced: '#3182ce',
  reduced: '#ed8936',
  combat_ineffective: '#e53e3e',
  unknown: '#888',
};

const STATUS_LABELS: Record<string, string> = {
  active: '\uD83D\uDFE2 Active',
  reserve: '\u26AA Reserve',
  deployed: '\uD83D\uDD34 Deployed',
  withdrawn: '\u2B1C Withdrawn',
};

export class OrbatPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private expandedCountry: string | null = null;

  constructor() {
 super({
 id: 'orbat',
 title: 'Order of Battle',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Military Order of Battle tracker. Displays force disposition by country with unit hierarchy, echelon breakdown, strength assessment, and deployment status.',
 });
 this.showLoading('Loading force disposition\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 5 * 60 * 1000);
  }

  private render(): void {
 const countries = getCountries();
 const allUnits = getUnits();

 this.setCount(allUnits.length);

 if (allUnits.length === 0) {
 this.setContent(`
 <div class="panel-empty">
 No military units tracked. Order of Battle data will populate as military intelligence feeds report force disposition and unit movements.
 </div>
 `);
 return;
 }

 const countryCards = countries.map(country => {
 const comp = getForceComposition(country);
 const expanded = this.expandedCountry === country;

 const deployedPct = comp.totalUnits > 0
 ? Math.round((comp.deployedCount / comp.totalUnits) * 100)
 : 0;

 const typeBreakdown = Object.entries(comp.byType)
 .filter(([, count]) => count > 0)
 .sort(([, a], [, b]) => b - a)
 .slice(0, 5)
 .map(([type, count]) => `<span class="orbat-type-chip">${type}: ${count}</span>`)
 .join('');

 const detailHtml = expanded ? this.renderCountryDetail(country) : '';

 return `<div class="orbat-country-card" data-country="${escapeHtml(country)}">
 <div class="orbat-country-header">
 <span class="orbat-country-name">${escapeHtml(country)}</span>
 <span class="orbat-unit-count">${comp.totalUnits} units</span>
 <span class="orbat-deployed">${deployedPct}% deployed</span>
 </div>
 <div class="orbat-type-row">${typeBreakdown}</div>
 ${detailHtml}
 </div>`;
 }).join('');

 this.setContent(`
 <div style="padding:8px 12px;">
 <div class="orbat-summary">${countries.length} countries \u2502 ${allUnits.length} units tracked</div>
 <div class="orbat-countries">${countryCards}</div>
 </div>
 `);

 this.getContentElement().querySelectorAll('.orbat-country-card').forEach(card => {
 card.addEventListener('click', () => {
 const c = card.getAttribute('data-country');
 this.expandedCountry = this.expandedCountry === c ? null : c;
 this.render();
 });
 });
  }

  private renderCountryDetail(country: string): string {
 const units = getUnits({ country }).slice(0, 20);
 return `<div class="orbat-detail">
 ${units.map(u => {
 const icon = ECHELON_ICONS[u.echelon] ?? '\u25CF';
 const strengthColor = STRENGTH_COLORS[u.strength] ?? '#888';
 const statusLabel = STATUS_LABELS[u.status] ?? u.status;
 return `<div class="orbat-unit-row">
 <span class="orbat-echelon-icon">${icon}</span>
 <span class="orbat-unit-name">${escapeHtml(u.designation)} ${escapeHtml(u.name)}</span>
 <span class="orbat-strength" style="color:${strengthColor}">${u.strength}</span>
 <span class="orbat-status">${statusLabel}</span>
 </div>`;
 }).join('')}
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
