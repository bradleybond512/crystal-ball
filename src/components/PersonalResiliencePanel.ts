/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * PersonalResiliencePanel — UI for the PersonalResilienceModel service.
 *
 * Five sections:
 *   1. Your Risk Score             — composite exposure (0–100%)
 *   2. Active Risk Factors          — top contributors per domain
 *   3. Regional Context             — user's regions + current threat level
 *   4. Domain Interest Profile      — declared domain interests + current activity
 *   5. Resilience Recommendations   — tiered guidance based on the risk score
 *
 * Reads from PersonalResilienceModel (singleton). Service reads are
 * wrapped in a local `safe()` so a transient service hiccup degrades
 * one section rather than blanking the panel.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  PersonalResilienceModel,
  type AlertHistoryEntry,
  type ResilienceProfile,
} from '@/services/intelligence/personal-resilience-model';
import {
  buildDomainInterestRows,
  buildRegionalContext,
  buildRiskFactors,
  recommendationForRisk,
  riskAsPercentage,
  riskFromResilience,
  type DomainInterestRow,
  type RegionContextRow,
  type RiskFactor,
} from './personal-resilience-helpers';

const REFRESH_MS = 60_000;

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

export class PersonalResiliencePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'personal-resilience',
      title: 'Personal Resilience',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Your exposure score, top risk factors, regional context, domain interests, and tiered resilience guidance. Refreshed each minute from PersonalResilienceModel.',
    });
    queueMicrotask(() => { this.refresh(); });
    this.refreshTimer = setInterval(() => { this.refresh(); }, REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private refresh(): void {
    const model = safe(() => PersonalResilienceModel.getInstance());
    const profile = safe(() => model?.getProfile()) ?? undefined;
    const alertHistory = safe(() => readAlertHistory()) ?? [];
    const declaredWeights = safe(() => readDomainWeights()) ?? {};

    const riskScore = profile ? riskFromResilience(profile.overallResilienceScore) : 0;
    const riskFactors = buildRiskFactors(profile);
    const regions = buildRegionalContext(profile, [], alertHistory, alertRegionLookup);
    const domainRows = buildDomainInterestRows(profile, declaredWeights);
    const recommendation = recommendationForRisk(riskScore);

    this.setCount(riskFactors.length);
    this.setContent(this.buildHtml(profile, riskScore, riskFactors, regions, domainRows, recommendation));
  }

  private buildHtml(
    profile: ResilienceProfile | undefined,
    riskScore: number,
    riskFactors: RiskFactor[],
    regions: RegionContextRow[],
    domainRows: DomainInterestRow[],
    recommendation: string | null,
  ): string {
    return `<div class="prp">
  <section class="prp-section prp-risk-score">
    <h3 class="prp-section-title">Your Risk Score</h3>
    ${renderRiskHeader(profile, riskScore)}
  </section>
  <section class="prp-section prp-risk-factors">
    <h3 class="prp-section-title">Active Risk Factors</h3>
    ${riskFactors.length === 0
      ? '<p class="prp-empty">No active risk factors — your exposure is calm across every tracked domain.</p>'
      : riskFactors.map((f) => renderRiskFactorRow(f)).join('\n    ')}
  </section>
  <section class="prp-section prp-regional">
    <h3 class="prp-section-title">Regional Context</h3>
    ${regions.length === 0
      ? '<p class="prp-empty">No saved regions yet — add saved places to surface regional threat context.</p>'
      : regions.map((r) => renderRegionRow(r)).join('\n    ')}
  </section>
  <section class="prp-section prp-domains">
    <h3 class="prp-section-title">Domain Interest Profile</h3>
    ${domainRows.length === 0
      ? '<p class="prp-empty">No declared domain interests yet.</p>'
      : domainRows.map((d) => renderDomainRow(d)).join('\n    ')}
  </section>
  <section class="prp-section prp-recommendations">
    <h3 class="prp-section-title">Resilience Recommendations</h3>
    ${recommendation === null
      ? '<p class="prp-empty">No action needed — keep watching.</p>'
      : `<p class="prp-recommendation">${escapeHtml(recommendation)}</p>`}
    ${profile && profile.recommendations.length > 0
      ? `<ul class="prp-rec-list">${profile.recommendations.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
      : ''}
  </section>
</div>`;
  }
}

// ── render helpers ───────────────────────────────────────────────────────────

function renderRiskHeader(profile: ResilienceProfile | undefined, riskScore: number): string {
  const pct = riskAsPercentage(riskScore);
  if (!profile) {
    return `<div class="prp-risk-row" data-band="unknown">
      <span class="prp-risk-pct">--%</span>
      <span class="prp-risk-band">NO PROFILE</span>
    </div>
    <p class="prp-empty">Save a place or declare a domain interest to seed your resilience profile.</p>`;
  }
  return `<div class="prp-risk-row" data-band="${escapeHtml(profile.preparednessLevel)}">
      <span class="prp-risk-pct">${pct}%</span>
      <span class="prp-risk-band">${escapeHtml(profile.preparednessLevel.toUpperCase())}</span>
    </div>
    <p class="prp-risk-caption">Composite of alert activity (40%), regional overlap (40%), domain interest (20%).</p>`;
}

function renderRiskFactorRow(f: RiskFactor): string {
  return `<div class="prp-factor" data-severity="${escapeHtml(f.severity)}">
      <span class="prp-factor-domain">${escapeHtml(f.domain)}</span>
      <span class="prp-factor-severity">${escapeHtml(f.severity)}</span>
      <span class="prp-factor-weight">w ${(f.weight * 100).toFixed(0)}%</span>
      <span class="prp-factor-contribution">contrib ${(f.contribution * 100).toFixed(0)}%</span>
      <span class="prp-factor-alerts">${f.alertsReceived} alert${f.alertsReceived === 1 ? '' : 's'}</span>
    </div>`;
}

function renderRegionRow(r: RegionContextRow): string {
  const highlight = r.inUserRegion ? ' prp-region-highlight' : '';
  const topDomain = r.topDomain ? ` · ${escapeHtml(r.topDomain)}` : '';
  return `<div class="prp-region${highlight}" data-threat="${escapeHtml(r.threatLevel)}">
      <span class="prp-region-name">${escapeHtml(r.region)}</span>
      <span class="prp-region-threat">${escapeHtml(r.threatLevel)}</span>
      <span class="prp-region-alerts">${r.matchingAlertCount} alert${r.matchingAlertCount === 1 ? '' : 's'}${topDomain}</span>
    </div>`;
}

function renderDomainRow(d: DomainInterestRow): string {
  return `<div class="prp-domain">
      <span class="prp-domain-name">${escapeHtml(d.domain)}</span>
      <span class="prp-domain-interest">interest ${(d.interestWeight * 100).toFixed(0)}%</span>
      <span class="prp-domain-exposure">exposure ${(d.exposureLevel * 100).toFixed(0)}%</span>
      <span class="prp-domain-contribution">→ ${(d.scoreContribution * 100).toFixed(0)}%</span>
    </div>`;
}

// ── side-channel reads (deliberately keyed off optional localStorage) ────────

interface LocalStorageLike {
  getItem(key: string): string | null;
}

function readLocalStorage(): LocalStorageLike | null {
  try {
    const g = globalThis as { localStorage?: LocalStorageLike };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
}

interface StoredAlertEntry {
  domain?: unknown;
  severity?: unknown;
  region?: unknown;
}

function readAlertHistory(): AlertHistoryEntry[] {
  const ls = readLocalStorage();
  if (!ls) return [];
  const raw = ls.getItem('wm-personal-alert-history');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => coerceAlert(entry))
      .filter((entry): entry is AlertHistoryEntry => entry !== null);
  } catch {
    return [];
  }
}

function coerceAlert(raw: unknown): AlertHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as StoredAlertEntry;
  if (typeof r.domain !== 'string' || typeof r.severity !== 'number') return null;
  return { domain: r.domain, severity: r.severity };
}

function readDomainWeights(): Record<string, number> {
  const ls = readLocalStorage();
  if (!ls) return {};
  const raw = ls.getItem('wm-personal-domain-weights');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function alertRegionLookup(entry: AlertHistoryEntry): string | undefined {
  const r = entry as AlertHistoryEntry & { region?: unknown };
  return typeof r.region === 'string' ? r.region : undefined;
}
