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

/** Immutable scored primitives, with raw identifiers confined to transient hash inputs. */
export interface EvidenceDraft {
  readonly kind: EvidenceKind;
  readonly payload: Readonly<EvidencePayload>;
  readonly hashInputs: Readonly<Record<string, string>>;
}

export type EvidenceCapture =
  | { kind: 'forecast'; record: PredictionRecord }
  | { kind: 'alert-outcome'; record: OutcomeRecord }
  | { kind: 'ema-forecast'; record: ForecastAccuracyPrediction }
  | { kind: 'ema-forecast-totals'; record: ForecastAccuracyTotals };

export function snapshotEvidence(change: EvidenceCapture): EvidenceDraft | null {
  const hashInputs: Record<string, string> = {};
  function hash(field: string, value: string | undefined): void {
    if (value) hashInputs[field] = value;
  }
  let payload: EvidencePayload;
  switch (change.kind) {
    case 'forecast': {
      const r = change.record;
      hash('targetKeyHash', r.targetKey);
      payload = compact({ id: r.id, sourceId: r.sourceId, domain: r.domain,
        probability: r.probability, predictedAt: r.predictedAt, resolveBy: r.resolveBy,
        status: r.status, resolvedAt: r.resolvedAt, provenanceKind: r.resolutionProvenance?.kind,
        resolverId: nonEmpty(r.resolutionProvenance?.resolverId), noteOrigin: noteOriginOf(r.resolutionNote),
        algorithmVersion: nonEmpty(r.algorithmVersion) });
      break;
    }
    case 'alert-outcome': {
      const r = change.record;
      hash('alertIdHash', r.alertId); hash('situationIdHash', r.situationId);
      payload = compact({ id: r.id, domain: r.domain, predictedSeverity: r.predictedSeverity,
        actualOutcome: r.actualOutcome, recordedAt: r.recordedAt.getTime() });
      break;
    }
    case 'ema-forecast': {
      const r = change.record;
      payload = compact({ id: r.id, region: r.region, risk24h: r.risk24h, baselineCount: r.baselineCount,
        createdAt: r.createdAt, resolvedAt: r.resolvedAt, hit: r.hit });
      break;
    }
    case 'ema-forecast-totals': {
      const r = change.record;
      if (r.totalHits + r.totalMisses === 0 || r.updatedAt === undefined) return null;
      payload = { id: 'totals', totalHits: r.totalHits, totalMisses: r.totalMisses, updatedAt: r.updatedAt };
    }
  }
  return Object.freeze({ kind: change.kind, payload: Object.freeze(payload), hashInputs: Object.freeze(hashInputs) });
}

/** Bound and validate a transient scored snapshot before any encoding/hash work. */
export function evidenceDraftRefusal(draft: EvidenceDraft): 'invalid-input' | 'input-size' | 'payload-size' | null {
  const values = [...Object.values(draft.payload), ...Object.values(draft.hashInputs)];
  if (Object.values(draft.payload).some(v => !['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v)))
    || Object.values(draft.hashInputs).some(v => typeof v !== 'string')) return 'invalid-input';
  if (values.some(v => typeof v === 'string' && v.length > 8192)) return 'input-size';
  if (new TextEncoder().encode(canonicalJson(draft)).byteLength > 8192) return 'input-size';
  const payload = { ...draft.payload };
  for (const field of Object.keys(draft.hashInputs)) payload[field] = `sha256:${'0'.repeat(64)}`;
  if (!validEvidencePayload(draft.kind, payload)) return 'invalid-input';
  if (new TextEncoder().encode(canonicalJson(payload)).byteLength > 4096) return 'payload-size';
  return null;
}

// A shared four-worker executor covers capture, ready validation and compatibility
// backfill. Production callers submit at most four jobs per bounded source.
const projectionJobs: (() => void)[] = [];
let activeProjectionJobs = 0;
let compatibilityWorkers = 0;
const projectionHighWater = { active: 0, queued: 0, compatibilityWorkers: 0 };
export const EVIDENCE_PROJECTION_WORKERS = 4;
export const EVIDENCE_PROJECTION_WAITERS = 12;
export function getEvidenceProjectionDiagnostics() {
  return { active: activeProjectionJobs, queued: projectionJobs.length, compatibilityWorkers,
    highWater: { ...projectionHighWater }, maxWorkers: EVIDENCE_PROJECTION_WORKERS, maxWaiters: EVIDENCE_PROJECTION_WAITERS };
}
export function runEvidenceProjection<T>(task: () => Promise<T>): Promise<T> {
  if (activeProjectionJobs >= EVIDENCE_PROJECTION_WORKERS && projectionJobs.length >= EVIDENCE_PROJECTION_WAITERS) {
    return Promise.reject(new Error('bounded evidence projection queue is full'));
  }
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeProjectionJobs += 1;
      projectionHighWater.active = Math.max(projectionHighWater.active, activeProjectionJobs);
      const release = () => { activeProjectionJobs -= 1; projectionJobs.shift()?.(); };
      void Promise.resolve().then(task).then(value => { release(); resolve(value); }, (error: unknown) => { release(); reject(error instanceof Error ? error : new Error('evidence projection failed')); });
    };
    if (activeProjectionJobs < EVIDENCE_PROJECTION_WORKERS) run(); else {
      projectionJobs.push(run);
      projectionHighWater.queued = Math.max(projectionHighWater.queued, projectionJobs.length);
    }
  });
}

async function projectDraftNow(draft: EvidenceDraft): Promise<EvidenceEntry> {
  const payload: EvidencePayload = { ...draft.payload };
  for (const [field, value] of Object.entries(draft.hashInputs)) payload[field] = await hashedId(value);
  return finish(draft.kind, payload);
}

export function projectEvidenceDraft(draft: EvidenceDraft): Promise<EvidenceEntry> {
  return runEvidenceProjection(() => projectDraftNow(draft));
}

export async function projectEvidenceDrafts(drafts: readonly EvidenceDraft[]): Promise<EvidenceEntry[]> {
  const entries: EvidenceEntry[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, drafts.length) }, async () => {
    compatibilityWorkers += 1;
    projectionHighWater.compatibilityWorkers = Math.max(projectionHighWater.compatibilityWorkers, compatibilityWorkers);
    try {
      for (;;) {
        const index = next++;
        if (index >= drafts.length) return;
        entries[index] = await projectEvidenceDraft(drafts[index]!);
      }
    } finally { compatibilityWorkers -= 1; }
  }));
  return entries;
}

export function projectForecast(record: PredictionRecord): Promise<EvidenceEntry> {
  return projectEvidenceDraft(snapshotEvidence({ kind: 'forecast', record })!);
}
export function projectOutcome(record: OutcomeRecord): Promise<EvidenceEntry> {
  return projectEvidenceDraft(snapshotEvidence({ kind: 'alert-outcome', record })!);
}
export function projectEmaForecast(record: ForecastAccuracyPrediction): Promise<EvidenceEntry> {
  return projectEvidenceDraft(snapshotEvidence({ kind: 'ema-forecast', record })!);
}
export function projectEmaTotals(record: ForecastAccuracyTotals): Promise<EvidenceEntry | null> {
  const draft = snapshotEvidence({ kind: 'ema-forecast-totals', record });
  return draft ? projectEvidenceDraft(draft) : Promise.resolve(null);
}

type Check = (value: unknown) => boolean;
const text = (max: number): Check => v => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001F\u007F]/.test(v);
const timestamp: Check = v => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e14;
const count: Check = v => Number.isSafeInteger(v) && Number(v) >= 0;
const between = (min: number, max: number): Check => v => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const member = (values: readonly string[]): Check => v => typeof v === 'string' && values.includes(v);
const hash: Check = v => typeof v === 'string' && isHashedId(v);

/** Strict scored payload validation for local replay, matching the journal's v1 schema. */
export function validEvidencePayload(kind: EvidenceKind, payload: unknown): payload is EvidencePayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  let required: Record<string, Check>;
  let optional: Record<string, Check>;
  switch (kind) {
    case 'forecast': {
      required = { id: text(200), sourceId: text(128), domain: text(64), probability: between(0, 1), predictedAt: timestamp, resolveBy: timestamp, status: member([...FORECAST_STATUSES]) };
      optional = { targetKeyHash: hash, resolvedAt: timestamp, provenanceKind: member(['direct', 'proxy']), resolverId: text(128), noteOrigin: member(['direct', 'proxy', 'other']), algorithmVersion: text(128) };
      break;
    }
    case 'alert-outcome': {
      required = { id: text(200), domain: text(64), predictedSeverity: member([...SEVERITIES]), actualOutcome: member([...OUTCOME_ACTIONS]), recordedAt: timestamp };
      optional = { alertIdHash: hash, situationIdHash: hash }; break;
    }
    case 'ema-forecast': {
      required = { id: text(200), region: text(160), risk24h: between(0, 100), baselineCount: count, createdAt: timestamp };
      optional = { resolvedAt: timestamp, hit: v => typeof v === 'boolean' };
      if ((p.resolvedAt === undefined) !== (p.hit === undefined)) return false;
      break;
    }
    case 'ema-forecast-totals': {
      required = { id: v => v === 'totals', totalHits: count, totalMisses: count, updatedAt: timestamp }; optional = {}; break;
    }
    default: { return false; }
  }
  return Object.entries(required).every(([field, check]) => check(p[field]))
    && Object.entries(p).every(([field, value]) => (required[field] ?? optional[field])?.(value) === true);
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
