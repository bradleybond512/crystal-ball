/**
 * DiplomaticCrisisPanel — operator surface for diplomatic-crisis signals.
 *
 * Eight sections, refreshed every 30 minutes:
 *   1. Heat Index             — composite 0..100 + top driver
 *   2. Ambassador Expulsions  — rank-aware severity, reciprocal flag
 *   3. Embassy Closures       — partial / consular / evacuated / fully closed
 *   4. Bilateral Disputes     — Vienna-Convention escalation ladder (1..5)
 *   5. UN Security Council    — recent emergency sessions + outcome
 *   6. Trade War Signals      — tariffs, sanctions, export controls
 *   7. Treaty Actions         — suspensions, denouncements, withdrawals
 *   8. Back-channel Activity  — confidence-weighted overall direction
 *
 * Pure DOM construction via h() / replaceChildren(). Every helper that
 * shapes content lives in `diplomatic-crisis-helpers.ts` so tests
 * exercise the same code paths the panel renders. Live data injection
 * is via the `set*` setters — without them the panel renders
 * "awaiting data" rows so it can ship before the upstream feed is wired.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  BACKCHANNEL_DIRECTION_GLYPH,
  BACKCHANNEL_DIRECTION_LABEL,
  BACKCHANNEL_TYPE_LABEL,
  DISPUTE_STAGE_COLOR,
  DISPUTE_STAGE_LABEL,
  EMBASSY_CLOSURE_TYPE_LABEL,
  HEAT_BAND_COLOR,
  RANK_LABEL,
  SEVERITY_COLOR,
  TRADE_WAR_KIND_LABEL,
  TREATY_ACTION_COLOR,
  TREATY_ACTION_LABEL,
  UNSC_OUTCOME_COLOR,
  UNSC_OUTCOME_LABEL,
  computeDiplomaticHeatIndex,
  summarizeBackchannelActivity,
  summarizeDisputes,
  summarizeEmbassyClosures,
  summarizeExpulsions,
  summarizeTradeWarSignals,
  summarizeTreatyEvents,
  summarizeUnscSessions,
  type BackchannelIndicator,
  type BackchannelSummary,
  type BilateralDispute,
  type DiplomaticHeatIndex,
  type DiplomaticHeatInput,
  type DisputeRow,
  type EmbassyClosureEvent,
  type EmbassyClosureRow,
  type ExpulsionEvent,
  type ExpulsionRow,
  type TradeWarRow,
  type TradeWarSignal,
  type TreatyEvent,
  type TreatyEventRow,
  type UnscSession,
  type UnscSessionRow,
} from './diplomatic-crisis-helpers';

const REFRESH_MS = 30 * 60_000;
const SECTION_STYLE = 'border:1px solid var(--border-subtle,#333);border-radius:4px;padding:10px;display:flex;flex-direction:column;gap:8px;';
const SECTION_TITLE_STYLE = 'font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin:0;';
const SUBTLE = 'font-size:11px;color:var(--text-secondary,#aaa);';

const EMPTY_HEAT: DiplomaticHeatInput = {
  expulsionScore: 0,
  embassyClosureScore: 0,
  disputeEscalationScore: 0,
  unscEmergencyScore: 0,
  tradeWarScore: 0,
  treatyActionScore: 0,
  backchannelEscalationScore: 0,
};

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

export class DiplomaticCrisisPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  private heatInput: DiplomaticHeatInput = EMPTY_HEAT;
  private expulsions: readonly ExpulsionEvent[] = [];
  private closures: readonly EmbassyClosureEvent[] = [];
  private disputes: readonly BilateralDispute[] = [];
  private unsc: readonly UnscSession[] = [];
  private tradeWar: readonly TradeWarSignal[] = [];
  private treaties: readonly TreatyEvent[] = [];
  private backchannels: readonly BackchannelIndicator[] = [];

  constructor() {
    super({
      id: 'diplomatic-crisis',
      title: 'Diplomatic Crisis',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Composite heat index, ambassador expulsions, embassy closures, bilateral dispute ladder, UN Security Council emergency sessions, trade-war signals, treaty actions, and back-channel direction. Refreshes every 30 minutes.',
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

  public setHeatInput(input: DiplomaticHeatInput): void { this.heatInput = input; this.render(); }
  public setExpulsions(events: readonly ExpulsionEvent[]): void { this.expulsions = events; this.render(); }
  public setEmbassyClosures(events: readonly EmbassyClosureEvent[]): void { this.closures = events; this.render(); }
  public setDisputes(disputes: readonly BilateralDispute[]): void { this.disputes = disputes; this.render(); }
  public setUnscSessions(sessions: readonly UnscSession[]): void { this.unsc = sessions; this.render(); }
  public setTradeWarSignals(signals: readonly TradeWarSignal[]): void { this.tradeWar = signals; this.render(); }
  public setTreatyEvents(events: readonly TreatyEvent[]): void { this.treaties = events; this.render(); }
  public setBackchannelIndicators(indicators: readonly BackchannelIndicator[]): void { this.backchannels = indicators; this.render(); }

  // ── Render ───────────────────────────────────────────────────────

  private render(): void {
    const now = Date.now();
    const heat = safe(() => computeDiplomaticHeatIndex(this.heatInput), computeDiplomaticHeatIndex(EMPTY_HEAT));
    const expulsions = safe(() => summarizeExpulsions(this.expulsions, now), []);
    const closures = safe(() => summarizeEmbassyClosures(this.closures, now), []);
    const disputes = safe(() => summarizeDisputes(this.disputes, now), []);
    const unsc = safe(() => summarizeUnscSessions(this.unsc, now), []);
    const tradeWar = safe(() => summarizeTradeWarSignals(this.tradeWar, now), []);
    const treaties = safe(() => summarizeTreatyEvents(this.treaties, now), []);
    const back = safe(() => summarizeBackchannelActivity(this.backchannels), {
      overall: 'maintenance',
      confidence: 0,
      indicators: [],
    } as BackchannelSummary);

    const headlineCount = expulsions.filter((r) => r.severity !== 'low').length
      + closures.length
      + disputes.filter((r) => r.stageRank >= 3).length
      + unsc.filter((r) => r.riskWeight >= 1).length
      + tradeWar.filter((r) => r.severity !== 'low').length
      + treaties.filter((r) => r.actionRank >= 3).length;
    this.setCount(headlineCount);

    const root = h(
      'div',
      { style: 'padding:12px;display:flex;flex-direction:column;gap:12px;' },
      this.renderHeatSection(heat),
      this.renderExpulsionSection(expulsions),
      this.renderClosureSection(closures),
      this.renderDisputeSection(disputes),
      this.renderUnscSection(unsc),
      this.renderTradeWarSection(tradeWar),
      this.renderTreatySection(treaties),
      this.renderBackchannelSection(back),
    );
    replaceChildren(this.content, root);
  }

  // ── 1. Heat index ────────────────────────────────────────────────

  private renderHeatSection(heat: DiplomaticHeatIndex): HTMLElement {
    const color = HEAT_BAND_COLOR[heat.band];
    const gauge = h(
      'div',
      { style: 'background:rgba(255,255,255,0.05);height:8px;border-radius:4px;overflow:hidden;' },
      h('div', { style: `width:${Math.max(0, Math.min(100, heat.score))}%;height:100%;background:${color};transition:width 240ms ease;` }),
    );
    const headline = h(
      'div',
      { style: 'display:flex;align-items:baseline;gap:8px;' },
      h('span', { style: `font-size:24px;font-weight:600;color:${color};` }, String(heat.score)),
      h('span', { style: SUBTLE }, '/ 100'),
      h('span', { style: `font-size:11px;color:${color};margin-left:auto;text-transform:uppercase;letter-spacing:0.05em;` }, heat.band),
    );
    const driver = heat.topDriver === null
      ? h('div', { style: SUBTLE }, 'No heat components reporting.')
      : h('div', { style: SUBTLE }, `Top driver: ${heat.topDriver}`);
    return h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'heat', band: heat.band } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Diplomatic Heat'),
      headline,
      gauge,
      driver,
    );
  }

  // ── 2. Expulsions ────────────────────────────────────────────────

  private renderExpulsionSection(rows: readonly ExpulsionRow[]): HTMLElement {
    const section = h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'expulsions' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Ambassador / Diplomat Expulsions'),
    );
    if (rows.length === 0) {
      section.append(h('div', { style: SUBTLE }, 'No expulsions reported.'));
      return section;
    }
    for (const row of rows) {
      const sevColor = SEVERITY_COLOR[row.severity];
      const reciprocalNote = row.reciprocal ? ' · reciprocal' : '';
      section.append(h(
        'div',
        { style: 'display:grid;grid-template-columns:1fr 110px 40px;gap:8px;align-items:start;font-size:12px;', dataset: { row: 'expulsion', id: row.id, severity: row.severity } },
        h('div', { style: 'display:flex;flex-direction:column;gap:2px;' },
          h('div', { style: `color:${sevColor};` }, `${row.hostCountry} ← ${row.sendingCountry}`),
          h('div', { style: SUBTLE }, `${RANK_LABEL[row.rank]} × ${row.count}${reciprocalNote}`)),
        h('span', { style: `font-size:10px;text-transform:uppercase;color:${sevColor};letter-spacing:0.05em;text-align:right;` }, row.severity),
        h('span', { style: `font-family:ui-monospace,monospace;text-align:right;${SUBTLE}` }, row.ageLabel),
      ));
    }
    return section;
  }

  // ── 3. Embassy closures ──────────────────────────────────────────

  private renderClosureSection(rows: readonly EmbassyClosureRow[]): HTMLElement {
    const section = h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'closures' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Embassy Closures'),
    );
    if (rows.length === 0) {
      section.append(h('div', { style: SUBTLE }, 'No embassy closures reported.'));
      return section;
    }
    for (const row of rows) {
      const sevColor = SEVERITY_COLOR[row.severity];
      section.append(h(
        'div',
        { style: 'display:grid;grid-template-columns:1fr 130px 40px;gap:8px;align-items:start;font-size:12px;', dataset: { row: 'closure', id: row.id, type: row.type } },
        h('div', { style: 'display:flex;flex-direction:column;gap:2px;' },
          h('div', { style: `color:${sevColor};` }, `${row.sendingCountry} embassy in ${row.hostCountry}`),
          h('div', { style: SUBTLE }, EMBASSY_CLOSURE_TYPE_LABEL[row.type])),
        h('span', { style: `font-size:10px;text-transform:uppercase;color:${sevColor};letter-spacing:0.05em;text-align:right;` }, row.severity),
        h('span', { style: `font-family:ui-monospace,monospace;text-align:right;${SUBTLE}` }, row.ageLabel),
      ));
    }
    return section;
  }

  // ── 4. Bilateral disputes ────────────────────────────────────────

  private renderDisputeSection(rows: readonly DisputeRow[]): HTMLElement {
    const section = h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'disputes' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Bilateral Disputes'),
    );
    if (rows.length === 0) {
      section.append(h('div', { style: SUBTLE }, 'No active bilateral disputes.'));
      return section;
    }
    for (const row of rows) {
      const stageColor = DISPUTE_STAGE_COLOR[row.stage];
      const nextHint = row.nextStage === null
        ? 'at top rung'
        : `next: ${DISPUTE_STAGE_LABEL[row.nextStage]}`;
      section.append(h(
        'div',
        { style: 'display:grid;grid-template-columns:1fr 60px 40px;gap:8px;align-items:start;font-size:12px;', dataset: { row: 'dispute', id: row.id, stage: row.stage } },
        h('div', { style: 'display:flex;flex-direction:column;gap:2px;' },
          h('div', { style: `color:${stageColor};` }, `${row.countryA} ↔ ${row.countryB} · ${row.topic}`),
          h('div', { style: SUBTLE }, `${DISPUTE_STAGE_LABEL[row.stage]} · ${nextHint}`)),
        h('span', { style: `font-family:ui-monospace,monospace;text-align:right;color:${stageColor};` }, `${row.stageRank}/5`),
        h('span', { style: `font-family:ui-monospace,monospace;text-align:right;${SUBTLE}` }, row.ageLabel),
      ));
    }
    return section;
  }

  // ── 5. UNSC sessions ─────────────────────────────────────────────

  private renderUnscSection(rows: readonly UnscSessionRow[]): HTMLElement {
    const section = h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'unsc' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'UN Security Council Emergency Sessions'),
    );
    if (rows.length === 0) {
      section.append(h('div', { style: SUBTLE }, 'No recent UNSC emergency sessions.'));
      return section;
    }
    for (const row of rows) {
      const color = UNSC_OUTCOME_COLOR[row.outcome];
      const vetoNote = row.vetoedBy === null ? '' : ` · vetoed by ${row.vetoedBy}`;
      section.append(h(
        'div',
        { style: 'display:grid;grid-template-columns:1fr 130px 40px;gap:8px;align-items:start;font-size:12px;', dataset: { row: 'unsc', id: row.id, outcome: row.outcome } },
        h('div', { style: 'display:flex;flex-direction:column;gap:2px;' },
          h('div', { style: 'color:#e5e5e5;' }, row.agenda),
          h('div', { style: SUBTLE }, `requested by ${row.requestingMember}${vetoNote}`)),
        h('span', { style: `font-size:10px;text-transform:uppercase;color:${color};letter-spacing:0.05em;text-align:right;` }, UNSC_OUTCOME_LABEL[row.outcome]),
        h('span', { style: `font-family:ui-monospace,monospace;text-align:right;${SUBTLE}` }, row.ageLabel),
      ));
    }
    return section;
  }

  // ── 6. Trade war signals ─────────────────────────────────────────

  private renderTradeWarSection(rows: readonly TradeWarRow[]): HTMLElement {
    const section = h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'trade-war' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Trade-War Escalation Signals'),
    );
    if (rows.length === 0) {
      section.append(h('div', { style: SUBTLE }, 'No trade-war signals reported.'));
      return section;
    }
    for (const row of rows) {
      const sevColor = SEVERITY_COLOR[row.severity];
      const magLabel = row.kind === 'tariff' ? `${row.magnitude}%` : `tier ${row.magnitude}`;
      section.append(h(
        'div',
        { style: 'display:grid;grid-template-columns:1fr 110px 40px;gap:8px;align-items:start;font-size:12px;', dataset: { row: 'trade', id: row.id, kind: row.kind } },
        h('div', { style: 'display:flex;flex-direction:column;gap:2px;' },
          h('div', { style: `color:${sevColor};` }, `${row.imposer} → ${row.target} · ${row.sector}`),
          h('div', { style: SUBTLE }, `${TRADE_WAR_KIND_LABEL[row.kind]} · ${magLabel}`)),
        h('span', { style: `font-size:10px;text-transform:uppercase;color:${sevColor};letter-spacing:0.05em;text-align:right;` }, row.severity),
        h('span', { style: `font-family:ui-monospace,monospace;text-align:right;${SUBTLE}` }, row.ageLabel),
      ));
    }
    return section;
  }

  // ── 7. Treaty events ─────────────────────────────────────────────

  private renderTreatySection(rows: readonly TreatyEventRow[]): HTMLElement {
    const section = h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'treaties' } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Treaty Actions'),
    );
    if (rows.length === 0) {
      section.append(h('div', { style: SUBTLE }, 'No treaty actions reported.'));
      return section;
    }
    for (const row of rows) {
      const color = TREATY_ACTION_COLOR[row.action];
      section.append(h(
        'div',
        { style: 'display:grid;grid-template-columns:1fr 130px 40px;gap:8px;align-items:start;font-size:12px;', dataset: { row: 'treaty', id: row.id, action: row.action } },
        h('div', { style: 'display:flex;flex-direction:column;gap:2px;' },
          h('div', { style: `color:${color};` }, row.treaty),
          h('div', { style: SUBTLE }, `${row.party}`)),
        h('span', { style: `font-size:10px;text-transform:uppercase;color:${color};letter-spacing:0.05em;text-align:right;` }, TREATY_ACTION_LABEL[row.action]),
        h('span', { style: `font-family:ui-monospace,monospace;text-align:right;${SUBTLE}` }, row.ageLabel),
      ));
    }
    return section;
  }

  // ── 8. Back-channel activity ─────────────────────────────────────

  private renderBackchannelSection(summary: BackchannelSummary): HTMLElement {
    const section = h(
      'div',
      { style: SECTION_STYLE, dataset: { section: 'backchannel', direction: summary.overall } },
      h('div', { style: SECTION_TITLE_STYLE }, 'Back-channel Activity'),
    );
    const headline = h(
      'div',
      { style: 'display:flex;align-items:baseline;gap:8px;' },
      h('span', { style: 'font-size:20px;font-weight:600;color:#e5e5e5;' }, `${BACKCHANNEL_DIRECTION_GLYPH[summary.overall]} ${BACKCHANNEL_DIRECTION_LABEL[summary.overall]}`),
      h('span', { style: SUBTLE }, `confidence ${(summary.confidence * 100).toFixed(0)} %`),
    );
    section.append(headline);
    if (summary.indicators.length === 0) {
      section.append(h('div', { style: SUBTLE }, 'No back-channel indicators loaded.'));
      return section;
    }
    for (const indicator of summary.indicators) {
      section.append(h(
        'div',
        { style: 'display:grid;grid-template-columns:1fr 130px 50px;gap:8px;align-items:start;font-size:12px;', dataset: { row: 'backchannel', id: indicator.id, direction: indicator.direction } },
        h('div', { style: 'display:flex;flex-direction:column;gap:2px;' },
          h('span', { style: 'color:#e5e5e5;' }, `${indicator.pair} · ${BACKCHANNEL_TYPE_LABEL[indicator.type]}`),
          h('span', { style: SUBTLE }, indicator.rationale || '—')),
        h('span', { style: `font-size:11px;color:#e5e5e5;text-align:right;` }, `${BACKCHANNEL_DIRECTION_GLYPH[indicator.direction]} ${BACKCHANNEL_DIRECTION_LABEL[indicator.direction]}`),
        h('span', { style: `font-family:ui-monospace,monospace;text-align:right;${SUBTLE}` }, `${(indicator.confidence * 100).toFixed(0)}%`),
      ));
    }
    return section;
  }
}

// Exposed for tests.
export const __testables = { safe, EMPTY_HEAT };
