// src/services/survival/snapshot-integrity.ts
//
// E6 · Survival Kernel hardening — snapshot export / import integrity.
//
// The World Snapshot is the survival "save file": at zero bars every UI view is
// a pure projection of the last snapshot on disk. world-snapshot.ts round-trips
// a snapshot the process just built and trusts implicitly. But E6 requires the
// snapshot to survive *export and re-import* — copied to another device, synced
// through iCloud, or reloaded cold after a crash — where the bytes are no longer
// trusted: they can be truncated, bit-rotted, or hand-edited.
//
// deserializeSnapshot's blind `JSON.parse(...) as WorldSnapshot` is exactly the
// fail-open we must not ship into grid-down: a corrupt snapshot would become a
// "trusted" posture with NaN levels or missing axes, and the operator would act
// on a save file that no longer means anything. This module makes the import
// boundary fail *closed*:
//
//   - a versioned, checksummed export envelope wraps the snapshot;
//   - import recomputes the checksum over a canonical (key-sorted) encoding and
//     rejects any mismatch — the corruption / truncation guard;
//   - a deep structural validator rejects a snapshot whose shape or numbers are
//     broken, with a list of concrete reasons, before any consumer sees it.
//
// HONESTY — what the checksum is and is NOT:
//   The checksum is a deterministic FNV-1a digest. It detects ACCIDENTAL damage
//   (truncated writes, bit rot, a botched hand-edit). It is NOT a cryptographic
//   signature and provides NO defense against a deliberate tamperer, who can
//   simply recompute it. Authenticating a snapshot against forgery is a separate
//   concern (a keyed MAC) deliberately out of scope here.
//
// Pure: no DOM, no fetch, no globals, no clock, no crypto. A function of its
// input bytes alone.

import type {
  AxisState,
  SurvivalBand,
  WorldSnapshot,
} from './survival-types.ts';
import { SNAPSHOT_VERSION, SURVIVAL_AXES } from './survival-types.ts';

export const SNAPSHOT_ENVELOPE_KIND = 'crystalball.survival.snapshot';
export const SNAPSHOT_ENVELOPE_VERSION = 1;

const AXIS_SET = new Set<string>(SURVIVAL_AXES);
const BAND_SET = new Set<SurvivalBand>(['secure', 'guarded', 'elevated', 'high', 'critical']);
const TREND_SET = new Set<AxisState['trend']>(['improving', 'steady', 'worsening']);
const MOVE_STATUS_SET = new Set<string>(['planned', 'in_progress', 'done', 'skipped']);

export interface SnapshotEnvelope {
  kind: string;
  envelopeVersion: number;
  /** Mirrors snapshot.version for a cheap early reject. */
  snapshotVersion: number;
  /** FNV-1a digest over the canonical encoding of `snapshot`. */
  checksum: string;
  snapshot: WorldSnapshot;
}

export type SnapshotImportError =
  | 'malformed_json'
  | 'not_an_envelope'
  | 'unsupported_envelope_version'
  | 'checksum_mismatch'
  | 'unsupported_snapshot_version'
  | 'invalid_shape';

export interface SnapshotImportOk {
  ok: true;
  snapshot: WorldSnapshot;
}
export interface SnapshotImportFail {
  ok: false;
  reason: SnapshotImportError;
  detail: string;
  /** Concrete structural problems, when reason is 'invalid_shape'. */
  errors?: string[];
}
export type SnapshotImportResult = SnapshotImportOk | SnapshotImportFail;

export interface SnapshotValidation {
  ok: boolean;
  errors: string[];
}

// ── Canonical encoding + checksum ───────────────────────────────────────────

/** Locale-independent ordinal (UTF-16 code-unit) comparison. localeCompare
 *  varies by the runtime's locale, which would make the digest differ between
 *  devices — exactly what a portable checksum must not do. */
function ordinalCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Deterministic, key-sorted JSON so the checksum is stable regardless of the
 *  key order a serializer happened to emit. Mirrors JSON.stringify precisely so
 *  the digest computed at export matches the one recomputed after a
 *  serialize→parse round-trip:
 *    - object keys whose value is `undefined` are OMITTED (JSON.stringify drops
 *      them; encoding them as null would break a valid snapshot's round-trip);
 *    - inside arrays, `undefined` and non-finite numbers encode to `null`
 *      (JSON.stringify's array behavior);
 *    - keys are ordered ordinally so the digest is identical across devices. */
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    const items = value.map((v) => canonicalJson(v));
    return `[${items.join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort(ordinalCompare);
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${entries.join(',')}}`;
}

/** FNV-1a 64-bit over the string's UTF-16 code units, hex-encoded (16 chars).
 *  A corruption digest, not a cryptographic hash — see the file header. Each
 *  code unit is hashed exactly once (charCodeAt, not codePointAt) so an astral
 *  character isn't hashed twice with mismatched forms; charCodeAt is spec-exact
 *  across engines, so the digest stays portable. */
function fnv1a64(str: string): string {
  const mask = 0xFF_FF_FF_FF_FF_FF_FF_FFn;
  const prime = 0x1_00_00_00_01_B3n;
  let hash = 0xCB_F2_9C_E4_84_22_23_25n;
  for (let i = 0; i < str.length; i += 1) {
    // eslint-disable-next-line unicorn/prefer-code-point -- deliberately hashing every UTF-16 code unit once; codePointAt would double-count surrogate pairs
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** The integrity checksum for a snapshot — exported so a persistence adapter can
 *  store it alongside the bytes and callers can craft envelopes in tests. */
export function snapshotChecksum(snapshot: WorldSnapshot): string {
  return fnv1a64(canonicalJson(snapshot));
}

// ── Structural validation ────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateAxis(axis: unknown, index: number, errors: string[]): void {
  const where = `posture.axes[${index}]`;
  if (!isObject(axis)) {
    errors.push(`${where} is not an object`);
    return;
  }
  if (!AXIS_SET.has(axis.axis as string)) errors.push(`${where}.axis "${String(axis.axis)}" is not a survival axis`);
  if (!isFiniteNumber(axis.level)) errors.push(`${where}.level is not a finite number`);
  else if (axis.level < 0 || axis.level > 100) errors.push(`${where}.level ${axis.level} is out of range 0..100`);
  if (!BAND_SET.has(axis.band as SurvivalBand)) errors.push(`${where}.band "${String(axis.band)}" is not a band`);
  if (!TREND_SET.has(axis.trend as AxisState['trend'])) errors.push(`${where}.trend "${String(axis.trend)}" is invalid`);
  if (!Array.isArray(axis.threats)) errors.push(`${where}.threats is not an array`);
  if (!Array.isArray(axis.drivers)) errors.push(`${where}.drivers is not an array`);
  if (!isObject(axis.confidence)) errors.push(`${where}.confidence is missing`);
  if (!isObject(axis.explanation)) errors.push(`${where}.explanation is missing`);
}

/** Every survival axis must be present exactly once — a partial posture is not
 *  a trustworthy grid-down projection (computePosture always emits all 8). */
function validateAxisCoverage(axes: unknown[], errors: string[]): void {
  if (axes.length === 0) errors.push('posture.axes is empty');
  axes.forEach((a, i) => validateAxis(a, i, errors));
  const present = new Set<string>();
  for (const a of axes) {
    if (isObject(a) && typeof a.axis === 'string') present.add(a.axis);
  }
  for (const axis of SURVIVAL_AXES) {
    if (!present.has(axis)) errors.push(`posture.axes is missing the "${axis}" axis`);
  }
}

function validatePosture(posture: unknown, errors: string[]): void {
  if (!isObject(posture)) {
    errors.push('posture is not an object');
    return;
  }
  if (Array.isArray(posture.axes)) validateAxisCoverage(posture.axes, errors);
  else errors.push('posture.axes is not an array');
  if (!isFiniteNumber(posture.overallLevel)) errors.push('posture.overallLevel is not a finite number');
  else if (posture.overallLevel < 0 || posture.overallLevel > 100) errors.push('posture.overallLevel is out of range 0..100');
  if (!BAND_SET.has(posture.overallBand as SurvivalBand)) errors.push('posture.overallBand is not a band');
  if (!AXIS_SET.has(posture.worstAxis as string)) errors.push('posture.worstAxis is not a survival axis');
  if (typeof posture.headline !== 'string') errors.push('posture.headline is not a string');
  if (!isFiniteNumber(posture.capturedAtMs)) errors.push('posture.capturedAtMs is not a finite number');
  if (!Array.isArray(posture.staleInputs)) errors.push('posture.staleInputs is not an array');
}

function validateFreshness(freshness: unknown, errors: string[]): void {
  if (!Array.isArray(freshness)) {
    errors.push('freshness is not an array');
    return;
  }
  freshness.forEach((f, i) => {
    const where = `freshness[${i}]`;
    if (!isObject(f)) {
      errors.push(`${where} is not an object`);
      return;
    }
    if (f.domain !== 'weather') errors.push(`${where}.domain "${String(f.domain)}" is not a snapshot domain`);
    if (!isFiniteNumber(f.fetchedAtMs)) errors.push(`${where}.fetchedAtMs is not a finite number`);
    if (!isFiniteNumber(f.ageMs)) errors.push(`${where}.ageMs is not a finite number`);
    if (typeof f.ok !== 'boolean') errors.push(`${where}.ok is not a boolean`);
  });
}

function validateSavedPlaces(places: unknown, errors: string[]): void {
  if (!Array.isArray(places)) {
    errors.push('savedPlaces is not an array');
    return;
  }
  places.forEach((p, i) => {
    const where = `savedPlaces[${i}]`;
    if (!isObject(p)) {
      errors.push(`${where} is not an object`);
      return;
    }
    if (typeof p.id !== 'string') errors.push(`${where}.id is not a string`);
    if (!isFiniteNumber(p.lat)) errors.push(`${where}.lat is not a finite number`);
    if (!isFiniteNumber(p.lon)) errors.push(`${where}.lon is not a finite number`);
  });
}

function validateWeatherAlerts(alerts: unknown, errors: string[]): void {
  if (!Array.isArray(alerts)) {
    errors.push('weatherAlerts is not an array');
    return;
  }
  alerts.forEach((a, i) => {
    const where = `weatherAlerts[${i}]`;
    if (!isObject(a)) {
      errors.push(`${where} is not an object`);
      return;
    }
    if (typeof a.id !== 'string') errors.push(`${where}.id is not a string`);
    if (typeof a.event !== 'string') errors.push(`${where}.event is not a string`);
  });
}

function validatePlan(plan: unknown, errors: string[]): void {
  if (!isObject(plan)) {
    errors.push('plan is not an object');
    return;
  }
  if (!Array.isArray(plan.committed)) {
    errors.push('plan.committed is not an array');
    return;
  }
  plan.committed.forEach((m, i) => {
    const where = `plan.committed[${i}]`;
    if (!isObject(m)) {
      errors.push(`${where} is not an object`);
      return;
    }
    if (typeof m.moveId !== 'string') errors.push(`${where}.moveId is not a string`);
    if (!isFiniteNumber(m.committedAtMs)) errors.push(`${where}.committedAtMs is not a finite number`);
    if (!MOVE_STATUS_SET.has(m.status as string)) errors.push(`${where}.status "${String(m.status)}" is invalid`);
  });
}

/** Deep structural validation of a candidate snapshot. Returns every concrete
 *  problem found (not just the first) so a diagnostics surface can show why an
 *  imported save file was rejected. Version is checked as shape, but callers
 *  that need a distinct "wrong version" signal should compare `version`
 *  themselves first — see importSnapshotEnvelope / safeDeserializeSnapshot. */
export function validateSnapshot(value: unknown): SnapshotValidation {
  const errors: string[] = [];
  if (!isObject(value)) {
    return { ok: false, errors: ['snapshot is not an object'] };
  }
  if (value.version !== SNAPSHOT_VERSION) {
    errors.push(`version ${String(value.version)} is not the supported version ${SNAPSHOT_VERSION}`);
  }
  if (!isFiniteNumber(value.capturedAtMs)) errors.push('capturedAtMs is not a finite number');
  validateFreshness(value.freshness, errors);
  validateWeatherAlerts(value.weatherAlerts, errors);
  validateSavedPlaces(value.savedPlaces, errors);
  validatePosture(value.posture, errors);
  validatePlan(value.plan, errors);
  return { ok: errors.length === 0, errors };
}

// ── Export / import ───────────────────────────────────────────────────────────

/** Wrap a snapshot in a checksummed, versioned envelope ready to write to disk
 *  or hand to another device. */
export function exportSnapshotEnvelope(snapshot: WorldSnapshot): string {
  const envelope: SnapshotEnvelope = {
    kind: SNAPSHOT_ENVELOPE_KIND,
    envelopeVersion: SNAPSHOT_ENVELOPE_VERSION,
    snapshotVersion: snapshot.version,
    checksum: snapshotChecksum(snapshot),
    snapshot,
  };
  return JSON.stringify(envelope);
}

function fail(reason: SnapshotImportError, detail: string, errors?: string[]): SnapshotImportFail {
  return errors ? { ok: false, reason, detail, errors } : { ok: false, reason, detail };
}

/** Import a snapshot from an export envelope, failing CLOSED on any problem.
 *  Never throws — untrusted bytes become a typed failure the caller can render,
 *  never a half-trusted posture. */
export function importSnapshotEnvelope(json: string): SnapshotImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return fail('malformed_json', 'envelope is not valid JSON');
  }
  if (!isObject(parsed) || parsed.kind !== SNAPSHOT_ENVELOPE_KIND) {
    return fail('not_an_envelope', 'missing or wrong envelope kind');
  }
  if (parsed.envelopeVersion !== SNAPSHOT_ENVELOPE_VERSION) {
    return fail('unsupported_envelope_version', `envelope version ${String(parsed.envelopeVersion)} is unsupported`);
  }
  const snapshot = parsed.snapshot;
  // snapshotVersion is envelope framing that sits OUTSIDE the checksummed body;
  // if it disagrees with the body's own version the envelope was corrupted, so
  // reject rather than trust the "cheap early reject" field it advertises.
  if (isObject(snapshot) && parsed.snapshotVersion !== snapshot.version) {
    return fail('unsupported_envelope_version', `envelope snapshotVersion ${String(parsed.snapshotVersion)} disagrees with body version ${String(snapshot.version)}`);
  }
  const expected = typeof parsed.checksum === 'string' ? parsed.checksum : '';
  const actual = fnv1a64(canonicalJson(snapshot));
  if (expected !== actual) {
    return fail('checksum_mismatch', `checksum ${expected || '(none)'} does not match ${actual} — the snapshot was truncated or altered`);
  }
  return finishImport(snapshot);
}

/** Import a bare snapshot (no envelope) — e.g. a value already persisted by an
 *  older path — with the same fail-closed shape validation, but no checksum
 *  guard (there is nothing to check it against). */
export function safeDeserializeSnapshot(json: string): SnapshotImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return fail('malformed_json', 'snapshot is not valid JSON');
  }
  return finishImport(parsed);
}

function finishImport(snapshot: unknown): SnapshotImportResult {
  if (isObject(snapshot) && snapshot.version !== SNAPSHOT_VERSION) {
    return fail('unsupported_snapshot_version', `snapshot version ${String(snapshot.version)} is unsupported`);
  }
  const validation = validateSnapshot(snapshot);
  if (!validation.ok) {
    return fail('invalid_shape', 'snapshot failed structural validation', validation.errors);
  }
  return { ok: true, snapshot: snapshot as WorldSnapshot };
}
