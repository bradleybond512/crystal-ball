/**
 * Pure helpers for ResourceCompetitionPanel.
 * No DOM, no fetch — safe to import in Node.js tests.
 *
 * Sections:
 *   1. Rare earth supply concentration risk
 *   2. Strategic mineral competition events
 *   3. Arctic resource claim disputes
 *   4. Deep-sea mining developments
 *   5. Resource nationalism events
 *   6. Battery mineral supply chain vulnerability
 */

import { escapeHtml } from '@/utils/sanitize';

// ── Types ─────────────────────────────────────────────────────────────────

export type ConcentrationRisk = 'low' | 'medium' | 'high' | 'critical';
export type AlignmentBloc =
  | 'china_aligned'
  | 'western_aligned'
  | 'russia_aligned'
  | 'non_aligned'
  | 'contested';
export type ArcticDisputeStatus =
  | 'negotiation'
  | 'unclos_review'
  | 'icj_pending'
  | 'frozen'
  | 'militarized';
export type ISAPhase = 'exploration' | 'exploitation' | 'moratorium' | 'suspended';
export type NationalismKind =
  | 'nationalization'
  | 'expropriation'
  | 'forced_equity'
  | 'export_ban'
  | 'royalty_hike';
export type NationalismStatus =
  | 'pending'
  | 'in_arbitration'
  | 'settled'
  | 'enforced'
  | 'reversed';
export type BatteryVulnerability = 'low' | 'medium' | 'high' | 'extreme';

export interface RareEarthDependency {
  element: string;
  chinaSharePct: number;
  topAlternatives: string;
  refiningChoke: string;
  strategicApplication: string;
  concentrationRisk: ConcentrationRisk;
}

export interface StrategicMineralEvent {
  acquirer: string;
  targetCountry: string;
  mineral: string;
  dollarValueMillions: number;
  alignment: AlignmentBloc;
  notes: string;
}

export interface ArcticDispute {
  area: string;
  claimants: string;
  hydrocarbonReserveLevel: ConcentrationRisk;
  diplomaticStatus: ArcticDisputeStatus;
  militaryPosture: string;
}

export interface DeepSeaMiningContract {
  contractor: string;
  sponsoringState: string;
  zone: string;
  phase: ISAPhase;
  moratoriumNote: string;
}

export interface NationalismEvent {
  country: string;
  mineral: string;
  operator: string;
  kind: NationalismKind;
  valueAtRiskMillions: number;
  status: NationalismStatus;
}

export interface BatteryMineralRisk {
  mineral: string;
  topProducerConcentrationHHI: number;
  processingConcentration: string;
  geopoliticalDependencyScore: number;
  vulnerability: BatteryVulnerability;
  notes: string;
}

// ── Color / label helpers ─────────────────────────────────────────────────

export function concentrationRiskColor(r: ConcentrationRisk): string {
  const colors: Record<ConcentrationRisk, string> = {
    low:      'var(--severity-low,      #22c55e)',
    medium:   'var(--severity-medium,   #f59e0b)',
    high:     'var(--severity-high,     #fb923c)',
    critical: 'var(--severity-critical, #ef4444)',
  };
  return colors[r];
}

export function concentrationRiskLabel(r: ConcentrationRisk): string {
  const labels: Record<ConcentrationRisk, string> = {
    low:      'Low',
    medium:   'Medium',
    high:     'High',
    critical: 'Critical',
  };
  return labels[r];
}

export function chinaShareRiskBand(pct: number): ConcentrationRisk {
  if (pct >= 80) return 'critical';
  if (pct >= 60) return 'high';
  if (pct >= 40) return 'medium';
  return 'low';
}

export function alignmentColor(a: AlignmentBloc): string {
  const colors: Record<AlignmentBloc, string> = {
    china_aligned:   'var(--severity-critical, #ef4444)',
    western_aligned: 'var(--severity-info,     #3b82f6)',
    russia_aligned:  'var(--severity-high,     #fb923c)',
    non_aligned:     'var(--severity-medium,   #f59e0b)',
    contested:       'var(--severity-medium,   #f59e0b)',
  };
  return colors[a];
}

export function alignmentLabel(a: AlignmentBloc): string {
  const labels: Record<AlignmentBloc, string> = {
    china_aligned:   'China-aligned',
    western_aligned: 'Western-aligned',
    russia_aligned:  'Russia-aligned',
    non_aligned:     'Non-aligned',
    contested:       'Contested',
  };
  return labels[a];
}

export function arcticStatusColor(s: ArcticDisputeStatus): string {
  const colors: Record<ArcticDisputeStatus, string> = {
    negotiation:    'var(--severity-low,      #22c55e)',
    unclos_review:  'var(--severity-info,     #3b82f6)',
    icj_pending:    'var(--severity-medium,   #f59e0b)',
    frozen:         'var(--severity-medium,   #f59e0b)',
    militarized:    'var(--severity-critical, #ef4444)',
  };
  return colors[s];
}

export function arcticStatusLabel(s: ArcticDisputeStatus): string {
  const labels: Record<ArcticDisputeStatus, string> = {
    negotiation:    'In negotiation',
    unclos_review:  'UNCLOS review',
    icj_pending:    'ICJ pending',
    frozen:         'Frozen',
    militarized:    'Militarized',
  };
  return labels[s];
}

export function isaPhaseColor(p: ISAPhase): string {
  const colors: Record<ISAPhase, string> = {
    exploration:  'var(--severity-info,     #3b82f6)',
    exploitation: 'var(--severity-high,     #fb923c)',
    moratorium:   'var(--severity-low,      #22c55e)',
    suspended:    'var(--text-secondary,    #9e9e9e)',
  };
  return colors[p];
}

export function isaPhaseLabel(p: ISAPhase): string {
  const labels: Record<ISAPhase, string> = {
    exploration:  'Exploration',
    exploitation: 'Exploitation',
    moratorium:   'Moratorium',
    suspended:    'Suspended',
  };
  return labels[p];
}

export function nationalismKindLabel(k: NationalismKind): string {
  const labels: Record<NationalismKind, string> = {
    nationalization: 'Nationalization',
    expropriation:   'Expropriation',
    forced_equity:   'Forced equity',
    export_ban:      'Export ban',
    royalty_hike:    'Royalty hike',
  };
  return labels[k];
}

export function nationalismStatusColor(s: NationalismStatus): string {
  const colors: Record<NationalismStatus, string> = {
    pending:         'var(--severity-medium,   #f59e0b)',
    in_arbitration:  'var(--severity-high,     #fb923c)',
    enforced:        'var(--severity-critical, #ef4444)',
    settled:         'var(--severity-info,     #3b82f6)',
    reversed:        'var(--severity-low,      #22c55e)',
  };
  return colors[s];
}

export function nationalismStatusLabel(s: NationalismStatus): string {
  const labels: Record<NationalismStatus, string> = {
    pending:         'Pending',
    in_arbitration:  'In arbitration',
    enforced:        'Enforced',
    settled:         'Settled',
    reversed:        'Reversed',
  };
  return labels[s];
}

export function batteryVulnerabilityColor(v: BatteryVulnerability): string {
  const colors: Record<BatteryVulnerability, string> = {
    low:     'var(--severity-low,      #22c55e)',
    medium:  'var(--severity-medium,   #f59e0b)',
    high:    'var(--severity-high,     #fb923c)',
    extreme: 'var(--severity-critical, #ef4444)',
  };
  return colors[v];
}

export function batteryVulnerabilityLabel(v: BatteryVulnerability): string {
  const labels: Record<BatteryVulnerability, string> = {
    low:     'Low',
    medium:  'Medium',
    high:    'High',
    extreme: 'Extreme',
  };
  return labels[v];
}

// ── Sort comparators ──────────────────────────────────────────────────────

export function sortByDollarValueDesc(
  a: StrategicMineralEvent,
  b: StrategicMineralEvent,
): number {
  return b.dollarValueMillions - a.dollarValueMillions;
}

export function sortByValueAtRiskDesc(
  a: NationalismEvent,
  b: NationalismEvent,
): number {
  return b.valueAtRiskMillions - a.valueAtRiskMillions;
}

export function sortByDependencyScoreDesc(
  a: BatteryMineralRisk,
  b: BatteryMineralRisk,
): number {
  return b.geopoliticalDependencyScore - a.geopoliticalDependencyScore;
}

// ── Aggregator counts ─────────────────────────────────────────────────────

export function countCriticalConcentration(rows: RareEarthDependency[]): number {
  return rows.filter((r) => r.concentrationRisk === 'critical' || r.concentrationRisk === 'high').length;
}

export function countActiveNationalizations(rows: NationalismEvent[]): number {
  return rows.filter((r) => r.status === 'pending' || r.status === 'in_arbitration' || r.status === 'enforced').length;
}

export function countContestedArcticClaims(rows: ArcticDispute[]): number {
  return rows.filter((r) => r.diplomaticStatus === 'militarized' || r.diplomaticStatus === 'icj_pending' || r.diplomaticStatus === 'frozen').length;
}

export function countActiveISAContracts(rows: DeepSeaMiningContract[]): number {
  return rows.filter((r) => r.phase === 'exploration' || r.phase === 'exploitation').length;
}

export function countVulnerableBatteryMinerals(rows: BatteryMineralRisk[]): number {
  return rows.filter((r) => r.vulnerability === 'extreme' || r.vulnerability === 'high').length;
}

export function countChinaAlignedAcquisitions(rows: StrategicMineralEvent[]): number {
  return rows.filter((r) => r.alignment === 'china_aligned').length;
}

// ── Render helpers (HTML strings) ─────────────────────────────────────────

const SECTION_STYLE = 'margin-bottom:14px';
const HEADER_STYLE  = 'font-size:12px;font-weight:600;color:var(--text-primary,#e0e0e0);margin-bottom:4px;display:flex;align-items:center';
const HINT_STYLE    = 'font-size:11px;color:var(--text-secondary,#9e9e9e);margin-bottom:4px';
const TABLE_STYLE   = 'width:100%;border-collapse:collapse';
const CELL_STYLE    = 'padding:3px 6px;font-size:12px';
const SUB_CELL_STYLE = 'padding:0 6px 4px 6px;font-size:10px;color:var(--text-secondary,#9e9e9e);border-bottom:1px solid var(--border-subtle,#222)';
const EMPTY_STYLE   = 'padding:6px;font-size:11px;color:var(--text-secondary,#9e9e9e);font-style:italic';

function badgeHtml(count: number, label: string): string {
  const text = `${count} ${label}`;
  return `<span style="margin-left:6px;font-size:10px;background:#b71c1c;color:#fff;border-radius:10px;padding:1px 6px">${escapeHtml(text)}</span>`;
}

function sectionHeaderHtml(title: string, badge?: string): string {
  return `<div style="${HEADER_STYLE}" data-section-header="${escapeHtml(title)}">${escapeHtml(title)}${badge ?? ''}</div>`;
}

export function renderRareEarthSection(rows: RareEarthDependency[]): string {
  const critical = countCriticalConcentration(rows);
  const badge = critical > 0 ? badgeHtml(critical, 'high/critical') : undefined;
  if (rows.length === 0) {
    return `<div data-section="rare-earth" style="${SECTION_STYLE}">${sectionHeaderHtml('Rare Earth Supply Concentration', badge)}<div style="${EMPTY_STYLE}">No rare earth dependency data available</div></div>`;
  }
  const body = rows.map((row) => {
    const color = concentrationRiskColor(row.concentrationRisk);
    const label = concentrationRiskLabel(row.concentrationRisk);
    const pct = `${row.chinaSharePct.toFixed(0)}%`;
    return (
      `<tr>` +
        `<td style="${CELL_STYLE};font-weight:600;color:${color}">${escapeHtml(row.element)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:${color};font-weight:600">${escapeHtml(pct)}</td>` +
        `<td style="${CELL_STYLE};color:var(--text-secondary,#9e9e9e)">${escapeHtml(row.topAlternatives)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;text-transform:uppercase;font-size:10px;color:${color}">${escapeHtml(label)}</td>` +
      `</tr>` +
      `<tr><td colspan="4" style="${SUB_CELL_STYLE}">Refining: ${escapeHtml(row.refiningChoke)} · ${escapeHtml(row.strategicApplication)}</td></tr>`
    );
  }).join('');
  return (
    `<div data-section="rare-earth" style="${SECTION_STYLE}">` +
      sectionHeaderHtml('Rare Earth Supply Concentration', badge) +
      `<div style="${HINT_STYLE}">Element · China share · alternatives · refining choke · application · risk band</div>` +
      `<table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>` +
    `</div>`
  );
}

export function renderStrategicMineralsSection(rows: StrategicMineralEvent[]): string {
  const chinaCount = countChinaAlignedAcquisitions(rows);
  const badge = chinaCount > 0 ? badgeHtml(chinaCount, 'China-aligned') : undefined;
  if (rows.length === 0) {
    return `<div data-section="strategic-minerals" style="${SECTION_STYLE}">${sectionHeaderHtml('Strategic Mineral Competition', badge)}<div style="${EMPTY_STYLE}">No strategic mineral acquisition events recorded</div></div>`;
  }
  const sorted = [...rows].sort(sortByDollarValueDesc);
  const body = sorted.map((row) => {
    const color = alignmentColor(row.alignment);
    const label = alignmentLabel(row.alignment);
    const value = row.dollarValueMillions >= 1000
      ? `$${(row.dollarValueMillions / 1000).toFixed(1)}B`
      : `$${row.dollarValueMillions.toFixed(0)}M`;
    return (
      `<tr>` +
        `<td style="${CELL_STYLE};font-weight:600;color:${color}">${escapeHtml(row.acquirer)}</td>` +
        `<td style="${CELL_STYLE};color:var(--text-secondary,#cccccc)">${escapeHtml(row.targetCountry)}</td>` +
        `<td style="${CELL_STYLE};color:#facc15">${escapeHtml(row.mineral)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:${color};font-weight:600">${escapeHtml(value)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;text-transform:uppercase;font-size:10px;color:${color}">${escapeHtml(label)}</td>` +
      `</tr>` +
      `<tr><td colspan="5" style="${SUB_CELL_STYLE}">${escapeHtml(row.notes)}</td></tr>`
    );
  }).join('');
  return (
    `<div data-section="strategic-minerals" style="${SECTION_STYLE}">` +
      sectionHeaderHtml('Strategic Mineral Competition', badge) +
      `<div style="${HINT_STYLE}">Acquirer · target country · mineral · value · alignment</div>` +
      `<table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>` +
    `</div>`
  );
}

export function renderArcticDisputesSection(rows: ArcticDispute[]): string {
  const contested = countContestedArcticClaims(rows);
  const badge = contested > 0 ? badgeHtml(contested, 'contested') : undefined;
  if (rows.length === 0) {
    return `<div data-section="arctic-disputes" style="${SECTION_STYLE}">${sectionHeaderHtml('Arctic Resource Claim Disputes', badge)}<div style="${EMPTY_STYLE}">No Arctic disputes recorded</div></div>`;
  }
  const body = rows.map((row) => {
    const sColor = arcticStatusColor(row.diplomaticStatus);
    const sLabel = arcticStatusLabel(row.diplomaticStatus);
    const rColor = concentrationRiskColor(row.hydrocarbonReserveLevel);
    const rLabel = concentrationRiskLabel(row.hydrocarbonReserveLevel);
    return (
      `<tr>` +
        `<td style="${CELL_STYLE};font-weight:600;color:${sColor}">${escapeHtml(row.area)}</td>` +
        `<td style="${CELL_STYLE};color:var(--text-secondary,#cccccc)">${escapeHtml(row.claimants)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:${rColor};font-size:10px;text-transform:uppercase">${escapeHtml(rLabel)} reserves</td>` +
        `<td style="${CELL_STYLE};text-align:right;text-transform:uppercase;font-size:10px;color:${sColor}">${escapeHtml(sLabel)}</td>` +
      `</tr>` +
      `<tr><td colspan="4" style="${SUB_CELL_STYLE}">Military: ${escapeHtml(row.militaryPosture)}</td></tr>`
    );
  }).join('');
  return (
    `<div data-section="arctic-disputes" style="${SECTION_STYLE}">` +
      sectionHeaderHtml('Arctic Resource Claim Disputes', badge) +
      `<div style="${HINT_STYLE}">Area · claimants · hydrocarbon reserves · diplomatic status · military posture</div>` +
      `<table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>` +
    `</div>`
  );
}

export function renderDeepSeaMiningSection(rows: DeepSeaMiningContract[]): string {
  const active = countActiveISAContracts(rows);
  const badge = active > 0 ? badgeHtml(active, 'active ISA') : undefined;
  if (rows.length === 0) {
    return `<div data-section="deep-sea" style="${SECTION_STYLE}">${sectionHeaderHtml('Deep-Sea Mining Developments', badge)}<div style="${EMPTY_STYLE}">No active ISA contracts</div></div>`;
  }
  const body = rows.map((row) => {
    const pColor = isaPhaseColor(row.phase);
    const pLabel = isaPhaseLabel(row.phase);
    return (
      `<tr>` +
        `<td style="${CELL_STYLE};font-weight:600">${escapeHtml(row.contractor)}</td>` +
        `<td style="${CELL_STYLE};color:var(--text-secondary,#cccccc)">${escapeHtml(row.sponsoringState)}</td>` +
        `<td style="${CELL_STYLE};color:#facc15">${escapeHtml(row.zone)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;text-transform:uppercase;font-size:10px;color:${pColor}">${escapeHtml(pLabel)}</td>` +
      `</tr>` +
      `<tr><td colspan="4" style="${SUB_CELL_STYLE}">${escapeHtml(row.moratoriumNote)}</td></tr>`
    );
  }).join('');
  return (
    `<div data-section="deep-sea" style="${SECTION_STYLE}">` +
      sectionHeaderHtml('Deep-Sea Mining Developments', badge) +
      `<div style="${HINT_STYLE}">Contractor · sponsoring state · zone · phase · environmental moratorium note</div>` +
      `<table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>` +
    `</div>`
  );
}

export function renderNationalismSection(rows: NationalismEvent[]): string {
  const active = countActiveNationalizations(rows);
  const badge = active > 0 ? badgeHtml(active, 'active disputes') : undefined;
  if (rows.length === 0) {
    return `<div data-section="nationalism" style="${SECTION_STYLE}">${sectionHeaderHtml('Resource Nationalism Events', badge)}<div style="${EMPTY_STYLE}">No active nationalization events</div></div>`;
  }
  const sorted = [...rows].sort(sortByValueAtRiskDesc);
  const body = sorted.map((row) => {
    const sColor = nationalismStatusColor(row.status);
    const sLabel = nationalismStatusLabel(row.status);
    const kLabel = nationalismKindLabel(row.kind);
    const value = row.valueAtRiskMillions >= 1000
      ? `$${(row.valueAtRiskMillions / 1000).toFixed(1)}B at risk`
      : `$${row.valueAtRiskMillions.toFixed(0)}M at risk`;
    return (
      `<tr>` +
        `<td style="${CELL_STYLE};font-weight:600;color:${sColor}">${escapeHtml(row.country)}</td>` +
        `<td style="${CELL_STYLE};color:#facc15">${escapeHtml(row.mineral)}</td>` +
        `<td style="${CELL_STYLE};color:var(--text-secondary,#cccccc)">${escapeHtml(row.operator)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:var(--text-primary,#e0e0e0)">${escapeHtml(value)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;text-transform:uppercase;font-size:10px;color:${sColor}">${escapeHtml(sLabel)}</td>` +
      `</tr>` +
      `<tr><td colspan="5" style="${SUB_CELL_STYLE}">Action: ${escapeHtml(kLabel)}</td></tr>`
    );
  }).join('');
  return (
    `<div data-section="nationalism" style="${SECTION_STYLE}">` +
      sectionHeaderHtml('Resource Nationalism Events', badge) +
      `<div style="${HINT_STYLE}">Country · mineral · operator · value at risk · status · action kind</div>` +
      `<table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>` +
    `</div>`
  );
}

export function renderBatteryMineralsSection(rows: BatteryMineralRisk[]): string {
  const vulnerable = countVulnerableBatteryMinerals(rows);
  const badge = vulnerable > 0 ? badgeHtml(vulnerable, 'vulnerable') : undefined;
  if (rows.length === 0) {
    return `<div data-section="battery" style="${SECTION_STYLE}">${sectionHeaderHtml('Battery Mineral Supply Chain', badge)}<div style="${EMPTY_STYLE}">No battery mineral risk data available</div></div>`;
  }
  const sorted = [...rows].sort(sortByDependencyScoreDesc);
  const body = sorted.map((row) => {
    const vColor = batteryVulnerabilityColor(row.vulnerability);
    const vLabel = batteryVulnerabilityLabel(row.vulnerability);
    const hhi = row.topProducerConcentrationHHI.toFixed(0);
    const dep = row.geopoliticalDependencyScore.toFixed(0);
    return (
      `<tr>` +
        `<td style="${CELL_STYLE};font-weight:600;color:${vColor}">${escapeHtml(row.mineral)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:var(--text-primary,#e0e0e0)">HHI ${escapeHtml(hhi)}</td>` +
        `<td style="${CELL_STYLE};color:var(--text-secondary,#cccccc)">${escapeHtml(row.processingConcentration)}</td>` +
        `<td style="${CELL_STYLE};text-align:right;color:${vColor};font-weight:600">${escapeHtml(dep)}/100</td>` +
        `<td style="${CELL_STYLE};text-align:right;text-transform:uppercase;font-size:10px;color:${vColor}">${escapeHtml(vLabel)}</td>` +
      `</tr>` +
      `<tr><td colspan="5" style="${SUB_CELL_STYLE}">${escapeHtml(row.notes)}</td></tr>`
    );
  }).join('');
  return (
    `<div data-section="battery" style="${SECTION_STYLE}">` +
      sectionHeaderHtml('Battery Mineral Supply Chain', badge) +
      `<div style="${HINT_STYLE}">Mineral · top-3 HHI · processing concentration · geo-weighted dependency · vulnerability</div>` +
      `<table style="${TABLE_STYLE}"><tbody>${body}</tbody></table>` +
    `</div>`
  );
}

// ── Static reference data ─────────────────────────────────────────────────

export const RARE_EARTH_DEPENDENCY: RareEarthDependency[] = [
  {
    element: 'Neodymium',
    chinaSharePct: 85,
    topAlternatives: 'Australia (Lynas), USA (Mountain Pass)',
    refiningChoke: 'China controls ~90% of separation/refining',
    strategicApplication: 'EV traction motors, wind turbine generators',
    concentrationRisk: 'critical',
  },
  {
    element: 'Dysprosium',
    chinaSharePct: 95,
    topAlternatives: 'Australia (limited), Myanmar (illegal flow)',
    refiningChoke: 'Near-monopoly Chinese heavy REE separation',
    strategicApplication: 'High-temperature magnets for EV / F-35',
    concentrationRisk: 'critical',
  },
  {
    element: 'Terbium',
    chinaSharePct: 92,
    topAlternatives: 'Myanmar (gray-market), Vietnam (small)',
    refiningChoke: 'Heavy REE separation almost exclusively in Jiangxi',
    strategicApplication: 'Phosphors, F-35 actuators, fluorescent lighting',
    concentrationRisk: 'critical',
  },
  {
    element: 'Yttrium',
    chinaSharePct: 78,
    topAlternatives: 'India, Malaysia (Lynas), Vietnam',
    refiningChoke: 'Chinese ion-adsorption clay refining',
    strategicApplication: 'YBCO superconductors, laser hosts, alloys',
    concentrationRisk: 'high',
  },
  {
    element: 'Samarium',
    chinaSharePct: 70,
    topAlternatives: 'Australia (Mt Weld), USA (Mountain Pass)',
    refiningChoke: 'Chinese light-REE separation cascade',
    strategicApplication: 'SmCo high-temperature magnets, missile guidance',
    concentrationRisk: 'high',
  },
  {
    element: 'Lanthanum',
    chinaSharePct: 65,
    topAlternatives: 'Australia, USA, India',
    refiningChoke: 'FCC catalyst grade dominated by Chinese refineries',
    strategicApplication: 'Petroleum FCC catalysts, hybrid car batteries (NiMH)',
    concentrationRisk: 'high',
  },
  {
    element: 'Cerium',
    chinaSharePct: 62,
    topAlternatives: 'Australia, USA, India',
    refiningChoke: 'Most abundant REE; refining still China-led',
    strategicApplication: 'Glass polishing, auto catalytic converters',
    concentrationRisk: 'high',
  },
  {
    element: 'Praseodymium',
    chinaSharePct: 87,
    topAlternatives: 'Australia (Lynas), USA (Mountain Pass)',
    refiningChoke: 'NdPr separation dominated by Chinese plants',
    strategicApplication: 'NdPr permanent magnets, aircraft engine alloys',
    concentrationRisk: 'critical',
  },
  {
    element: 'Gadolinium',
    chinaSharePct: 80,
    topAlternatives: 'Australia, USA (limited)',
    refiningChoke: 'Heavy REE separation in Ganzhou',
    strategicApplication: 'MRI contrast agents, neutron shielding',
    concentrationRisk: 'critical',
  },
  {
    element: 'Europium',
    chinaSharePct: 90,
    topAlternatives: 'USA (very limited), Estonia (legacy stockpile)',
    refiningChoke: 'Bayan Obo + Sichuan + Jiangxi refining',
    strategicApplication: 'Red phosphors, LED lighting, anti-counterfeit inks',
    concentrationRisk: 'critical',
  },
];

export const STRATEGIC_MINERAL_EVENTS: StrategicMineralEvent[] = [
  {
    acquirer: 'CMOC Group',
    targetCountry: 'DRC',
    mineral: 'Cobalt',
    dollarValueMillions: 3800,
    alignment: 'china_aligned',
    notes: 'Tenke Fungurume expansion; royalty dispute settled 2023',
  },
  {
    acquirer: 'Tianqi Lithium',
    targetCountry: 'Chile',
    mineral: 'Lithium',
    dollarValueMillions: 4100,
    alignment: 'china_aligned',
    notes: '24% stake in SQM purchased via Chilean court arbitration',
  },
  {
    acquirer: 'Glencore',
    targetCountry: 'DRC',
    mineral: 'Cobalt',
    dollarValueMillions: 2900,
    alignment: 'western_aligned',
    notes: 'Mutanda restart; off-take to GM and BMW',
  },
  {
    acquirer: 'Albemarle',
    targetCountry: 'Australia',
    mineral: 'Lithium',
    dollarValueMillions: 1500,
    alignment: 'western_aligned',
    notes: 'Kemerton hydroxide plant expansion',
  },
  {
    acquirer: 'Zijin Mining',
    targetCountry: 'Argentina',
    mineral: 'Lithium',
    dollarValueMillions: 770,
    alignment: 'china_aligned',
    notes: 'Tres Quebradas lithium brine acquisition',
  },
  {
    acquirer: 'BHP',
    targetCountry: 'Canada',
    mineral: 'Nickel',
    dollarValueMillions: 100,
    alignment: 'western_aligned',
    notes: 'Equity stake in Canada Nickel Company',
  },
  {
    acquirer: 'Tsingshan',
    targetCountry: 'Indonesia',
    mineral: 'Nickel',
    dollarValueMillions: 5200,
    alignment: 'china_aligned',
    notes: 'Morowali Industrial Park HPAL expansion',
  },
  {
    acquirer: 'Lundin Mining',
    targetCountry: 'Argentina',
    mineral: 'Copper',
    dollarValueMillions: 950,
    alignment: 'western_aligned',
    notes: 'Josemaria copper-gold project FID',
  },
  {
    acquirer: 'Syrah Resources',
    targetCountry: 'Mozambique',
    mineral: 'Graphite',
    dollarValueMillions: 220,
    alignment: 'western_aligned',
    notes: 'Balama anode-grade off-take to Tesla',
  },
  {
    acquirer: 'Hunan Gold',
    targetCountry: 'Tajikistan',
    mineral: 'Antimony',
    dollarValueMillions: 180,
    alignment: 'china_aligned',
    notes: 'Equity in Kanjol antimony project; secures Chinese stockpile',
  },
];

export const ARCTIC_DISPUTES: ArcticDispute[] = [
  {
    area: 'Lomonosov Ridge',
    claimants: 'Russia / Canada / Denmark',
    hydrocarbonReserveLevel: 'critical',
    diplomaticStatus: 'unclos_review',
    militaryPosture: 'Russian SSBN bastion patrols; Canadian sovereignty patrols',
  },
  {
    area: 'Alpha-Mendeleev Ridge',
    claimants: 'Russia / Canada',
    hydrocarbonReserveLevel: 'high',
    diplomaticStatus: 'unclos_review',
    militaryPosture: 'Limited; CCLS submissions overlap',
  },
  {
    area: 'Northern Sea Route control',
    claimants: 'Russia (claims internal waters) / USA-EU (claims international straits)',
    hydrocarbonReserveLevel: 'medium',
    diplomaticStatus: 'militarized',
    militaryPosture: 'Russian Northern Fleet basing; Bastion-P coastal missiles',
  },
  {
    area: 'Beaufort Sea wedge',
    claimants: 'Canada / USA',
    hydrocarbonReserveLevel: 'high',
    diplomaticStatus: 'frozen',
    militaryPosture: 'Disagreement on EEZ boundary; both sides patrol',
  },
  {
    area: 'Hans Island successor (Tartupaluk)',
    claimants: 'Canada / Denmark (resolved 2022)',
    hydrocarbonReserveLevel: 'low',
    diplomaticStatus: 'negotiation',
    militaryPosture: 'Demilitarized; precedent for peaceful Arctic settlement',
  },
  {
    area: 'Svalbard fisheries zone',
    claimants: 'Norway / Russia / EU',
    hydrocarbonReserveLevel: 'medium',
    diplomaticStatus: 'icj_pending',
    militaryPosture: 'Norwegian Coast Guard escalations; Russian inspections',
  },
];

export const DEEP_SEA_MINING: DeepSeaMiningContract[] = [
  {
    contractor: 'The Metals Company (NORI-D)',
    sponsoringState: 'Nauru',
    zone: 'Clarion-Clipperton Zone',
    phase: 'exploitation',
    moratoriumNote: 'First exploitation application; 24+ states oppose',
  },
  {
    contractor: 'Global Sea Mineral Resources (GSR)',
    sponsoringState: 'Belgium',
    zone: 'Clarion-Clipperton Zone',
    phase: 'exploration',
    moratoriumNote: 'Belgium supports precautionary pause',
  },
  {
    contractor: 'China Minmetals',
    sponsoringState: 'China',
    zone: 'Clarion-Clipperton Zone',
    phase: 'exploration',
    moratoriumNote: 'China opposes precautionary moratorium',
  },
  {
    contractor: 'COMRA',
    sponsoringState: 'China',
    zone: 'Western Pacific seamounts (cobalt crusts)',
    phase: 'exploration',
    moratoriumNote: 'Cobalt-rich crust contract',
  },
  {
    contractor: 'JOGMEC',
    sponsoringState: 'Japan',
    zone: 'Western Pacific (Okinawa Trough hydrothermal)',
    phase: 'exploration',
    moratoriumNote: 'EEZ-area pilot; Japan favors cautious development',
  },
  {
    contractor: 'BGR',
    sponsoringState: 'Germany',
    zone: 'Clarion-Clipperton Zone',
    phase: 'exploration',
    moratoriumNote: 'Germany supports moratorium; license held but inactive',
  },
  {
    contractor: 'Korea Institute of Ocean Science',
    sponsoringState: 'South Korea',
    zone: 'Clarion-Clipperton Zone',
    phase: 'exploration',
    moratoriumNote: 'South Korea recently joined precautionary-pause coalition',
  },
  {
    contractor: 'Cook Islands Seabed Minerals Authority',
    sponsoringState: 'Cook Islands',
    zone: 'Cook Islands EEZ',
    phase: 'exploration',
    moratoriumNote: 'National waters; outside ISA precautionary scope',
  },
];

export const NATIONALISM_EVENTS: NationalismEvent[] = [
  {
    country: 'Mexico',
    mineral: 'Lithium',
    operator: 'Bacanora / Ganfeng',
    kind: 'nationalization',
    valueAtRiskMillions: 1200,
    status: 'in_arbitration',
  },
  {
    country: 'Chile',
    mineral: 'Lithium',
    operator: 'SQM / Albemarle',
    kind: 'forced_equity',
    valueAtRiskMillions: 8000,
    status: 'pending',
  },
  {
    country: 'Indonesia',
    mineral: 'Nickel',
    operator: 'Multi-operator',
    kind: 'export_ban',
    valueAtRiskMillions: 4500,
    status: 'enforced',
  },
  {
    country: 'Indonesia',
    mineral: 'Bauxite',
    operator: 'Multi-operator',
    kind: 'export_ban',
    valueAtRiskMillions: 2200,
    status: 'enforced',
  },
  {
    country: 'Zimbabwe',
    mineral: 'Lithium',
    operator: 'Bikita / Sabi Star',
    kind: 'export_ban',
    valueAtRiskMillions: 600,
    status: 'enforced',
  },
  {
    country: 'Namibia',
    mineral: 'Lithium / cobalt',
    operator: 'Multi-operator',
    kind: 'export_ban',
    valueAtRiskMillions: 350,
    status: 'enforced',
  },
  {
    country: 'Panama',
    mineral: 'Copper',
    operator: 'First Quantum (Cobre Panama)',
    kind: 'expropriation',
    valueAtRiskMillions: 10_000,
    status: 'in_arbitration',
  },
  {
    country: 'Bolivia',
    mineral: 'Lithium',
    operator: 'Foreign joint ventures',
    kind: 'forced_equity',
    valueAtRiskMillions: 900,
    status: 'pending',
  },
  {
    country: 'Peru',
    mineral: 'Copper',
    operator: 'Various majors',
    kind: 'royalty_hike',
    valueAtRiskMillions: 750,
    status: 'pending',
  },
  {
    country: 'DRC',
    mineral: 'Cobalt / copper',
    operator: 'Sicomines / CMOC',
    kind: 'royalty_hike',
    valueAtRiskMillions: 2100,
    status: 'settled',
  },
];

export const BATTERY_MINERAL_RISK: BatteryMineralRisk[] = [
  {
    mineral: 'Lithium',
    topProducerConcentrationHHI: 3100,
    processingConcentration: '~65% refined in China (carbonate + hydroxide)',
    geopoliticalDependencyScore: 72,
    vulnerability: 'high',
    notes: 'Brine (Chile/Argentina) vs. spodumene (Australia); midstream is the bottleneck',
  },
  {
    mineral: 'Cobalt',
    topProducerConcentrationHHI: 5400,
    processingConcentration: '~75% refined in China; ~70% mined in DRC',
    geopoliticalDependencyScore: 88,
    vulnerability: 'extreme',
    notes: 'DRC artisanal mining exposure + Chinese refining duopoly',
  },
  {
    mineral: 'Nickel (battery grade)',
    topProducerConcentrationHHI: 4200,
    processingConcentration: '~55% refined in Indonesia, much of it Chinese-financed',
    geopoliticalDependencyScore: 78,
    vulnerability: 'high',
    notes: 'Class 1 vs. Class 2 nickel; HPAL conversion concentrated in Indonesia',
  },
  {
    mineral: 'Graphite (anode)',
    topProducerConcentrationHHI: 6300,
    processingConcentration: '~90% spherical-coated anode material processed in China',
    geopoliticalDependencyScore: 92,
    vulnerability: 'extreme',
    notes: 'Synthetic + natural anode supply both Chinese-dominated',
  },
  {
    mineral: 'Manganese',
    topProducerConcentrationHHI: 2400,
    processingConcentration: 'High-purity manganese sulfate ~95% China-refined',
    geopoliticalDependencyScore: 70,
    vulnerability: 'high',
    notes: 'Battery-grade refining bottleneck despite diverse mine production (South Africa, Gabon, Australia)',
  },
  {
    mineral: 'Copper',
    topProducerConcentrationHHI: 1800,
    processingConcentration: 'Chinese smelters take ~45% of global concentrate',
    geopoliticalDependencyScore: 55,
    vulnerability: 'medium',
    notes: 'Mine production reasonably diverse; smelter concentration the choke point',
  },
];
