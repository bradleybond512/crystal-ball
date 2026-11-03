import { validateNWSAlertSnapshot, MAX_NWS_SNAPSHOT_ALERTS } from './nws-alert-snapshot';
import type { NWSAlertSnapshot } from './nws-alert-snapshot';
import { validateAlertRetentionEvidence } from './alert-retention';

export interface NwsLifecycleMember {
  id: string;
  issuedAt: number;
  expiresAt: number;
}

export interface NwsLifecycleState {
  version: 1;
  observedAt: number;
  members: NwsLifecycleMember[];
}

export type NwsOperationalState = 'active' | 'inactive' | 'unverified';

const MAX_METADATA_BYTES = 2 * 1024 * 1024;

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= 0 && value <= 8_640_000_000_000_000;
}

export function validateNwsLifecycleState(value: unknown, now = Date.now()): NwsLifecycleState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  if (state.version !== 1 || !timestamp(state.observedAt) || state.observedAt > now
    || !Array.isArray(state.members) || state.members.length > MAX_NWS_SNAPSHOT_ALERTS) return null;
  const ids = new Set<string>();
  const members: NwsLifecycleMember[] = [];
  for (const value of state.members) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const member = value as Record<string, unknown>;
    if (typeof member.id !== 'string' || !member.id.startsWith('nws-')
      || member.id.length <= 4 || member.id.length > 1028 || ids.has(member.id)
      || !timestamp(member.issuedAt) || member.issuedAt > state.observedAt
      || !timestamp(member.expiresAt) || member.expiresAt <= member.issuedAt) return null;
    ids.add(member.id);
    members.push({ id: member.id, issuedAt: member.issuedAt, expiresAt: member.expiresAt });
  }
  members.sort((a, b) => {
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
  const result: NwsLifecycleState = { version: 1, observedAt: state.observedAt, members };
  return new TextEncoder().encode(JSON.stringify(result)).byteLength <= MAX_METADATA_BYTES ? result : null;
}

export function prepareNwsLifecycle(value: unknown, now = Date.now()): {
  snapshot: NWSAlertSnapshot; state: NwsLifecycleState;
} | null {
  const snapshot = validateNWSAlertSnapshot(value, now);
  if (!snapshot) return null;
  const state = validateNwsLifecycleState({
    version: 1, observedAt: snapshot.observedAt,
    members: snapshot.alerts.map(alert => ({
      id: `nws-${alert.id}`, issuedAt: Date.parse(alert.sent), expiresAt: Date.parse(alert.expires),
    })),
  }, now);
  return state ? { snapshot, state } : null;
}

export function nwsOperationalState(
  alert: { id: string; source: string; timestamp: number; retentionEvidence?: unknown },
  members: ReadonlyMap<string, NwsLifecycleMember> | null,
  now = Date.now(),
): NwsOperationalState {
  if (alert.source !== 'nws') return 'unverified';
  if (members) {
    const member = members.get(alert.id);
    return member?.issuedAt === alert.timestamp && member.expiresAt > now ? 'active' : 'inactive';
  }
  const evidence = validateAlertRetentionEvidence('nws', alert.retentionEvidence, now);
  return evidence?.kind === 'nws-expiry' && evidence.expiresAt <= now ? 'inactive' : 'unverified';
}
