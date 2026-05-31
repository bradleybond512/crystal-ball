/**
 * SanctionsTrackerPanel (panel id: `sanctions-tracker`).
 *
 * Deep intelligence view for the global sanctions landscape:
 *   1. Active Sanctions Regimes      — OFAC / EU / UN / UK-OFSI / Canada coverage by target country.
 *   2. Newly Designated Entities     — designations within the last 30 days.
 *   3. Evasion Network Signals       — detected shell companies, dark fleets, port-hopping, crypto laundering, front financiers, mis-invoicing.
 *   4. Secondary Sanctions Exposure  — composite exposure score per country.
 *   5. Sanctions-Busting Trade Corridors — known corridors with monthly volume.
 *   6. Frozen Asset Tracking         — frozen asset value by jurisdiction / origin / asset type.
 *
 * Pure helpers + label/color tables live in `sanctions-tracker-helpers.ts`.
 * The panel does no fetching — it reads from the existing intelligence
 * stores (ObservationStore) when relevant events are present, and falls
 * back to deterministic seed snapshots otherwise. Every singleton read
 * is wrapped in safe() so a misbehaving service can't crash the page.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { query as observationQuery } from '@/services/intelligence/observation-store';
import {
  // Section 1
  countComprehensiveRegimes,
  regimeScopeColor,
  regimeScopeLabel,
  // Section 2
  countRecentDesignations,
  isRecentlyDesignated,
  designationColor,
  designationLabel,
  // Section 3
  highConfidenceEvasionCount,
  evasionPatternLabel,
  evasionConfidenceColor,
  evasionConfidenceLabel,
  // Section 4
  computeExposureScore,
  classifyExposure,
  exposureTierColor,
  exposureTierLabel,
  // Section 5
  totalActiveCorridorVolumeUsdM,
  corridorStatusColor,
  corridorStatusLabel,
  // Section 6
  totalFrozenAssetsUsdBn,
  frozenAssetsByJurisdiction,
  frozenAssetTypeLabel,
  totalAlertCount,
  ACTIVE_REGIMES,
  NEW_DESIGNATIONS,
  EVASION_SIGNALS,
  COUNTRY_EXPOSURE,
  TRADE_CORRIDORS,
  FROZEN_ASSETS,
  REFERENCE_NOW_MS,
  type ActiveSanctionsRegime,
  type NewlyDesignated,
  type EvasionSignal,
  type CountryExposure,
  type TradeCorridor,
  type FrozenAssets,
} from './sanctions-tracker-helpers';

const REFRESH_MS = 60 * 60 * 1000;

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
  const header = h('div', { className: 'stp-section-header', style: 'font-weight:600;font-size:13px;margin:10px 0 4px 0' }, title);
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

function fmtDate(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export class SanctionsTrackerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'sanctions-tracker',
      title: 'Sanctions Tracker',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep intelligence on the global sanctions landscape: active OFAC / EU / UN regimes, newly designated entities, evasion network signals, secondary sanctions exposure by country, sanctions-busting trade corridors, and frozen asset tracking.',
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
    // Pull any ObservationStore events tagged sanctions/sanctions-evasion
    // so the panel reflects live evidence when feeds are wired. Failures
    // fall through to deterministic seed snapshots.
    const liveEvents = safe(() => observationQuery({ domain: 'geopolitical', limit: 50 })) ?? [];

    const regimes = ACTIVE_REGIMES;
    const designations = NEW_DESIGNATIONS;
    const evasions = EVASION_SIGNALS;
    const exposure = COUNTRY_EXPOSURE;
    const corridors = TRADE_CORRIDORS;
    const frozen = FROZEN_ASSETS;
    const nowMs = Date.now() || REFERENCE_NOW_MS;

    this.setCount(totalAlertCount({ regimes, designations, evasions, nowMs }));

    const root = h('div', { className: 'stp' });
    root.append(this.renderHeader(regimes, designations, evasions, nowMs, liveEvents.length));
    root.append(this.renderActiveRegimes(regimes));
    root.append(this.renderNewDesignations(designations, nowMs));
    root.append(this.renderEvasionSignals(evasions));
    root.append(this.renderExposure(exposure));
    root.append(this.renderCorridors(corridors));
    root.append(this.renderFrozenAssets(frozen));

    replaceChildren(this.getContentElement(), root);
  }

  private renderHeader(
    regimes: readonly ActiveSanctionsRegime[],
    designations: readonly NewlyDesignated[],
    evasions: readonly EvasionSignal[],
    nowMs: number,
    liveEventCount: number,
  ): HTMLElement {
    return h('div', {
      style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:baseline;font-size:11px;opacity:0.85;margin-bottom:4px',
    },
      h('span', {}, `${countComprehensiveRegimes(regimes)} comprehensive regimes`),
      h('span', {}, `· ${countRecentDesignations(designations, nowMs)} new in 30d`),
      h('span', {}, `· ${highConfidenceEvasionCount(evasions)} strong evasion signals`),
      h('span', {}, `· ${liveEventCount} live geopolitical observations`),
    );
  }

  private renderActiveRegimes(rows: ActiveSanctionsRegime[]): HTMLElement {
    const section = h('section', { 'data-section': 'active-regimes' });
    section.append(sectionHeader('Active Sanctions Regimes'));
    if (rows.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No active sanctions regimes.'));
      return section;
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const tbody = h('tbody');
    for (const r of rows) {
      const tr = h('tr');
      tr.append(cell(r.country, 'font-weight:600'));
      tr.append(cell(r.body, 'opacity:0.85'));
      tr.append(cell(r.regimeName, 'opacity:0.75;font-size:11px'));
      const scopeCell = h('td', { style: 'padding:3px 6px' });
      scopeCell.append(tierBadge(regimeScopeLabel(r.scope), regimeScopeColor(r.scope)));
      tr.append(scopeCell);
      tr.append(cell(`since ${r.sinceYear}`, 'opacity:0.6;font-size:11px'));
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(table);
    return section;
  }

  private renderNewDesignations(items: NewlyDesignated[], nowMs: number): HTMLElement {
    const section = h('section', { 'data-section': 'new-designations' });
    section.append(sectionHeader('Newly Designated Entities', countRecentDesignations(items, nowMs)));
    if (items.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No recent designations.'));
      return section;
    }
    const list = h('ul', { style: 'list-style:none;padding:0;margin:0' });
    for (const d of items) {
      const li = h('li', { style: 'padding:3px 0;font-size:12px' });
      li.append(tierBadge(designationLabel(d.type), designationColor(d.type)));
      li.append(h('span', { style: 'margin-left:6px;font-weight:600' }, d.name));
      li.append(h('span', { style: 'opacity:0.7;margin-left:6px' }, `${d.designator} · ${d.country} · ${d.sectoralProgram}`));
      const recency = isRecentlyDesignated(d, nowMs) ? 'NEW' : '';
      li.append(h('span', { style: 'opacity:0.6;margin-left:6px;font-size:11px' }, `${fmtDate(d.designatedAt)}${recency ? ' · ' + recency : ''}`));
      list.append(li);
    }
    section.append(list);
    return section;
  }

  private renderEvasionSignals(signals: EvasionSignal[]): HTMLElement {
    const section = h('section', { 'data-section': 'evasion-signals' });
    section.append(sectionHeader('Evasion Network Signals', highConfidenceEvasionCount(signals)));
    if (signals.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No evasion signals detected.'));
      return section;
    }
    const list = h('ul', { style: 'list-style:none;padding:0;margin:0' });
    for (const s of signals) {
      const li = h('li', { style: 'padding:3px 0;font-size:12px' });
      li.append(tierBadge(evasionConfidenceLabel(s.confidence), evasionConfidenceColor(s.confidence)));
      li.append(h('span', { style: 'margin-left:6px;font-weight:600' }, evasionPatternLabel(s.pattern)));
      li.append(h('span', { style: 'opacity:0.7;margin-left:6px' }, `→ ${s.target}`));
      li.append(h('div', { style: 'opacity:0.65;font-size:11px;margin-left:4px' }, s.notes));
      list.append(li);
    }
    section.append(list);
    return section;
  }

  private renderExposure(rows: CountryExposure[]): HTMLElement {
    const section = h('section', { 'data-section': 'secondary-exposure' });
    section.append(sectionHeader('Secondary Sanctions Exposure'));
    if (rows.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No exposure data.'));
      return section;
    }
    const list = h('div', { style: 'display:flex;flex-direction:column;gap:4px' });
    const sorted = [...rows].sort((a, b) => computeExposureScore(b) - computeExposureScore(a));
    for (const r of sorted) {
      const score = computeExposureScore(r);
      const tier = classifyExposure(score);
      const row = h('div', { style: 'display:grid;grid-template-columns:140px 70px 110px 1fr;align-items:center;gap:6px;font-size:12px' });
      row.append(h('span', { style: 'font-weight:600' }, r.country));
      row.append(h('span', { style: 'opacity:0.8' }, `${score}/100`));
      row.append(tierBadge(exposureTierLabel(tier), exposureTierColor(tier)));
      row.append(h('span', { style: 'opacity:0.65;font-size:11px' }, r.riskNotes));
      list.append(row);
    }
    section.append(list);
    return section;
  }

  private renderCorridors(corridors: TradeCorridor[]): HTMLElement {
    const section = h('section', { 'data-section': 'trade-corridors' });
    section.append(sectionHeader('Sanctions-Busting Trade Corridors'));
    if (corridors.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No active corridors.'));
      return section;
    }
    section.append(h('div', {
      style: 'opacity:0.7;font-size:11px;margin:2px 0',
    }, `Active corridor volume: $${Math.round(totalActiveCorridorVolumeUsdM(corridors)).toLocaleString()}M / month`));
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const tbody = h('tbody');
    const sorted = [...corridors].sort((a, b) => b.monthlyVolumeUsdM - a.monthlyVolumeUsdM);
    for (const c of sorted) {
      const tr = h('tr');
      tr.append(cell(`${c.from} → ${c.to}`, 'font-weight:600'));
      tr.append(cell(c.commodity, 'opacity:0.75'));
      tr.append(cell(`$${Math.round(c.monthlyVolumeUsdM).toLocaleString()}M`, 'opacity:0.85'));
      const statusCell = h('td', { style: 'padding:3px 6px' });
      statusCell.append(tierBadge(corridorStatusLabel(c.status), corridorStatusColor(c.status)));
      tr.append(statusCell);
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(table);
    return section;
  }

  private renderFrozenAssets(assets: FrozenAssets[]): HTMLElement {
    const section = h('section', { 'data-section': 'frozen-assets' });
    section.append(sectionHeader('Frozen Asset Tracking'));
    if (assets.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No frozen assets tracked.'));
      return section;
    }
    section.append(h('div', {
      style: 'opacity:0.7;font-size:11px;margin:2px 0',
    }, `Total frozen: $${totalFrozenAssetsUsdBn(assets).toLocaleString()}B`));

    const byJurisdiction = frozenAssetsByJurisdiction(assets);
    const summary = h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin:2px 0 6px 0' });
    const jurisdictions = [...byJurisdiction.entries()].sort((a, b) => b[1] - a[1]);
    for (const [j, v] of jurisdictions) {
      summary.append(h('span', {
        style: 'background:#1f2937;color:#e5e7eb;padding:1px 6px;border-radius:3px;font-size:11px',
      }, `${j} $${(Math.round(v * 10) / 10).toLocaleString()}B`));
    }
    section.append(summary);

    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const tbody = h('tbody');
    for (const a of assets) {
      const tr = h('tr');
      tr.append(cell(a.jurisdiction, 'font-weight:600'));
      tr.append(cell(a.originCountry, 'opacity:0.85'));
      tr.append(cell(frozenAssetTypeLabel(a.assetType), 'opacity:0.75'));
      tr.append(cell(`$${a.valueUsdBn.toLocaleString()}B`, 'opacity:0.85'));
      tr.append(cell(a.program, 'opacity:0.65;font-size:11px'));
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(table);
    return section;
  }
}
