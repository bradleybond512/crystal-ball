/**
 * EnergyGeopoliticsPanel (panel id: `energy-geopolitics`).
 *
 * Tracks the geopolitical weaponization of energy:
 *   1. Chokepoint Risk Monitor   — Hormuz / Bab-el-Mandeb / Bosphorus / Suez / Malacca
 *   2. OPEC+ Compliance          — per-member quota vs. production
 *   3. Pipeline Disruptions      — active outages by region / cause
 *   4. LNG Supply Stress         — spot premium, bottlenecks, drivers
 *   5. Sanctions Leverage        — net effectiveness after evasion
 *   6. Strategic Reserves        — IEA/national coverage days
 *   7. Weaponization Risk        — per-producer nation score
 *
 * Pure helpers live in `energy-geopolitics-helpers.ts`.
 */

import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildEnergyGeopoliticsRenderData,
  scoreChokepointRisk,
  scoreSanctionsLeverage,
  getNonCompliantMembers,
  getChokepointsByRisk,
  getWeaponizationByScore,
  totalOilAtRisk,
  getRiskColor,
  getWeaponizationColor,
  getLNGStressColor,
  getReserveStatusColor,
  formatMbpd,
  formatScore,
  formatComplianceRate,
  type ChokepointRisk,
  type OPECMember,
  type PipelineIncident,
  type SanctionsLeverage,
  type StrategicReserve,
  type WeaponizationRisk,
  type EnergyGeopoliticsRenderData,
} from './energy-geopolitics-helpers';

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

function cell(text: string, style?: string): HTMLElement {
  return h('td', { style: `padding:3px 6px;font-size:12px${style ? ';' + style : ''}` }, text);
}

function sectionHeader(title: string, badge?: HTMLElement): HTMLElement {
  const header = h('div', {
    style: 'font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;padding:10px 12px 4px;border-top:1px solid #1f2937;margin-top:4px',
  }, title);
  if (badge) header.append(badge);
  return header;
}

function countBadge(count: number, label: string, color = '#b71c1c'): HTMLElement {
  return h('span', {
    style: `margin-left:6px;font-size:10px;background:${color};color:#fff;border-radius:10px;padding:1px 6px`,
  }, `${count} ${label}`);
}

function riskPill(level: string): HTMLElement {
  return h('span', {
    style: `font-size:10px;padding:1px 6px;border-radius:8px;background:${getRiskColor(level)}22;color:${getRiskColor(level)};border:1px solid ${getRiskColor(level)}44;text-transform:uppercase;letter-spacing:0.04em`,
  }, level);
}

export class EnergyGeopoliticsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'energy-geopolitics',
      title: 'Energy Geopolitics',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks oil/gas chokepoint risk, OPEC+ compliance, pipeline disruptions, LNG supply stress, energy sanctions effectiveness, strategic reserve levels, and weaponization risk per producer nation.',
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
    const data = buildEnergyGeopoliticsRenderData();

    // Count badge: total active incidents across chokepoints + pipelines
    const totalIncidents =
      data.chokepoints.reduce((s, c) => s + c.activeIncidents, 0) +
      data.pipelines.filter((p) => p.status !== 'operational').length;
    this.setCount(totalIncidents);

    replaceChildren(
      this.content,
      this.buildSummaryBar(data),
      this.buildChokepointsSection(data.chokepoints),
      this.buildOPECSection(data.opec.members),
      this.buildPipelinesSection(data.pipelines),
      this.buildLNGSection(data),
      this.buildSanctionsSection(data.sanctions),
      this.buildReservesSection(data.reserves),
      this.buildWeaponizationSection(data.weaponization),
    );
    this.markFresh();
  }

  private buildSummaryBar(data: EnergyGeopoliticsRenderData): HTMLElement {
    const bar = h('div', {
      style: 'display:flex;align-items:center;gap:10px;padding:8px 12px;background:#111827;border-bottom:1px solid #1f2937;flex-wrap:wrap',
    });

    const riskColor = getRiskColor(data.overallRiskLevel);
    const scorePill = h('span', {
      style: `font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;background:${riskColor}22;color:${riskColor};border:1px solid ${riskColor}55`,
    }, `Risk ${formatScore(data.overallRiskScore)}`);

    const oilRisk = totalOilAtRisk(data.chokepoints);
    const oilLabel = h('span', { style: 'font-size:11px;color:#9ca3af' },
      `${formatMbpd(oilRisk)} at-risk throughput`);

    const lngColor = getLNGStressColor(data.lng.overallStressLevel);
    const lngPill = h('span', {
      style: `font-size:11px;padding:2px 8px;border-radius:10px;background:${lngColor}22;color:${lngColor};border:1px solid ${lngColor}44`,
    }, `LNG ${data.lng.overallStressLevel}`);

    bar.append(scorePill, oilLabel, lngPill);

    if (data.topRisks.length > 0) {
      const topRisk = h('span', { style: 'font-size:11px;color:#f59e0b;flex-basis:100%' },
        `⚠ ${data.topRisks[0]}`);
      bar.append(topRisk);
    }

    return bar;
  }

  private buildChokepointsSection(chokepoints: ChokepointRisk[]): HTMLElement {
    const sorted = getChokepointsByRisk(chokepoints);
    const criticalCount = sorted.filter((c) => c.riskLevel === 'critical').length;

    const section = h('div');
    const hdr = sectionHeader('Chokepoint Risk Monitor');
    if (criticalCount > 0) hdr.append(countBadge(criticalCount, 'critical'));
    section.append(hdr);

    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const thead = h('thead');
    thead.append(h('tr', {},
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:left;font-weight:500' }, 'Chokepoint'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:right;font-weight:500' }, 'Flow (Mb/d)'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:center;font-weight:500' }, 'Risk'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:right;font-weight:500' }, 'Score'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:right;font-weight:500' }, 'Incidents'),
    ));
    table.append(thead);

    const tbody = h('tbody');
    for (const cp of sorted) {
      const score = scoreChokepointRisk(cp);
      const color = getRiskColor(cp.riskLevel);
      const tr = h('tr', { style: 'border-top:1px solid #1f2937' });
      tr.append(
        cell(cp.name, 'color:#e5e7eb'),
        cell(cp.oilFlowMbpd.toFixed(1), 'text-align:right;color:#9ca3af'),
        h('td', { style: 'padding:3px 6px;text-align:center' }, riskPill(cp.riskLevel)),
        cell(score.toString(), `text-align:right;color:${color};font-weight:600`),
        cell(cp.activeIncidents.toString(), `text-align:right;color:${cp.activeIncidents > 0 ? '#f87171' : '#6b7280'}`),
      );
      tbody.append(tr);

      if (cp.keyThreats.length > 0 && (cp.riskLevel === 'high' || cp.riskLevel === 'critical')) {
        const detailRow = h('tr');
        const detailCell = h('td', { colSpan: '5', style: 'padding:2px 8px 6px 20px;font-size:11px;color:#6b7280' });
        detailCell.textContent = cp.keyThreats.slice(0, 2).join(' · ');
        detailRow.append(detailCell);
        tbody.append(detailRow);
      }
    }
    table.append(tbody);
    section.append(table);
    return section;
  }

  private buildOPECSection(members: OPECMember[]): HTMLElement {
    const nonCompliant = getNonCompliantMembers(members);
    const section = h('div');
    const hdr = sectionHeader('OPEC+ Compliance');
    if (nonCompliant.length > 0) hdr.append(countBadge(nonCompliant.length, 'non-compliant', '#d97706'));
    section.append(hdr);

    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const thead = h('thead');
    thead.append(h('tr', {},
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:left;font-weight:500' }, 'Member'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:right;font-weight:500' }, 'Quota'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:right;font-weight:500' }, 'Actual'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:center;font-weight:500' }, 'Status'),
    ));
    table.append(thead);

    const tbody = h('tbody');
    for (const m of members) {
      let statusColor = '#f59e0b';
      if (m.status === 'compliant') statusColor = '#22c55e';
      else if (m.status === 'suspended') statusColor = '#6b7280';
      const tr = h('tr', { style: 'border-top:1px solid #1f2937' });
      tr.append(
        cell(m.name, 'color:#e5e7eb'),
        cell(formatMbpd(m.quotaMbpd), 'text-align:right;color:#9ca3af'),
        cell(formatMbpd(m.actualMbpd), `text-align:right;color:${m.actualMbpd > m.quotaMbpd ? '#f87171' : '#9ca3af'}`),
        h('td', { style: `padding:3px 6px;text-align:center;font-size:10px;color:${statusColor}` },
          m.status.replace(/_/g, ' ')),
      );
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(table);

    // Compliance rate row
    const compliance = calculateOPECComplianceSummary(members);
    const footer = h('div', {
      style: 'padding:6px 12px;font-size:11px;color:#6b7280;display:flex;gap:12px;flex-wrap:wrap',
    });
    footer.append(
      h('span', {}, `Compliance: ${formatComplianceRate(compliance.overallComplianceRate)}`),
      h('span', {}, `Cohesion: ${compliance.cohesionScore}/100`),
      h('span', { style: `color:${compliance.cohesionTrend === 'deteriorating' ? '#f87171' : '#9ca3af'}` },
        `Trend: ${compliance.cohesionTrend}`),
    );
    section.append(footer);
    return section;
  }

  private buildPipelinesSection(pipelines: PipelineIncident[]): HTMLElement {
    const active = pipelines.filter((p) => p.status !== 'operational');
    const section = h('div');
    const hdr = sectionHeader('Pipeline Disruptions');
    if (active.length > 0) hdr.append(countBadge(active.length, 'active'));
    section.append(hdr);

    if (active.length === 0) {
      section.append(h('div', { style: 'padding:8px 12px;font-size:12px;color:#6b7280' }, 'No active disruptions.'));
      return section;
    }

    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const thead = h('thead');
    thead.append(h('tr', {},
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:left;font-weight:500' }, 'Pipeline'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:left;font-weight:500' }, 'Cause'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:right;font-weight:500' }, 'Affected'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:right;font-weight:500' }, 'Severity'),
    ));
    table.append(thead);

    const tbody = h('tbody');
    for (const p of active) {
      let sevColor = '#6b7280';
      if (p.severityScore >= 60) sevColor = '#ef4444';
      else if (p.severityScore >= 35) sevColor = '#f59e0b';
      const tr = h('tr', { style: 'border-top:1px solid #1f2937' });
      tr.append(
        cell(p.name, 'color:#e5e7eb'),
        cell(p.causeCategory, 'color:#9ca3af'),
        cell(formatMbpd(p.affectedCapacityMbpd), 'text-align:right;color:#f87171'),
        cell(p.severityScore.toString(), `text-align:right;color:${sevColor};font-weight:600`),
      );
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(table);
    return section;
  }

  private buildLNGSection(data: EnergyGeopoliticsRenderData): HTMLElement {
    const lng = data.lng;
    const stressColor = getLNGStressColor(lng.overallStressLevel);
    const section = h('div');
    section.append(sectionHeader('LNG Supply Chain Stress'));

    const summary = h('div', {
      style: 'padding:8px 12px;display:flex;gap:12px;flex-wrap:wrap;align-items:center',
    });
    summary.append(
      h('span', {
        style: `font-size:12px;font-weight:700;color:${stressColor}`,
      }, lng.overallStressLevel.toUpperCase()),
      h('span', { style: 'font-size:12px;color:#9ca3af' }, `Score: ${formatScore(lng.stressScore)}`),
      h('span', { style: 'font-size:12px;color:#9ca3af' }, `Spot premium: ×${lng.spotPremiumMultiplier.toFixed(2)}`),
      h('span', { style: 'font-size:12px;color:#9ca3af' }, `Delay: +${lng.shippingDelayDays}d`),
    );
    section.append(summary);

    if (lng.drivers.length > 0) {
      const driverList = h('div', { style: 'padding:4px 12px 8px' });
      for (const d of lng.drivers) {
        driverList.append(h('div', { style: 'font-size:11px;color:#6b7280;padding:1px 0' }, `• ${d}`));
      }
      section.append(driverList);
    }
    return section;
  }

  private buildSanctionsSection(sanctions: SanctionsLeverage[]): HTMLElement {
    const section = h('div');
    section.append(sectionHeader('Energy Sanctions Leverage'));

    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const thead = h('thead');
    thead.append(h('tr', {},
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:left;font-weight:500' }, 'Nation'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:right;font-weight:500' }, 'Exports'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:right;font-weight:500' }, 'Evaded'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:right;font-weight:500' }, 'Net Leverage'),
    ));
    table.append(thead);

    const tbody = h('tbody');
    for (const s of sanctions) {
      const netScore = scoreSanctionsLeverage(s);
      let netColor = '#6b7280';
      if (netScore >= 50) netColor = '#22c55e';
      else if (netScore >= 25) netColor = '#f59e0b';
      const tr = h('tr', { style: 'border-top:1px solid #1f2937' });
      tr.append(
        cell(s.targetNation, 'color:#e5e7eb'),
        cell(formatMbpd(s.exportVolumeMbpd), 'text-align:right;color:#9ca3af'),
        cell(`${Math.round(s.evadedPercentage * 100)}%`, 'text-align:right;color:#f59e0b'),
        cell(netScore.toString(), `text-align:right;color:${netColor};font-weight:600`),
      );
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(table);
    return section;
  }

  private buildReservesSection(reserves: StrategicReserve[]): HTMLElement {
    const criticalCount = reserves.filter((r) => r.status === 'critical').length;
    const section = h('div');
    const hdr = sectionHeader('Strategic Reserve Levels');
    if (criticalCount > 0) hdr.append(countBadge(criticalCount, 'critical'));
    section.append(hdr);

    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const thead = h('thead');
    thead.append(h('tr', {},
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:left;font-weight:500' }, 'Country'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:right;font-weight:500' }, 'Days'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:right;font-weight:500' }, 'Fill %'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:center;font-weight:500' }, 'Status'),
    ));
    table.append(thead);

    const tbody = h('tbody');
    for (const r of reserves) {
      const statusColor = getReserveStatusColor(r.status);
      const tr = h('tr', { style: 'border-top:1px solid #1f2937' });
      tr.append(
        cell(r.nation, 'color:#e5e7eb'),
        cell(r.coverageDays.toString(), `text-align:right;color:${r.coverageDays < 30 ? '#f87171' : '#9ca3af'}`),
        cell(`${r.fillLevelPercent}%`, `text-align:right;color:${r.fillLevelPercent < 40 ? '#f87171' : '#9ca3af'}`),
        h('td', { style: `padding:3px 6px;text-align:center;font-size:10px;color:${statusColor}` }, r.status),
      );
      tbody.append(tr);
    }
    table.append(tbody);
    section.append(table);
    return section;
  }

  private buildWeaponizationSection(risks: WeaponizationRisk[]): HTMLElement {
    const sorted = getWeaponizationByScore(risks);
    const extremeCount = sorted.filter((r) => r.tier === 'extreme').length;
    const section = h('div');
    const hdr = sectionHeader('Energy Weaponization Risk');
    if (extremeCount > 0) hdr.append(countBadge(extremeCount, 'extreme', '#b91c1c'));
    section.append(hdr);

    const table = h('table', { style: 'width:100%;border-collapse:collapse' });
    const thead = h('thead');
    thead.append(h('tr', {},
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:left;font-weight:500' }, 'Nation'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:center;font-weight:500' }, 'Tier'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:right;font-weight:500' }, 'Score'),
      h('th', { style: 'padding:4px 6px;font-size:10px;color:#6b7280;text-align:right;font-weight:500' }, 'World Share'),
    ));
    table.append(thead);

    const tbody = h('tbody');
    for (const w of sorted) {
      const tierColor = getWeaponizationColor(w.tier);
      const tr = h('tr', { style: 'border-top:1px solid #1f2937' });
      tr.append(
        cell(w.nation, 'color:#e5e7eb'),
        h('td', { style: `padding:3px 6px;text-align:center` },
          h('span', { style: `font-size:10px;padding:1px 6px;border-radius:8px;background:${tierColor}22;color:${tierColor};border:1px solid ${tierColor}44` }, w.tier)),
        cell(w.weaponizationScore.toString(), `text-align:right;color:${tierColor};font-weight:600`),
        cell(`${Math.round(w.exportShareOfWorldSupply * 100)}%`, 'text-align:right;color:#9ca3af'),
      );
      tbody.append(tr);

      if (w.tier === 'extreme' || w.tier === 'high') {
        const detailRow = h('tr');
        const dc = h('td', { colSpan: '4', style: 'padding:2px 8px 6px 20px;font-size:11px;color:#6b7280' });
        dc.textContent = w.primaryLeverage.slice(0, 2).join(' · ');
        detailRow.append(dc);
        tbody.append(detailRow);
      }
    }
    table.append(tbody);
    section.append(table);
    return section;
  }
}

// Re-export for the render method (avoids re-import of helpers inside panel)
import { calculateOPECCompliance as _calcOPEC } from './energy-geopolitics-helpers';
function calculateOPECComplianceSummary(members: OPECMember[]) {
  return _calcOPEC(members);
}
