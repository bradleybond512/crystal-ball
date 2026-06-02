 
import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildRenderData,
  readinessClass,
  severityClass,
  rankByReadiness,
  type CountryReadiness,
  type ActiveOutbreak,
  type OutbreakSeverity,
} from './pandemic-preparedness-helpers';

const REFRESH_MS = 60 * 60 * 1000;

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

const SEVERITY_ORDER: Record<OutbreakSeverity, number> = {
  Watch: 0,
  Alert: 1,
  Outbreak: 2,
  Epidemic: 3,
  'Pandemic Potential': 4,
};

export class PandemicPreparednessPanel extends Panel {
  static readonly panelId = 'pandemic-preparedness';
  static readonly title = 'Pandemic Preparedness';

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: PandemicPreparednessPanel.panelId,
      title: PandemicPreparednessPanel.title,
      showCount: false,
      trackActivity: true,
      infoTooltip:
        'Global health security readiness: GHSI / IHR scores, active outbreaks (H5N1, Mpox Clade Ib, Cholera), and country-level preparedness gaps. Data sourced from GHSI 2021, WHO IHR monitoring, CDC, and WHO Disease Outbreak News.',
    });
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  private refresh(): void {
    const data = safe(() => buildRenderData());
    if (!data) {
      this.setContent('<div class="panel-empty">Preparedness data unavailable.</div>');
      return;
    }

    const {
      countries,
      outbreaks,
      globalPreparednessIndex,
      criticalGapCount,
      activeOutbreakCount,
      pandemicPotentialCount,
      avgGhsiScore,
    } = data;

    const indexCls = this.indexClass(globalPreparednessIndex);

    const summaryHtml = this.buildSummaryHtml(
      globalPreparednessIndex,
      indexCls,
      activeOutbreakCount,
      pandemicPotentialCount,
      criticalGapCount,
      avgGhsiScore,
    );

    const sortedOutbreaks = [...outbreaks].sort(
      (a, b) => (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0),
    );

    const outbreakRows = sortedOutbreaks.map((o) => this.renderOutbreak(o)).join('');
    const outbreakSectionHtml =
      '<div class="pp-section"><h3 class="pp-section-title">Active Outbreaks &amp; Alerts</h3>' +
      outbreakRows + '</div>';

    const sortedCountries = rankByReadiness(countries);
    const countryRows = sortedCountries.map((c) => this.renderCountry(c)).join('');
    const countrySectionHtml =
      '<div class="pp-section"><h3 class="pp-section-title">Country Preparedness</h3>' +
      '<div class="pp-countries">' + countryRows + '</div></div>';

    this.setContent(
      '<div class="pp-panel">' +
      summaryHtml +
      outbreakSectionHtml +
      countrySectionHtml +
      '<div class="pp-footer">Sources: GHSI 2021 \u00B7 WHO IHR \u00B7 CDC \u00B7 WHO Disease Outbreak News</div>' +
      '</div>',
    );
  }

  private indexClass(score: number): string {
    if (score < 40) return 'read-critical';
    if (score < 60) return 'read-weak';
    if (score < 70) return 'read-adequate';
    return 'read-strong';
  }

  private buildSummaryHtml(
    globalPreparednessIndex: number,
    indexCls: string,
    activeOutbreakCount: number,
    pandemicPotentialCount: number,
    criticalGapCount: number,
    avgGhsiScore: number,
  ): string {
    return (
      '<div class="pp-summary-bar">' +
      '<div class="pp-metric"><span class="pp-label">Prep Index</span>' +
      '<span class="pp-value ' + escapeHtml(indexCls) + '">' + globalPreparednessIndex +
      '<span class="pp-denom">/100</span></span></div>' +
      '<div class="pp-metric"><span class="pp-label">Active Outbreaks</span>' +
      '<span class="pp-value sev-outbreak">' + activeOutbreakCount + '</span></div>' +
      '<div class="pp-metric"><span class="pp-label">Pandemic Risk</span>' +
      '<span class="pp-value sev-pandemic">' + pandemicPotentialCount + '</span></div>' +
      '<div class="pp-metric"><span class="pp-label">Critical Gaps</span>' +
      '<span class="pp-value read-critical">' + criticalGapCount + '</span></div>' +
      '<div class="pp-metric"><span class="pp-label">Avg GHSI</span>' +
      '<span class="pp-value">' + avgGhsiScore + '</span></div>' +
      '</div>'
    );
  }

  private renderOutbreak(o: ActiveOutbreak): string {
    const sevCls = escapeHtml(severityClass(o.severity));
    const humanTxBadge = o.humanTransmission
      ? '<span class="pp-human-tx" title="Human-to-human transmission confirmed">\u{1F464} Human Tx</span>'
      : '';
    const casesStr = o.caseCount > 0 ? '<span>Cases: ' + o.caseCount.toLocaleString() + '</span>' : '';
    const deathsStr = o.deathCount > 0 ? '<span>Deaths: ' + o.deathCount.toLocaleString() + '</span>' : '';
    const cfrStr = o.cfr > 0 && o.caseCount !== 1 ? '<span>CFR: ' + o.cfr + '%</span>' : '';

    return (
      '<div class="pp-outbreak-row ' + sevCls + '">' +
      '<div class="pp-ob-header">' +
      '<span class="pp-pathogen">' + escapeHtml(o.pathogen) + '</span>' +
      '<span class="pp-sev-badge ' + sevCls + '">' + escapeHtml(o.severity) + '</span>' +
      '<span class="pp-ob-class">' + escapeHtml(o.pathogenClass) + '</span>' +
      humanTxBadge +
      '<span class="pp-ob-loc">' + escapeHtml(o.country) + '</span>' +
      '</div>' +
      '<div class="pp-desc">' + escapeHtml(o.description) + '</div>' +
      '<div class="pp-ob-meta">' + casesStr + deathsStr + cfrStr +
      '<span class="pp-who">' + escapeHtml(o.whoStatus) + '</span></div>' +
      '</div>'
    );
  }

  private renderCountry(c: CountryReadiness): string {
    const readCls = escapeHtml(readinessClass(c.readinessLevel));
    const ghsiBar = Math.round((c.ghsiScore / 100) * 60);
    return (
      '<div class="pp-country-row ' + readCls + '">' +
      '<div class="pp-c-header">' +
      '<span class="pp-country-name">' + escapeHtml(c.country) + '</span>' +
      '<span class="pp-read-badge ' + readCls + '">' + escapeHtml(c.readinessLevel) + '</span>' +
      '<span class="pp-ghsi">GHSI: ' + c.ghsiScore + '</span>' +
      '<span class="pp-ihr">IHR: ' + c.ihrScore + '</span>' +
      '</div>' +
      '<div class="pp-ghsi-bar-track">' +
      '<div class="pp-ghsi-bar-fill ' + readCls + '" style="width:' + ghsiBar + 'px"></div>' +
      '</div>' +
      '<div class="pp-gap">Gap: ' + escapeHtml(c.keyGap) + '</div>' +
      '</div>'
    );
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }
}
