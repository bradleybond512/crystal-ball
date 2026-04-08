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
  return res.json() as Promise<CommsHealthData>;
}
