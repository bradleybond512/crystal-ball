/**
 * EnergySecurityPanel (panel id: `energy-security`).
 *
 * Deep-intelligence panel for oil/gas supply disruption, pipeline attacks,
 * grid vulnerability, energy price shocks, OPEC+ compliance, LNG terminal
 * status, and energy sanctions impact.
 *
 * Sections:
 *   1. Supply Disruption Events     — active outages (oil/gas/LNG/coal)
 *   2. Pipeline Attack Indicators   — cyber / physical / sabotage events
 *   3. Grid Vulnerability Watch     — per-region grid risk + threat + redundancy
 *   4. Energy Price Shock Signals   — Brent / WTI / TTF / HH / JKM 24h moves
 *   5. OPEC+ Compliance             — per-country quota vs production
 *   6. LNG Terminal Status          — import/export terminal operational state
 *   7. Sanctions Impact Scoring     — composite score net of evasion
 *
 * Pure helpers live in `energy-security-helpers.ts` so unit tests can import
 * them without pulling in the Panel base class or live services.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { query } from '@/services/intelligence/observation-store';
import {
  severityColor,
  severityLabel,
  commodityLabel,
  causeLabel,
  attackTypeLabel,
  attackTypeColor,
  attackStatusColor,
  gridThreatLabel,
  redundancyColor,
  priceLevelColor,
  formatPercentChange,
  opecStatusColor,
  lngRoleLabel,
  lngStatusColor,
  sanctionsImpactColor,
  sanctionsImpactLabel,
  netImpactScore,
  formatMbblPerDay,
  formatMtpa,
  formatDuration,
  composeBadgeCount,
  countActiveDisruptions,
  countConfirmedAttacks,
  countCriticalGrids,
  countShockBenchmarks,
  countOffshoreOfflineTerminals,
  DISRUPTION_EVENTS,
  PIPELINE_ATTACKS,
  GRID_VULNERABILITIES,
  PRICE_SHOCKS,
  OPEC_COMPLIANCE,
  LNG_TERMINALS,
  SANCTIONS_IMPACT,
} from './energy-security-helpers';

const REFRESH_MS = 5 * 60 * 1000;

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px${style ? ';' + style : ''}` }, text);
}

function sectionHeader(title: string, badge?: HTMLElement): HTMLElement {
  const header = h('div', { className: 'esp-section-header' }, title);
  if (badge) header.append(badge);
  return header;
}

function countBadge(count: number, label: string): HTMLElement {
  return h('span', {
    style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
  }, `${count} ${label}`);
}

export class EnergySecurityPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'energy-security',
      title: 'Energy Security Intelligence',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep intelligence view for energy security: supply disruptions, pipeline attacks, grid vulnerabilities, price shocks, OPEC+ compliance, LNG terminals, and sanctions impact.',
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
    const liveEvents = safe(() => query({ domain: 'energy', limit: 50 })) ?? [];
    const liveHighCount = liveEvents.filter(
      (e) => e.severity === 'HIGH' || e.severity === 'CRITICAL',
    ).length;

    this.setCount(
      composeBadgeCount(
        DISRUPTION_EVENTS,
        PIPELINE_ATTACKS,
        GRID_VULNERABILITIES,
        PRICE_SHOCKS,
        LNG_TERMINALS,
      ) + liveHighCount,
    );

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'esp-root' },
        this.buildDisruptionsSection(),
        this.buildAttacksSection(),
        this.buildGridSection(),
        this.buildPriceSection(),
        this.buildOpecSection(),
        this.buildLngSection(),
        this.buildSanctionsSection(),
      ),
    );
  }

  // ── Section 1: Supply Disruption Events ───────────────────────────────

  private buildDisruptionsSection(): HTMLElement {
    const active = countActiveDisruptions(DISRUPTION_EVENTS);
    const badge = active > 0 ? countBadge(active, 'high/critical') : undefined;
    const tbody = h('tbody');

    for (const d of DISRUPTION_EVENTS) {
      const color = severityColor(d.severity);
      const sev   = severityLabel(d.severity);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` }, d.facility),
          cell(d.country, 'color:#9e9e9e'),
          cell(commodityLabel(d.commodity), 'color:#ccc'),
          cell(causeLabel(d.cause), 'color:#ccc'),
          cell(formatDuration(d.durationDays), 'color:#ccc;text-align:right'),
          cell(formatMbblPerDay(d.lostMbblPerDay), 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${color};text-align:right` }, sev),
        ),
      );
    }

    return h('div', { className: 'esp-section' },
      sectionHeader('Supply Disruption Events', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Facility · country · commodity · cause · duration · lost flow · severity',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 2: Pipeline Attack Indicators ─────────────────────────────

  private buildAttacksSection(): HTMLElement {
    const confirmed = countConfirmedAttacks(PIPELINE_ATTACKS);
    const badge = confirmed > 0 ? countBadge(confirmed, 'confirmed') : undefined;
    const tbody = h('tbody');

    for (const a of PIPELINE_ATTACKS) {
      const tColor = attackTypeColor(a.type);
      const sColor = attackStatusColor(a.status);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${tColor}` }, a.pipeline),
          cell(a.country, 'color:#9e9e9e'),
          cell(attackTypeLabel(a.type), 'color:#ccc'),
          cell(`conf ${a.confidence}/3`, 'color:#ccc;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right` }, a.status),
        ),
      );
    }

    return h('div', { className: 'esp-section' },
      sectionHeader('Pipeline Attack Indicators', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Pipeline · country · attack type · analyst confidence · status',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 3: Grid Vulnerability Watch ───────────────────────────────

  private buildGridSection(): HTMLElement {
    const critical = countCriticalGrids(GRID_VULNERABILITIES);
    const badge = critical > 0 ? countBadge(critical, 'high/critical') : undefined;
    const tbody = h('tbody');

    for (const g of GRID_VULNERABILITIES) {
      const color  = severityColor(g.riskLevel);
      const rColor = redundancyColor(g.redundancy);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` }, g.region),
          cell(gridThreatLabel(g.primaryThreat), 'color:#ccc'),
          h('td', { style: `padding:3px 6px;font-size:11px;color:${rColor};text-transform:uppercase` }, `redundancy: ${g.redundancy}`),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${color};text-align:right` }, severityLabel(g.riskLevel)),
        ),
      );
    }

    return h('div', { className: 'esp-section' },
      sectionHeader('Grid Vulnerability Watch', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Region · primary threat · redundancy · risk level',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 4: Energy Price Shock Signals ─────────────────────────────

  private buildPriceSection(): HTMLElement {
    const shocks = countShockBenchmarks(PRICE_SHOCKS);
    const badge = shocks > 0 ? countBadge(shocks, 'shock/crisis') : undefined;
    const tbody = h('tbody');

    for (const p of PRICE_SHOCKS) {
      const color = priceLevelColor(p.level);
      const pct   = formatPercentChange(p.changePercent24h);

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, p.benchmark),
          h('td', { style: `padding:3px 6px;font-size:12px;color:${color};text-align:right` }, pct),
          cell(`shock @ ${p.shockThreshold}%`, 'color:#9e9e9e;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${color};text-align:right` }, p.level),
        ),
      );
    }

    return h('div', { className: 'esp-section' },
      sectionHeader('Energy Price Shock Signals', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Benchmark · 24h change · shock threshold · level',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 5: OPEC+ Compliance ───────────────────────────────────────

  private buildOpecSection(): HTMLElement {
    const tbody = h('tbody');

    for (const o of OPEC_COMPLIANCE) {
      const color = opecStatusColor(o.status);

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, o.country),
          cell(`${o.quotaMbblPerDay.toFixed(1)} Mb/d quota`, 'color:#9e9e9e;text-align:right'),
          cell(`${o.productionMbblPerDay.toFixed(1)} Mb/d`, 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:12px;color:${color};text-align:right` }, `${o.compliancePercent}%`),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${color};text-align:right` }, o.status),
        ),
      );
    }

    return h('div', { className: 'esp-section' },
      sectionHeader('OPEC+ Compliance'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Country · quota · production · compliance % · status',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 6: LNG Terminal Status ────────────────────────────────────

  private buildLngSection(): HTMLElement {
    const offline = countOffshoreOfflineTerminals(LNG_TERMINALS);
    const badge = offline > 0 ? countBadge(offline, 'offline') : undefined;
    const tbody = h('tbody');

    for (const t of LNG_TERMINALS) {
      const sColor = lngStatusColor(t.status);

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, t.terminal),
          cell(t.country, 'color:#9e9e9e'),
          cell(lngRoleLabel(t.role), 'color:#ccc'),
          cell(formatMtpa(t.capacityMtpa), 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${sColor};text-align:right` }, t.status),
        ),
      );
    }

    return h('div', { className: 'esp-section' },
      sectionHeader('LNG Terminal Status', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Terminal · country · role · capacity · status',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 7: Sanctions Impact Scoring ───────────────────────────────

  private buildSanctionsSection(): HTMLElement {
    const tbody = h('tbody');

    for (const s of SANCTIONS_IMPACT) {
      const net    = netImpactScore(s);
      const color  = sanctionsImpactColor(net);
      const label  = sanctionsImpactLabel(net);
      const barWidth = Math.round(net);

      const bar = h('div', { style: 'background:#333;border-radius:2px;height:6px' },
        h('div', { style: `background:${color};width:${barWidth}%;height:6px;border-radius:2px` }),
      );

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` }, s.target),
          cell(s.regime, 'color:#9e9e9e'),
          h('td', { style: 'padding:3px 6px;width:90px' }, bar),
          h('td', { style: `padding:3px 6px;font-size:12px;color:${color};text-align:right` }, `${net}/100`),
          cell(`${formatMbblPerDay(s.evadedMbblPerDay)} evaded`, 'color:#ccc;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${color};text-align:right` }, label),
        ),
      );
    }

    return h('div', { className: 'esp-section' },
      sectionHeader('Sanctions Impact Scoring'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Target · regime · net impact (0–100, evasion deducted) · evaded flow',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }
}
