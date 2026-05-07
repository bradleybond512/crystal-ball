/**
 * Live MITRE ATT&CK ingestion → AptGroup[] for apt-tracker.
 *
 * Fetches the slimmed STIX bundle from `/api/attack/groups` and runs
 * apt-tracker's existing pure parser over it. The route does the slimming
 * so we don't transfer 30 MB of unused techniques/software/relationships;
 * the parser stays in TS so any contract change shows up at typecheck.
 */

import { type AptGroup, parseAttackBundle } from './apt-tracker';

export interface AttackGroupsResponse {
  bundle: unknown;
  updatedAt: number;
  source: string;
  groupsCount: number;
  degraded?: boolean;
  reason?: string;
  staleAfterError?: string;
}

export async function fetchAttackBundle(apiBaseUrl: string): Promise<AttackGroupsResponse> {
  const url = `${apiBaseUrl}/api/attack/groups`;
  const r = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(70_000),     // first-cold fetch can take 10–30s
  });
  if (!r.ok) throw new Error(`/api/attack/groups HTTP ${r.status}`);
  return (await r.json()) as AttackGroupsResponse;
}

/** Fetch + parse in one call. Returns the AptGroup[] directly so the
 *  apt-tracker can use it as the ground-truth group catalog for OTX
 *  pulse matching, CISA advisory cross-referencing, etc. */
export async function refreshAttackGroups(
  apiBaseUrl: string,
): Promise<{ groups: AptGroup[]; response: AttackGroupsResponse }> {
  const response = await fetchAttackBundle(apiBaseUrl);
  const groups = parseAttackBundle(response.bundle);
  return { groups, response };
}
