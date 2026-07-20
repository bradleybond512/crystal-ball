/**
 * NarcoticsTraffickingPanel (panel id `narcotics-trafficking`).
 *
 * Deep-intelligence narcotics-trafficking surface. Six sections:
 *   1. Composite Threat Score    weighted 0–100 across all five axes.
 *   2. Route Disruption Events   active disruptions across known corridors.
 *   3. Cartel Territorial Watch  inter-group friction by intensity.
 *   4. Regional Interdictions    last-30d seizure rollup by region.
 *   5. Precursor Supply Chain    chemical-diversion monitoring.
 *   6. Narco-State Corruption    aggregate corruption indices by country.
 *   7. Trafficking Volume Trends per-substance 30d trend.
 *
 * Pure helpers (scoring, aggregations, static catalogues) live in
 * `narcotics-trafficking-helpers.ts` so tests can exercise them
 * without spinning up the Panel base class. Refresh: 1h.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  bandColor,
  bandLabel,
  CARTEL_TERRITORIAL_EVENTS,
  computeNarcoticsScore,
  countActiveDisruptions,
  countCriticalNarcoStates,
  countHighConfidencePrecursorSignals,
  countOpenWarfareConflicts,
  countRisingVolumeSubstances,
  disruptionCauseLabel,
  formatSeizure,
  intensityColor,
  intensityLabel,
  INTERDICTION_EVENTS_BASE,
  methodLabel,
  NARCO_STATE_INDICES,
  PRECURSOR_SIGNALS_BASE,
  precursorConfidenceColor,
  precursorLabel,
  ROUTE_DISRUPTIONS_BASE,
  substanceLabel,
  summarizeInterdictionsByRegion,
  timeAgo,
  volumeTrendArrow,
  volumeTrendColor,
  VOLUME_TRENDS_BASE,
  type CartelTerritorialEvent,
  type InterdictionEvent,
  type NarcoStateIndex,
  type NarcoticsCompositeScore,
  type PrecursorSignal,
  type RouteDisruption,
  type VolumeTrendRow,
} from './narcotics-trafficking-helpers';

const REFRESH_MS = 60 * 60 * 1000;
const TOOLTIP =
  'Analytical view of narcotics-trafficking dynamics: route disruptions, cartel territorial conflict, regional interdictions, precursor-chemical diversion, narco-state corruption indices, and substance-volume trends. 1-hour refresh.';

function safe<T>(fn: () => T): T | null {
  try { return fn() ?? null; } catch { return null; }
}

export class NarcoticsTraffickingPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'narcotics-trafficking',
      title: 'Narcotics Trafficking',
      showCount: true,
      trackActivity: true,
      infoTooltip: TOOLTIP,
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
    const disruptions = safe<readonly RouteDisruption[]>(() => ROUTE_DISRUPTIONS_BASE) ?? [];
    const cartelEvents = safe<readonly CartelTerritorialEvent[]>(() => CARTEL_TERRITORIAL_EVENTS) ?? [];
    const interdictions = safe<readonly InterdictionEvent[]>(() => INTERDICTION_EVENTS_BASE) ?? [];
    const precursors = safe<readonly PrecursorSignal[]>(() => PRECURSOR_SIGNALS_BASE) ?? [];
    const narcoStates = safe<readonly NarcoStateIndex[]>(() => NARCO_STATE_INDICES) ?? [];
    const trends = safe<readonly VolumeTrendRow[]>(() => VOLUME_TRENDS_BASE) ?? [];

    const score = computeNarcoticsScore({
      activeDisruptions: countActiveDisruptions(disruptions),
      openWarfareConflicts: countOpenWarfareConflicts(cartelEvents),
      highConfidencePrecursorSignals: countHighConfidencePrecursorSignals(precursors),
      criticalNarcoStates: countCriticalNarcoStates(narcoStates),
      risingVolumeSubstances: countRisingVolumeSubstances(trends),
    });

    this.setCount(score.total);
    const root = h('div', { className: 'ntp-root' },
      this.renderScoreSection(score),
      this.renderRouteDisruptionSection(disruptions),
      this.renderCartelSection(cartelEvents),
      this.renderInterdictionSection(interdictions),
      this.renderPrecursorSection(precursors),
      this.renderNarcoStateSection(narcoStates),
      this.renderTrendSection(trends),
    );
    replaceChildren(this.content, root);
  }

  // ── Section 1: Composite Threat Score ──────────────────────────

  private renderScoreSection(score: NarcoticsCompositeScore): HTMLElement {
    const color = bandColor(score.band);
    const widthPct = Math.max(0, Math.min(100, score.total));
    return h('div', { className: 'ntp-section' },
      h('div', { className: 'ntp-section-header', style: 'display:flex;align-items:baseline;gap:8px' },
        h('span', null, 'Composite Threat Score'),
        h('span', { style: `font-size:11px;color:${color};text-transform:uppercase;letter-spacing:0.04em` }, bandLabel(score.band)),
        h('span', { style: 'margin-left:auto;font-size:18px;font-weight:600' }, String(score.total), '/100'),
      ),
      h('div', { style: 'background:#1f1f1f;border-radius:3px;height:8px;overflow:hidden;margin:6px 0 4px' },
        h('div', { style: `background:${color};width:${widthPct}%;height:8px;border-radius:3px` }),
      ),
      h('div', { style: 'font-size:11px;color:#9e9e9e' },
        `Contributions — routes ${score.contributions.routeDisruption}, cartels ${score.contributions.cartelConflict}, precursors ${score.contributions.precursorDiversion}, corruption ${score.contributions.narcoStateCorruption}, volume ${score.contributions.volumeAccel}`,
      ),
    );
  }

  // ── Section 2: Route Disruption Events ────────────────────────

  private renderRouteDisruptionSection(rows: readonly RouteDisruption[]): HTMLElement {
    const active = countActiveDisruptions(rows);
    const headerChildren: (HTMLElement | string)[] = ['Route Disruption Events'];
    if (active > 0) {
      headerChildren.push(h('span', {
        style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
      }, `${active} active`));
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const r of rows) table.append(this.renderRouteRow(r));
    return h('div', { className: 'ntp-section' },
      h('div', { className: 'ntp-section-header' }, ...headerChildren),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' }, 'Region · substance · cause · throughput impact'),
      table,
    );
  }

  private renderRouteRow(r: RouteDisruption): HTMLElement {
    return h('tbody', null,
      h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, r.routeRegion),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc' }, substanceLabel(r.substance)),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e' }, disruptionCauseLabel(r.cause)),
        h('td', { style: 'padding:3px 6px;font-size:11px;text-align:right' }, `${Math.round(r.throughputImpactPct)}%`),
        h('td', { style: 'padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right' }, timeAgo(r.detectedAt)),
      ),
      h('tr', null,
        h('td', { colspan: '5', style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222' }, r.summary),
      ),
    );
  }

  // ── Section 3: Cartel Territorial Watch ───────────────────────

  private renderCartelSection(rows: readonly CartelTerritorialEvent[]): HTMLElement {
    const open = countOpenWarfareConflicts(rows);
    const headerChildren: (HTMLElement | string)[] = ['Cartel Territorial Watch'];
    if (open > 0) {
      headerChildren.push(h('span', {
        style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
      }, `${open} open-warfare`));
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const r of rows) table.append(this.renderCartelRow(r));
    return h('div', { className: 'ntp-section' },
      h('div', { className: 'ntp-section-header' }, ...headerChildren),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' }, 'Region · primary vs rival · intensity · 30d clashes'),
      table,
    );
  }

  private renderCartelRow(r: CartelTerritorialEvent): HTMLElement {
    const color = intensityColor(r.intensity);
    return h('tbody', null,
      h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, r.region),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc' }, `${r.primaryActor} vs ${r.rivalActor}`),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e;text-align:right' }, `${r.recentClashes30d} clashes / 30d`),
        h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;text-align:right;color:${color}` }, intensityLabel(r.intensity)),
      ),
      h('tr', null,
        h('td', { colspan: '4', style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222' }, r.notable),
      ),
    );
  }

  // ── Section 4: Regional Interdictions ─────────────────────────

  private renderInterdictionSection(rows: readonly InterdictionEvent[]): HTMLElement {
    const aggregated = summarizeInterdictionsByRegion(rows);
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const a of aggregated) {
      table.append(h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, a.region),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc;text-align:right' }, formatSeizure(a.seizureKg)),
        h('td', { style: 'padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right' }, `${a.eventCount} events`),
      ));
    }
    const methodTable = h('table', { style: 'width:100%;border-collapse:collapse;margin-top:6px' });
    for (const r of rows.slice(0, 6)) {
      methodTable.append(h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc' }, methodLabel(r.method)),
        h('td', { style: 'padding:3px 6px;font-size:11px' }, substanceLabel(r.substance)),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e;text-align:right' }, formatSeizure(r.seizureKg)),
        h('td', { style: 'padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right' }, timeAgo(r.detectedAt)),
      ));
    }
    return h('div', { className: 'ntp-section' },
      h('div', { className: 'ntp-section-header' }, 'Major Interdictions (last 30 d)'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' }, 'Aggregate seizure by region'),
      table,
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin:8px 0 4px' }, 'Recent events'),
      methodTable,
    );
  }

  // ── Section 5: Precursor Supply Chain ─────────────────────────

  private renderPrecursorSection(rows: readonly PrecursorSignal[]): HTMLElement {
    const highConf = countHighConfidencePrecursorSignals(rows);
    const headerChildren: (HTMLElement | string)[] = ['Precursor Supply Chain'];
    if (highConf > 0) {
      headerChildren.push(h('span', {
        style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
      }, `${highConf} high-conf diversion`));
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const r of rows) table.append(this.renderPrecursorRow(r));
    return h('div', { className: 'ntp-section' },
      h('div', { className: 'ntp-section-header' }, ...headerChildren),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' }, 'Chemical · origin → destination · diversion confidence'),
      table,
    );
  }

  private renderPrecursorRow(r: PrecursorSignal): HTMLElement {
    const pct = Math.round(r.diversionConfidence * 100);
    const color = precursorConfidenceColor(r.diversionConfidence);
    return h('tbody', null,
      h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, precursorLabel(r.chemical)),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc' }, `${r.originRegion} → ${r.destinationRegion}`),
        h('td', { style: 'padding:3px 6px;width:80px' },
          h('div', { style: 'background:#333;border-radius:2px;height:6px' },
            h('div', { style: `background:${color};width:${pct}%;height:6px;border-radius:2px` }),
          ),
        ),
        h('td', { style: `padding:3px 6px;font-size:11px;color:${color};text-align:right` }, `${pct}%`),
        h('td', { style: 'padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right' }, timeAgo(r.reportedAt)),
      ),
      h('tr', null,
        h('td', { colspan: '5', style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222' }, r.rationale),
      ),
    );
  }

  // ── Section 6: Narco-State Corruption ─────────────────────────

  private renderNarcoStateSection(rows: readonly NarcoStateIndex[]): HTMLElement {
    const critical = countCriticalNarcoStates(rows);
    const headerChildren: (HTMLElement | string)[] = ['Narco-State Corruption Index'];
    if (critical > 0) {
      headerChildren.push(h('span', {
        style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
      }, `${critical} critical`));
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const r of rows) table.append(this.renderNarcoStateRow(r));
    return h('div', { className: 'ntp-section' },
      h('div', { className: 'ntp-section-header' }, ...headerChildren),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' }, 'Country · score · band · driver'),
      table,
    );
  }

  private renderNarcoStateRow(r: NarcoStateIndex): HTMLElement {
    const color = bandColor(r.band);
    const widthPct = Math.max(0, Math.min(100, r.corruptionScore));
    return h('tbody', null,
      h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, r.country),
        h('td', { style: 'padding:3px 6px;width:80px' },
          h('div', { style: 'background:#333;border-radius:2px;height:6px' },
            h('div', { style: `background:${color};width:${widthPct}%;height:6px;border-radius:2px` }),
          ),
        ),
        h('td', { style: `padding:3px 6px;font-size:11px;color:${color};text-align:right` }, String(r.corruptionScore)),
        h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;text-align:right;color:${color}` }, bandLabel(r.band)),
      ),
      h('tr', null,
        h('td', { colspan: '4', style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222' }, r.driver),
      ),
    );
  }

  // ── Section 7: Trafficking Volume Trends ──────────────────────

  private renderTrendSection(rows: readonly VolumeTrendRow[]): HTMLElement {
    const rising = countRisingVolumeSubstances(rows);
    const headerChildren: (HTMLElement | string)[] = ['Trafficking Volume Trends (last 30 d)'];
    if (rising > 0) {
      headerChildren.push(h('span', {
        style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
      }, `${rising} rising`));
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const r of rows) table.append(this.renderTrendRow(r));
    return h('div', { className: 'ntp-section' },
      h('div', { className: 'ntp-section-header' }, ...headerChildren),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' }, 'Substance · 30d volume · trend vs prior 30d'),
      table,
    );
  }

  private renderTrendRow(r: VolumeTrendRow): HTMLElement {
    const arrow = volumeTrendArrow(r.trend);
    const tColor = volumeTrendColor(r.trend);
    const shiftPct = `${r.relativeShift >= 0 ? '+' : ''}${Math.round(r.relativeShift * 100)}%`;
    const tonneLabel = r.volume30dTonnes >= 1
      ? `${Math.round(r.volume30dTonnes)} t`
      : `${Math.round(r.volume30dTonnes * 1000)} kg`;
    return h('tr', null,
      h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, substanceLabel(r.substance)),
      h('td', { style: 'padding:3px 6px;font-size:11px;text-align:right' }, tonneLabel),
      h('td', { style: `padding:3px 6px;font-size:11px;text-align:right;color:${tColor}` }, shiftPct),
      h('td', { style: `padding:3px 6px;font-size:13px;text-align:right;color:${tColor}` }, arrow),
    );
  }
}
