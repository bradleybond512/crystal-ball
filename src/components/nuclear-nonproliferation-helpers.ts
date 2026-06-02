/**
 * Pure helpers for NuclearNonproliferationPanel.
 *
 * Arms-control VERIFICATION + proliferation-risk surface — distinct from the
 * arsenal/doctrine NuclearSuperpower panel. No DOM, no fetch, no globals; every
 * render helper returns an HTML string and escapes interpolated values so tests
 * can import the module without dragging in Panel or browser deps.
 */
import { escapeHtml } from '@/utils/sanitize';

// ── Types ───────────────────────────────────────────────────────────────────

export type NptStatus = 'signatory' | 'non_signatory' | 'withdrawn' | 'non_compliant';
export type SafeguardsStatus =
  | 'comprehensive'
  | 'additional_protocol'
  | 'voluntary'
  | 'suspended'
  | 'no_safeguards';
export type AlertTier = 'low' | 'elevated' | 'high' | 'critical';
export type InterdictionStatus = 'interdicted' | 'recovered' | 'lost' | 'unconfirmed';
export type RiskTier = 'minimal' | 'guarded' | 'elevated' | 'severe';

export interface NptEntry {
  country: string;
  status: NptStatus;
  note: string;
}

export interface SafeguardsEntry {
  country: string;
  status: SafeguardsStatus;
  note: string;
}

export interface EnrichmentAlert {
  country: string;
  facility: string;
  enrichmentPct: number;
  tier: AlertTier;
  note: string;
}

export interface SmugglingIncident {
  location: string;
  material: string;
  quantity: string;
  status: InterdictionStatus;
  year: number;
}

export interface WithdrawalRisk {
  country: string;
  treaty: string;
  score: number;
  tier: RiskTier;
}

export interface NonproliferationInputs {
  npt: readonly NptEntry[];
  safeguards: readonly SafeguardsEntry[];
  enrichment: readonly EnrichmentAlert[];
  smuggling: readonly SmugglingIncident[];
  withdrawalRisk: readonly WithdrawalRisk[];
}

// ── Static reference datasets ─────────────────────────────────────────────────

export const NPT_ADHERENCE: readonly NptEntry[] = [
  { country: 'India', status: 'non_signatory', note: 'Never signed; declared weapons state outside the treaty.' },
  { country: 'Pakistan', status: 'non_signatory', note: 'Never signed; weapons program outside safeguards.' },
  { country: 'Israel', status: 'non_signatory', note: 'Policy of deliberate ambiguity; never signed.' },
  { country: 'South Sudan', status: 'non_signatory', note: 'Has not acceded since 2011 independence.' },
  { country: 'North Korea', status: 'withdrawn', note: 'Announced withdrawal in 2003; only state to leave the NPT.' },
  { country: 'Iran', status: 'non_compliant', note: 'Signatory but IAEA reports outstanding safeguards questions.' },
  { country: 'Syria', status: 'non_compliant', note: 'Signatory; unresolved undeclared-reactor file (Al Kibar).' },
  { country: 'United States', status: 'signatory', note: 'Nuclear-weapon state party; ratified 1970.' },
  { country: 'Germany', status: 'signatory', note: 'Non-nuclear-weapon state party in full compliance.' },
  { country: 'Japan', status: 'signatory', note: 'Non-nuclear-weapon state party; Additional Protocol in force.' },
];

export const SAFEGUARDS_STATUS: readonly SafeguardsEntry[] = [
  { country: 'Japan', status: 'additional_protocol', note: 'CSA plus Additional Protocol; broader-conclusion state.' },
  { country: 'Germany', status: 'additional_protocol', note: 'EURATOM CSA plus Additional Protocol.' },
  { country: 'Brazil', status: 'comprehensive', note: 'Comprehensive Safeguards Agreement; no Additional Protocol.' },
  { country: 'Argentina', status: 'comprehensive', note: 'CSA under ABACC bilateral accounting; no AP.' },
  { country: 'United States', status: 'voluntary', note: 'Voluntary-offer agreement as a nuclear-weapon state.' },
  { country: 'Iran', status: 'suspended', note: 'Additional Protocol implementation suspended since 2021.' },
  { country: 'North Korea', status: 'no_safeguards', note: 'Expelled inspectors in 2009; no safeguards in force.' },
  { country: 'India', status: 'voluntary', note: 'Facility-specific safeguards on civil reactors only.' },
];

export const ENRICHMENT_ALERTS: readonly EnrichmentAlert[] = [
  { country: 'Iran', facility: 'Fordow', enrichmentPct: 60, tier: 'critical', note: 'Near-weapons-grade HEU-adjacent stockpile detected.' },
  { country: 'Iran', facility: 'Natanz', enrichmentPct: 20, tier: 'high', note: 'Advanced centrifuge cascades beyond JCPOA limits.' },
  { country: 'North Korea', facility: 'Yongbyon', enrichmentPct: 90, tier: 'critical', note: 'Undeclared weapons-grade production; no inspections.' },
  { country: 'Pakistan', facility: 'Kahuta', enrichmentPct: 90, tier: 'elevated', note: 'Established weapons-grade program outside safeguards.' },
  { country: 'Brazil', facility: 'Resende', enrichmentPct: 5, tier: 'low', note: 'Civil fuel-cycle enrichment under CSA.' },
];

export const SMUGGLING_INCIDENTS: readonly SmugglingIncident[] = [
  { location: 'Chisinau, Moldova', material: 'HEU', quantity: '4.5 g', status: 'interdicted', year: 2011 },
  { location: 'Tbilisi, Georgia', material: 'HEU', quantity: '3.0 g', status: 'interdicted', year: 2019 },
  { location: 'Rotterdam, Netherlands', material: 'Cs-137', quantity: '1 source', status: 'recovered', year: 2018 },
  { location: 'Batumi, Georgia', material: 'plutonium', quantity: '0.2 g', status: 'unconfirmed', year: 2016 },
  { location: 'Mumbai, India', material: 'natural uranium', quantity: '7 kg', status: 'recovered', year: 2021 },
  { location: 'Kinshasa, DRC', material: 'Cs-137', quantity: '1 source', status: 'lost', year: 2020 },
];

export const WITHDRAWAL_RISK: readonly WithdrawalRisk[] = [
  { country: 'North Korea', treaty: 'NPT', score: 95, tier: 'severe' },
  { country: 'Iran', treaty: 'JCPOA', score: 78, tier: 'severe' },
  { country: 'Russia', treaty: 'New START', score: 64, tier: 'elevated' },
  { country: 'United States', treaty: 'CTBT', score: 42, tier: 'elevated' },
  { country: 'Saudi Arabia', treaty: 'NPT', score: 28, tier: 'guarded' },
  { country: 'Japan', treaty: 'NPT', score: 6, tier: 'minimal' },
];

// ── Color + label tables ──────────────────────────────────────────────────────

const NPT_COLOR: Record<NptStatus, string> = {
  signatory: 'var(--severity-low, #4caf50)',
  non_compliant: 'var(--severity-medium, #facc15)',
  non_signatory: 'var(--severity-high, #fb923c)',
  withdrawn: 'var(--severity-critical, #ef4444)',
};

const NPT_LABEL: Record<NptStatus, string> = {
  signatory: 'Signatory',
  non_compliant: 'Non-Compliant',
  non_signatory: 'Non-Signatory',
  withdrawn: 'Withdrawn',
};

const SAFEGUARDS_COLOR: Record<SafeguardsStatus, string> = {
  additional_protocol: 'var(--severity-low, #4caf50)',
  comprehensive: 'var(--severity-info, #38bdf8)',
  voluntary: 'var(--severity-medium, #facc15)',
  suspended: 'var(--severity-high, #fb923c)',
  no_safeguards: 'var(--severity-critical, #ef4444)',
};

const SAFEGUARDS_LABEL: Record<SafeguardsStatus, string> = {
  additional_protocol: 'Additional Protocol',
  comprehensive: 'Comprehensive',
  voluntary: 'Voluntary Offer',
  suspended: 'Suspended',
  no_safeguards: 'No Safeguards',
};

const TIER_COLOR: Record<AlertTier, string> = {
  low: 'var(--severity-low, #4caf50)',
  elevated: 'var(--severity-medium, #facc15)',
  high: 'var(--severity-high, #fb923c)',
  critical: 'var(--severity-critical, #ef4444)',
};

const TIER_LABEL: Record<AlertTier, string> = {
  low: 'Low',
  elevated: 'Elevated',
  high: 'High',
  critical: 'Critical',
};

const INTERDICTION_COLOR: Record<InterdictionStatus, string> = {
  interdicted: 'var(--severity-low, #4caf50)',
  recovered: 'var(--severity-info, #38bdf8)',
  lost: 'var(--severity-critical, #ef4444)',
  unconfirmed: 'var(--severity-medium, #facc15)',
};

const INTERDICTION_LABEL: Record<InterdictionStatus, string> = {
  interdicted: 'Interdicted',
  recovered: 'Recovered',
  lost: 'Lost',
  unconfirmed: 'Unconfirmed',
};

const RISK_COLOR: Record<RiskTier, string> = {
  minimal: 'var(--severity-low, #4caf50)',
  guarded: 'var(--severity-medium, #facc15)',
  elevated: 'var(--severity-high, #fb923c)',
  severe: 'var(--severity-critical, #ef4444)',
};

const RISK_LABEL: Record<RiskTier, string> = {
  minimal: 'Minimal',
  guarded: 'Guarded',
  elevated: 'Elevated',
  severe: 'Severe',
};

// ── Table accessors ───────────────────────────────────────────────────────────

export const nptColor = (status: NptStatus): string => NPT_COLOR[status] ?? '#888';
export const nptLabel = (status: NptStatus): string => NPT_LABEL[status] ?? status;
export const safeguardsColor = (status: SafeguardsStatus): string => SAFEGUARDS_COLOR[status] ?? '#888';
export const safeguardsLabel = (status: SafeguardsStatus): string => SAFEGUARDS_LABEL[status] ?? status;
export const alertTierColor = (tier: AlertTier): string => TIER_COLOR[tier] ?? '#888';
export const alertTierLabel = (tier: AlertTier): string => TIER_LABEL[tier] ?? tier;
export const interdictionColor = (status: InterdictionStatus): string => INTERDICTION_COLOR[status] ?? '#888';
export const interdictionLabel = (status: InterdictionStatus): string => INTERDICTION_LABEL[status] ?? status;
export const riskColor = (tier: RiskTier): string => RISK_COLOR[tier] ?? '#888';
export const riskLabel = (tier: RiskTier): string => RISK_LABEL[tier] ?? tier;

// ── Band classifiers ──────────────────────────────────────────────────────────

export function enrichmentAlertTier(pct: number): AlertTier {
  const clamped = clampPct(pct);
  if (clamped >= 60) return 'critical';
  if (clamped >= 20) return 'high';
  if (clamped >= 5) return 'elevated';
  return 'low';
}

export function withdrawalRiskTier(score: number): RiskTier {
  const clamped = clampScore(score);
  if (clamped >= 75) return 'severe';
  if (clamped >= 40) return 'elevated';
  if (clamped >= 20) return 'guarded';
  return 'minimal';
}

// ── Numeric helpers ───────────────────────────────────────────────────────────

export function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
}

export function formatPct(pct: number): string {
  return `${clampPct(pct).toFixed(0)}%`;
}

// ── Sort comparators ──────────────────────────────────────────────────────────

const ALERT_TIER_RANK: Record<AlertTier, number> = { critical: 3, high: 2, elevated: 1, low: 0 };

export function byEnrichmentDesc(a: EnrichmentAlert, b: EnrichmentAlert): number {
  const tierDelta = ALERT_TIER_RANK[b.tier] - ALERT_TIER_RANK[a.tier];
  return tierDelta === 0 ? b.enrichmentPct - a.enrichmentPct : tierDelta;
}

export function byRiskScoreDesc(a: WithdrawalRisk, b: WithdrawalRisk): number {
  return b.score - a.score;
}

export function byYearDesc(a: SmugglingIncident, b: SmugglingIncident): number {
  return b.year - a.year;
}

// ── Aggregators ───────────────────────────────────────────────────────────────

export function countNonCompliantOrWithdrawn(entries: readonly NptEntry[]): number {
  return entries.filter((e) => e.status === 'non_compliant' || e.status === 'withdrawn').length;
}

export function countSuspendedSafeguards(entries: readonly SafeguardsEntry[]): number {
  return entries.filter((e) => e.status === 'suspended' || e.status === 'no_safeguards').length;
}

export function countCriticalAlerts(alerts: readonly EnrichmentAlert[]): number {
  return alerts.filter((a) => a.tier === 'critical' || a.tier === 'high').length;
}

export function countSevereRisks(risks: readonly WithdrawalRisk[]): number {
  return risks.filter((r) => r.tier === 'severe').length;
}

export function aggregateConcernCount(inputs: NonproliferationInputs): number {
  return (
    countNonCompliantOrWithdrawn(inputs.npt) +
    countSuspendedSafeguards(inputs.safeguards) +
    countCriticalAlerts(inputs.enrichment) +
    countSevereRisks(inputs.withdrawalRisk)
  );
}

// ── Render helpers ────────────────────────────────────────────────────────────

function sectionHeader(title: string, badge: number): string {
  return `<div class="nnp-section-head">
    <h3>${escapeHtml(title)}</h3>
    <span class="nnp-section-badge">${badge}</span>
  </div>`;
}

export function renderNptSection(entries: readonly NptEntry[]): string {
  const concern = countNonCompliantOrWithdrawn(entries);
  const rows = entries.length === 0
    ? '<div class="nnp-empty">No NPT adherence records.</div>'
    : entries.map((e) => `
      <div class="nnp-row">
        <span class="nnp-country">${escapeHtml(e.country)}</span>
        <span class="nnp-tag" style="color:${nptColor(e.status)}">${escapeHtml(nptLabel(e.status))}</span>
        <span class="nnp-note">${escapeHtml(e.note)}</span>
      </div>`).join('');
  return `<section class="nnp-section nnp-npt">${sectionHeader('NPT Adherence', concern)}${rows}</section>`;
}

export function renderSafeguardsSection(entries: readonly SafeguardsEntry[]): string {
  const concern = countSuspendedSafeguards(entries);
  const rows = entries.length === 0
    ? '<div class="nnp-empty">No IAEA safeguards records.</div>'
    : entries.map((e) => `
      <div class="nnp-row">
        <span class="nnp-country">${escapeHtml(e.country)}</span>
        <span class="nnp-tag" style="color:${safeguardsColor(e.status)}">${escapeHtml(safeguardsLabel(e.status))}</span>
        <span class="nnp-note">${escapeHtml(e.note)}</span>
      </div>`).join('');
  return `<section class="nnp-section nnp-safeguards">${sectionHeader('IAEA Safeguards', concern)}${rows}</section>`;
}

export function renderEnrichmentSection(alerts: readonly EnrichmentAlert[]): string {
  const concern = countCriticalAlerts(alerts);
  const sorted = [...alerts].sort(byEnrichmentDesc);
  const rows = sorted.length === 0
    ? '<div class="nnp-empty">No enrichment alerts.</div>'
    : sorted.map((a) => `
      <div class="nnp-row">
        <span class="nnp-country">${escapeHtml(a.country)} · ${escapeHtml(a.facility)}</span>
        <span class="nnp-pct">${escapeHtml(formatPct(a.enrichmentPct))}</span>
        <span class="nnp-tag" style="color:${alertTierColor(a.tier)}">${escapeHtml(alertTierLabel(a.tier))}</span>
        <span class="nnp-note">${escapeHtml(a.note)}</span>
      </div>`).join('');
  return `<section class="nnp-section nnp-enrichment">${sectionHeader('Enrichment Alerts', concern)}${rows}</section>`;
}

export function renderSmugglingSection(incidents: readonly SmugglingIncident[]): string {
  const sorted = [...incidents].sort(byYearDesc);
  const rows = sorted.length === 0
    ? '<div class="nnp-empty">No smuggling incidents on record.</div>'
    : sorted.map((i) => `
      <div class="nnp-row">
        <span class="nnp-year">${i.year}</span>
        <span class="nnp-country">${escapeHtml(i.location)}</span>
        <span class="nnp-material">${escapeHtml(i.material)} · ${escapeHtml(i.quantity)}</span>
        <span class="nnp-tag" style="color:${interdictionColor(i.status)}">${escapeHtml(interdictionLabel(i.status))}</span>
      </div>`).join('');
  return `<section class="nnp-section nnp-smuggling">${sectionHeader('Trafficking Incidents', incidents.length)}${rows}</section>`;
}

export function renderWithdrawalRiskSection(risks: readonly WithdrawalRisk[]): string {
  const concern = countSevereRisks(risks);
  const sorted = [...risks].sort(byRiskScoreDesc);
  const rows = sorted.length === 0
    ? '<div class="nnp-empty">No treaty-withdrawal risk scores.</div>'
    : sorted.map((r) => `
      <div class="nnp-row">
        <span class="nnp-country">${escapeHtml(r.country)}</span>
        <span class="nnp-treaty">${escapeHtml(r.treaty)}</span>
        <span class="nnp-score" style="color:${riskColor(r.tier)}">${clampScore(r.score)}</span>
        <span class="nnp-tag" style="color:${riskColor(r.tier)}">${escapeHtml(riskLabel(r.tier))}</span>
      </div>`).join('');
  return `<section class="nnp-section nnp-withdrawal">${sectionHeader('Treaty Withdrawal Risk', concern)}${rows}</section>`;
}

export function renderAll(inputs: NonproliferationInputs): string {
  return `<div class="nnp-dashboard">
    ${renderNptSection(inputs.npt)}
    ${renderSafeguardsSection(inputs.safeguards)}
    ${renderEnrichmentSection(inputs.enrichment)}
    ${renderSmugglingSection(inputs.smuggling)}
    ${renderWithdrawalRiskSection(inputs.withdrawalRisk)}
  </div>`;
}

export const DEFAULT_INPUTS: NonproliferationInputs = {
  npt: NPT_ADHERENCE,
  safeguards: SAFEGUARDS_STATUS,
  enrichment: ENRICHMENT_ALERTS,
  smuggling: SMUGGLING_INCIDENTS,
  withdrawalRisk: WITHDRAWAL_RISK,
};
