/**
 * SupplyChainResiliencePanel — operator surface for supply-chain stress.
 *
 * Seven sections, refreshed every 10 minutes:
 *   1. Stress Index           — composite 0..100 + top-weighted driver
 *   2. Semiconductor Shortages — per-node lead-time severity
 *   3. Critical-Goods Scarcity — severity-ranked goods + region
 *   4. Factory Shutdowns      — impact-ranked active disruptions
 *   5. Freight Rate Anomalies — lane-level deviation vs baseline
 *   6. JIT Inventory Risk     — per-sector days-of-cover vs safety
 *   7. Nearshoring Trend      — confidence-weighted sector direction
 *
 * Pure DOM construction via h() / replaceChildren(). Every helper that
 * shapes content lives in `supply-chain-helpers.ts` so tests exercise
 * the same code paths the panel renders. Live data injection is
 * via the `setData(...)` setters — without them the panel renders an
 * "awaiting data" state so it can be enabled before the upstream feed
 * is wired.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  FREIGHT_CLASSIFICATION_COLOR,
  JIT_BAND_COLOR,
  NEARSHORING_DIRECTION_GLYPH,
  NEARSHORING_DIRECTION_LABEL,
  SHORTAGE_SEVERITY_COLOR,
  SHUTDOWN_CAUSE_LABEL,
  STRESS_BAND_COLOR,
  bandForStressScore,
  computeJitRisk,
  computeStressIndex,
  detectFreightAnomalies,
  summarizeFactoryShutdowns,
  summarizeNearshoring,
  summarizeScarcity,
  summarizeSemiconductorShortages,
  type FactoryShutdown,
  type FreightAnomaly,
  type FreightLaneSnapshot,
  type JitInventorySnapshot,
  type JitRiskRow,
  type NearshoringIndicator,
  type NearshoringTrend,
  type ScarcityRow,
  type ScarcitySignal,
  type SemiconductorShortageRow,
  type SemiconductorSnapshot,
  type StressIndex,
  type StressInput,
} from './supply-chain-helpers';

const REFRESH_MS = 10 * 60_000;
const SECTION_STYLE = 'border:1px solid var(--border-subtle,#333);border-radius:4px;padding:10px;display:flex;flex-direction:column;gap:8px;';
const SECTION_TITLE_STYLE = 'font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin:0;';
const SUBTLE = 'font-size:11px;color:var(--text-secondary,#aaa);';

const EMPTY_STRESS: StressInput = {
  freightAnomalyScore: 0,
  factoryShutdownScore: 0,
  semisShortageScore: 0,
  scarcityScore: 0,
  jitRiskScore: 0,
};

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export class SupplyChainResiliencePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  private stressInput: StressInput = EMPTY_STRESS;
  private semis: readonly SemiconductorSnapshot[] = [];
  private scarcity: readonly ScarcitySignal[] = [];
  private shutdowns: readonly FactoryShutdown[] = [];
  private freight: readonly FreightLaneSnapshot[] = [];
  private jit: readonly JitInventorySnapshot[] = [];
  private nearshoring: readonly NearshoringIndicator[] = [];

  constructor() {
    super({
      id: 'supply-chain-resilience',
      title: 'Supply Chain Resilience',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Composite stress index, semiconductor shortages, critical-goods scarcity, factory shutdowns, freight anomalies, JIT inventory risk, and nearshoring trend. Refreshes every 10 minutes.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // ── Live-data setters ────────────────────────────────────────────

  public setStressInput(input: StressInput): void { this.stressInput = input; this.render(); }
  public setSemiconductorSnapshots(snaps: readonly SemiconductorSnapshot[]): void { this.semis = snaps; this.render(); }
  public setScarcitySignals(signals: readonly ScarcitySignal[]): void { this.scarcity = signals; this.render(); }
  public setFactoryShutdowns(s: readonly FactoryShutdown[]): void { this.shutdowns = s; this.render(); }
  public setFreightLaneSnapshots(snaps: readonly FreightLaneSnapshot[]): void { this.freight = snaps; this.render(); }
  public setJitInventorySnapshots(snaps: readonly JitInventorySnapshot[]): void { this.jit = snaps; this.render(); }
  public setNearshoringIndicators(indicators: readonly NearshoringIndicator[]): void { this.nearshoring = indicators; this.render(); }

  // ── Render ───────────────────────────────────────────────────────

  private render(): void {
    const now = Date.now();
    const stress: StressIndex = safe(
      () => computeStressIndex(this.stressInput),
      computeStressIndex(EMPTY_STRESS),
    );
    const semis = safe(() => summarizeSemiconductorShortages(this.semis), []);
    const scarcity = safe(() => summarizeScarcity(this.scarcity, now), []);
    const shutdowns = safe(() => summarizeFactoryShutdowns(this.shutdowns, now), []);
    const freight = safe(() => detectFreightAnomalies(this.freight), []);
    const jit = safe(() => computeJitRisk(this.jit), []);
    const near = safe(() => summarizeNearshoring(this.nearshoring), {
      overall: 'stable',
      confidence: 0,
      bySector: [],
    } as NearshoringTrend);

    const headlineCount = semis.filter((r) => r.severity !== 'low').length
      + scarcity.filter((r) => r.severity !== 'low').length
      + shutdowns.length
      + freight.filter((r) => r.classification !== 'normal').length
      + jit.filter((r) => r.riskBand !== 'safe').length;
    this.setCount(headlineCount);

    const root = h(
      'div',
      { style: 'padding:12px;display:flex;flex-direction:column;gap:12px;' },
      this.renderStressSection(stress),
      this.renderSemiconductorSection(semis),
      this.renderScarcitySection(scarcity),
      this.renderShutdownSection(shutdowns),
      this.renderFreightSection(freight),
      this.renderJitSection(jit),
      this.renderNearshoringSection(near),
    );
    replaceChildren(this.content, root);
  }

  // ── 1. Stress index ──────────────────────────────────────────────

  private renderStressSection(stress: StressIndex): HTMLElement {
    const color = STRESS_BAND_COLOR[stress.band];
    const gauge = h(
      'div',
      { style: 'background:rgba(255,255,255,0.05);height:8px;border-radius:4px;overflow:hidden;' },
      h('div', { style: `width:${Math.max(0, Math.min(100, stress.score))}%;height:100%;background:${color};transition:width 240ms ease;` }),
    );
    const scoreLine = h(
      'div',
      { style: 'display:flex;align-items:baseline;gap:8px;' },
      h('span', { style: `font-size:24px;font-weight:600;color:${color};` }, String(stress.score)),
      h('span', { style: SUBTLE }, '/ 100'),
      h('span', { style: `font-size:11px;color:${color};margin-left:auto;text-transform:uppercase;letter-spacing:0.05em;` }, stress.band),
    );
    const driverLine = stress.topDriver === null
      ? h('div', { style: SUBTLE }, 'No stress components reporting.')
      : h('div', { style: SUBTLE }, `Top driver: ${stress.topDriver}`);
    return h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'stress', band: stress.band } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Supply Chain Stress'),
      scoreLine,
      gauge,
      driverLine,
    );
  }

  // ── 2. Semiconductor shortages ───────────────────────────────────

  private renderSemiconductorSection(rows: readonly SemiconductorShortageRow[]): HTMLElement {
    const section = h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'semis' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Semiconductor Shortages'),
    );
    if (rows.length === 0) {
      section.append(h('div', { style: SUBTLE }, 'No semiconductor lead-time data available.'));
      return section;
    }
    for (const row of rows) {
      const sevColor = SHORTAGE_SEVERITY_COLOR[row.severity];
      section.append(h(
        'div',
        { style: 'display:grid;grid-template-columns:60px 1fr 70px;gap:8px;align-items:center;font-size:12px;', dataset: { row: 'semi', node: row.node, severity: row.severity } },
        h('span', { style: `font-family:ui-monospace,monospace;color:${sevColor};font-weight:600;` }, row.node),
        h('div', { style: 'display:flex;flex-direction:column;gap:2px;' },
          h('div', { style: 'color:#e5e5e5;' }, `${row.leadTimeWeeks}w lead (baseline ${row.baselineLeadTimeWeeks}w)`),
          h('div', { style: SUBTLE }, row.affectedSectors.length === 0 ? '—' : row.affectedSectors.join(', '))),
        h('span', { style: `font-family:ui-monospace,monospace;text-align:right;color:${sevColor};` }, `${row.ratio.toFixed(2)}×`),
      ));
    }
    return section;
  }

  // ── 3. Critical-goods scarcity ───────────────────────────────────

  private renderScarcitySection(rows: readonly ScarcityRow[]): HTMLElement {
    const section = h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'scarcity' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Critical-Goods Scarcity'),
    );
    if (rows.length === 0) {
      section.append(h('div', { style: SUBTLE }, 'No scarcity signals reported.'));
      return section;
    }
    for (const row of rows) {
      const sevColor = SHORTAGE_SEVERITY_COLOR[row.severity];
      section.append(h(
        'div',
        { style: 'display:grid;grid-template-columns:1fr 90px 40px;gap:8px;align-items:center;font-size:12px;', dataset: { row: 'scarcity', good: row.good, severity: row.severity } },
        h('div', { style: 'display:flex;flex-direction:column;gap:2px;' },
          h('div', { style: `color:${sevColor};` }, row.good),
          h('div', { style: SUBTLE }, `${row.region} · ${row.source}`)),
        h('span', { style: `font-size:10px;text-transform:uppercase;color:${sevColor};letter-spacing:0.05em;` }, row.severity),
        h('span', { style: `font-family:ui-monospace,monospace;text-align:right;${SUBTLE}` }, row.ageLabel),
      ));
    }
    return section;
  }

  // ── 4. Factory shutdowns ─────────────────────────────────────────

  private renderShutdownSection(rows: readonly ReturnType<typeof summarizeFactoryShutdowns>[number][]): HTMLElement {
    const section = h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'shutdowns' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Factory Shutdowns'),
    );
    if (rows.length === 0) {
      section.append(h('div', { style: SUBTLE }, 'No active shutdowns.'));
      return section;
    }
    for (const row of rows) {
      section.append(h(
        'div',
        { style: 'display:grid;grid-template-columns:1fr 110px 70px;gap:8px;align-items:start;font-size:12px;', dataset: { row: 'shutdown', id: row.id, cause: row.cause } },
        h('div', { style: 'display:flex;flex-direction:column;gap:2px;' },
          h('div', { style: 'color:#e5e5e5;' }, row.facility),
          h('div', { style: SUBTLE }, `${row.region} · ${SHUTDOWN_CAUSE_LABEL[row.cause]}`)),
        h('span', { style: `font-family:ui-monospace,monospace;${SUBTLE}` }, `dur ${row.durationLabel} · age ${row.ageLabel}`),
        h('span', { style: 'font-family:ui-monospace,monospace;text-align:right;color:#e5e5e5;' }, `${row.impactScore}`),
      ));
    }
    return section;
  }

  // ── 5. Freight rate anomalies ────────────────────────────────────

  private renderFreightSection(rows: readonly FreightAnomaly[]): HTMLElement {
    const section = h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'freight' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Freight Rate Anomalies'),
    );
    if (rows.length === 0) {
      section.append(h('div', { style: SUBTLE }, 'No freight rate data available.'));
      return section;
    }
    for (const row of rows) {
      const color = FREIGHT_CLASSIFICATION_COLOR[row.classification];
      const sign = row.percentDelta > 0 ? '+' : '';
      section.append(h(
        'div',
        { style: 'display:grid;grid-template-columns:1fr 80px 80px;gap:8px;align-items:center;font-size:12px;', dataset: { row: 'freight', lane: row.lane, classification: row.classification } },
        h('div', { style: 'display:flex;flex-direction:column;gap:2px;' },
          h('div', { style: 'color:#e5e5e5;' }, row.lane),
          h('div', { style: SUBTLE }, `$${row.currentRateUsd} vs $${row.baselineRateUsd}`)),
        h('span', { style: `font-family:ui-monospace,monospace;text-align:right;color:${color};` }, `${sign}${row.percentDelta.toFixed(1)}%`),
        h('span', { style: `font-size:10px;text-transform:uppercase;text-align:right;color:${color};letter-spacing:0.05em;` }, row.classification),
      ));
    }
    return section;
  }

  // ── 6. JIT inventory risk ────────────────────────────────────────

  private renderJitSection(rows: readonly JitRiskRow[]): HTMLElement {
    const section = h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'jit' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Just-In-Time Inventory Risk'),
    );
    if (rows.length === 0) {
      section.append(h('div', { style: SUBTLE }, 'No inventory snapshots loaded.'));
      return section;
    }
    for (const row of rows) {
      const color = JIT_BAND_COLOR[row.riskBand];
      section.append(h(
        'div',
        { style: 'display:grid;grid-template-columns:1fr 110px 90px;gap:8px;align-items:center;font-size:12px;', dataset: { row: 'jit', sector: row.sector, band: row.riskBand } },
        h('div', { style: 'display:flex;flex-direction:column;gap:2px;' },
          h('span', { style: `color:${color};` }, row.sector),
          h('span', { style: SUBTLE }, `safety ${row.safetyThresholdDays}d`)),
        h('span', { style: `font-family:ui-monospace,monospace;${SUBTLE}` }, `${row.daysOfCover}d cover · −${row.shortfallDays}d`),
        h('span', { style: `font-size:10px;text-transform:uppercase;text-align:right;color:${color};letter-spacing:0.05em;` }, row.riskBand.replace('_', ' ')),
      ));
    }
    return section;
  }

  // ── 7. Nearshoring trend ─────────────────────────────────────────

  private renderNearshoringSection(trend: NearshoringTrend): HTMLElement {
    const section = h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'nearshoring', direction: trend.overall } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Nearshoring Trend'),
    );
    const headline = h(
      'div',
      { style: 'display:flex;align-items:baseline;gap:8px;' },
      h('span', { style: 'font-size:20px;font-weight:600;color:#e5e5e5;' }, `${NEARSHORING_DIRECTION_GLYPH[trend.overall]} ${NEARSHORING_DIRECTION_LABEL[trend.overall]}`),
      h('span', { style: SUBTLE }, `confidence ${(trend.confidence * 100).toFixed(0)} %`),
    );
    section.append(headline);
    if (trend.bySector.length === 0) {
      section.append(h('div', { style: SUBTLE }, 'No sector indicators loaded.'));
      return section;
    }
    for (const indicator of trend.bySector) {
      section.append(h(
        'div',
        { style: 'display:grid;grid-template-columns:1fr 90px 50px;gap:8px;align-items:center;font-size:12px;', dataset: { row: 'sector', sector: indicator.sector, direction: indicator.direction } },
        h('div', { style: 'display:flex;flex-direction:column;gap:2px;' },
          h('span', { style: 'color:#e5e5e5;' }, indicator.sector),
          h('span', { style: SUBTLE }, indicator.rationale || '—')),
        h('span', { style: `font-size:11px;color:#e5e5e5;` }, `${NEARSHORING_DIRECTION_GLYPH[indicator.direction]} ${NEARSHORING_DIRECTION_LABEL[indicator.direction]}`),
        h('span', { style: `font-family:ui-monospace,monospace;text-align:right;${SUBTLE}` }, `${(indicator.confidence * 100).toFixed(0)}%`),
      ));
    }
    return section;
  }
}

// Exposed for tests.
export const __testables = { safe, EMPTY_STRESS, bandForStressScore };
