/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * HealthSuperpowerPanel — the deepest intelligence view for biological
 * and public-health threats. Combines five lenses:
 *
 *   1. Disease Outbreak Tracker     — active outbreaks, severity, trajectory
 *   2. Wastewater Surveillance      — CDC NWSS metro-level signal levels
 *   3. Biodisaster Signal           — novel variants, zoonotic spillover, AMR
 *   4. Healthcare System Stress     — hospital + ICU capacity by region
 *   5. Pandemic Preparedness Index  — composite readiness score
 *
 * Service reads are wrapped in a local `safe()` so a single upstream
 * failure (sidecar down, malformed payload, etc.) degrades that section
 * rather than blanking the whole panel.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { situationEngine } from '@/services/situation-engine';
import { fetchDiseaseOutbreaks, type DiseaseOutbreak } from '@/services/disease-outbreak';
import { fetchWastewater, type WastewaterSignal, type WastewaterLevel, type WastewaterTrend, type WastewaterPathogen } from '@/services/wastewater';
import type { Situation } from '@/services/situation-types';

// ── Local safe wrapper ───────────────────────────────────────────────────────

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

async function safeAsync<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn(); } catch { return undefined; }
}

// ── Loose shapes (the panel survives even when upstream types drift) ─────────

interface SituationLike {
  id?: string;
  title?: string;
  name?: string;
  domain?: string;
  tags?: readonly string[];
  severity?: string;
  summary?: string;
  geo?: { label?: string };
  lastUpdated?: number;
}

// ── Public types ─────────────────────────────────────────────────────────────

export type OutbreakTrajectory = 'rising' | 'stable' | 'falling';
export type OutbreakSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface OutbreakRow {
  id: string;
  region: string;
  disease: string;
  trajectory: OutbreakTrajectory;
  severity: OutbreakSeverity;
  source: string;
  daysOld: number;
}

export interface WastewaterMetroRow {
  jurisdiction: string;
  worstLevel: WastewaterLevel;
  pathogens: { pathogen: WastewaterPathogen; level: WastewaterLevel; trend: WastewaterTrend }[];
}

export type BiodisasterKind = 'new-variant' | 'zoonotic-spillover' | 'unusual-cluster' | 'antimicrobial-resistance';

export interface BiodisasterFlag {
  id: string;
  kind: BiodisasterKind;
  label: string;
  summary: string;
  source: 'situation' | 'outbreak' | 'wastewater';
}

export type HealthcareStressLevel = 'green' | 'yellow' | 'red';

export interface HealthcareStressRow {
  region: string;
  status: HealthcareStressLevel;
  reason: string;
}

export interface PandemicPreparednessSummary {
  /** 0–100 composite (higher = better posture). */
  score: number;
  band: 'ready' | 'guarded' | 'stressed' | 'overwhelmed';
  contributors: { label: string; delta: number }[];
}

// ── Exported pure helpers (tested without DOM) ───────────────────────────────

const RISING_KEYWORDS = ['surge', 'spike', 'rising', 'expanding', 'rapid', 'spreading', 'cluster grows'];
const FALLING_KEYWORDS = ['decline', 'declining', 'easing', 'subsiding', 'controlled', 'contained'];

/**
 * Derive an outbreak's case-trajectory label from the available text
 * signals — title and any "trajectory" hint already attached. Falls
 * back to 'stable' when nothing is dispositive.
 */
export function outbreakTrajectory(outbreak: { title?: string; trajectory?: string } | undefined): OutbreakTrajectory {
  if (!outbreak) return 'stable';
  const hint = (outbreak.trajectory ?? '').toLowerCase();
  if (hint === 'rising' || hint === 'falling' || hint === 'stable') return hint;
  const text = (outbreak.title ?? '').toLowerCase();
  if (RISING_KEYWORDS.some((kw) => text.includes(kw))) return 'rising';
  if (FALLING_KEYWORDS.some((kw) => text.includes(kw))) return 'falling';
  return 'stable';
}

const SEVERITY_RANK: Record<OutbreakSeverity, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};

const TRAJECTORY_RANK: Record<OutbreakTrajectory, number> = {
  rising: 2, stable: 1, falling: 0,
};

/**
 * Convert raw outbreaks to display rows. Drops entries missing a
 * disease label, sorts severity desc then trajectory desc (rising
 * first), caps to 25 so the section stays scannable.
 */
export function buildOutbreakRows(
  outbreaks: readonly DiseaseOutbreak[],
  now: number = Date.now(),
): OutbreakRow[] {
  const rows = outbreaks
    .filter((o) => typeof o.disease === 'string' && o.disease.length > 0)
    .map((o): OutbreakRow => ({
      id: o.id,
      region: o.country || 'Unknown',
      disease: o.disease,
      trajectory: outbreakTrajectory(o as { title?: string }),
      severity: o.severity,
      source: o.source,
      daysOld: Math.max(0, Math.floor((now - new Date(o.date).getTime()) / 86_400_000)),
    }));
  rows.sort((a, b) => {
    const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sev !== 0) return sev;
    return TRAJECTORY_RANK[b.trajectory] - TRAJECTORY_RANK[a.trajectory];
  });
  return rows.slice(0, 25);
}

const LEVEL_RANK: Record<WastewaterLevel, number> = {
  low: 0, moderate: 1, elevated: 2, high: 3,
};

/**
 * Group wastewater signals by jurisdiction, keeping the up-to-3 highest
 * pathogens per metro and bubbling the worst level to the row header
 * so users can scan at a glance.
 */
export function groupWastewaterByJurisdiction(signals: readonly WastewaterSignal[]): WastewaterMetroRow[] {
  const byMetro = new Map<string, { pathogen: WastewaterPathogen; level: WastewaterLevel; trend: WastewaterTrend }[]>();
  for (const s of signals) {
    if (!s.jurisdiction) continue;
    const list = byMetro.get(s.jurisdiction) ?? [];
    list.push({ pathogen: s.pathogen, level: s.level, trend: s.trend });
    byMetro.set(s.jurisdiction, list);
  }
  const rows: WastewaterMetroRow[] = [];
  for (const [jurisdiction, pathogens] of byMetro) {
    const ordered = [...pathogens].sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
    const worst = ordered[0]?.level ?? 'low';
    rows.push({ jurisdiction, worstLevel: worst, pathogens: ordered.slice(0, 3) });
  }
  rows.sort((a, b) => LEVEL_RANK[b.worstLevel] - LEVEL_RANK[a.worstLevel]);
  return rows;
}

const ZOONOTIC_KEYWORDS = ['zoonotic', 'spillover', 'avian', 'h5n1', 'h7n9', 'swine flu', 'bat', 'wildlife transmission'];
const VARIANT_KEYWORDS = ['variant', 'new strain', 'novel clade', 'mutation', 'lineage'];
const AMR_KEYWORDS = ['resistant', 'resistance', 'mdr', 'xdr', 'antimicrobial', 'antibiotic-resistant'];
const CLUSTER_KEYWORDS = ['cluster', 'unusual', 'unexplained', 'mystery', 'novel pathogen'];

function classifyBiodisaster(text: string): BiodisasterKind | null {
  const lower = text.toLowerCase();
  if (ZOONOTIC_KEYWORDS.some((kw) => lower.includes(kw))) return 'zoonotic-spillover';
  if (VARIANT_KEYWORDS.some((kw) => lower.includes(kw))) return 'new-variant';
  if (AMR_KEYWORDS.some((kw) => lower.includes(kw))) return 'antimicrobial-resistance';
  if (CLUSTER_KEYWORDS.some((kw) => lower.includes(kw))) return 'unusual-cluster';
  return null;
}

/**
 * Surface flagged unusual patterns — variants, zoonotic spillover,
 * AMR signals, and unexplained clusters — pulled from active situations
 * and outbreak titles. Deduped by id; capped at 12.
 */
export function detectBiodisasterSignals(
  situations: readonly Situation[],
  outbreaks: readonly DiseaseOutbreak[],
): BiodisasterFlag[] {
  const flags: BiodisasterFlag[] = [];
  const seen = new Set<string>();
  const push = (flag: BiodisasterFlag): void => {
    if (seen.has(flag.id)) return;
    seen.add(flag.id);
    flags.push(flag);
  };
  for (const raw of situations as readonly SituationLike[]) {
    if (raw.domain !== 'health') continue;
    const text = `${raw.title ?? raw.name ?? ''} ${raw.summary ?? ''}`;
    const kind = classifyBiodisaster(text);
    if (!kind) continue;
    push({
      id: `sit:${raw.id ?? text.slice(0, 24)}`,
      kind,
      label: raw.name ?? raw.title ?? 'Health situation',
      summary: raw.summary ?? raw.title ?? '',
      source: 'situation',
    });
  }
  for (const o of outbreaks) {
    const kind = classifyBiodisaster(`${o.disease} ${o.title}`);
    if (!kind) continue;
    push({
      id: `out:${o.id}`,
      kind,
      label: `${o.disease} · ${o.country}`,
      summary: o.title,
      source: 'outbreak',
    });
  }
  return flags.slice(0, 12);
}

const ICU_KEYWORDS = ['icu', 'intensive care'];
const CAPACITY_KEYWORDS = ['capacity', 'overwhelmed', 'beds', 'hospital'];

/**
 * Derive healthcare-system-stress rows from active situations tagged
 * health/hospital/icu. Status is computed by severity label so we
 * downgrade gracefully when no numeric capacity is attached.
 */
export function buildHealthcareStressRows(
  situations: readonly Situation[],
): HealthcareStressRow[] {
  const rows: HealthcareStressRow[] = [];
  for (const raw of situations as readonly SituationLike[]) {
    if (raw.domain !== 'health') continue;
    const text = `${raw.title ?? raw.name ?? ''} ${raw.summary ?? ''}`.toLowerCase();
    const isIcu = ICU_KEYWORDS.some((kw) => text.includes(kw));
    const isCapacity = CAPACITY_KEYWORDS.some((kw) => text.includes(kw));
    if (!isIcu && !isCapacity) continue;
    const status = severityToStressLevel(raw.severity);
    rows.push({
      region: raw.geo?.label ?? 'Unknown region',
      status,
      reason: raw.name ?? raw.title ?? raw.summary ?? 'Capacity signal',
    });
  }
  return rows.slice(0, 10);
}

interface ContribAcc {
  score: number;
  contributors: { label: string; delta: number }[];
}

function applyPenalty(acc: ContribAcc, count: number, perUnit: number, cap: number, label: (n: number) => string): void {
  if (count <= 0) return;
  const delta = -Math.min(cap, count * perUnit);
  acc.score += delta;
  acc.contributors.push({ label: label(count), delta });
}

function bandFor(score: number): PandemicPreparednessSummary['band'] {
  if (score >= 80) return 'ready';
  if (score >= 60) return 'guarded';
  if (score >= 35) return 'stressed';
  return 'overwhelmed';
}

/**
 * Pandemic preparedness composite. Starts at 100 (full readiness) and
 * subtracts targeted penalties per signal class. Caps at 0 and floors
 * at 100 so the score stays interpretable.
 */
export function computePreparednessIndex(
  outbreaks: readonly OutbreakRow[],
  wastewater: readonly WastewaterMetroRow[],
  biodisaster: readonly BiodisasterFlag[],
  healthcareStress: readonly HealthcareStressRow[],
): PandemicPreparednessSummary {
  const acc: ContribAcc = { score: 100, contributors: [] };
  applyPenalty(acc, outbreaks.filter((o) => o.severity === 'critical').length, 12, 40,
    (n) => `${n} critical outbreak${n === 1 ? '' : 's'}`);
  applyPenalty(acc, outbreaks.filter((o) => o.trajectory === 'rising').length, 3, 15,
    (n) => `${n} rising`);
  applyPenalty(acc, wastewater.filter((m) => m.worstLevel === 'high').length, 6, 20,
    (n) => `${n} metro${n === 1 ? '' : 's'} at HIGH wastewater`);
  applyPenalty(acc, wastewater.filter((m) => m.worstLevel === 'elevated').length, 2, 10,
    (n) => `${n} elevated`);
  applyPenalty(acc, biodisaster.filter((b) => b.kind === 'zoonotic-spillover').length, 10, 20,
    () => 'zoonotic spillover signal');
  applyPenalty(acc, biodisaster.filter((b) => b.kind === 'new-variant').length, 4, 10,
    (n) => `${n} novel variant signal${n === 1 ? '' : 's'}`);
  applyPenalty(acc, biodisaster.filter((b) => b.kind === 'antimicrobial-resistance').length, 5, 10,
    () => 'antimicrobial resistance');
  applyPenalty(acc, healthcareStress.filter((h) => h.status === 'red').length, 5, 15,
    (n) => `${n} red-status healthcare region${n === 1 ? '' : 's'}`);
  let score = acc.score;
  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return { score, band: bandFor(score), contributors: acc.contributors };
}

function severityToStressLevel(severity: string | undefined): HealthcareStressLevel {
  const s = (severity ?? '').toLowerCase();
  if (s === 'critical' || s === 'high') return 'red';
  if (s === 'medium') return 'yellow';
  return 'green';
}

// ── Panel ────────────────────────────────────────────────────────────────────

const REFRESH_MS = 5 * 60_000;

export class HealthSuperpowerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private outbreaks: DiseaseOutbreak[] = [];
  private wastewaterSignals: WastewaterSignal[] = [];

  constructor() {
    super({
      id: 'health-superpower',
      title: 'Health Intelligence',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Deep biological + public-health intelligence: active outbreaks, wastewater surveillance, novel variants and zoonotic spillover, healthcare system stress, pandemic preparedness composite. 5-minute refresh.',
    });
    queueMicrotask(() => { void this.refresh(); });
    this.refreshTimer = setInterval(() => { void this.refresh(); }, REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private async refresh(): Promise<void> {
    this.outbreaks = (await safeAsync(() => fetchDiseaseOutbreaks())) ?? this.outbreaks;
    const wastewater = await safeAsync(() => fetchWastewater());
    if (wastewater) this.wastewaterSignals = wastewater.signals as WastewaterSignal[];
    const situations = (safe(() => situationEngine.getSituations()) ?? []) as Situation[];

    const outbreakRows = buildOutbreakRows(this.outbreaks);
    const wastewaterRows = groupWastewaterByJurisdiction(this.wastewaterSignals);
    const biodisaster = detectBiodisasterSignals(situations, this.outbreaks);
    const stress = buildHealthcareStressRows(situations);
    const prep = computePreparednessIndex(outbreakRows, wastewaterRows, biodisaster, stress);

    this.setCount(outbreakRows.length + biodisaster.length);
    this.setContent(this.buildHtml(outbreakRows, wastewaterRows, biodisaster, stress, prep));
  }

  private buildHtml(
    outbreaks: OutbreakRow[],
    wastewater: WastewaterMetroRow[],
    biodisaster: BiodisasterFlag[],
    stress: HealthcareStressRow[],
    prep: PandemicPreparednessSummary,
  ): string {
    return `<div class="hsp">
  <section class="hsp-section hsp-preparedness">
    <h3 class="hsp-section-title">Pandemic Preparedness Index</h3>
    <div class="hsp-prep-row" data-band="${escapeHtml(prep.band)}">
      <span class="hsp-prep-score">${prep.score}</span>
      <span class="hsp-prep-band">${escapeHtml(prep.band.toUpperCase())}</span>
    </div>
    ${prep.contributors.length === 0
      ? '<p class="hsp-empty">No stress signals — full readiness posture.</p>'
      : `<ul class="hsp-prep-contrib">${prep.contributors.map((c) => `<li><span class="hsp-prep-label">${escapeHtml(c.label)}</span><span class="hsp-prep-delta">${c.delta}</span></li>`).join('')}</ul>`}
  </section>
  <section class="hsp-section hsp-outbreaks">
    <h3 class="hsp-section-title">Disease Outbreak Tracker</h3>
    ${outbreaks.length === 0
      ? '<p class="hsp-empty">No active outbreaks reported.</p>'
      : outbreaks.map((o) => `<div class="hsp-outbreak" data-severity="${escapeHtml(o.severity)}" data-trajectory="${escapeHtml(o.trajectory)}">
      <span class="hsp-disease">${escapeHtml(o.disease)}</span>
      <span class="hsp-region">${escapeHtml(o.region)}</span>
      <span class="hsp-severity">${escapeHtml(o.severity)}</span>
      <span class="hsp-trajectory">${trajectoryIcon(o.trajectory)} ${escapeHtml(o.trajectory)}</span>
      <span class="hsp-source">${escapeHtml(o.source)} · ${o.daysOld}d</span>
    </div>`).join('\n    ')}
  </section>
  <section class="hsp-section hsp-wastewater">
    <h3 class="hsp-section-title">Wastewater Surveillance</h3>
    ${wastewater.length === 0
      ? '<p class="hsp-empty">No NWSS metro signals.</p>'
      : wastewater.map((m) => `<div class="hsp-metro" data-level="${escapeHtml(m.worstLevel)}">
      <span class="hsp-metro-name">${escapeHtml(m.jurisdiction)}</span>
      <span class="hsp-metro-level">${escapeHtml(m.worstLevel)}</span>
      <span class="hsp-metro-pathogens">${m.pathogens.map((p) => `${escapeHtml(p.pathogen)} (${escapeHtml(p.level)}, ${escapeHtml(p.trend)})`).join(' · ')}</span>
    </div>`).join('\n    ')}
  </section>
  <section class="hsp-section hsp-biodisaster">
    <h3 class="hsp-section-title">Biodisaster Signal</h3>
    ${biodisaster.length === 0
      ? '<p class="hsp-empty">No novel-threat signatures.</p>'
      : biodisaster.map((b) => `<div class="hsp-bio" data-kind="${escapeHtml(b.kind)}">
      <span class="hsp-bio-kind">${escapeHtml(b.kind)}</span>
      <span class="hsp-bio-label">${escapeHtml(b.label)}</span>
      <span class="hsp-bio-summary">${escapeHtml(b.summary)}</span>
    </div>`).join('\n    ')}
  </section>
  <section class="hsp-section hsp-stress">
    <h3 class="hsp-section-title">Healthcare System Stress</h3>
    ${stress.length === 0
      ? '<p class="hsp-empty">No reported hospital or ICU stress.</p>'
      : stress.map((s) => `<div class="hsp-stress-row" data-status="${escapeHtml(s.status)}">
      <span class="hsp-stress-region">${escapeHtml(s.region)}</span>
      <span class="hsp-stress-status">${escapeHtml(s.status)}</span>
      <span class="hsp-stress-reason">${escapeHtml(s.reason)}</span>
    </div>`).join('\n    ')}
  </section>
</div>`;
  }
}

function trajectoryIcon(t: OutbreakTrajectory): string {
  if (t === 'rising') return '↑';
  if (t === 'falling') return '↓';
  return '→';
}
