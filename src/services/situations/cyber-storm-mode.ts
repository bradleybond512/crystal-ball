/* eslint-disable unicorn/no-nested-ternary, sonarjs/no-nested-conditional */
/**
 * Cyber Storm Mode payload — Phase 4 of
 * docs/CLAUDE_HIGH_IMPACT_EVENT_INTELLIGENCE_VISION_2026-04-29.md.
 *
 * Pure deterministic. Takes a cyber Situation that has reached a
 * threshold (severity ≥ critical OR userExposure ≥ 0.85) and produces
 * a focused mode payload mirroring Personal Storm Mode. The host UI
 * can render this as a full-screen takeover when active.
 */

import type { Situation } from './situation-types';

// ── Public API ──────────────────────────────────────────────────────────

export interface CyberStormModePayload {
  active: boolean;
  /** Title for the mode banner. */
  threatTitle: string;
  /** Affected systems / vendors / sectors the user owns. */
  affectedSystems: readonly string[];
  /** Why the user is exposed (one line). */
  userExposureReason: string;
  /** When the user should act by (ms timestamp), or undefined for ASAP. */
  actionDeadlineMs?: number;
  /** Patch / mitigation status when known. */
  patchStatus: 'available' | 'in_progress' | 'no_patch_yet' | 'unknown';
  /** Phishing / scam risk that often follows major cyber events. */
  phishingScamRisk: 'low' | 'medium' | 'high';
  /** Signals to watch next (deduped from the situation). */
  watchNext: readonly string[];
  /** Source confirmation summary. */
  sourceConfirmation: string;
  /** Concrete user action. */
  primaryAction: string;
}

export interface ActivationOptions {
  /** Override the activation threshold; defaults to the doc-spec
   *  (critical+ OR exposure ≥ 0.85). */
  forceActive?: boolean;
}

/** Build a CyberStormMode payload from a Situation. Returns inactive
 *  payload when the threshold isn't met (active=false, fields populated
 *  for inspection but UI should hide). */
export function buildCyberStormMode(
  situation: Situation,
  options: ActivationOptions = {},
): CyberStormModePayload {
  if (situation.domain !== 'cyber') {
    return inactivePayload(situation, 'Not a cyber situation');
  }

  const meetsThreshold =
    options.forceActive === true ||
    situation.severity === 'critical' ||
    situation.severity === 'emergency' ||
    situation.userExposure >= 0.85;

  if (!meetsThreshold) {
    return inactivePayload(situation, 'Below storm-mode activation threshold');
  }

  const exposureReasons = situation.personalImpact.reasons.join('; ');
  // Patch status — derive from threshold flags. Phase 4+ wires
  // CISA / vendor advisory metadata directly into the situation,
  // but for now we can reason from the diagnostics trace.
  const thresholds = situation.diagnosticsTrace.thresholdsCrossed;
  const isUserVendorMatch = thresholds.includes('user_vendor_match');
  const isCriticalInfra = thresholds.includes('critical_infra');
  const lastStage = thresholds.find((t) => t.startsWith('stage:'))?.split(':')[1] ?? '';

  const patchStatus: CyberStormModePayload['patchStatus'] =
    lastStage === 'kev_listed' || lastStage === 'sector_targeted'
      ? 'available'
      : lastStage === 'ransomware_in_use'
      ? 'in_progress'
      : lastStage === 'cve_published' || lastStage === 'exploit_observed'
      ? 'no_patch_yet'
      : 'unknown';

  // Phishing risk rises during major events and when critical infra
  // is hit (think: fake "CrowdStrike outage rescue" emails).
  const phishingScamRisk: CyberStormModePayload['phishingScamRisk'] = isCriticalInfra
    ? 'high'
    : isUserVendorMatch
    ? 'medium'
    : 'low';

  const primaryAction = isUserVendorMatch
    ? `Patch your affected system(s) today.${patchStatus === 'no_patch_yet' ? ' (No vendor patch yet — apply mitigations.)' : ''}`
    : `Monitor your accounts and watch for ${phishingScamRisk}-risk phishing campaigns.`;

  return {
    active: true,
    threatTitle: situation.title,
    affectedSystems: extractAffectedSystems(situation),
    userExposureReason: exposureReasons || 'Critical-infrastructure threat that may affect services you depend on',
    patchStatus,
    phishingScamRisk,
    watchNext: situation.expectedNextSignals.map((s) => s.description).slice(0, 4),
    sourceConfirmation: composeSourceConfirmation(situation),
    primaryAction,
  };
}

// ── Internals ───────────────────────────────────────────────────────────

function inactivePayload(situation: Situation, reason: string): CyberStormModePayload {
  return {
    active: false,
    threatTitle: situation.title,
    affectedSystems: [],
    userExposureReason: reason,
    patchStatus: 'unknown',
    phishingScamRisk: 'low',
    watchNext: [],
    sourceConfirmation: composeSourceConfirmation(situation),
    primaryAction: 'No action required.',
  };
}

function extractAffectedSystems(situation: Situation): string[] {
  // Try to pull from evidence claims (the cyber adapter writes
  // 'CVE → vendor' style claims). Fall back to the title if empty.
  const fromEvidence = situation.evidence
    .map((e) => e.claim)
    .filter((c) => /macOS|iOS|Windows|Linux|Android|Chrome|Safari|Firefox|kernel/i.test(c))
    .slice(0, 3);
  if (fromEvidence.length > 0) return fromEvidence;
  return [situation.title];
}

function composeSourceConfirmation(situation: Situation): string {
  const { agreeing, disagreeing, independentSourceCount } = situation.sourceAgreement;
  if (agreeing.length === 0) return 'No corroborating sources yet';
  const dis = disagreeing.length > 0 ? ` (${disagreeing.length} disputing)` : '';
  return `${independentSourceCount} independent source(s): ${agreeing.slice(0, 3).join(', ')}${dis}`;
}
