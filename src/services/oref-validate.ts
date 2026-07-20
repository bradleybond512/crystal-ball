// Worker-free OREF types + response validation.
//
// Split out of oref-alerts.ts so unit tests can import the pure guard without
// pulling in oref-alerts.ts → '@/services/summarization' → '@/services/ml-worker',
// whose Vite-only `@/workers/ml.worker?worker` import aborts tsx/node:test at
// load time (the `?worker` query suffix has no `default` export under esbuild).
// oref-alerts.ts re-exports these so its public API is unchanged.

export interface OrefAlert {
  id: string;
  cat: string;
  title: string;
  data: string[];
  desc: string;
  alertDate: string;
}

export interface OrefAlertsResponse {
  configured: boolean;
  alerts: OrefAlert[];
  historyCount24h: number;
  totalHistoryCount?: number;
  timestamp: string;
  error?: string;
}

/** True when a parsed /api/oref-alerts payload has the expected shape. The cast
 *  in fetchOrefAlerts is compile-time only, so this guards against a malformed
 *  200 (alerts-less object / HTML) being cached + served as a fresh all-clear. */
export function isValidOrefAlertsResponse(data: unknown): data is OrefAlertsResponse {
  return !!data && typeof data === 'object' && Array.isArray((data as { alerts?: unknown }).alerts);
}
