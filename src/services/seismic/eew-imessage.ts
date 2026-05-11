/**
 * EEW TIER_5 iMessage escalation — Layer 8.
 *
 * Bridges the alert engine (Layer 7) to the existing
 * `imessage-bridge.sendImessage` so a TIER_5_EXTREME alert pushes a
 * native iMessage to the user's configured recipient.
 *
 * Plan invariants:
 *   - On send failure, mark status `failed` + record the error. **Do
 *     not retry.** A wedged Messages.app shouldn't generate spam.
 *   - When the iMessage toggle is off, status is `disabled` and the
 *     bridge is **not** called.
 *   - When the recipient is empty, status is `disabled` (no recipient
 *     configured is functionally the same as feature off).
 *   - The body is short (<=160 chars) so iMessage doesn't fragment.
 */

import { getImessageSettings, sendImessage } from '../imessage-bridge';
import type { EewAlert } from './eew-alert-engine';

export type EewImessageOutcome =
  | { status: 'sent' }
  | { status: 'disabled'; reason: 'feature_off' | 'no_recipient' }
  | { status: 'failed'; error: string };

export interface EewImessageDeps {
  /** Inject for tests; defaults to the real bridge. */
  send?: (recipient: string, body: string) => Promise<{ ok: boolean; reason?: string }>;
  /** Inject for tests; defaults to the real settings store. */
  getSettings?: () => { recipient: string };
  /** Master toggle from runtime-config. When false, never call the
   *  bridge regardless of saved settings. */
  enabled: boolean;
}

const MAX_BODY_LEN = 160;

export function buildBody(alert: EewAlert, nowMs: number): string {
  const ts = new Date(nowMs).toISOString();
  // Compact format: "TIER_5 EEW: M7.2 within 500km of Home — 2026-05-05T22:30:00Z"
  const body = `TIER_5 EEW: ${alert.reason} - ${ts}`;
  if (body.length <= MAX_BODY_LEN) return body;
  return `${body.slice(0, MAX_BODY_LEN - 1)}…`;
}

/**
 * Try to send an iMessage for the given TIER_5 alert. Always resolves —
 * never throws. The outcome should be merged into the alert's
 * `imessageStatus` / `imessageError` and persisted via the ledger.
 */
export async function escalateTier5ToImessage(
  alert: EewAlert,
  nowMs: number,
  deps: EewImessageDeps,
): Promise<EewImessageOutcome> {
  if (alert.tier !== 'TIER_5_EXTREME') {
    // Should only be called for TIER_5; treat anything else as feature_off
    // so the caller doesn't accidentally page the user on lower tiers.
    return { status: 'disabled', reason: 'feature_off' };
  }
  if (!deps.enabled) {
    return { status: 'disabled', reason: 'feature_off' };
  }

  const settings = (deps.getSettings ?? getImessageSettings)();
  const recipient = settings.recipient.trim();
  if (recipient.length === 0) {
    return { status: 'disabled', reason: 'no_recipient' };
  }

  const send = deps.send ?? sendImessage;
  const body = buildBody(alert, nowMs);

  try {
    const result = await send(recipient, body);
    if (result.ok) return { status: 'sent' };
    return { status: 'failed', error: result.reason ?? 'unknown error' };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Apply an `EewImessageOutcome` to an alert, returning a new alert
 *  (immutable). */
export function applyOutcome(alert: EewAlert, outcome: EewImessageOutcome): EewAlert {
  if (outcome.status === 'sent') {
    return { ...alert, imessageStatus: 'sent', imessageError: undefined };
  }
  if (outcome.status === 'failed') {
    return { ...alert, imessageStatus: 'failed', imessageError: outcome.error };
  }
  return { ...alert, imessageStatus: 'disabled', imessageError: undefined };
}
