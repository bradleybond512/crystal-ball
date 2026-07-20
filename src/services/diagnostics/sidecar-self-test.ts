/**
 * Renderer-side wrapper for the sidecar fan-out probe at
 * `/api/diagnostics/self-test`. Keeps the result types in one place
 * (panel + tests both import them) and provides a deterministic
 * verdict-color helper.
 */

import { getApiBaseUrl } from '@/services/runtime';

export type SidecarSelfTestVerdict = 'ok' | 'degraded' | 'fail';

export interface SidecarSelfTestResult {
  route: string;
  domain: string;
  ok: boolean;
  verdict: SidecarSelfTestVerdict;
  /** HTTP status code returned by the probe; 0 when the request never
   *  reached the server (network error / timeout). */
  status: number;
  latencyMs: number;
  error?: string | null;
}

export interface SidecarSelfTestSummary {
  total: number;
  ok: number;
  degraded: number;
  fail: number;
}

export interface SidecarSelfTestResponse {
  results: SidecarSelfTestResult[];
  summary: SidecarSelfTestSummary;
  asOf: string;
  error?: string;
}

export const VERDICT_BADGE: Record<SidecarSelfTestVerdict, { icon: string; color: string; label: string }> = {
  ok:       { icon: '✓', color: '#4caf50', label: 'PASS' },
  degraded: { icon: '⚠', color: '#ff9800', label: 'DEGRADED' },
  fail:     { icon: '✗', color: '#ff453a', label: 'FAIL' },
};

export async function fetchSidecarSelfTest(): Promise<SidecarSelfTestResponse> {
  const url = `${getApiBaseUrl()}/api/diagnostics/self-test`;
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) {
      return {
        results: [], asOf: new Date().toISOString(),
        summary: { total: 0, ok: 0, degraded: 0, fail: 0 },
        error: `HTTP ${resp.status}`,
      };
    }
    const body = (await resp.json()) as SidecarSelfTestResponse;
    return body;
  } catch (error) {
    return {
      results: [], asOf: new Date().toISOString(),
      summary: { total: 0, ok: 0, degraded: 0, fail: 0 },
      error: String((error as Error).message ?? error),
    };
  }
}

export function formatLatency(latencyMs: number): string {
  if (!Number.isFinite(latencyMs)) return '—';
  if (latencyMs < 1000) return `${Math.round(latencyMs)} ms`;
  return `${(latencyMs / 1000).toFixed(2)} s`;
}

export function overallVerdict(summary: SidecarSelfTestSummary): SidecarSelfTestVerdict {
  if (summary.fail > 0) return 'fail';
  if (summary.degraded > 0) return 'degraded';
  return 'ok';
}
