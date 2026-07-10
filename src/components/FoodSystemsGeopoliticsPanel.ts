import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildRenderData,
  mechanismClass,
  concentrationRiskClass,
  volatilityClass,
  WEAPONIZATION_EVENTS,
  SUPPLY_CONCENTRATIONS,
  type FoodWeaponizationEvent,
  type FoodSupplyConcentration,
  type FoodGeopoliticsData,
} from './food-systems-geopolitics-helpers';

const REFRESH_MS = 24 * 60 * 60 * 1000; // 24 hours

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

export class FoodSystemsGeopoliticsPanel extends Panel {
  static readonly panelId = 'food-systems-geopolitics';
  static readonly title = 'Food Systems & Geopolitics';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: FoodSystemsGeopoliticsPanel.panelId,
      title: FoodSystemsGeopoliticsPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks food as an instrument of state power: grain blockades, export bans, fertilizer cutoffs, and supply chain vulnerabilities. Distinct from food insecurity outcomes.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  private render(): void {
    const data = safe(() => buildRenderData(WEAPONIZATION_EVENTS, SUPPLY_CONCENTRATIONS));
    if (!data) {
      this.setContent('<div class="panel-empty">No food geopolitics data available.</div>');
      return;
    }
    const ongoingCount = data.events.filter((e) => e.ongoing).length;
    this.setCount(ongoingCount);
    this.setContent(this.buildHtml(data));
  }

  private buildHtml(data: FoodGeopoliticsData): string {
    let fsiColor = 'var(--color-ok)';
    if (data.globalFoodSecurityIndex < 40) fsiColor = 'var(--color-critical)';
    else if (data.globalFoodSecurityIndex < 65) fsiColor = 'var(--color-warning)';

    let riskColor = 'var(--color-ok)';
    if (data.weaponizationRiskScore >= 70) riskColor = 'var(--color-critical)';
    else if (data.weaponizationRiskScore >= 40) riskColor = 'var(--color-warning)';

    const fertAlert = data.fertilizer_dependency_alert
      ? '<span class="fsg-alert-badge">FERTILIZER ALERT</span>'
      : '';

    return `<div class="fsg-panel">
      <div class="fsg-header">
        <div class="fsg-index-row">
          <span class="fsg-label">Food Security Index</span>
          <span class="fsg-index-val" style="color:${fsiColor}">${data.globalFoodSecurityIndex}/100</span>
          <span class="fsg-label" style="margin-left:12px">Weaponization Risk</span>
          <span class="fsg-risk-val" style="color:${riskColor}">${data.weaponizationRiskScore}/100</span>
          ${fertAlert}
        </div>
        ${data.mostVulnerableRegions.length > 0 ? `<div class="fsg-vulnerable">Most vulnerable: ${data.mostVulnerableRegions.map((r) => escapeHtml(r)).join(' · ')}</div>` : ''}
      </div>

      <section class="fsg-section">
        <h3 class="fsg-section-title">Supply Concentration Risk</h3>
        <table class="fsg-table">
          <thead><tr>
            <th>Commodity</th><th>Top Producers</th><th>Share</th><th>Risk</th><th>Volatility</th><th>Recent Disruption</th>
          </tr></thead>
          <tbody>${data.concentrations.map((c) => this.concentrationRow(c)).join('')}</tbody>
        </table>
      </section>

      <section class="fsg-section">
        <h3 class="fsg-section-title">Food Weaponization Events</h3>
        <table class="fsg-table">
          <thead><tr>
            <th>Date</th><th>Actor</th><th>Target</th><th>Mechanism</th><th>Commodity</th><th>Impact</th><th>Sig</th><th>Status</th>
          </tr></thead>
          <tbody>${data.events.map((e) => this.eventRow(e)).join('')}</tbody>
        </table>
      </section>

      <div class="fsg-footer">
        <span class="fsg-source">${data.events.length} events · ${data.concentrations.length} commodities tracked · 24hr refresh</span>
      </div>
    </div>`;
  }

  private concentrationRow(c: FoodSupplyConcentration): string {
    const riskCls = concentrationRiskClass(c.chokepointRisk);
    const volCls = volatilityClass(c.priceVolatility);
    return `<tr class="fsg-conc-row">
      <td class="fsg-commodity">${escapeHtml(c.commodity)}</td>
      <td class="fsg-producers">${c.topProducers.map((p) => escapeHtml(p)).join(', ')}</td>
      <td class="fsg-share">${c.top3SharePct}%</td>
      <td class="fsg-risk ${riskCls}">${escapeHtml(c.chokepointRisk)}</td>
      <td class="fsg-vol ${volCls}">${escapeHtml(c.priceVolatility)}</td>
      <td class="fsg-disruption">${escapeHtml(c.recentDisruption)}</td>
    </tr>`;
  }

  private eventRow(e: FoodWeaponizationEvent): string {
    const mechCls = mechanismClass(e.mechanism);
    const ongoingBadge = e.ongoing ? '<span class="fsg-ongoing">LIVE</span>' : '';
    return `<tr class="fsg-event-row ${mechCls}">
      <td class="fsg-date">${escapeHtml(e.date)}</td>
      <td class="fsg-actor">${escapeHtml(e.actor)}</td>
      <td class="fsg-target">${escapeHtml(e.target)}</td>
      <td class="fsg-mech ${mechCls}">${escapeHtml(e.mechanism)}</td>
      <td class="fsg-comm">${escapeHtml(e.commodity)}</td>
      <td class="fsg-impact">${e.impactM}M</td>
      <td class="fsg-sig">${e.significance}/10</td>
      <td class="fsg-status">${ongoingBadge}</td>
    </tr>`;
  }
}
