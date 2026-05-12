/**
 * Pure aggregation: collapse sidecar probe results into per-domain rows
 * for the Self-Test panel.
 *
 * One sidecar self-test response can include multiple routes per domain
 * (e.g. firms-modis + firms-viirs both under "fire"). The panel wants
 * one row per domain showing the worst verdict + median latency + most
 * recent data age + last error.
 *
 * Kept pure so tests can pin the rollup rules without spinning the panel.
 */

import type { SidecarSelfTestResult, SidecarSelfTestVerdict } from './sidecar-self-test';

export interface DomainRow {
  domain: string;
  verdict: SidecarSelfTestVerdict;
  /** Median latency across the domain's probes (ms). */
  medianLatencyMs: number;
  /** Count of probes contributing to the row. */
  probeCount: number;
  /** Worst error string seen for the domain — useful in a triage table. */
  lastError?: string;
}

const VERDICT_RANK: Record<SidecarSelfTestVerdict, number> = {
  fail: 2,
  degraded: 1,
  ok: 0,
};

export function aggregateByDomain(
  results: readonly SidecarSelfTestResult[],
): DomainRow[] {
  const byDomain = new Map<string, SidecarSelfTestResult[]>();
  for (const r of results) {
    const arr = byDomain.get(r.domain) ?? [];
    arr.push(r);
    byDomain.set(r.domain, arr);
  }
  const rows: DomainRow[] = [];
  for (const [domain, list] of byDomain) {
    rows.push({
      domain,
      verdict: worstVerdict(list),
      medianLatencyMs: median(list.map((r) => r.latencyMs)),
      probeCount: list.length,
      lastError: lastErrorMessage(list),
    });
  }
  // Sort rows worst → best so the user's eye lands on real problems first;
  // alphabetical tiebreaker for stable display order.
  rows.sort((a, b) => (VERDICT_RANK[b.verdict] - VERDICT_RANK[a.verdict]) || a.domain.localeCompare(b.domain));
  return rows;
}

function worstVerdict(list: readonly SidecarSelfTestResult[]): SidecarSelfTestVerdict {
  let worst: SidecarSelfTestVerdict = 'ok';
  for (const r of list) {
    if (VERDICT_RANK[r.verdict] > VERDICT_RANK[worst]) worst = r.verdict;
  }
  return worst;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

function lastErrorMessage(list: readonly SidecarSelfTestResult[]): string | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i]?.error;
    if (e) return e;
  }
  return undefined;
}

/** Convenience: a single PASS/WARN/FAIL roll-up across every domain row. */
export type AggregateStatus = 'PASS' | 'WARN' | 'FAIL';

export function aggregateOverallStatus(rows: readonly DomainRow[]): AggregateStatus {
  let warn = false;
  for (const r of rows) {
    if (r.verdict === 'fail') return 'FAIL';
    if (r.verdict === 'degraded') warn = true;
  }
  return warn ? 'WARN' : 'PASS';
}
