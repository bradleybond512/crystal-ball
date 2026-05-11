/**
 * Vulners-style trending CVE service.
 *
 * Pulls "recently modified" CVEs from NVD and cross-references them with
 * the FIRST.org Exploit Prediction Scoring System (EPSS) — a free,
 * no-key API that returns the modeled probability a CVE will be
 * exploited in the wild over the next 30 days.
 *
 *   EPSS > 0.5  → 🔴 Critical exploit risk
 *   EPSS 0.1–0.5 → 🟠 Elevated exploit risk
 *   EPSS < 0.1  → 🟡 Low exploit risk
 *   no EPSS data → ⚪ Unknown
 *
 * No DOM, no globals. Helpers are deterministic for fixture tests.
 */

import { getApiBaseUrl } from '@/services/runtime';
import {
  parseNvdResponse,
  type CveRecord,
} from './cve-service';

export type EpssTier = 'critical' | 'elevated' | 'low' | 'unknown';

export interface EpssScore {
  /** CVE id, e.g. CVE-2026-12345. */
  cve: string;
  /** Probability of exploitation (0–1). */
  epss: number;
  /** Percentile rank within the EPSS corpus (0–1). */
  percentile: number;
  /** Date of the EPSS score in YYYY-MM-DD form, or null. */
  date: string | null;
}

export interface VulnersRecord extends CveRecord {
  epssScore: number | null;
  epssPercentile: number | null;
  epssDate: string | null;
  exploitRiskTier: EpssTier;
}

export interface VulnersListResponse {
  records: VulnersRecord[];
  asOf: string;
  fromCache?: boolean;
  error?: string;
}

// ── EPSS API typings (subset we actually use) ──────────────────────────────

interface FirstEpssRow {
  cve?: string;
  epss?: string;
  percentile?: string;
  date?: string;
}

export interface FirstEpssResponse {
  status?: string;
  total?: number;
  data?: FirstEpssRow[];
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/** Spec-mandated EPSS tier ladder.
 *
 * | EPSS         | Tier      |
 * | ------------ | --------- |
 * | > 0.5        | critical  |
 * | 0.1–0.5      | elevated  |
 * | < 0.1        | low       |
 * | null/NaN     | unknown   |
 */
export function epssTier(epss: number | null | undefined): EpssTier {
  if (epss === null || epss === undefined || !Number.isFinite(epss)) return 'unknown';
  if (epss > 0.5) return 'critical';
  if (epss >= 0.1) return 'elevated';
  return 'low';
}

/** Parse a FIRST.org `/data/v1/epss` response into a CVE-keyed map. */
export function parseEpssResponse(payload: unknown): Map<string, EpssScore> {
  const out = new Map<string, EpssScore>();
  if (!payload || typeof payload !== 'object') return out;
  const rows = (payload as FirstEpssResponse).data;
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (!row?.cve) continue;
    const epss = parseEpssNumber(row.epss);
    const percentile = parseEpssNumber(row.percentile) ?? 0;
    if (epss === null) continue;
    out.set(row.cve, {
      cve: row.cve,
      epss,
      percentile,
      date: typeof row.date === 'string' ? row.date : null,
    });
  }
  return out;
}

function parseEpssNumber(value: string | undefined): number | null {
  if (typeof value !== 'string') return null;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

/** Merge a CVE list with its EPSS scores. CVEs with no EPSS row keep
 *  null scores and `unknown` tier — they're still listed. */
export function enrichCvesWithEpss(
  cves: CveRecord[],
  epss: Map<string, EpssScore>,
): VulnersRecord[] {
  return cves.map((cve) => {
    const score = epss.get(cve.id);
    return {
      ...cve,
      epssScore: score?.epss ?? null,
      epssPercentile: score?.percentile ?? null,
      epssDate: score?.date ?? null,
      exploitRiskTier: epssTier(score?.epss),
    };
  });
}

/** Sort by EPSS desc, with CVSS as the tiebreaker, with null EPSS rows
 *  pushed to the bottom. */
export function sortByExploitRisk(records: VulnersRecord[]): VulnersRecord[] {
  const out = [...records];
  out.sort((a, b) => {
    const ea = a.epssScore ?? -1;
    const eb = b.epssScore ?? -1;
    if (ea !== eb) return eb - ea;
    const ca = a.cvssScore ?? -1;
    const cb = b.cvssScore ?? -1;
    if (ca !== cb) return cb - ca;
    const ta = a.lastModifiedAt ? Date.parse(a.lastModifiedAt) : 0;
    const tb = b.lastModifiedAt ? Date.parse(b.lastModifiedAt) : 0;
    return tb - ta;
  });
  return out;
}

/** Convenience: parse NVD + EPSS payloads in one step. */
export function buildVulnersList(
  nvdPayload: unknown,
  epssPayload: unknown,
): VulnersRecord[] {
  const cves = parseNvdResponse(nvdPayload);
  const epss = parseEpssResponse(epssPayload);
  return sortByExploitRisk(enrichCvesWithEpss(cves, epss));
}

/** Build the FIRST.org EPSS query URL for a batch of CVE ids. The
 *  service caps at 100 ids per call (the FIRST API supports more, but
 *  the URL gets long). Sidecar can call multiple times for larger
 *  batches. */
export function buildEpssQueryUrl(cveIds: string[]): string {
  const cleaned = cveIds
    .filter((id) => /^CVE-\d{4}-\d+$/.test(id))
    .slice(0, 100);
  if (cleaned.length === 0) return 'https://api.first.org/data/v1/epss';
  return `https://api.first.org/data/v1/epss?cve=${cleaned.join(',')}`;
}

// ── Renderer-side fetch wrapper ────────────────────────────────────────────

export async function fetchVulnersCves(): Promise<VulnersListResponse> {
  const url = `${getApiBaseUrl()}/api/security/vulners`;
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) {
      return { records: [], asOf: new Date().toISOString(), error: `HTTP ${resp.status}` };
    }
    const body = (await resp.json()) as VulnersListResponse;
    return {
      records: Array.isArray(body.records) ? body.records : [],
      asOf: body.asOf ?? new Date().toISOString(),
      fromCache: !!body.fromCache,
    };
  } catch (error) {
    return {
      records: [], asOf: new Date().toISOString(),
      error: String((error as Error).message ?? error),
    };
  }
}
