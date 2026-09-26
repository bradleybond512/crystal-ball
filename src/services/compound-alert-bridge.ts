 
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

import { unifiedAlertStore, type AlertSeverity, type UnifiedAlert } from './unified-alerts';
import {
  detectCompoundThreats,
  updateDomainLevel,
  type ThreatDomain,
  type CompoundThreatAlert,
} from './compound-threat-detector';

import { createIdentityLedger, hydrateIdentityLedger, identifyAlert, type IdentityLedger, type IdentityLimits } from './alert-identity';

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
function refreshDomainLevels(): UnifiedAlert[] {
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
  return alerts.filter(a => a.source !== 'correlation');
}

interface CompoundEpisode {
  id: string;
  family: string;
  memberKeys: string[];
  memberIds: string[];
  startedAt: number;
}

function validEpisode(value: unknown): value is CompoundEpisode {
  if (!value || typeof value !== 'object') return false;
  const e = value as CompoundEpisode;
  return typeof e.id === 'string' && e.id.startsWith('compound-') && typeof e.family === 'string'
    && Number.isSafeInteger(e.startedAt) && e.startedAt >= 0
    && Array.isArray(e.memberKeys) && e.memberKeys.length > 0 && e.memberKeys.every(k => typeof k === 'string' && k.length > 0)
    && Array.isArray(e.memberIds) && e.memberIds.length > 0 && e.memberIds.every(k => typeof k === 'string' && k.length > 0);
}

export class CompoundEpisodeRegistry {
  private ledger: IdentityLedger<CompoundEpisode>;
  private sequence = 0;
  private persistenceFailures = 0;
  private admissionFailures = 0;

  constructor(limits?: IdentityLimits) {
    this.ledger = createIdentityLedger(validEpisode, limits);
    try {
      const raw = localStorage.getItem('wm-compound-episodes-v1');
      if (raw) this.ledger = hydrateIdentityLedger(JSON.parse(raw), Date.now(), validEpisode, limits, () => {
        this.persistenceFailures++;
      });
    } catch { this.persistenceFailures++; }
  }

  consider(family: string, members: readonly UnifiedAlert[], now = Date.now()): CompoundEpisode | null {
    this.ledger.expire(now);
    const identities = members.map(a => a.source === 'correlation' ? null : identifyAlert(a));
    if (!family || family.length > 256 || identities.length === 0 || identities.some(i => !i)) {
      this.admissionFailures++;
      return null;
    }
    const incomingKeys = [...new Set(identities.flatMap(i => i ? [i.key] : []))].sort((a, b) => a.localeCompare(b));
    const entries = this.ledger.snapshot().entries;
    const matching = entries.filter(e => e.value.family === family && e.value.memberKeys.some(k => incomingKeys.includes(k)))
      .sort((a, b) => a.firstReceivedAt - b.firstReceivedAt || a.key.localeCompare(b.key))[0];
    const memberKeys = [...new Set([...(matching?.value.memberKeys ?? []), ...incomingKeys])].sort((a, b) => a.localeCompare(b));
    const memberIds = [...new Set([...(matching?.value.memberIds ?? []), ...members.map(a => a.id)])].sort((a, b) => a.localeCompare(b));
    const key = matching?.key ?? JSON.stringify(['compound', family, incomingKeys]);
    let id = matching?.value.id;
    if (!id) {
      do { id = `compound-${now}-${++this.sequence}`; } while (entries.some(e => e.value.id === id));
    }
    const episode = { id, family, memberKeys, memberIds, startedAt: matching?.value.startedAt ?? now };
    const eventTime = Math.max(...identities.flatMap(i => i ? [i.eventTime] : []));
    const result = this.ledger.admit({ key, revision: JSON.stringify(memberKeys), eventTime }, episode, now);
    if (result === 'invalid' || result === 'capacity') {
      this.admissionFailures++;
      return matching?.value ?? null;
    }
    if (result === 'accepted') this.persist();
    return result === 'duplicate' && matching ? matching.value : episode;
  }

  diagnostics(): { size: number; byteLength: number; admissionFailures: number; persistenceFailures: number } {
    return { size: this.ledger.size, byteLength: this.ledger.byteLength,
      admissionFailures: this.admissionFailures, persistenceFailures: this.persistenceFailures };
  }

  private persist(): void {
    try {
      const encoded = JSON.stringify(this.ledger.snapshot());
      localStorage.setItem('wm-compound-episodes-v1', encoded);
      if (localStorage.getItem('wm-compound-episodes-v1') !== encoded) throw new Error('Compound episode persistence failed');
    } catch { this.persistenceFailures++; }
  }
}

const compoundEpisodes = new CompoundEpisodeRegistry();

function ingestCompoundAlerts(): void {
  const sourceAlerts = refreshDomainLevels();
  const synthetic: UnifiedAlert[] = [];
  for (const compound of detectCompoundThreats()) {
    if (compound.overallScore < SCORE_THRESHOLD) continue;
    const sortedDomains = [...compound.domains].sort((a, b) => a.localeCompare(b));
    const members = sourceAlerts.filter(a => {
      const domain = SOURCE_TO_DOMAIN[a.source];
      return domain !== undefined && compound.domains.includes(domain);
    });
    if (!compound.domains.every(d => members.some(a => SOURCE_TO_DOMAIN[a.source] === d))) continue;
    const episode = compoundEpisodes.consider(sortedDomains.join('-'), members);
    if (!episode) continue;
    const recLines = compound.recommendations.map(r => `• ${r}`).join('\n');
    synthetic.push({
      id: episode.id, source: 'correlation', severity: RISK_TO_SEVERITY[compound.escalationRisk],
      title: compound.title, body: `${compound.description}\n\n${recLines}`, timestamp: episode.startedAt,
      relevanceScore: compound.overallScore, acknowledged: false, pinned: false,
      correlationMembers: episode.memberIds,
    });
  }
  if (synthetic.length > 0) unifiedAlertStore.ingest(synthetic);
}

let started = false;
export function startCompoundAlertBridge(): void {
  if (started) return;
  started = true;
  window.setTimeout(ingestCompoundAlerts, 10_000);
  window.setInterval(ingestCompoundAlerts, SCAN_MS);
}
