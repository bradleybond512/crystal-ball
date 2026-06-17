import { getApiBaseUrl } from './runtime';
import { dataFreshness } from './data-freshness';

export interface DodContract {
  id: string;
  recipient: string;
  amount: number;
  subAgency: string;
  description: string;
  startDate: string | null;
  state: string | null;
}

export interface DodContractsSnapshot {
  awards: DodContract[];
  totalAmount: number;
  periodStart: string;
  periodEnd: string;
  fetchedAt: number;
}

const CLIENT_CACHE_TTL = 30 * 60 * 1000; // 30 min — sidecar already caches 1h

let _cache: { snap: DodContractsSnapshot; ts: number } | null = null;

export async function fetchDodContracts(opts: { days?: number; limit?: number } = {}): Promise<DodContractsSnapshot> {
  const now = Date.now();
  if (_cache && now - _cache.ts < CLIENT_CACHE_TTL) return _cache.snap;

  const days = Math.max(1, Math.min(90, opts.days ?? 7));
  const limit = Math.max(1, Math.min(50, opts.limit ?? 20));
  try {
 const res = await fetch(`${getApiBaseUrl()}/api/dod-contracts?days=${days}&limit=${limit}`);
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const data = await res.json() as DodContractsSnapshot;
 if (!data || typeof data !== 'object' || !Array.isArray(data.awards)) throw new Error('dod-contracts: malformed response');
 _cache = { snap: data, ts: now };
 if (data.awards.length > 0) dataFreshness.recordUpdate('dod-contracts', data.awards.length);
 return data;
  } catch (error) {
 dataFreshness.recordError('dod-contracts', error instanceof Error ? error.message : 'fetch failed');
 return { awards: [], totalAmount: 0, periodStart: '', periodEnd: '', fetchedAt: now };
  }
}

export function formatAmount(amount: number): string {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}
