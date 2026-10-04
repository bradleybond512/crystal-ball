/**
 * Evidence journal projections (R4-LOW-008).
 *
 * Pure functions that turn the renderer's calibration ledgers into "scored"
 * journal entries and back. A scored entry keeps only what the calibration
 * maths needs. Claim text, notes, evidence references, driver scores and
 * coordinates are never projected, and identifiers that may embed content
 * (target keys, alert and situation ids) are replaced by `sha256:<hex>`.
 *
 * Projection is idempotent across a rebuild: projecting a record rebuilt from
 * the journal yields the same digest as the original entry, so a rebuilt
 * ledger never re-appends what the journal already holds.
 *
 * `canonicalJson` must stay byte-identical to the sidecar's version in
 * `src-tauri/sidecar/evidence-store.mjs`; a cross-check test pins that.
 */

import type { ForecastAccuracyPrediction, ForecastAccuracyTotals } from '../forecast-accuracy';
import type { PredictionRecord, PredictionStatus } from './forecast-calibration';
import type { OutcomeAction, OutcomeRecord, PredictedSeverity } from './outcome-ledger';
import type { FactDomain } from './types';

export type EvidenceKind = 'forecast' | 'alert-outcome' | 'ema-forecast' | 'ema-forecast-totals';

export type EvidencePayload = Record<string, string | number | boolean>;

/** A scored entry ready to send to the journal. */
export interface EvidenceEntry {
  kind: EvidenceKind;
  id: string;
  payload: EvidencePayload;
  /** SHA-256 hex of `canonicalJson(payload)`. */
  digest: string;
}

/** An entry read back from the journal. */
export interface JournalEntry {
  seq: number;
  kind: EvidenceKind;
  recordId: string;
  digest: string;
  recordedAt: number;
  payload: Record<string, unknown>;
}

export const HASHED_ID_PREFIX = 'sha256:';
export const CLAIM_NOT_RETAINED = 'Claim not retained (rebuilt from the evidence journal)';
export const NOTE_NOT_RETAINED = 'note not retained';

const HASHED_ID_RE = /^sha256:[0-9a-f]{64}$/;
const FORECAST_STATUSES: ReadonlySet<string> = new Set(['pending', 'resolved_true', 'resolved_false', 'expired']);
const SEVERITIES: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'critical']);
const OUTCOME_ACTIONS: ReadonlySet<string> = new Set([
  'dismissed', 'acted-on', 'escalated', 'de-escalated', 'confirmed-real', 'marked-false-positive',
]);

// ── Canonical JSON + hashing ─────────────────────────────────────────────

/** Plain UTF-16 code-unit order, matching the sidecar. Never localeCompare:
 *  a locale-aware order would change digests between machines. */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort(compareCodeUnits)
    .map((key) => [JSON.stringify(key), canonicalJson(record[key])].join(':'));
  return `{${members.join(',')}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isHashedId(value: string): boolean {
  return HASHED_ID_RE.test(value);
}

/** Hash an identifier once; an already-hashed id passes through unchanged. */
export async function hashedId(value: string): Promise<string> {
  return isHashedId(value) ? value : `${HASHED_ID_PREFIX}${await sha256Hex(value)}`;
}

async function optionalHashedId(value: string | undefined): Promise<string | undefined> {
  return value ? hashedId(value) : undefined;
}

/** Empty strings count as absent, so a rebuilt record projects identically. */
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

function compact(input: Record<string, string | number | boolean | undefined>): EvidencePayload {
  const out: EvidencePayload = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

async function finish(kind: EvidenceKind, input: Record<string, string | number | boolean | undefined>): Promise<EvidenceEntry> {
  const payload = compact(input);
  return { kind, id: String(payload.id), payload, digest: await sha256Hex(canonicalJson(payload)) };
}

// ── Resolution-note origin ───────────────────────────────────────────────

export type NoteOrigin = 'direct' | 'proxy' | 'other';

/** Calibration code classifies labels by the note prefix (`direct:` or
 *  `proxy:`), so the journal keeps the prefix class but not the text. */
export function noteOriginOf(note: string | undefined): NoteOrigin | undefined {
  if (note === undefined) return undefined;
  if (note.startsWith('direct:')) return 'direct';
  if (note.startsWith('proxy:')) return 'proxy';
  return 'other';
}

export function rebuiltNote(origin: NoteOrigin | undefined): string | undefined {
  if (origin === 'direct' || origin === 'proxy') return `${origin}: ${NOTE_NOT_RETAINED}`;
  return origin === 'other' ? NOTE_NOT_RETAINED : undefined;
}

// ── Projections (ledger → journal) ───────────────────────────────────────

export async function projectForecast(record: PredictionRecord): Promise<EvidenceEntry> {
  return finish('forecast', {
    id: record.id,
    sourceId: record.sourceId,
    domain: record.domain,
    probability: record.probability,
    predictedAt: record.predictedAt,
    resolveBy: record.resolveBy,
    status: record.status,
    targetKeyHash: await optionalHashedId(record.targetKey),
    resolvedAt: record.resolvedAt,
    provenanceKind: record.resolutionProvenance?.kind,
    resolverId: nonEmpty(record.resolutionProvenance?.resolverId),
    noteOrigin: noteOriginOf(record.resolutionNote),
    algorithmVersion: nonEmpty(record.algorithmVersion),
  });
}

export async function projectOutcome(record: OutcomeRecord): Promise<EvidenceEntry> {
  return finish('alert-outcome', {
    id: record.id,
    domain: record.domain,
    predictedSeverity: record.predictedSeverity,
    actualOutcome: record.actualOutcome,
    recordedAt: record.recordedAt.getTime(),
    alertIdHash: await optionalHashedId(record.alertId),
    situationIdHash: await optionalHashedId(record.situationId),
  });
}

export async function projectEmaForecast(prediction: ForecastAccuracyPrediction): Promise<EvidenceEntry> {
  return finish('ema-forecast', {
    id: prediction.id,
    region: prediction.region,
    risk24h: prediction.risk24h,
    baselineCount: prediction.baselineCount,
    createdAt: prediction.createdAt,
    resolvedAt: prediction.resolvedAt,
    hit: prediction.hit,
  });
}

/** Totals are journaled as snapshots; `null` when there is nothing to keep
 *  or no stable timestamp to key the snapshot on. */
export async function projectEmaTotals(totals: ForecastAccuracyTotals): Promise<EvidenceEntry | null> {
  if (totals.totalHits + totals.totalMisses === 0 || totals.updatedAt === undefined) return null;
  return finish('ema-forecast-totals', {
    id: 'totals',
    totalHits: totals.totalHits,
    totalMisses: totals.totalMisses,
    updatedAt: totals.updatedAt,
  });
}

// ── Fold (many journal rows per record → the one to rebuild from) ────────

/** Later states outrank earlier ones regardless of arrival order. */
export function evidenceRank(kind: EvidenceKind, payload: Record<string, unknown>): number {
  switch (kind) {
    case 'forecast': {
      return payload.status === 'pending' ? 0 : 1;
    }
    case 'ema-forecast': {
      return payload.resolvedAt === undefined ? 0 : 1;
    }
    case 'ema-forecast-totals': {
      return Number(payload.totalHits) + Number(payload.totalMisses);
    }
    default: {
      return 0;
    }
  }
}

/** Pick one entry per record id: highest rank, then highest seq. */
export function foldLatest(entries: readonly JournalEntry[]): JournalEntry[] {
  const best = new Map<string, JournalEntry>();
  for (const entry of entries) {
    const current = best.get(entry.recordId);
    if (!current) { best.set(entry.recordId, entry); continue; }
    const rank = evidenceRank(entry.kind, entry.payload);
    const currentRank = evidenceRank(current.kind, current.payload);
    if (rank > currentRank || (rank === currentRank && entry.seq > current.seq)) best.set(entry.recordId, entry);
  }
  return [...best.values()];
}

// ── Rebuild (journal → ledger) ───────────────────────────────────────────

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function forecastFromEvidence(payload: Record<string, unknown>): PredictionRecord | null {
  const id = str(payload.id);
  const sourceId = str(payload.sourceId);
  const domain = str(payload.domain);
  const probability = num(payload.probability);
  const predictedAt = num(payload.predictedAt);
  const resolveBy = num(payload.resolveBy);
  const status = str(payload.status);
  if (!id || !sourceId || !domain || probability === undefined || predictedAt === undefined
    || resolveBy === undefined || !status || !FORECAST_STATUSES.has(status)) return null;
  const provenanceKind = payload.provenanceKind === 'direct' || payload.provenanceKind === 'proxy'
    ? payload.provenanceKind
    : undefined;
  const origin = payload.noteOrigin === 'direct' || payload.noteOrigin === 'proxy' || payload.noteOrigin === 'other'
    ? payload.noteOrigin
    : undefined;
  const record: PredictionRecord = {
    id,
    sourceId,
    domain: domain as FactDomain,
    claim: CLAIM_NOT_RETAINED,
    probability,
    predictedAt,
    resolveBy,
    status: status as PredictionStatus,
  };
  const targetKeyHash = str(payload.targetKeyHash);
  if (targetKeyHash) record.targetKey = targetKeyHash;
  const resolvedAt = num(payload.resolvedAt);
  if (resolvedAt !== undefined) record.resolvedAt = resolvedAt;
  const note = rebuiltNote(origin);
  if (note) record.resolutionNote = note;
  if (provenanceKind) {
    record.resolutionProvenance = { resolverId: str(payload.resolverId) ?? '', kind: provenanceKind, evidence: [] };
  }
  const algorithmVersion = str(payload.algorithmVersion);
  if (algorithmVersion) record.algorithmVersion = algorithmVersion;
  return record;
}

export function outcomeFromEvidence(payload: Record<string, unknown>): OutcomeRecord | null {
  const id = str(payload.id);
  const domain = str(payload.domain);
  const predictedSeverity = str(payload.predictedSeverity);
  const actualOutcome = str(payload.actualOutcome);
  const recordedAt = num(payload.recordedAt);
  if (!id || !domain || !predictedSeverity || !SEVERITIES.has(predictedSeverity)
    || !actualOutcome || !OUTCOME_ACTIONS.has(actualOutcome) || recordedAt === undefined) return null;
  return {
    id,
    alertId: str(payload.alertIdHash),
    situationId: str(payload.situationIdHash),
    domain,
    predictedSeverity: predictedSeverity as PredictedSeverity,
    actualOutcome: actualOutcome as OutcomeAction,
    recordedAt: new Date(recordedAt),
  };
}

export function emaForecastFromEvidence(payload: Record<string, unknown>): ForecastAccuracyPrediction | null {
  const id = str(payload.id);
  const region = str(payload.region);
  const risk24h = num(payload.risk24h);
  const baselineCount = num(payload.baselineCount);
  const createdAt = num(payload.createdAt);
  if (!id || !region || risk24h === undefined || baselineCount === undefined || createdAt === undefined) return null;
  const prediction: ForecastAccuracyPrediction = { id, region, risk24h, baselineCount, createdAt };
  const resolvedAt = num(payload.resolvedAt);
  if (resolvedAt !== undefined && typeof payload.hit === 'boolean') {
    prediction.resolvedAt = resolvedAt;
    prediction.hit = payload.hit;
  }
  return prediction;
}

export function emaTotalsFromEvidence(payload: Record<string, unknown>): ForecastAccuracyTotals | null {
  const totalHits = num(payload.totalHits);
  const totalMisses = num(payload.totalMisses);
  const updatedAt = num(payload.updatedAt);
  if (totalHits === undefined || totalMisses === undefined || totalHits < 0 || totalMisses < 0) return null;
  return { totalHits, totalMisses, updatedAt };
}
