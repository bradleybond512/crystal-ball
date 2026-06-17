/* eslint-disable sonarjs/use-type-alias -- pre-existing */
import { getApiBaseUrl } from '@/services/runtime';

export interface CommsHealthData {
  overall: 'normal' | 'warning' | 'critical';
  bgp: { hijacks: number; leaks: number; severity: 'normal' | 'warning' | 'critical' };
  ixp: { status: 'normal' | 'warning' | 'critical'; degraded: string[] };
  ddos: { l7: 'normal' | 'elevated' | 'critical'; l3: 'normal' | 'elevated' | 'critical'; cloudflareKeyMissing: boolean };
  cables: { degraded: string[]; normal: string[] };
  updatedAt: string;
}

export async function fetchCommsHealth(): Promise<CommsHealthData> {
  const res = await fetch(`${getApiBaseUrl()}/api/comms-health`);
  if (!res.ok) throw new Error(`comms-health: ${res.status}`);
  const data = await res.json() as CommsHealthData;
  if (!data || typeof data !== 'object' || !('overall' in data)) throw new Error('comms-health: malformed response');
  return data;
}
