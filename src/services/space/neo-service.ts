/**
 * NEO service — thin renderer-side fetch over the sidecar `/api/space/neo`
 * route. Pure parsing/classification lives in neo-normalize.ts.
 */

import { getApiBaseUrl } from '../runtime';
import type { CloseApproach, ImpactRiskObject } from './neo-normalize';

export interface NeoSnapshot {
  closeApproaches: CloseApproach[];
  impactRisks: ImpactRiskObject[];
  closeApproachCount: number;
  impactRiskCount: number;
  degraded: boolean;
  reason?: string;
  source: string;
  generatedAt: string;
}

export async function fetchNeoSnapshot(signal?: AbortSignal): Promise<NeoSnapshot> {
  const res = await fetch(`${getApiBaseUrl()}/api/space/neo`, { signal });
  if (!res.ok) throw new Error(`neo HTTP ${res.status}`);
  return (await res.json()) as NeoSnapshot;
}
