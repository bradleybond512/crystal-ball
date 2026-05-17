/**
 * Intelligence Digest — compiles a structured 1h / 6h / 24h
 * intelligence digest from all active services, ready for export or
 * notification. Pure service with injectable provider interfaces so
 * tests run without depending on the upstream subsystems, and so
 * future PRs can wire each provider as those services land.
 *
 * Sections (each present only when its provider returns content):
 *   - Situations (SituationStoreV2)
 *   - Signature matches (CrisisSignatureLibrary)
 *   - Contradictions (ContradictionDetector)
 *   - Failure predictions (FailurePredictionEngine)
 *
 * Plus top-level fields:
 *   - civilizationPulseScore / pulseLabel (CivilizationPulseEngine)
 *   - worldNarrative (WorldNarrativeEngine)
 *   - topRisks: 3 highest-severity items across all sections
 *   - headline: short composed string (mentions critical count + period)
 */

// ── Public types ─────────────────────────────────────────────────────────

export type DigestPeriod = '1h' | '6h' | '24h';

export interface DigestItem {
  title: string;
  domain: string;
  severity: string;
  timestamp: number;
  summary: string;
  situationId: string | null;
}

export interface DigestSection {
  title: string;
  summary: string;
  itemCount: number;
  highestSeverity: string;
  items: DigestItem[];
}

export interface IntelligenceDigest {
  id: string;
  generatedAt: number;
  period: DigestPeriod;
  headline: string;
  civilizationPulseScore: number | null;
  pulseLabel: string;
  sections: DigestSection[];
  totalAlerts: number;
  criticalCount: number;
  topRisks: DigestItem[];
  worldNarrative: string | null;
}

export interface DigestSituation {
  id: string;
  name: string;
  domain: string;
  severity: string;
  summary: string;
  updatedAt: number;
}

export interface DigestSignatureMatch {
  signatureId: string;
  situationId: string | null;
  confidence: number;
  domain: string;
  matchedAt: number;
}

export interface DigestContradiction {
  id: string;
  conflictType: string;
  domain: string;
  region: string;
  severity: string;
  detectedAt: number;
  summary: string;
}

export interface DigestFailurePrediction {
  target: string;
  probability: number;
  predictedAt: number;
  summary: string;
}

export interface DigestPulse {
  score: number;
  label: string;
}

export interface SituationsProvider {
  getRecent(): readonly DigestSituation[];
}

export interface SignatureProvider {
  getActive(): readonly DigestSignatureMatch[];
}

export interface ContradictionsProvider {
  getOpen(): readonly DigestContradiction[];
}

export interface FailurePredictionProvider {
  getHighRisk(): readonly DigestFailurePrediction[];
}

export interface PulseProvider {
  getLatest(): DigestPulse | null;
}

export interface NarrativeProvider {
  getLatest(): string | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface IntelligenceDigestServiceOptions {
  storage?: StorageLike | null;
  now?: () => number;
  situationsProvider?: SituationsProvider | null;
  signatureProvider?: SignatureProvider | null;
  contradictionsProvider?: ContradictionsProvider | null;
  failurePredictionProvider?: FailurePredictionProvider | null;
  pulseProvider?: PulseProvider | null;
  narrativeProvider?: NarrativeProvider | null;
}

export interface IntelligenceDigestService {
  generate(period: DigestPeriod): IntelligenceDigest;
  getLatestDigest(): IntelligenceDigest | undefined;
  getHistory(limit?: number): IntelligenceDigest[];
  subscribe(cb: (digest: IntelligenceDigest) => void): void;
  unsubscribe(cb: (digest: IntelligenceDigest) => void): void;
}

// ── Constants ────────────────────────────────────────────────────────────

export const STORAGE_KEY = 'wm-intelligence-digest';
export const MAX_DIGESTS = 90;

const PERIOD_MS: Record<DigestPeriod, number> = {
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
};

const SEVERITY_RANK: Record<string, number> = {
  info: 0, low: 1, medium: 2, high: 3, critical: 4,
  INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4,
};

// ── Helpers ──────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextDigestId(nowMs: number): string {
  _idCounter += 1;
  return `dig-${nowMs.toString(36)}-${_idCounter.toString(36)}`;
}

function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? SEVERITY_RANK[severity.toLowerCase()] ?? 0;
}

function highestSeverity(items: readonly DigestItem[]): string {
  if (items.length === 0) return 'info';
  let best = items[0]!.severity;
  let bestRank = severityRank(best);
  for (const item of items) {
    const r = severityRank(item.severity);
    if (r > bestRank) { best = item.severity; bestRank = r; }
  }
  return best;
}

function resolveLocalStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof globalThis !== 'undefined') {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls && typeof ls.getItem === 'function') return ls;
  }
  return null;
}

function cloneDigest(d: IntelligenceDigest): IntelligenceDigest {
  return {
    ...d,
    sections: d.sections.map((s) => ({
      ...s,
      items: s.items.map((i) => ({ ...i })),
    })),
    topRisks: d.topRisks.map((i) => ({ ...i })),
  };
}

function rehydrate(storage: StorageLike | null): IntelligenceDigest[] {
  if (!storage) return [];
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: IntelligenceDigest[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const d = item as IntelligenceDigest;
    if (typeof d.id !== 'string') continue;
    out.push(d);
  }
  return out;
}

// ── Section builders ────────────────────────────────────────────────────

function buildSituationsSection(
  situations: readonly DigestSituation[], floor: number,
): DigestSection | null {
  const filtered = situations.filter((s) => s.updatedAt >= floor);
  if (filtered.length === 0) return null;
  const items: DigestItem[] = filtered.map((s) => ({
    title: s.name,
    domain: s.domain,
    severity: s.severity,
    timestamp: s.updatedAt,
    summary: s.summary,
    situationId: s.id,
  }));
  return {
    title: 'Active situations',
    summary: `${items.length} active situation${items.length === 1 ? '' : 's'} in window.`,
    itemCount: items.length,
    highestSeverity: highestSeverity(items),
    items,
  };
}

function buildSignatureSection(
  matches: readonly DigestSignatureMatch[], floor: number,
): DigestSection | null {
  const filtered = matches.filter((m) => m.matchedAt >= floor);
  if (filtered.length === 0) return null;
  const items: DigestItem[] = filtered.map((m) => ({
    title: `Signature match: ${m.signatureId}`,
    domain: m.domain,
    severity: m.confidence >= 0.8 ? 'high' : 'medium',
    timestamp: m.matchedAt,
    summary: `Matched signature ${m.signatureId} at confidence ${m.confidence.toFixed(2)}.`,
    situationId: m.situationId,
  }));
  return {
    title: 'Signature matches',
    summary: `${items.length} historical pattern${items.length === 1 ? '' : 's'} matched current observations.`,
    itemCount: items.length,
    highestSeverity: highestSeverity(items),
    items,
  };
}

function buildContradictionsSection(
  contradictions: readonly DigestContradiction[], floor: number,
): DigestSection | null {
  const filtered = contradictions.filter((c) => c.detectedAt >= floor);
  if (filtered.length === 0) return null;
  const items: DigestItem[] = filtered.map((c) => ({
    title: `${c.conflictType} in ${c.domain}`,
    domain: c.domain,
    severity: c.severity,
    timestamp: c.detectedAt,
    summary: c.summary,
    situationId: null,
  }));
  return {
    title: 'Open contradictions',
    summary: `${items.length} unresolved contradiction${items.length === 1 ? '' : 's'} across feeds.`,
    itemCount: items.length,
    highestSeverity: highestSeverity(items),
    items,
  };
}

function severityFromProbability(p: number): string {
  if (p >= 0.8) return 'critical';
  if (p >= 0.6) return 'high';
  return 'medium';
}

function buildFailurePredictionsSection(
  predictions: readonly DigestFailurePrediction[], floor: number,
): DigestSection | null {
  const filtered = predictions.filter((p) => p.predictedAt >= floor);
  if (filtered.length === 0) return null;
  const items: DigestItem[] = filtered.map((p) => ({
    title: `Failure risk: ${p.target}`,
    domain: 'infrastructure',
    severity: severityFromProbability(p.probability),
    timestamp: p.predictedAt,
    summary: p.summary,
    situationId: null,
  }));
  return {
    title: 'Failure predictions',
    summary: `${items.length} feed${items.length === 1 ? '' : 's'} at elevated failure risk.`,
    itemCount: items.length,
    highestSeverity: highestSeverity(items),
    items,
  };
}

function pickTopRisks(sections: readonly DigestSection[], n: number): DigestItem[] {
  const all = sections.flatMap((s) => s.items);
  return [...all]
    .sort((a, b) => {
      const dr = severityRank(b.severity) - severityRank(a.severity);
      if (dr !== 0) return dr;
      return b.timestamp - a.timestamp;
    })
    .slice(0, n);
}

function periodLabel(period: DigestPeriod): string {
  if (period === '1h') return 'past hour';
  if (period === '6h') return 'past 6 hours';
  return 'past 24 hours';
}

function composeHeadline(
  period: DigestPeriod,
  totalAlerts: number,
  criticalCount: number,
): string {
  const window = periodLabel(period);
  if (totalAlerts === 0) {
    return `No active situations in the ${window}; world feeds quiet and stable.`;
  }
  if (criticalCount > 0) {
    return `${criticalCount} critical and ${totalAlerts - criticalCount} other item${totalAlerts - criticalCount === 1 ? '' : 's'} in the ${window}.`;
  }
  return `${totalAlerts} item${totalAlerts === 1 ? '' : 's'} tracked in the ${window}, no critical-level activity.`;
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createIntelligenceDigestService(
  options: IntelligenceDigestServiceOptions = {},
): IntelligenceDigestService {
  const storage = resolveLocalStorage(options.storage);
  const clock = options.now ?? (() => Date.now());
  const situations = options.situationsProvider ?? null;
  const signatures = options.signatureProvider ?? null;
  const contradictions = options.contradictionsProvider ?? null;
  const failures = options.failurePredictionProvider ?? null;
  const pulse = options.pulseProvider ?? null;
  const narrative = options.narrativeProvider ?? null;

  const history: IntelligenceDigest[] = rehydrate(storage);
  const listeners = new Set<(digest: IntelligenceDigest) => void>();

  function persist(): void {
    if (!storage) return;
    try { storage.setItem(STORAGE_KEY, JSON.stringify(history)); }
    catch { /* non-critical */ }
  }

  function notify(digest: IntelligenceDigest): void {
    const snapshot = cloneDigest(digest);
    for (const cb of listeners) {
      try { cb(snapshot); } catch { /* listener crash isolation */ }
    }
  }

  return {
    generate(period): IntelligenceDigest {
      const now = clock();
      const floor = now - PERIOD_MS[period];

      const sections: DigestSection[] = [];
      const sit = situations
        ? buildSituationsSection(situations.getRecent(), floor) : null;
      if (sit) sections.push(sit);
      const sig = signatures
        ? buildSignatureSection(signatures.getActive(), floor) : null;
      if (sig) sections.push(sig);
      const con = contradictions
        ? buildContradictionsSection(contradictions.getOpen(), floor) : null;
      if (con) sections.push(con);
      const fail = failures
        ? buildFailurePredictionsSection(failures.getHighRisk(), floor) : null;
      if (fail) sections.push(fail);

      const totalAlerts = sections.reduce((acc, s) => acc + s.itemCount, 0);
      const allItems = sections.flatMap((s) => s.items);
      const criticalRank = SEVERITY_RANK.critical ?? 4;
      const criticalCount = allItems.filter(
        (i) => severityRank(i.severity) >= criticalRank,
      ).length;
      const topRisks = pickTopRisks(sections, 3);

      const pulseSnapshot = pulse ? pulse.getLatest() : null;
      const worldNarrative = narrative ? narrative.getLatest() : null;

      const digest: IntelligenceDigest = {
        id: nextDigestId(now),
        generatedAt: now,
        period,
        headline: composeHeadline(period, totalAlerts, criticalCount),
        civilizationPulseScore: pulseSnapshot ? pulseSnapshot.score : null,
        pulseLabel: pulseSnapshot ? pulseSnapshot.label : 'unknown',
        sections,
        totalAlerts,
        criticalCount,
        topRisks,
        worldNarrative,
      };

      history.push(digest);
      if (history.length > MAX_DIGESTS) {
        history.splice(0, history.length - MAX_DIGESTS);
      }
      persist();
      notify(digest);
      return cloneDigest(digest);
    },

    getLatestDigest(): IntelligenceDigest | undefined {
      if (history.length === 0) return undefined;
      return cloneDigest(history[history.length - 1]!);
    },

    getHistory(limit = 30): IntelligenceDigest[] {
      const out: IntelligenceDigest[] = [];
      for (let i = history.length - 1; i >= 0 && out.length < limit; i--) {
        out.push(cloneDigest(history[i]!));
      }
      return out;
    },

    subscribe(cb): void {
      listeners.add(cb);
    },

    unsubscribe(cb): void {
      listeners.delete(cb);
    },
  };
}

// ── Lazy singleton ───────────────────────────────────────────────────────

let _singleton: IntelligenceDigestService | null = null;

export function getIntelligenceDigestService(): IntelligenceDigestService {
  _singleton ??= createIntelligenceDigestService();
  return _singleton;
}

export function _resetIntelligenceDigestSingletonForTests(): void {
  _singleton = null;
}
