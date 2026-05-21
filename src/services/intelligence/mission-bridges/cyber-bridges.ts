/**
 * Cyber domain mission bridges.
 *
 * Normalizes CVE/KEV vulnerability events, threat-intelligence indicators
 * (ThreatFox / OTX / URLScan), and breach notifications (HIBP) into
 * NormalizedFeedEvent shape. All four bridges self-register with
 * MissionBridgeRegistry at module load.
 */

import {
  MissionBridgeBase,
  getMissionBridgeRegistry,
  type FeedSeverity,
  type NormalizedFeedEvent,
} from './mission-bridge-core';

// ── CVE / CISA KEV Bridge ─────────────────────────────────────────────

const KEV_BASE_SEVERITY = 3; // KEV entries are known-exploited — always ≥ 3

function cvssToSeverity(score: number): FeedSeverity {
  if (score >= 9) return 4;
  if (score >= 7) return 3;
  if (score >= 4) return 2;
  if (score > 0) return 1;
  return 0;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

export class CVEKevBridge extends MissionBridgeBase {
  readonly domain = 'cyber';
  readonly feedId  = 'cisa-kev';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const cvssScore = num(raw.cvssScore, 0);
    const baseFromCvss = cvssToSeverity(cvssScore);
    // KEV entries are actively exploited — floor at 3
    const severity: FeedSeverity = Math.max(baseFromCvss, KEV_BASE_SEVERITY) as FeedSeverity;
    const description = str(raw.description) || `${id}: ${str(raw.vulnerabilityName) || 'unknown vulnerability'}`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Threat Intelligence Bridge (ThreatFox / OTX / URLScan) ───────────

const THREAT_TYPE_SEVERITY: Record<string, FeedSeverity> = {
  c2_server:       4,
  ransomware:      4,
  apt:             4,
  botnet:          3,
  phishing:        2,
  malware_url:     2,
  suspicious:      1,
};

export class ThreatIntelBridge extends MissionBridgeBase {
  readonly domain = 'cyber';
  readonly feedId  = 'threat-intel';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const threatType = str(raw.threatType).toLowerCase();
    const severity: FeedSeverity = THREAT_TYPE_SEVERITY[threatType] ?? 1;
    const ioc = str(raw.ioc) || str(raw.indicator);
    const description = str(raw.description) || `${threatType || 'threat'}: ${ioc || id}`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Breach Intelligence Bridge (HIBP / dark-web leak) ─────────────────

const BREACH_CLASS_SEVERITY: Record<string, FeedSeverity> = {
  credentials: 4,
  financial:   4,
  health:      3,
  personal_pii: 3,
  email:       2,
  general:     1,
};

export class BreachIntelBridge extends MissionBridgeBase {
  readonly domain = 'cyber';
  readonly feedId  = 'breach-intel';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const breachClass = str(raw.breachClass).toLowerCase();
    const recordCount = num(raw.recordCount, 0);
    let severity: FeedSeverity = BREACH_CLASS_SEVERITY[breachClass] ?? 1;
    // Scale up for massive breaches (> 1M records)
    if (recordCount > 1_000_000 && severity < 4) {
      severity = (severity + 1) as FeedSeverity;
    }
    const description = str(raw.description) || `Breach: ${str(raw.title) || id} (${breachClass || 'unknown class'})`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Infrastructure Attack Bridge (DDoS / ransomware incident) ─────────

const ATTACK_TYPE_SEVERITY: Record<string, FeedSeverity> = {
  ransomware_incident:   4,
  data_exfiltration:     4,
  ddos_critical:         3,
  unauthorized_access:   3,
  ddos_moderate:         2,
  scanning:              1,
};

export class InfraAttackBridge extends MissionBridgeBase {
  readonly domain = 'cyber';
  readonly feedId  = 'infra-attacks';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const attackType = str(raw.attackType).toLowerCase().replace(/\s+/g, '_');
    const severity: FeedSeverity = ATTACK_TYPE_SEVERITY[attackType] ?? 1;
    const target = str(raw.target) || 'unknown target';
    const description = str(raw.description) || `${attackType || 'attack'} against ${target}`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Cyber-Attack Mission Bridge ────────────────────────────────────────
// Active attack-in-progress events (DDoS, intrusion attempt, exploitation).
// Distinct from InfraAttackBridge: this one focuses on the *stage* of the
// attack (confirmed impact / in-progress / attempted / probe) rather than
// the asset class targeted. Used when we have stage telemetry from EDR /
// SOC tooling but not necessarily an asset taxonomy.

const ATTACK_STAGE_SEVERITY: Record<string, FeedSeverity> = {
  confirmed_impact:   4,
  exfiltration:       4,
  active_exploit:     4,
  in_progress:        3,
  intrusion:          3,
  attempted:          2,
  probe:              1,
  reconnaissance:     1,
};

const KILL_CHAIN_SEVERITY: Record<string, FeedSeverity> = {
  // Lockheed Martin Cyber Kill Chain stages, mapped to severity.
  actions_on_objectives: 4,
  command_and_control:   4,
  exploitation:          4,
  installation:          3,
  delivery:              3,
  weaponization:         2,
  reconnaissance:        1,
};

export class CyberAttackMissionBridge extends MissionBridgeBase {
  readonly domain = 'cyber';
  readonly feedId  = 'cyber-attack';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const stage = str(raw.stage).toLowerCase().replace(/\s+/g, '_');
    const killChain = str(raw.killChain).toLowerCase().replace(/\s+/g, '_');
    const stageSeverity = ATTACK_STAGE_SEVERITY[stage];
    const chainSeverity = KILL_CHAIN_SEVERITY[killChain];
    // Take the higher of the two signals when both are present — a
    // 'reconnaissance' stage label paired with a kill-chain reading of
    // 'exploitation' should escalate.
    const severity: FeedSeverity = Math.max(
      stageSeverity ?? 0,
      chainSeverity ?? 0,
    ) as FeedSeverity || 1;
    const actor = str(raw.actor) || 'unknown actor';
    const target = str(raw.target) || 'unknown target';
    const description = str(raw.description)
      || `${stage || 'attack'} (${actor} → ${target})`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Data Breach Mission Bridge ─────────────────────────────────────────
// Disclosed breaches with structured severity by data class + record count.
// Distinct from BreachIntelBridge (which is HIBP/dark-web focused): this
// bridge handles official disclosures (regulator, vendor, customer
// notification) where we have a clean record-count + data-class pair.

const BREACH_DATA_CLASS_SEVERITY: Record<string, FeedSeverity> = {
  financial:    4,
  health:       4,
  credentials:  3,
  pii:          3,
  email:        2,
  metadata:     1,
};

export class DataBreachMissionBridge extends MissionBridgeBase {
  readonly domain = 'cyber';
  readonly feedId  = 'data-breach';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const dataClass = str(raw.dataClass).toLowerCase();
    const recordCount = num(raw.recordCount, 0);
    const baseSeverity: FeedSeverity = BREACH_DATA_CLASS_SEVERITY[dataClass] ?? 1;

    // Volume escalation, capped at 4. Bucketed coarsely so we never
    // escalate one notch for a 1-record increment near a boundary.
    // (< 1M records leaves the baseline class severity untouched.)
    let volumeBoost = 0;
    if (recordCount >= 10_000_000) volumeBoost = 2;
    else if (recordCount >= 1_000_000) volumeBoost = 1;

    const severity: FeedSeverity = Math.min(4, baseSeverity + volumeBoost) as FeedSeverity;
    const organization = str(raw.organization) || 'undisclosed org';
    const description = str(raw.description)
      || `Breach: ${organization} (${dataClass || 'unknown'}, ${recordCount.toLocaleString()} records)`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Infrastructure-Compromise Mission Bridge ───────────────────────────
// Confirmed compromise of critical infrastructure (utilities, transit,
// healthcare, finance). Severity reflects *impact* on the asset, not the
// attack stage. The InfraAttackBridge focuses on the attack type (ddos /
// ransomware / etc); this bridge focuses on the post-attack state.

const COMPROMISE_IMPACT_SEVERITY: Record<string, FeedSeverity> = {
  outage:              4,
  service_disruption:  3,
  degraded:            3,
  data_loss:           3,
  contained:           2,
  suspicious_activity: 2,
  scanning:            1,
  none:                0,
};

const SECTOR_CRITICALITY: Record<string, number> = {
  // Hardening floor: critical sectors never drop below severity 2 once
  // a confirmed compromise has occurred. The number is the *floor* the
  // sector imposes on the impact-derived severity.
  power_grid: 3,
  utilities:  3,
  hospital:   3,
  healthcare: 3,
  transit:    2,
  finance:    2,
  telecom:    2,
};

export class InfrastructureCompromiseMissionBridge extends MissionBridgeBase {
  readonly domain = 'cyber';
  readonly feedId  = 'infra-compromise';

  normalize(raw: Record<string, unknown>): NormalizedFeedEvent | null {
    const id = str(raw.id);
    if (id.length === 0) return null;

    const impact = str(raw.impact).toLowerCase().replace(/\s+/g, '_');
    const sector = str(raw.sector).toLowerCase().replace(/\s+/g, '_');
    const impactSeverity: FeedSeverity = COMPROMISE_IMPACT_SEVERITY[impact] ?? 1;
    const sectorFloor = SECTOR_CRITICALITY[sector] ?? 0;
    const severity: FeedSeverity = Math.max(impactSeverity, sectorFloor) as FeedSeverity;
    const operator = str(raw.operator) || 'undisclosed operator';
    const description = str(raw.description)
      || `${sector || 'infra'} compromise: ${operator} (${impact || 'impact unknown'})`;
    const timestamp = num(raw.timestamp, Date.now());
    return { id, severity, description, timestamp, raw };
  }
}

// ── Auto-registration ─────────────────────────────────────────────────

getMissionBridgeRegistry().register(new CVEKevBridge());
getMissionBridgeRegistry().register(new ThreatIntelBridge());
getMissionBridgeRegistry().register(new BreachIntelBridge());
getMissionBridgeRegistry().register(new InfraAttackBridge());
getMissionBridgeRegistry().register(new CyberAttackMissionBridge());
getMissionBridgeRegistry().register(new DataBreachMissionBridge());
getMissionBridgeRegistry().register(new InfrastructureCompromiseMissionBridge());
