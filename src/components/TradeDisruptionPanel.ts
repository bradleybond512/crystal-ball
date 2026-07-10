/**
 * TradeDisruptionPanel (panel id: `trade-disruption`).
 *
 * Deep-intelligence panel for global trade flow disruptions.
 *
 * Sections:
 *   1. Sanctions Regimes          — comprehensive + sectoral sanctions with trade impact.
 *   2. Tariff Escalations         — active trade wars with rates + affected volumes.
 *   3. Export Bans & Restrictions — critical commodity export controls.
 *   4. Trade War Flashpoints      — bilateral disputes with trade-at-risk dollar values.
 *   5. Trade Flow Risk Index      — per-region composite 0–4 disruption score.
 *
 * Pure helpers live in `trade-disruption-helpers.ts` so unit tests can import
 * them without pulling in the Panel base class or live services.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { query } from '@/services/intelligence/observation-store';
import {
  sanctionsSeverityColor,
  sanctionsSeverityLabel,
  tariffStageColor,
  tariffStageLabel,
  formatTariffRate,
  exportCategoryColor,
  exportCategoryLabel,
  formatVolumeMt,
  disputeStatusColor,
  disputeStatusLabel,
  flowRiskColor,
  flowRiskLabel,
  formatTradeBn,
  countComprehensiveSanctions,
  countCriticalDisputes,
  countEscalatingTariffs,
  SANCTIONS_REGIMES,
  TARIFF_ESCALATIONS,
  EXPORT_BANS,
  TRADE_FLASHPOINTS,
  FLOW_INDEX,
} from './trade-disruption-helpers';

const REFRESH_MS = 10 * 60 * 1000;

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px${style ? ';' + style : ''}` }, text);
}

function sectionHeader(title: string, badge?: HTMLElement): HTMLElement {
  const header = h('div', { className: 'tdp-section-header' }, title);
  if (badge) header.append(badge);
  return header;
}

function countBadge(count: number, label: string): HTMLElement {
  return h('span', {
    style: 'margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px',
  }, `${count} ${label}`);
}

export class TradeDisruptionPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'trade-disruption',
      title: 'Trade Disruption Intelligence',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep intelligence view for trade disruptions: sanctions regimes, tariff escalations, export bans, trade war flashpoints, and trade flow risk index.',
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
    const liveEvents = safe(() => query({ domain: 'economics', limit: 50 })) ?? [];
    const liveHighCount = liveEvents.filter(
      (e) => e.severity === 'HIGH' || e.severity === 'CRITICAL',
    ).length;

    this.setCount(
      countComprehensiveSanctions(SANCTIONS_REGIMES) +
      countCriticalDisputes(TRADE_FLASHPOINTS) +
      countEscalatingTariffs(TARIFF_ESCALATIONS) +
      liveHighCount,
    );

    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'tdp-root' },
        this.buildSanctionsSection(),
        this.buildTariffsSection(),
        this.buildExportBansSection(),
        this.buildFlashpointsSection(),
        this.buildFlowIndexSection(),
      ),
    );
  }

  // ── Section 1: Sanctions Regimes ──────────────────────────────────────

  private buildSanctionsSection(): HTMLElement {
    const comprehensive = countComprehensiveSanctions(SANCTIONS_REGIMES);
    const badge = comprehensive > 0 ? countBadge(comprehensive, 'comprehensive') : undefined;
    const tbody = h('tbody');

    for (const s of SANCTIONS_REGIMES) {
      const color  = sanctionsSeverityColor(s.severity);
      const sLabel = sanctionsSeverityLabel(s.severity);
      const trade  = formatTradeBn(s.annualTradeImpactBn);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` }, s.target),
          cell(s.imposingParties, 'color:#ccc'),
          cell(s.sectors, 'color:#9e9e9e'),
          cell(trade, 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${color};text-align:right` }, sLabel),
        ),
      );
    }

    return h('div', { className: 'tdp-section' },
      sectionHeader('Sanctions Regimes', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Target · imposing parties · affected sectors · annual trade impact · severity',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 2: Tariff Escalations ─────────────────────────────────────

  private buildTariffsSection(): HTMLElement {
    const escalating = countEscalatingTariffs(TARIFF_ESCALATIONS);
    const badge = escalating > 0 ? countBadge(escalating, 'escalating/retaliatory') : undefined;
    const tbody = h('tbody');

    for (const t of TARIFF_ESCALATIONS) {
      const color  = tariffStageColor(t.stage);
      const sLabel = tariffStageLabel(t.stage);
      const rate   = formatTariffRate(t.tariffRate);
      const vol    = formatTradeBn(t.tradeVolumeBn);

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600' }, t.countries),
          cell(rate, `color:${color};font-weight:600`),
          cell(vol, 'color:#facc15;text-align:right'),
          cell(t.primarySectors, 'color:#9e9e9e'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${color};text-align:right` }, sLabel),
        ),
      );
    }

    return h('div', { className: 'tdp-section' },
      sectionHeader('Tariff Escalations', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Parties · rate · trade volume · sectors · stage',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 3: Export Bans & Restrictions ────────────────────────────

  private buildExportBansSection(): HTMLElement {
    const tbody = h('tbody');

    for (const b of EXPORT_BANS) {
      const color  = exportCategoryColor(b.category);
      const cLabel = exportCategoryLabel(b.category);
      const vol    = formatVolumeMt(b.volumeMt);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` }, b.country),
          cell(b.commodity, 'color:#ccc'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${color}` }, cLabel),
          cell(vol, 'color:#facc15;text-align:right'),
        ),
        h('tr',
          h('td', {
            colspan: '4',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, `Affects: ${b.affectedImporters}`),
        ),
      );
    }

    return h('div', { className: 'tdp-section' },
      sectionHeader('Export Bans & Restrictions'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Country · commodity · category · volume · affected importers',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 4: Trade War Flashpoints ─────────────────────────────────

  private buildFlashpointsSection(): HTMLElement {
    const critical = countCriticalDisputes(TRADE_FLASHPOINTS);
    const badge = critical > 0 ? countBadge(critical, 'critical') : undefined;
    const tbody = h('tbody');

    for (const f of TRADE_FLASHPOINTS) {
      const color  = disputeStatusColor(f.status);
      const sLabel = disputeStatusLabel(f.status);
      const vol    = formatTradeBn(f.tradeAtRiskBn);

      tbody.append(
        h('tr',
          h('td', { style: `padding:3px 6px;font-size:12px;font-weight:600;color:${color}` }, f.parties),
          cell(vol, 'color:#facc15;text-align:right'),
          h('td', { style: `padding:3px 6px;font-size:10px;text-transform:uppercase;color:${color};text-align:right` }, sLabel),
        ),
        h('tr',
          h('td', {
            colspan: '3',
            style: 'padding:0 6px 4px 6px;font-size:10px;color:#9e9e9e;border-bottom:1px solid #222',
          }, f.dispute),
        ),
      );
    }

    return h('div', { className: 'tdp-section' },
      sectionHeader('Trade War Flashpoints', badge),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Parties · trade at risk · status · dispute',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  // ── Section 5: Trade Flow Risk Index ─────────────────────────────────

  private buildFlowIndexSection(): HTMLElement {
    const tbody = h('tbody');

    for (const r of FLOW_INDEX) {
      const color    = flowRiskColor(r.risk);
      const rLabel   = flowRiskLabel(r.risk);
      const barWidth = Math.round((r.risk / 4) * 100);

      const bar = h('div', { style: 'background:#333;border-radius:2px;height:6px' },
        h('div', { style: `background:${color};width:${barWidth}%;height:6px;border-radius:2px` }),
      );

      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px' }, r.region),
          h('td', { style: 'padding:3px 6px;width:80px' }, bar),
          h('td', { style: `padding:3px 6px;font-size:11px;color:${color};text-transform:uppercase` }, rLabel),
        ),
      );
    }

    return h('div', { className: 'tdp-section' },
      sectionHeader('Trade Flow Risk Index'),
      h('div', { style: 'font-size:11px;color:#9e9e9e;margin-bottom:4px' },
        'Regional composite trade disruption risk · 0 minimal → 4 severe',
      ),
      h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }
}
