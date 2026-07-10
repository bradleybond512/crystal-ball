/**
 * RegulatoryArbitragePanel (panel id: `regulatory-arbitrage`).
 *
 * Tracks cross-jurisdiction regulatory gaps exploited by global actors:
 *   1. Summary Bar                    — headline risk metrics at a glance
 *   2. Jurisdiction Opacity Scores    — beneficial ownership opacity + shell company hotspots
 *   3. FATF Status Tracker            — grey/blacklist status by country
 *   4. Regulatory Gap Map             — tax haven, crypto, data sovereignty, finance gaps
 *   5. Arbitrage Exposure Metrics     — composite per-jurisdiction risk score
 *   6. Enforcement Trend Analysis     — action counts and penalty totals by region
 *
 * All data is deterministic / offline-safe seed data.
 * Every singleton call is wrapped in safe() so a service error cannot crash the page.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  // Opacity
  classifyOpacity,
  opacityTierColor,
  opacityTierLabel,
  sortByOpacityDesc,
  countExtremeOpacityJurisdictions,
  // FATF
  fatfStatusColor,
  fatfStatusLabel,
  countFatfByStatus,
  highRiskFatfJurisdictions,
  averageComplianceScore,
  // Regulatory gaps
  gapSeverityColor,
  gapSeverityLabel,
  gapDomainLabel,
  countCriticalGaps,
  sortGapsBySeverityDesc,
  // Arbitrage exposure
  computeArbitrageScore,
  classifyArbitrageRisk,
  arbitrageRiskColor,
  arbitrageRiskLabel,
  totalIllicitFlowsUsdBn,
  sortByArbitrageScoreDesc,
  // Enforcement
  enforcementTrendColor,
  enforcementTrendLabel,
  totalPenaltiesUsdM,
  sortByPenaltiesDesc,
  // Summary builder
  buildPanelSummary,
  // Seed data
  JURISDICTION_OPACITY,
  FATF_JURISDICTIONS,
  REGULATORY_GAPS,
  ARBITRAGE_EXPOSURE,
  ENFORCEMENT_REGIONS,
  // Types
  type JurisdictionOpacity,
  type FatfJurisdiction,
  type RegulatoryGap,
  type ArbitrageExposure,
  type EnforcementRegion,
} from './regulatory-arbitrage-helpers';

const REFRESH_MS = 60 * 60 * 1000;

function safe<T>(fn: () => T): T | null {
  try { return fn() ?? null; } catch { return null; }
}

function badge(text: string, bg: string, fg = '#fff'): HTMLElement {
  return h('span', {
    style: `display:inline-block;background:${bg};color:${fg};padding:1px 7px;border-radius:3px;font-size:11px;font-weight:600`,
  }, text);
}

function sectionHeader(title: string, extra?: string): HTMLElement {
  const el = h('div', {
    style: 'font-weight:700;font-size:13px;margin:14px 0 5px 0;padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,0.1)',
  }, title);
  if (extra) {
    el.append(h('span', { style: 'font-weight:400;opacity:0.6;font-size:11px;margin-left:8px' }, extra));
  }
  return el;
}

function cell(text: string, style = ''): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px;${style}` }, text);
}

export class RegulatoryArbitragePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'regulatory-arbitrage',
      title: 'Regulatory Arbitrage',
      trackActivity: true,
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
    const opacity    = safe(() => [...JURISDICTION_OPACITY])  ?? [];
    const fatf       = safe(() => [...FATF_JURISDICTIONS])    ?? [];
    const gaps       = safe(() => [...REGULATORY_GAPS])       ?? [];
    const exposure   = safe(() => [...ARBITRAGE_EXPOSURE])    ?? [];
    const enforcement = safe(() => [...ENFORCEMENT_REGIONS])  ?? [];

    const summary = safe(() => buildPanelSummary(opacity, fatf, gaps, exposure, enforcement));

    const container = h('div', { style: 'padding:10px;font-family:var(--font-mono,monospace);color:var(--text-primary,#e5e7eb)' });

    if (summary) container.append(this.renderSummaryBar(summary));
    container.append(this.renderOpacity(sortByOpacityDesc(opacity)));
    container.append(this.renderFatf(fatf));
    container.append(this.renderGaps(sortGapsBySeverityDesc(gaps)));
    container.append(this.renderExposure(sortByArbitrageScoreDesc(exposure)));
    container.append(this.renderEnforcement(sortByPenaltiesDesc(enforcement)));

    replaceChildren(this.content, container);
  }

  // ── Summary bar ──────────────────────────────────────────────────────────

  private renderSummaryBar(s: ReturnType<typeof buildPanelSummary>): HTMLElement {
    const riskColor = arbitrageRiskColor(s.overallArbitrageRisk);
    const wrap = h('div', {
      style: `display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;padding:8px;background:rgba(255,255,255,0.05);border-radius:6px;border-left:3px solid ${riskColor}`,
    });
    const metric = (label: string, value: string, color?: string): HTMLElement => {
      const el = h('div', { style: 'display:flex;flex-direction:column;min-width:100px' });
      el.append(h('span', { style: 'font-size:10px;opacity:0.6;text-transform:uppercase;letter-spacing:0.05em' }, label));
      const colorStyle = color ? `color:${color}` : '';
      el.append(h('span', { style: `font-size:16px;font-weight:700;${colorStyle}` }, value));
      return el;
    };
    wrap.append(metric('Overall Risk',     arbitrageRiskLabel(s.overallArbitrageRisk), riskColor));
    wrap.append(metric('Extreme Opacity',  `${s.extremeOpacityCount} jurisdictions`));
    wrap.append(metric('FATF High Risk',   `${s.fatfHighRiskCount} jurisdictions`));
    wrap.append(metric('Critical Gaps',    `${s.criticalGapCount}`));
    wrap.append(metric('Illicit Flows',    `$${s.totalIllicitFlowsBn}B / yr`));
    wrap.append(metric('Enforcement $',   `$${(s.totalPenaltiesM / 1000).toFixed(1)}B`));
    return wrap;
  }

  // ── Section 1 — Jurisdiction Opacity ─────────────────────────────────────

  private renderOpacity(rows: JurisdictionOpacity[]): HTMLElement {
    const section = h('section', { 'data-section': 'opacity' });
    const extremeCount = countExtremeOpacityJurisdictions(rows);
    section.append(sectionHeader('Beneficial Ownership Opacity', `${extremeCount} extreme`));
    if (rows.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No data.'));
      return section;
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const tbody = h('tbody');
    for (const r of rows) {
      const tier = classifyOpacity(r.opacityScore);
      const tr = h('tr');
      tr.append(cell(r.jurisdiction, 'font-weight:600'));
      tr.append(cell(r.region, 'opacity:0.65'));
      tr.append(h('td', { style: 'padding:3px 6px' }, badge(opacityTierLabel(tier), opacityTierColor(tier))));
      tr.append(cell(`${r.opacityScore}/100`, 'opacity:0.85'));
      tr.append(cell(`~${r.shellCompanyCount}k shells`, 'opacity:0.65;font-size:11px'));
      const flags = h('td', { style: 'padding:3px 6px;font-size:11px;opacity:0.65' });
      const items: string[] = [];
      if (r.nomineeDirectorsAllowed) items.push('nominees');
      if (r.bearerSharesAllowed)     items.push('bearer shares');
      if (!r.publicRegistryExists)   items.push('no public registry');
      flags.textContent = items.join(', ');
      tr.append(flags);
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(table);
    return section;
  }

  // ── Section 2 — FATF Status ───────────────────────────────────────────────

  private renderFatf(rows: FatfJurisdiction[]): HTMLElement {
    const section = h('section', { 'data-section': 'fatf' });
    const highRisk = highRiskFatfJurisdictions(rows);
    const avgScore = averageComplianceScore(rows);
    section.append(sectionHeader('FATF Compliance Status', `avg compliance ${avgScore}/100`));

    // Stat pills
    const pills = h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px' });
    const statuses: import('./regulatory-arbitrage-helpers').FatfStatus[] = ['black', 'grey', 'monitored', 'compliant'];
    for (const s of statuses) {
      const n = countFatfByStatus(rows, s);
      if (n === 0) continue;
      pills.append(badge(`${fatfStatusLabel(s)}: ${n}`, fatfStatusColor(s)));
    }
    section.append(pills);

    // High-risk detail
    if (highRisk.length > 0) {
      const list = h('div', { style: 'display:flex;flex-direction:column;gap:4px' });
      for (const r of highRisk) {
        const row = h('div', { style: 'display:flex;align-items:flex-start;gap:8px;font-size:12px' });
        row.append(badge(fatfStatusLabel(r.status), fatfStatusColor(r.status)));
        row.append(h('span', { style: 'font-weight:600;min-width:140px' }, r.jurisdiction));
        row.append(h('span', { style: 'opacity:0.65;font-size:11px' }, r.deficiencies.join('; ')));
        list.append(row);
      }
      section.append(list);
    }
    return section;
  }

  // ── Section 3 — Regulatory Gap Map ───────────────────────────────────────

  private renderGaps(gaps: RegulatoryGap[]): HTMLElement {
    const section = h('section', { 'data-section': 'gaps' });
    const criticalCount = countCriticalGaps(gaps);
    section.append(sectionHeader('Regulatory Gap Map', `${criticalCount} critical/significant`));
    if (gaps.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No gaps on record.'));
      return section;
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const tbody = h('tbody');
    for (const g of gaps) {
      const tr = h('tr', { style: 'border-bottom:1px solid rgba(255,255,255,0.05)' });
      tr.append(cell(g.jurisdiction, 'font-weight:600'));
      tr.append(h('td', { style: 'padding:3px 6px' }, badge(gapDomainLabel(g.domain), '#374151')));
      tr.append(h('td', { style: 'padding:3px 6px' }, badge(gapSeverityLabel(g.severity), gapSeverityColor(g.severity))));
      const desc = h('td', { style: 'padding:3px 6px;font-size:11px;opacity:0.75' }, g.description);
      tr.append(desc);
      if (g.closurePressure) {
        tr.append(h('td', { style: 'padding:3px 6px;font-size:11px;color:#60a5fa' }, '⬆ pressure'));
      } else {
        tr.append(h('td'));
      }
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(table);
    return section;
  }

  // ── Section 4 — Arbitrage Exposure ───────────────────────────────────────

  private renderExposure(rows: ArbitrageExposure[]): HTMLElement {
    const section = h('section', { 'data-section': 'exposure' });
    const totalFlows = totalIllicitFlowsUsdBn(rows);
    section.append(sectionHeader('Arbitrage Exposure', `$${totalFlows}B illicit flows / yr`));
    if (rows.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No data.'));
      return section;
    }
    const list = h('div', { style: 'display:flex;flex-direction:column;gap:4px' });
    for (const r of rows) {
      const score = computeArbitrageScore(r);
      const risk  = classifyArbitrageRisk(score);
      const row   = h('div', {
        style: 'display:grid;grid-template-columns:160px 90px 80px 60px 60px 60px 1fr;align-items:center;gap:6px;font-size:12px',
      });
      row.append(h('span', { style: 'font-weight:600' }, r.jurisdiction));
      row.append(badge(arbitrageRiskLabel(risk), arbitrageRiskColor(risk)));
      row.append(h('span', { style: 'opacity:0.8' }, `${score}/100`));
      row.append(h('span', { style: 'opacity:0.65;font-size:11px' }, `Tax +${r.taxDifferentialPct}pp`));
      row.append(h('span', { style: 'opacity:0.65;font-size:11px' }, `Crypto ${r.cryptoGapScore}`));
      row.append(h('span', { style: 'opacity:0.65;font-size:11px' }, `Fin ${r.financeGapScore}`));
      row.append(h('span', { style: 'opacity:0.65;font-size:11px' }, `$${r.illicitFlowsUsdBn}B flows`));
      list.append(row);
    }
    section.append(list);
    return section;
  }

  // ── Section 5 — Enforcement Trend ─────────────────────────────────────────

  private renderEnforcement(rows: EnforcementRegion[]): HTMLElement {
    const section = h('section', { 'data-section': 'enforcement' });
    const totalPenalties = totalPenaltiesUsdM(rows);
    section.append(sectionHeader('Enforcement Trends by Region', `$${(totalPenalties / 1000).toFixed(1)}B penalties`));
    if (rows.length === 0) {
      section.append(h('div', { style: 'opacity:0.6;font-size:12px' }, 'No data.'));
      return section;
    }
    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const tbody = h('tbody');
    for (const r of rows) {
      const tr = h('tr', { style: 'border-bottom:1px solid rgba(255,255,255,0.05)' });
      tr.append(cell(r.region, 'font-weight:600;min-width:120px'));
      tr.append(h('td', { style: 'padding:3px 6px' }, badge(enforcementTrendLabel(r.trend), enforcementTrendColor(r.trend))));
      tr.append(cell(`${r.actionsLastYear}→${r.actionsThisYear}`, 'opacity:0.8;font-size:11px'));
      tr.append(cell(`$${r.penaltiesUsdM.toLocaleString()}M`, 'opacity:0.85'));
      tr.append(cell(r.activeBodies.join(', '), 'opacity:0.55;font-size:11px'));
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(table);
    return section;
  }
}
