/**
 * Enhanced-brief snapshot collector — bridges live singletons into the
 * pure renderer's input shape (EnhancedBriefingInput).
 *
 * This is the impure half of the enhanced-brief stack. It pulls from
 * the unified-alert store, the situation engine, the SWPC space-weather
 * monitor, the fire-intel service, and the feature-health registry.
 *
 * Per-section try/catches: a failure in one collector (e.g. economic
 * stress when /api/economic/stress isn't yet polled) degrades only that
 * section, not the whole report. Renderer accepts null/empty inputs and
 * shows "Data unavailable" placeholders.
 *
 * The collector is intentionally light on transformation logic — most
 * derivation (executive-summary fallback, threat-score sort, trend
 * arrows) lives in enhanced-brief-generator.ts where it's pure-testable.
 */

import { unifiedAlertStore } from '../unified-alerts';
import type { UnifiedAlert } from '../unified-alerts';
import { situationEngine } from '../situation-engine';
import { getCachedBriefing } from '../intelligence-briefing';
import { getFeatureHealthRegistry } from '../diagnostics/diagnostics-state';
import type { ThreatSeverity } from '../intelligence-briefing';
import { getApiBaseUrl } from '../runtime';
import {
  type AlertEntry,
  type EconomicIndicator,
  type EnhancedBriefingInput,
  type FeedHealthRow,
  type SpaceWeatherSnapshot,
  type ThreatMatrixCell,
  type WildfireRanked,
  computeFireThreatScore,
} from './enhanced-brief-generator';
import { mapHealthStatusToFeedStatus, topScenarioSeverity } from './enhanced-brief-mappers';


// ── Public API ───────────────────────────────────────────────────────

export interface CollectOptions {
  /** Optional override for the app version stamped in the footer. */
  appVersion?: string;
  /** Optional injection of `now` for deterministic tests. */
  now?: () => number;
  /** Optional override for the API base — tests inject ''/mock; the
   *  default reads from runtime.ts. */
  apiBaseUrl?: string;
}

export async function collectEnhancedBriefing(
  options: CollectOptions = {},
): Promise<EnhancedBriefingInput> {
  const now = options.now ?? Date.now;
  const appVersion = options.appVersion ?? readAppVersion();
  const apiBase = options.apiBaseUrl ?? getApiBaseUrl();

  // All collectors are independently try/catch'd — never let one section
  // sink the whole snapshot.
  const [executiveSummary, threatMatrix, activeAlerts, spaceWeather, topWildfires, economicIndicators, feedHealth] =
    await Promise.all([
      Promise.resolve().then(() => collectExecutiveSummary()),
      Promise.resolve().then(() => collectThreatMatrix()),
      Promise.resolve().then(() => collectActiveAlerts()),
      collectSpaceWeather(apiBase),
      Promise.resolve().then(() => collectTopWildfires()),
      collectEconomicIndicators(apiBase),
      Promise.resolve().then(() => collectFeedHealth()),
    ]);

  return {
    executiveSummary, threatMatrix, activeAlerts, spaceWeather,
    topWildfires, economicIndicators, feedHealth,
    dataCurrentAt: now(), appVersion,
  };
}

// ── Per-section collectors ───────────────────────────────────────────

function collectExecutiveSummary(): string | undefined {
  // Reuse the AI brief's executive-summary section when available so the
  // PDF doesn't paraphrase what the briefing panel already shows.
  try {
    const briefing = getCachedBriefing();
    if (!briefing) return undefined;
    const exec = briefing.sections.find((s) => s.type === 'executive-summary');
    const trimmed = exec?.content?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  } catch { return undefined; }
}

/** Build a domain × severity matrix from active situations.
 *  Per-domain we pick the worst-severity active situation. */
export function collectThreatMatrix(): ThreatMatrixCell[] {
  try {
    const sits = situationEngine.getSituations()
      .filter((s) => s.phase === 'active' || s.phase === 'developing');
    if (sits.length === 0) return [];
    // Group by domain, pick worst severity.
    const byDomain = new Map<string, { worstScore: number; severity: ThreatSeverity; count: number }>();
    for (const sit of sits) {
      const sev = topScenarioSeverity(sit.scenarios?.[0]?.severity as string | undefined);
      const score = severityScore(sev);
      const existing = byDomain.get(sit.domain);
      if (!existing || score > existing.worstScore) {
        byDomain.set(sit.domain, { worstScore: score, severity: sev, count: (existing?.count ?? 0) + 1 });
      } else {
        existing.count += 1;
      }
    }
    return [...byDomain.entries()].map(([domain, info]) => ({
      domain: prettyDomain(domain),
      severity: info.severity,
      label: `${info.count} active`,
    }));
  } catch { return []; }
}

// (topScenarioSeverity is re-exported from enhanced-brief-mappers above.)

const SEVERITY_SCORES: Record<ThreatSeverity, number> = {
  critical: 4, high: 3, medium: 2, low: 1, info: 0,
};
function severityScore(sev: ThreatSeverity): number { return SEVERITY_SCORES[sev]; }

function prettyDomain(domain: string): string {
  return domain.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Map UnifiedAlert → AlertEntry; cap at 25 critical/high alerts. */
export function collectActiveAlerts(): AlertEntry[] {
  try {
    const alerts: UnifiedAlert[] = unifiedAlertStore.getAll();
    const now = Date.now();
    const filtered = alerts
      .filter((a) => !a.acknowledged && (a.snoozedUntil ?? 0) <= now)
      .filter((a) => a.severity === 'critical' || a.severity === 'high');
    return filtered.slice(0, 25).map((a) => ({
      source: a.source.toUpperCase(),
      title: a.title,
      severity: alertSeverityToThreatSeverity(a.severity),
      location: a.location?.label,
    }));
  } catch { return []; }
}

function alertSeverityToThreatSeverity(s: UnifiedAlert['severity']): ThreatSeverity {
  switch (s) {
    case 'critical': { return 'critical';
    }
    case 'high': {     return 'high';
    }
    case 'medium': {   return 'medium';
    }
    case 'low': {      return 'low';
    }
    default: {         return 'info';
    }
  }
}

async function collectSpaceWeather(apiBaseUrl: string): Promise<SpaceWeatherSnapshot | null> {
  try {
    const r = await fetch(`${apiBaseUrl}/api/spaceweather/status`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const payload = (await r.json()) as Partial<{
      xrayPeakLabel: string; xrayPeakFlux: number;
      kp: number; auroraVisibilityLatN: number;
      earthwardCmes: { note?: string }[];
    }>;
    return {
      xrayPeakLabel: payload.xrayPeakLabel ?? '—',
      xrayPeakFlux: typeof payload.xrayPeakFlux === 'number' ? payload.xrayPeakFlux : null,
      kp: typeof payload.kp === 'number' ? payload.kp : null,
      auroraVisibilityLatN: typeof payload.auroraVisibilityLatN === 'number' ? payload.auroraVisibilityLatN : null,
      earthwardCmeCount: Array.isArray(payload.earthwardCmes) ? payload.earthwardCmes.length : 0,
      cmeNotes: Array.isArray(payload.earthwardCmes)
        ? payload.earthwardCmes.map((c) => c?.note).filter((n): n is string => typeof n === 'string')
        : undefined,
    };
  } catch { return null; }
}

/** Map RankedThreat → WildfireRanked via the renderer's pure scorer.
 *  The collector only reaches into the inciweb-shaped IncidentReport
 *  (acresBurned, percentContained); the renderer applies the
 *  acres × (1 − containment) scoring uniformly. */
export function collectTopWildfires(): WildfireRanked[] {
  try {
    interface InciLike {
      name: string; state: string;
      acresBurned: number | null; percentContained: number | null;
    }
    interface RankedLike { incident: InciLike; threatScore: number }
    const fireServiceModule = getFireServiceState();
    if (!fireServiceModule) return [];
    const rankedRaw = fireServiceModule as RankedLike[];
    return rankedRaw.map((r) => ({
      name: r.incident.name,
      state: r.incident.state || null,
      acres: r.incident.acresBurned,
      containmentPct: r.incident.percentContained,
      threatScore: r.threatScore || computeFireThreatScore(r.incident.acresBurned, r.incident.percentContained),
    }));
  } catch { return []; }
}

/** Read the current ranked-threats snapshot if the fire-intel service
 *  has cached one; otherwise return null. The snapshot is populated by
 *  the panel/data-loader; the collector never triggers a fetch. */
function getFireServiceState(): unknown {
  try {
    interface MaybeWithFireSnap { __fireIntelSnapshot?: { rankedThreats?: unknown[] } }
    const w = (globalThis as unknown as MaybeWithFireSnap);
    return Array.isArray(w.__fireIntelSnapshot?.rankedThreats) ? w.__fireIntelSnapshot!.rankedThreats : null;
  } catch { return null; }
}

async function collectEconomicIndicators(apiBaseUrl: string): Promise<EconomicIndicator[]> {
  try {
    const r = await fetch(`${apiBaseUrl}/api/economic/stress`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return [];
    interface StressPayload {
      indicators?: {
        id: string; label: string;
        latest?: { value?: number } | null;
        history?: { date?: string; value?: number }[];
        degraded?: boolean;
      }[];
    }
    const payload = (await r.json()) as StressPayload;
    if (!Array.isArray(payload.indicators)) return [];
    return payload.indicators
      .filter((ind) => !ind.degraded)
      .map((ind) => {
        const history = Array.isArray(ind.history) ? ind.history : [];
        const latest = typeof ind.latest?.value === 'number' ? ind.latest.value : null;
        // Baseline = oldest in window (which the route promises is ~30 days back).
        const baseline = history.length > 0 && typeof history[0]?.value === 'number'
          ? history[0].value : null;
        return { id: ind.id, label: ind.label, latestValue: latest, baselineValue: baseline };
      });
  } catch { return []; }
}

// (mapHealthStatusToFeedStatus is re-exported from enhanced-brief-mappers above.)

export function collectFeedHealth(now: number = Date.now()): FeedHealthRow[] {
  try {
    const registry = getFeatureHealthRegistry();
    const rows = registry.all();
    return rows.map((r) => ({
      feedId: r.featureId,
      label: r.label,
      status: mapHealthStatusToFeedStatus(r.status),
      ageSeconds: r.lastSuccessAt ? Math.max(0, Math.round((now - r.lastSuccessAt) / 1000)) : undefined,
    }));
  } catch { return []; }
}

function readAppVersion(): string {
  // Vite injects __APP_VERSION__ at build time; falls back to a generic
  // marker in dev/test where the constant isn't defined.
  try {
    const v = (globalThis as unknown as { __APP_VERSION__?: string }).__APP_VERSION__;
    return typeof v === 'string' && v.length > 0 ? v : 'dev';
  } catch { return 'dev'; }
}

export {mapHealthStatusToFeedStatus, topScenarioSeverity} from './enhanced-brief-mappers';