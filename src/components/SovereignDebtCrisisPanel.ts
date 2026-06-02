/**
 * SovereignDebtCrisisPanel (panel id: `sovereign-debt-crisis`)
 *
 * Tracks debt distress levels by country using IMF debt-sustainability-analysis
 * tiers, default probability, IMF program status, credit-rating trends,
 * and creditor composition.
 *
 * Data is mock/deterministic for offline use.
 * Refresh: every 1 hour.
 */

import { Panel } from './Panel';
import {
  MOCK_COUNTRIES,
  buildCountryRenderData,
  buildPanelSummary,
  renderCountryCard,
  renderSummaryHeader,
  sortByDistressTierDesc,
  type CountryDebtData,
} from './sovereign-debt-crisis-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

export class SovereignDebtCrisisPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private countries: CountryDebtData[] = MOCK_COUNTRIES;

  constructor() {
    super({
      id: 'sovereign-debt-crisis',
      title: 'Sovereign Debt Crisis Monitor',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Debt distress levels by country using IMF DSA tiers. Tracks countries in or approaching default, IMF program status, credit-rating trends, and creditor composition.',
    });
    this.render();
    this.refreshTimer = setInterval(() => { this.render(); }, REFRESH_MS);
  }

  /** Inject live country data (for testing or live wiring). */
  public setCountries(countries: CountryDebtData[]): void {
    this.countries = countries;
    this.render();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private render(): void {
    const renderData = this.countries
      .map((c) => buildCountryRenderData(c))
      .sort(sortByDistressTierDesc);

    const summary = buildPanelSummary(this.countries);

    this.setCount(summary.inDefault + summary.highDistress);

    const summaryHtml = renderSummaryHeader(summary);
    const cardsHtml = renderData.map((d) => renderCountryCard(d)).join('');

    this.setContent(`
      ${summaryHtml}
      <div style="padding:10px 12px;">
        ${cardsHtml.length > 0 ? cardsHtml : '<div style="color:var(--text-secondary,#888);font-size:12px;">No country data available.</div>'}
      </div>
    `);
  }
}
