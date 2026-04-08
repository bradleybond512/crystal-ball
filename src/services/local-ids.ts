import { getApiBaseUrl, isDesktopRuntime } from '@/services/runtime';
import type { LocalIDSAlert } from '@/types';

export async function fetchLocalIDSAlerts(): Promise<LocalIDSAlert[]> {
  if (!isDesktopRuntime()) return [];
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/local-ids`);
 if (!res.ok) return [];
 return (await res.json()) as LocalIDSAlert[];
  } catch {
 return [];
  }
}
