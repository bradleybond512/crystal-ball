/**
 * MaritimeBoundaryPanel (panel id `maritime-boundary`).
 *
 * Deep-intelligence maritime-boundary surface. Seven sections:
 *   1. Composite Pressure Score  weighted 0–100 across all six axes.
 *   2. EEZ / Territorial-Sea Disputes  active and escalating claims.
 *   3. UNCLOS Arbitration Docket  ICJ / ITLOS / PCA / Annex-VII cases.
 *   4. Island / Reef Militarization  observed-feature signals.
 *   5. Fisheries Incursion Events  IUU + unlicensed + flag-state issues.
 *   6. Maritime Law Enforcement  boarding / detention / seizure / protest.
 *   7. Regional Dispute Heat Map  per-region aggregate heat.
 *   8. Naval Patrol Confrontations  observer-tier intensity ladder.
 *
 * Pure helpers (scoring, aggregations, static catalogues) live in
 * `maritime-boundary-helpers.ts` so tests can exercise them
 * without spinning up the Panel base class. Refresh: 1h.
 *
 * Framing is strictly observer / analyst — no operational detail,
 * no targeting, no evasion or tactical content. Public CSIS / IISS /
 * USNI / ICJ / PCA bulletin style only.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  bandColor,
  bandLabel,
  BOUNDARY_DISPUTE_EVENTS,
  casePhaseLabel,
  computeMaritimeBoundaryScore,
  confrontationIntensityColor,
  confrontationIntensityLabel,
  countActiveArbitrations,
  countEscalatingDisputes,
  countHighIntensityMilitarization,
  countRecentEnforcementIncidents,
  countRecentIncursionEvents,
  countUnsafeConfrontations,
  disputeKindLabel,
  disputeStatusColor,
  disputeStatusLabel,
  enforcementKindLabel,
  ENFORCEMENT_INCIDENTS,
  FISHERIES_INCURSIONS,
  heatColor,
  incursionKindLabel,
  militarizationKindLabel,
  MILITARIZATION_SIGNALS,
  NAVAL_CONFRONTATIONS,
  summarizeHeatByRegion,
  summarizeIncursionsByRegion,
  timeAgo,
  UNCLOS_CASE_DOCKET,
  venueLabel,
  type BoundaryDisputeEvent,
  type FisheriesIncursionEvent,
  type MaritimeBoundaryCompositeScore,
  type MaritimeEnforcementIncident,
  type MilitarizationSignal,
  type NavalConfrontationEvent,
  type UnclosCaseRow,
} from './maritime-boundary-helpers';

const REFRESH_MS = 60 * 60 * 1000;
const TOOLTIP =
  'Analytical view of maritime-boundary pressure: EEZ / territorial-sea disputes, UNCLOS arbitration docket, island-feature militarization, fisheries incursions, maritime law-enforcement incidents, regional dispute heat, and observer-tier naval patrol confrontations. 1-hour refresh.';

function safe<T>(fn: () => T): T | null {
  try { return fn() ?? null; } catch { return null; }
}

export class MaritimeBoundaryPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'maritime-boundary',
      title: 'Maritime Boundary',
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
    const disputes      = safe<readonly BoundaryDisputeEvent[]>(() => BOUNDARY_DISPUTE_EVENTS) ?? [];
    const cases         = safe<readonly UnclosCaseRow[]>(() => UNCLOS_CASE_DOCKET) ?? [];
    const militarization = safe<readonly MilitarizationSignal[]>(() => MILITARIZATION_SIGNALS) ?? [];
    const incursions    = safe<readonly FisheriesIncursionEvent[]>(() => FISHERIES_INCURSIONS) ?? [];
    const enforcement   = safe<readonly MaritimeEnforcementIncident[]>(() => ENFORCEMENT_INCIDENTS) ?? [];
    const confrontations = safe<readonly NavalConfrontationEvent[]>(() => NAVAL_CONFRONTATIONS) ?? [];

    const score = computeMaritimeBoundaryScore({
      escalatingDisputes:           countEscalatingDisputes(disputes),
      activeArbitrations:           countActiveArbitrations(cases),
      highIntensityMilitarization:  countHighIntensityMilitarization(militarization),
      recentIncursionEvents:        countRecentIncursionEvents(incursions),
      recentEnforcementIncidents:   countRecentEnforcementIncidents(enforcement),
      unsafeConfrontations:         countUnsafeConfrontations(confrontations),
    });

    this.setCount(score.total);
    const root = h('div', { className: 'mbp-root' },
      this.renderScoreSection(score),
      this.renderDisputeSection(disputes),
      this.renderArbitrationSection(cases),
      this.renderMilitarizationSection(militarization),
      this.renderIncursionSection(incursions),
      this.renderEnforcementSection(enforcement),
      this.renderHeatMapSection(disputes),
      this.renderConfrontationSection(confrontations),
    );
    replaceChildren(this.content, root);
  }

  // ── Section 1: Composite Pressure Score ────────────────────────

  private renderScoreSection(score: MaritimeBoundaryCompositeScore): HTMLElement {
    const color = bandColor(score.band);
    const widthPct = Math.max(0, Math.min(100, score.total));
    return h('div', { className: 'mbp-section' },
      h('div', { className: 'mbp-section-header', style: 'display:flex;align-items:baseline;gap:8px' },
        h('span', null, 'Composite Boundary-Pressure Score'),
        h('span', { style: `font-size:11px;color:${color};text-transform:uppercase;letter-spacing:0.04em` }, bandLabel(score.band)),
        h('span', { style: 'margin-left:auto;font-size:18px;font-weight:600' }, String(score.total), '/100'),
      ),
      h('div', { style: 'background:#1f1f1f;border-radius:3px;height:8px;overflow:hidden;margin:6px 0 4px' },
        h('div', { style: `background:${color};width:${widthPct}%;height:8px;border-radius:3px` }),
      ),
      h('div', { style: 'font-size:11px;color:#9e9e9e' },
        `Contributions — disputes ${score.contributions.boundaryDisputes}, arbitration ${score.contributions.arbitrationLoad}, militarization ${score.contributions.militarization}, fisheries ${score.contributions.fisheriesIncursions}, enforcement ${score.contributions.enforcementIncidents}, naval ${score.contributions.navalConfrontations}`,
      ),
    );
  }

  // ── Section 2: EEZ / Territorial-Sea Disputes ─────────────────

  private renderDisputeSection(rows: readonly BoundaryDisputeEvent[]): HTMLElement {
    const escalating = countEscalatingDisputes(rows);
    const headerChildren: (HTMLElement | string)[] = ['EEZ / Territorial-Sea Disputes'];
    if (escalating > 0) {
      headerChildren.push(h('span', {
        style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
      }, `${escalating} escalating`));
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const r of rows) table.append(this.renderDisputeRow(r));
    return h('div', { className: 'mbp-section' },
      h('div', { className: 'mbp-section-header' }, ...headerChildren),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' }, 'Region · parties · kind · status · heat'),
      table,
    );
  }

  private renderDisputeRow(r: BoundaryDisputeEvent): HTMLElement {
    const statusColor = disputeStatusColor(r.status);
    const hColor = heatColor(r.heatIndex);
    return h('tbody', null,
      h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, r.region),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc' }, `${r.partyA} vs ${r.partyB}`),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e' }, disputeKindLabel(r.kind)),
        h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;text-align:right;color:${statusColor}` }, disputeStatusLabel(r.status)),
        h('td', { style: `padding:3px 6px;font-size:11px;text-align:right;color:${hColor}` }, String(r.heatIndex)),
        h('td', { style: 'padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right' }, timeAgo(r.reportedAt)),
      ),
      h('tr', null,
        h('td', { colspan: '6', style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222' }, r.summary),
      ),
    );
  }

  // ── Section 3: UNCLOS Arbitration Docket ──────────────────────

  private renderArbitrationSection(rows: readonly UnclosCaseRow[]): HTMLElement {
    const active = countActiveArbitrations(rows);
    const headerChildren: (HTMLElement | string)[] = ['UNCLOS Arbitration Docket'];
    if (active > 0) {
      headerChildren.push(h('span', {
        style: 'margin-left:6px;font-size:10px;background:#fb923c;color:#000;border-radius:10px;padding:1px 6px',
      }, `${active} active`));
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const r of rows) table.append(this.renderArbitrationRow(r));
    return h('div', { className: 'mbp-section' },
      h('div', { className: 'mbp-section-header' }, ...headerChildren),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' }, 'Case · venue · applicant vs respondent · phase'),
      table,
    );
  }

  private renderArbitrationRow(r: UnclosCaseRow): HTMLElement {
    return h('tbody', null,
      h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, r.caseName),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc' }, venueLabel(r.venue)),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e' }, `${r.applicant} vs ${r.respondent}`),
        h('td', { style: 'padding:3px 6px;font-size:11px;text-align:right' }, casePhaseLabel(r.phase)),
        h('td', { style: 'padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right' }, timeAgo(r.filedAt)),
      ),
      h('tr', null,
        h('td', { colspan: '5', style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222' }, `${r.region} — ${r.note}`),
      ),
    );
  }

  // ── Section 4: Island / Reef Militarization ───────────────────

  private renderMilitarizationSection(rows: readonly MilitarizationSignal[]): HTMLElement {
    const high = countHighIntensityMilitarization(rows);
    const headerChildren: (HTMLElement | string)[] = ['Island / Reef Militarization'];
    if (high > 0) {
      headerChildren.push(h('span', {
        style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
      }, `${high} high-intensity`));
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const r of rows) table.append(this.renderMilitarizationRow(r));
    return h('div', { className: 'mbp-section' },
      h('div', { className: 'mbp-section-header' }, ...headerChildren),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' }, 'Feature · controlling claimant · kind · intensity'),
      table,
    );
  }

  private renderMilitarizationRow(r: MilitarizationSignal): HTMLElement {
    const color = heatColor(r.intensity);
    const widthPct = Math.max(0, Math.min(100, r.intensity));
    return h('tbody', null,
      h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, r.feature),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc' }, r.controllingClaimant),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e' }, militarizationKindLabel(r.kind)),
        h('td', { style: 'padding:3px 6px;width:80px' },
          h('div', { style: 'background:#333;border-radius:2px;height:6px' },
            h('div', { style: `background:${color};width:${widthPct}%;height:6px;border-radius:2px` }),
          ),
        ),
        h('td', { style: `padding:3px 6px;font-size:11px;color:${color};text-align:right` }, String(r.intensity)),
        h('td', { style: 'padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right' }, timeAgo(r.observedAt)),
      ),
      h('tr', null,
        h('td', { colspan: '6', style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222' }, `${r.region} — ${r.rationale}`),
      ),
    );
  }

  // ── Section 5: Fisheries Incursion Events ─────────────────────

  private renderIncursionSection(rows: readonly FisheriesIncursionEvent[]): HTMLElement {
    const recent = countRecentIncursionEvents(rows);
    const headerChildren: (HTMLElement | string)[] = ['Fisheries Incursion Events'];
    if (recent > 0) {
      headerChildren.push(h('span', {
        style: 'margin-left:6px;font-size:10px;background:#fb923c;color:#000;border-radius:10px;padding:1px 6px',
      }, `${recent} in 30d`));
    }
    const aggregated = summarizeIncursionsByRegion(rows);
    const aggTable = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const a of aggregated) {
      aggTable.append(h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, a.region),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc;text-align:right' }, `${a.vesselCount} vessels`),
        h('td', { style: 'padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right' }, `${a.eventCount} events`),
      ));
    }
    const eventTable = h('table', { style: 'width:100%;border-collapse:collapse;margin-top:6px' });
    for (const r of rows.slice(0, 6)) {
      eventTable.append(h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc' }, r.region),
        h('td', { style: 'padding:3px 6px;font-size:11px' }, incursionKindLabel(r.kind)),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e' }, `${r.flagState} → ${r.hostState}`),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e;text-align:right' }, `${r.vesselCount} vsl`),
        h('td', { style: 'padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right' }, timeAgo(r.reportedAt)),
      ));
    }
    return h('div', { className: 'mbp-section' },
      h('div', { className: 'mbp-section-header' }, ...headerChildren),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' }, 'Aggregate by region (last 30 d)'),
      aggTable,
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin:8px 0 4px' }, 'Recent events'),
      eventTable,
    );
  }

  // ── Section 6: Maritime Law Enforcement Incidents ─────────────

  private renderEnforcementSection(rows: readonly MaritimeEnforcementIncident[]): HTMLElement {
    const recent = countRecentEnforcementIncidents(rows);
    const headerChildren: (HTMLElement | string)[] = ['Maritime Law Enforcement Incidents'];
    if (recent > 0) {
      headerChildren.push(h('span', {
        style: 'margin-left:6px;font-size:10px;background:#fb923c;color:#000;border-radius:10px;padding:1px 6px',
      }, `${recent} in 30d`));
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const r of rows) table.append(this.renderEnforcementRow(r));
    return h('div', { className: 'mbp-section' },
      h('div', { className: 'mbp-section-header' }, ...headerChildren),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' }, 'Region · host vs flag · kind · outcome'),
      table,
    );
  }

  private renderEnforcementRow(r: MaritimeEnforcementIncident): HTMLElement {
    return h('tbody', null,
      h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, r.region),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc' }, `${r.hostState} → ${r.flagState}`),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e' }, enforcementKindLabel(r.kind)),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#9e9e9e;text-align:right' }, r.vesselCount > 0 ? `${r.vesselCount} vsl` : '—'),
        h('td', { style: 'padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right' }, timeAgo(r.reportedAt)),
      ),
      h('tr', null,
        h('td', { colspan: '5', style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222' }, r.outcome),
      ),
    );
  }

  // ── Section 7: Regional Dispute Heat Map ──────────────────────

  private renderHeatMapSection(rows: readonly BoundaryDisputeEvent[]): HTMLElement {
    const aggregated = summarizeHeatByRegion(rows);
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const a of aggregated) {
      const color = bandColor(a.band);
      const widthPct = Math.max(0, Math.min(100, a.heat));
      table.append(h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, a.region),
        h('td', { style: 'padding:3px 6px;width:120px' },
          h('div', { style: 'background:#333;border-radius:2px;height:6px' },
            h('div', { style: `background:${color};width:${widthPct}%;height:6px;border-radius:2px` }),
          ),
        ),
        h('td', { style: `padding:3px 6px;font-size:11px;color:${color};text-align:right` }, String(a.heat)),
        h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;text-align:right;color:${color}` }, bandLabel(a.band)),
        h('td', { style: 'padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right' }, `${a.contributingClaims} claims`),
      ));
    }
    return h('div', { className: 'mbp-section' },
      h('div', { className: 'mbp-section-header' }, 'Regional Dispute Heat Map'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' }, 'Aggregate dispute heat per region'),
      table,
    );
  }

  // ── Section 8: Naval Patrol Confrontations ────────────────────

  private renderConfrontationSection(rows: readonly NavalConfrontationEvent[]): HTMLElement {
    const unsafe = countUnsafeConfrontations(rows);
    const headerChildren: (HTMLElement | string)[] = ['Naval Patrol Confrontations'];
    if (unsafe > 0) {
      headerChildren.push(h('span', {
        style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
      }, `${unsafe} unsafe / live-fire`));
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    for (const r of rows) table.append(this.renderConfrontationRow(r));
    return h('div', { className: 'mbp-section' },
      h('div', { className: 'mbp-section-header' }, ...headerChildren),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' }, 'Region · parties · intensity'),
      table,
    );
  }

  private renderConfrontationRow(r: NavalConfrontationEvent): HTMLElement {
    const color = confrontationIntensityColor(r.intensity);
    return h('tbody', null,
      h('tr', null,
        h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, r.region),
        h('td', { style: 'padding:3px 6px;font-size:11px;color:#ccc' }, `${r.partyA} ↔ ${r.partyB}`),
        h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;text-align:right;color:${color}` }, confrontationIntensityLabel(r.intensity)),
        h('td', { style: 'padding:3px 6px;font-size:10px;color:#9e9e9e;text-align:right' }, timeAgo(r.observedAt)),
      ),
      h('tr', null,
        h('td', { colspan: '4', style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222' }, r.summary),
      ),
    );
  }
}
