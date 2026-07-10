import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildRenderData,
  nationalismClass,
  eventTypeClass,
  outcomeClass,
  volatilityClass,
  resourceConcentrationScore,
  type NationalizationEvent,
  type CriticalResource,
  type CountryRiskProfile,
} from './resource-nationalism-helpers';

const REFRESH_MS = 30 * 60 * 1000;

export class ResourceNationalismPanel extends Panel {
  static readonly panelId = 'resource-nationalism';
  static readonly title = 'Resource Nationalism';
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: ResourceNationalismPanel.panelId,
      title: ResourceNationalismPanel.title,
      showCount: true,
      trackActivity: false,
      infoTooltip:
        'Tracks state seizures, nationalizations, and weaponization of critical natural resources (minerals, energy, water). Covers 12+ countries and 8 strategic commodities with supply-concentration risk scores.',
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
    let data: ReturnType<typeof buildRenderData> | null = null;
    try {
      data = buildRenderData();
    } catch {
      this.setContent('<div style="padding:12px;color:var(--text-secondary,#aaa);font-size:12px;">Data unavailable</div>');
      return;
    }

    const {
      events,
      resources,
      countries,
      globalNationalismIndex,
      criticalEventCount,
      highRiskResourceCount,
      highRiskCountryCount,
    } = data;

    this.setCount(criticalEventCount);

    let idxClass: string;
    if (globalNationalismIndex >= 75) {
      idxClass = 'nm-critical';
    } else if (globalNationalismIndex >= 55) {
      idxClass = 'nm-high';
    } else if (globalNationalismIndex >= 35) {
      idxClass = 'nm-moderate';
    } else {
      idxClass = 'nm-low';
    }

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${this.renderHeader(globalNationalismIndex, idxClass, criticalEventCount, highRiskResourceCount, highRiskCountryCount)}
      ${this.renderResources(resources)}
      ${this.renderCountries(countries)}
      ${this.renderEvents(events)}
    </div>`;

    this.setContent(html);
  }

  private renderHeader(
    globalNationalismIndex: number,
    idxClass: string,
    criticalEventCount: number,
    highRiskResourceCount: number,
    highRiskCountryCount: number,
  ): string {
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;">
      <div class="rn-metric" style="padding:8px;border:1px solid var(--border-subtle,#333);border-radius:4px;">
        <div class="rn-label" style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Nationalism Index</div>
        <div class="rn-value ${escapeHtml(idxClass)}" style="font-size:18px;font-weight:700;">${globalNationalismIndex}</div>
      </div>
      <div class="rn-metric" style="padding:8px;border:1px solid var(--border-subtle,#333);border-radius:4px;">
        <div class="rn-label" style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Critical Events</div>
        <div class="rn-value nm-critical" style="font-size:18px;font-weight:700;">${criticalEventCount}</div>
      </div>
      <div class="rn-metric" style="padding:8px;border:1px solid var(--border-subtle,#333);border-radius:4px;">
        <div class="rn-label" style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">High-Risk Resources</div>
        <div class="rn-value nm-high" style="font-size:18px;font-weight:700;">${highRiskResourceCount}</div>
      </div>
      <div class="rn-metric" style="padding:8px;border:1px solid var(--border-subtle,#333);border-radius:4px;">
        <div class="rn-label" style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">High-Risk Countries</div>
        <div class="rn-value nm-high" style="font-size:18px;font-weight:700;">${highRiskCountryCount}</div>
      </div>
    </div>`;
  }

  private renderResources(resources: CriticalResource[]): string {
    const sorted = [...resources].sort((a, b) => resourceConcentrationScore(b) - resourceConcentrationScore(a));
    const rows = sorted.map((r) => this.renderResourceRow(r)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Critical Resource Concentration</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderResourceRow(r: CriticalResource): string {
    const concScore = resourceConcentrationScore(r);
    const rowClass = `rn-resource-row ${escapeHtml(nationalismClass(r.weaponizationRisk))}`;
    const volClass = escapeHtml(volatilityClass(r.priceVolatility));
    const producers = escapeHtml(r.primaryProducers.join(', '));
    return `<div class="${rowClass}" style="border:1px solid var(--border-subtle,#333);border-radius:3px;padding:7px 10px;">
      <div class="rn-resource-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
        <span class="rn-resource-name" style="font-weight:700;font-size:12px;">${escapeHtml(r.name)}</span>
        <span class="${escapeHtml(nationalismClass(r.weaponizationRisk))}" style="font-size:10px;font-weight:600;text-transform:uppercase;">${escapeHtml(r.weaponizationRisk)}</span>
        <span class="${volClass}" style="font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(r.priceVolatility)}</span>
        <span class="rn-conc-score" style="font-family:ui-monospace,monospace;font-size:10px;">conc ${concScore}</span>
      </div>
      <div class="rn-producers" style="font-size:10px;color:var(--text-secondary,#aaa);margin-bottom:2px;">${producers}</div>
      <div class="rn-strategic-use" style="font-size:10px;color:var(--text-secondary,#aaa);margin-bottom:2px;">${escapeHtml(r.strategicUse)}</div>
      <div class="rn-hhi" style="font-size:10px;color:var(--text-secondary,#aaa);">HHI ${r.supplyConcentrationHHI} · top producer ${r.topProducerSharePct}%</div>
    </div>`;
  }

  private renderCountries(countries: CountryRiskProfile[]): string {
    const sorted = [...countries].sort((a, b) => b.nationalismScore - a.nationalismScore);
    const rows = sorted.map((c) => this.renderCountryRow(c)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Country Nationalism Risk</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderCountryRow(c: CountryRiskProfile): string {
    const riskClass = escapeHtml(nationalismClass(c.riskLevel));
    const resources = escapeHtml(c.keyResources.join(', '));
    return `<div class="rn-country-row ${riskClass}" style="border:1px solid var(--border-subtle,#333);border-radius:3px;padding:7px 10px;">
      <div class="rn-country-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
        <span class="rn-country-name" style="font-weight:700;font-size:12px;">${escapeHtml(c.country)}</span>
        <span class="${riskClass}" style="font-size:10px;font-weight:600;text-transform:uppercase;">${escapeHtml(c.riskLevel)}</span>
        <span class="rn-trend" style="font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(c.trend)}</span>
        <span class="rn-score" style="font-family:ui-monospace,monospace;font-size:10px;">${c.nationalismScore}</span>
      </div>
      <div class="rn-country-resources" style="font-size:10px;color:var(--text-secondary,#aaa);margin-bottom:2px;">${resources}</div>
      <div class="rn-country-notes" style="font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(c.notes)}</div>
    </div>`;
  }

  private renderEvents(events: NationalizationEvent[]): string {
    const sorted = [...events].sort((a, b) => b.severity - a.severity);
    const rows = sorted.map((ev) => this.renderEventRow(ev)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Nationalization &amp; Seizure Events (${events.length})</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderEventRow(ev: NationalizationEvent): string {
    const evTypeClass = escapeHtml(eventTypeClass(ev.eventType));
    const ocClass = escapeHtml(outcomeClass(ev.outcome));
    const companies = escapeHtml(ev.affectedCompanies.join(', '));
    let severityColor: string;
    if (ev.severity >= 9) {
      severityColor = '#d50000';
    } else if (ev.severity >= 7) {
      severityColor = '#ff9800';
    } else {
      severityColor = '#ffeb3b';
    }
    return `<div class="rn-event-row" style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${severityColor};border-radius:3px;padding:7px 10px;">
      <div class="rn-event-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:3px;">
        <span class="rn-event-country" style="font-weight:700;font-size:12px;">${escapeHtml(ev.country)}</span>
        <span class="rn-event-resource" style="font-size:11px;">${escapeHtml(ev.resource)}</span>
        <span class="${evTypeClass}" style="font-size:10px;font-weight:600;text-transform:uppercase;">${escapeHtml(ev.eventType)}</span>
        <span class="${ocClass}" style="font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(ev.outcome)}</span>
        <span class="rn-event-date" style="font-family:ui-monospace,monospace;font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(ev.date)}</span>
      </div>
      <div class="rn-event-desc" style="font-size:11px;margin-bottom:3px;">${escapeHtml(ev.description)}</div>
      <div class="rn-event-meta" style="font-size:10px;color:var(--text-secondary,#aaa);">
        <span>Severity ${ev.severity}/10</span>
        <span style="margin-left:8px;">$${ev.economicImpactBn}B</span>
        <span style="margin-left:8px;">${companies}</span>
      </div>
    </div>`;
  }
}
