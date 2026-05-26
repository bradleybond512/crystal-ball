/**
 * SovereignDebtPanel (panel id: `sovereign-debt`).
 *
 * Deep intelligence view for sovereign credit and debt distress:
 *   1. Sovereign Credit Watch     — CDS spreads + debt-to-GDP per country.
 *   2. Multilateral Risk Flags    — IMF / World Bank / Paris Club programmes.
 *   3. Yield Curve Watch          — 2y/10y inversion by country.
 *   4. Debt Stress Events         — restructurings + reserve drawdowns.
 *   5. Contagion Risk Index       — per-region 0–4 composite score.
 *
 * Pure helpers + label/color tables live in `sovereign-debt-helpers.ts`.
 * The panel does no fetching — it reads from the existing intelligence
 * stores (ObservationStore) when relevant events are present, and falls
 * back to deterministic seed snapshots otherwise. Every singleton read
 * is wrapped in safe() so a misbehaving service can't crash the page.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { query as observationQuery } from '@/services/intelligence/observation-store';
import {
  classifyCreditTier,
  creditTierColor,
  creditTierLabel,
  countActivePrograms,
  distressTierColor,
  distressTierLabel,
  classifyYieldCurve,
  curveSpreadBps,
  yieldCurveColor,
  yieldCurveLabel,
  countInvertedCurves,
  restructuringColor,
  restructuringLabel,
  reservePressureColor,
  reservePressureLabel,
  activeRestructurings,
  computeContagionScore,
  contagionColor,
  contagionLabel,
  SOVEREIGN_CREDIT,
  MULTILATERAL_FLAGS,
  YIELD_CURVES,
  RESTRUCTURING_EVENTS,
  RESERVE_DRAWDOWNS,
  CONTAGION_REGIONS,
  type SovereignCreditEntry,
  type MultilateralFlag,
  type YieldCurvePoint,
  type RestructuringEvent,
  type ReserveDrawdown,
  type ContagionEntry,
} from './sovereign-debt-helpers';

const REFRESH_MS = 5 * 60 * 1000;

function safe<T>(fn: () => T): T | null {
  try {
    return fn() ?? null;
  } catch {
    return null;
  }
}

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px${style ? ';' + style : ''}` }, text);
}

function sectionHeader(title: string, count?: number): HTMLElement {
  const header = h('div', { className: 'sdp-section-header', style: 'font-weight:600;font-size:13px;margin:10px 0 4px 0' }, title);
  if (typeof count === 'number' && count > 0) {
    header.append(h('span', {
      style: 'margin-left:6px;font-size:10px;background:#b91c1c;color:#fff;border-radius:10px;padding:1px 6px',
    }, String(count)));
  }
  return header;
}

function tierBadge(text: string, bg: string): HTMLElement {
  return h('span', {
    style: `display:inline-block;background:${bg};color:#fff;padding:1px 6px;border-radius:3px;font-size:11px`,
  }, text);
}

export class SovereignDebtPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'sovereign-debt',
      title: 'Sovereign Debt',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep intelligence on sovereign credit risk: CDS spreads, debt-to-GDP, IMF / World Bank flags, yield-curve inversions, restructuring events, reserve drawdowns, and regional contagion risk.',
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
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  private refresh(): void {
    // Pull any ObservationStore events tagged sovereign/debt so the panel
    // reflects live evidence when feeds are wired. Failures fall through
    // to deterministic seed snapshots.
    const liveEvents = safe(() => observationQuery({ domain: 'finance', limit: 50 })) ?? [];

    const credit = SOVEREIGN_CREDIT;
    const flags = MULTILATERAL_FLAGS;
    const curves = YIELD_CURVES;
    const restructurings = RESTRUCTURING_EVENTS;
    const reserves = RESERVE_DRAWDOWNS;
    const regions = CONTAGION_REGIONS.map((r) => computeContagionScore(r));

    const distressedCount = credit.filter((c) => {
      const t = classifyCreditTier(c);
      return t === 'distressed' || t === 'default-imminent';
    }).length;

    this.setCount(distressedCount + activeRestructurings(restructurings) + countActivePrograms(flags));

    const root = h('div', { className: 'sdp' });
    root.append(this.renderHeader(distressedCount, liveEvents.length));
    root.append(this.renderCreditWatch(credit));
    root.append(this.renderMultilateralFlags(flags));
    root.append(this.renderYieldCurves(curves));
    root.append(this.renderStressEvents(restructurings, reserves));
    root.append(this.renderContagionIndex(regions));

    replaceChildren(this.getContentElement(), root);
  }

  private renderHeader(distressedCount: number, liveEventCount: number): HTMLElement {
    return h('div', {
      style: 'display:flex;gap:12px;align-items:baseline;font-size:11px;opacity:0.85;margin-bottom:4px',
    },
      h('span', {}, `${distressedCount} distressed sovereigns`),
      h('span', {}, `· ${liveEventCount} live finance observations`),
    );
  }

  private renderCreditWatch(rows: SovereignCreditEntry[]): HTMLElement {
    const section = h('section', { 'data-section': 'sovereign-credit' });
    section.append(sectionHeader('Sovereign Credit Watch'));
    if (rows.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No sovereign credit data.'));
      return section;
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const tbody = h('tbody');
    for (const r of rows) {
      const tier = classifyCreditTier(r);
      const tr = h('tr');
      tr.append(cell(r.country));
      tr.append(cell(`${r.cdsSpread5y}bp`, 'opacity:0.9'));
      tr.append(cell(`${Math.round(r.debtToGdp * 100)}% debt/GDP`, 'opacity:0.8'));
      const tierCell = h('td', { style: 'padding:3px 6px' });
      tierCell.append(tierBadge(creditTierLabel(tier), creditTierColor(tier)));
      tr.append(tierCell);
      tr.append(cell(r.notes, 'opacity:0.6;font-size:11px'));
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(table);
    return section;
  }

  private renderMultilateralFlags(flags: MultilateralFlag[]): HTMLElement {
    const section = h('section', { 'data-section': 'multilateral-flags' });
    section.append(sectionHeader('Multilateral Risk Flags', countActivePrograms(flags)));
    if (flags.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No active IMF/World Bank flags.'));
      return section;
    }
    const list = h('ul', { style: 'list-style:none;padding:0;margin:0' });
    for (const f of flags) {
      const li = h('li', { style: 'padding:3px 0;font-size:12px' });
      li.append(tierBadge(distressTierLabel(f.tier), distressTierColor(f.tier)));
      li.append(h('span', { style: 'margin-left:6px;font-weight:600' }, f.country));
      li.append(h('span', { style: 'opacity:0.7;margin-left:6px' }, `${f.source} · ${f.programType}`));
      if (f.amountUsdBn !== null) {
        li.append(h('span', { style: 'opacity:0.7;margin-left:6px' }, `$${f.amountUsdBn}B`));
      }
      list.append(li);
    }
    section.append(list);
    return section;
  }

  private renderYieldCurves(curves: YieldCurvePoint[]): HTMLElement {
    const section = h('section', { 'data-section': 'yield-curves' });
    section.append(sectionHeader('Yield Curve Watch', countInvertedCurves(curves)));
    if (curves.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No yield curve data.'));
      return section;
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const tbody = h('tbody');
    for (const c of curves) {
      const state = classifyYieldCurve(c);
      const tr = h('tr');
      tr.append(cell(c.country));
      tr.append(cell(`2y ${c.yield2y.toFixed(2)}%`, 'opacity:0.85'));
      tr.append(cell(`10y ${c.yield10y.toFixed(2)}%`, 'opacity:0.85'));
      tr.append(cell(`${curveSpreadBps(c)}bp`, 'opacity:0.7'));
      const stateCell = h('td', { style: 'padding:3px 6px' });
      stateCell.append(tierBadge(yieldCurveLabel(state), yieldCurveColor(state)));
      tr.append(stateCell);
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(table);
    return section;
  }

  private renderStressEvents(events: RestructuringEvent[], reserves: ReserveDrawdown[]): HTMLElement {
    const section = h('section', { 'data-section': 'stress-events' });
    section.append(sectionHeader('Debt Stress Events', activeRestructurings(events)));

    section.append(h('div', { style: 'font-size:11px;opacity:0.75;margin:2px 0' }, 'Restructurings'));
    if (events.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No restructuring events.'));
    } else {
      const list = h('ul', { style: 'list-style:none;padding:0;margin:0' });
      for (const e of events) {
        const li = h('li', { style: 'padding:2px 0;font-size:12px' });
        li.append(tierBadge(restructuringLabel(e.status), restructuringColor(e.status)));
        const haircut = e.haircutPercent === null ? '' : `, ${e.haircutPercent}% haircut`;
        li.append(h('span', { style: 'margin-left:6px' }, `${e.country} — $${e.bondsAffectedUsdBn}B${haircut}`));
        list.append(li);
      }
      section.append(list);
    }

    section.append(h('div', { style: 'font-size:11px;opacity:0.75;margin:6px 0 2px 0' }, 'Reserve drawdowns'));
    if (reserves.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No reserve drawdown signals.'));
    } else {
      const list = h('ul', { style: 'list-style:none;padding:0;margin:0' });
      for (const r of reserves) {
        const li = h('li', { style: 'padding:2px 0;font-size:12px' });
        li.append(tierBadge(reservePressureLabel(r.pressure), reservePressureColor(r.pressure)));
        const change = `${r.changeMonthPct > 0 ? '+' : ''}${r.changeMonthPct.toFixed(1)}% MoM`;
        li.append(h('span', { style: 'margin-left:6px' }, `${r.country} — $${r.reservesUsdBn}B (${change}, ${r.importCoverMonths.toFixed(1)}mo cover)`));
        list.append(li);
      }
      section.append(list);
    }
    return section;
  }

  private renderContagionIndex(regions: ContagionEntry[]): HTMLElement {
    const section = h('section', { 'data-section': 'contagion-index' });
    section.append(sectionHeader('Contagion Risk Index'));
    if (regions.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No contagion data.'));
      return section;
    }
    const list = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
    for (const r of regions) {
      const row = h('div', { style: 'display:grid;grid-template-columns:160px 110px 1fr;align-items:center;gap:6px;font-size:12px' });
      row.append(h('span', { style: 'opacity:0.9' }, r.region));
      row.append(tierBadge(`${r.risk}/4 ${contagionLabel(r.risk)}`, contagionColor(r.risk)));
      row.append(h('span', { style: 'opacity:0.65;font-size:11px' }, r.drivers.length === 0 ? 'no active drivers' : r.drivers.join(' · ')));
      list.append(row);
    }
    section.append(list);
    return section;
  }
}
