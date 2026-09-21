 
/**
 * Compound alert bridge — wires the compound-threat-detector into the
 * unified alert store so multi-domain escalations surface as synthetic
 * alerts in Triage alongside regular per-source alerts.
 *
 * Runs detectCompoundThreats() every 5 minutes. Each compound alert
 * with score ≥50 gets ingested as a `correlation` alert with the
 * playbook title, recommendations in the body, and escalation-risk
 * mapped to severity.
 */

import { unifiedAlertStore, type AlertSeverity } from './unified-alerts';
import {
  detectCompoundThreats,
  updateDomainLevel,
  type ThreatDomain,
  type CompoundThreatAlert,
} from './compound-threat-detector';

const SCAN_MS = 5 * 60_000;
const SCORE_THRESHOLD = 50;

const RISK_TO_SEVERITY: Record<CompoundThreatAlert['escalationRisk'], AlertSeverity> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

const SOURCE_TO_DOMAIN: Record<string, ThreatDomain> = {
  cyber: 'cyber',
  'local-ids': 'cyber',
  oref: 'military',
  'breaking-news': 'military',
  'power-grid': 'infrastructure',
  'comms-health': 'infrastructure',
  earthquake: 'natural_disaster',
  tsunami: 'natural_disaster',
  volcano: 'natural_disaster',
  cyclone: 'natural_disaster',
  fire: 'natural_disaster',
  gdacs: 'natural_disaster',
  disease: 'health',
  radiation: 'health',
  'space-weather': 'infrastructure',
};

/** Compute per-domain threat levels from current alert store state. */
function refreshDomainLevels(): void {
  const now = Date.now();
  const window = 6 * 60 * 60_000;
  const alerts = unifiedAlertStore.getAll().filter(a =>
    !a.acknowledged && a.timestamp > now - window,
  );

  const sevScore: Record<string, number> = { critical: 90, high: 65, medium: 40, low: 15, info: 5 };
  const domainScores = new Map<ThreatDomain, { total: number; count: number; events: string[] }>();

  for (const a of alerts) {
    if (a.source === 'correlation') continue;
    const domain = SOURCE_TO_DOMAIN[a.source];
    if (!domain) continue;
    const cur = domainScores.get(domain) ?? { total: 0, count: 0, events: [] };
    cur.total += sevScore[a.severity] ?? 10;
    cur.count += 1;
    if (cur.events.length < 5) cur.events.push(a.title.slice(0, 60));
    domainScores.set(domain, cur);
  }

  for (const [domain, data] of domainScores) {
    const level = Math.min(100, Math.round(data.total / Math.max(1, data.count)));
    updateDomainLevel(domain, level, data.count, data.events);
  }
}

/** A compound absent for longer than this ends its episode; a recurrence gets a new alert. */
const EPISODE_GAP_MS = 3 * SCAN_MS;
const compoundEpisodes = new Map<string, { start: number; lastSeen: number }>();

/**
 * Stable alert id for one continuous episode of a compound threat.
 *
 * The previous id embedded a 5-minute time bucket, so a compound that
 * persisted for hours minted a new alert — and a new critical notification —
 * on every scan (measured: 47 "Cascading Infrastructure Failure" alerts in
 * 246 minutes). Reusing the episode's start time keeps one alert that updates
 * in place (ingest() preserves ack/pin state), while a compound that clears
 * for longer than EPISODE_GAP_MS and then recurs is surfaced as new rather
 * than silently inheriting an old acknowledgement.
 */
export function compoundEpisodeId(
  domainsKey: string,
  now: number,
  registry: Map<string, { start: number; lastSeen: number }> = compoundEpisodes,
  gapMs: number = EPISODE_GAP_MS,
): string {
  const prev = registry.get(domainsKey);
  const start = prev && now - prev.lastSeen <= gapMs ? prev.start : now;
  registry.set(domainsKey, { start, lastSeen: now });
  return `compound-${domainsKey}-${start}`;
}

function ingestCompoundAlerts(): void {
  refreshDomainLevels();
  const compounds = detectCompoundThreats();

  const synthetic = compounds
    .filter(c => c.overallScore >= SCORE_THRESHOLD)
    .map(c => {
      const sortedDomains = [...c.domains].sort((a, b) => a.localeCompare(b));
      const recLines = c.recommendations.map(r => `• ${r}`).join('\n');
      return {
        id: compoundEpisodeId(sortedDomains.join('-'), Date.now()),
        source: 'correlation' as const,
        severity: RISK_TO_SEVERITY[c.escalationRisk],
        title: c.title,
        body: `${c.description}\n\n${recLines}`,
        timestamp: c.detectedAt,
        relevanceScore: c.overallScore,
        acknowledged: false,
        pinned: false,
        correlationMembers: [] as string[],
      };
    });

  if (synthetic.length > 0) {
    unifiedAlertStore.ingest(synthetic);
  }
}

let started = false;
export function startCompoundAlertBridge(): void {
  if (started) return;
  started = true;
  window.setTimeout(ingestCompoundAlerts, 10_000);
  window.setInterval(ingestCompoundAlerts, SCAN_MS);
}
