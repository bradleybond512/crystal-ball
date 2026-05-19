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

// ── Auto-registration ─────────────────────────────────────────────────

getMissionBridgeRegistry().register(new CVEKevBridge());
getMissionBridgeRegistry().register(new ThreatIntelBridge());
getMissionBridgeRegistry().register(new BreachIntelBridge());
getMissionBridgeRegistry().register(new InfraAttackBridge());
