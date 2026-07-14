/**
 * Urban Instability Monitor Panel
 *
 * Tracks city-level protest intensity, gang territorial control,
 * displacement pressure, and government response capacity across
 * major cities worldwide. Cities are sorted by composite risk score.
 *
 * Refresh: every 30 minutes.
 */

import { Panel } from './Panel';
import {
  buildPanelRenderData,
  getMockCityData,
  renderCitiesSection,
  filterByTier,
  type CityRawData,
  type CityInstabilityResult,
} from './urban-instability-helpers';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

export class UrbanInstabilityPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private cities: CityRawData[] = getMockCityData();

  constructor() {
    super({
      id: 'urban-instability',
      title: 'Urban Instability Monitor',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'City-level protest intensity, gang control, displacement pressure, and governance capacity. Sorted by composite risk score.',
    });
    this.render();
    if (typeof setInterval !== 'undefined') {
      this.refreshTimer = setInterval(() => { this.render(); }, REFRESH_MS);
    }
  }

  /** Inject live city data from a data loader. */
  public setCities(cities: CityRawData[]): void {
    this.cities = cities;
    this.render();
  }

  private criticalCount(results: CityInstabilityResult[]): number {
    return filterByTier(results, 'severe').length;
  }

  private render(): void {
    try {
      const results = buildPanelRenderData(this.cities);
      const count = this.criticalCount(results);
      this.setCount(count);
      const html = this.buildHtml(results);
      this.setContent(html);
      this.markFresh();
    } catch {
      this.setContent('<div style="padding:12px;color:#ff453a;font-size:12px;">Urban instability data unavailable.</div>');
    }
  }

  private buildHtml(results: CityInstabilityResult[]): string {
    const criticalCount = results.filter((r) => r.tier === 'critical').length;
    const severeCount = results.filter((r) => r.tier === 'severe').length;

    const banner = (criticalCount + severeCount) > 0
      ? this.buildBanner(criticalCount, severeCount)
      : '';

    const subtitle = `<div style="padding:6px 10px 2px;font-size:11px;color:var(--text-secondary,#888);">
      ${results.length} cities · sorted by composite risk
    </div>`;

    return `${banner}${subtitle}<div style="padding:0 8px 8px;">${renderCitiesSection(results)}</div>`;
  }

  private buildBanner(criticalCount: number, severeCount: number): string {
    const bits: string[] = [];
    if (criticalCount > 0) bits.push(`${criticalCount} CRITICAL`);
    if (severeCount > 0)   bits.push(`${severeCount} SEVERE`);
    const text = bits.join(' · ');
    return `<div style="padding:6px 12px;background:rgba(255, 69, 58,0.12);border-bottom:1px solid rgba(255, 69, 58,0.3);font-size:11px;font-weight:700;color:#ff453a;letter-spacing:0.04em;">
      &#9888; URBAN INSTABILITY: ${text}
    </div>`;
  }

  override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }
}

export type { CityRawData, CityInstabilityResult, InstabilityTier } from './urban-instability-helpers';
