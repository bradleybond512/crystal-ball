// Calibration evidence journal (R4-LOW-008): append-only, hash-chained,
// backed by node:sqlite.
//
// The renderer's calibration ledgers (forecast spine, alert outcomes, EMA
// forecast hit/miss) live in WebKit localStorage behind rolling caps. This
// journal is their durable system of record: every scored state of every
// record is appended once and never rewritten, so the ledgers can be rebuilt
// after a WebKit reset and exported for backup.
//
// Guarantees:
//   - Append-only, enforced by SQLite triggers that abort UPDATE and DELETE.
//   - Idempotent: a row is keyed by (kind, record_id, digest), where digest is
//     the SHA-256 of the canonical JSON payload computed HERE, never trusted
//     from the caller.
//   - Hash-chained: entry_hash = sha256(prev_hash, kind, record_id, digest,
//     recorded_at, appended_at). A meta row tracks the head hash and count, so
//     an edited, inserted or removed row is reported as a broken chain. This
//     detects corruption and partial edits; it cannot stop someone who rewrites
//     the whole file, which the docs state plainly.
//   - Scored fields only: per-kind allowlists keep what calibration maths needs
//     and drop everything else (claims, notes, evidence references,
//     coordinates). Identifiers that may embed content arrive pre-hashed as
//     `sha256:<hex>`.
//   - No rolling cap. A size ceiling refuses new appends visibly instead of
//     deleting old evidence.

import { createHash } from 'node:crypto';
import { chmodSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const EVIDENCE_SCHEMA_VERSION = 1;
export const EVIDENCE_KINDS = Object.freeze(['forecast', 'alert-outcome', 'ema-forecast', 'ema-forecast-totals']);
export const MAX_ENTRY_BYTES = 4096;
export const MAX_APPEND_BATCH = 200;
export const MAX_MISSING_QUERY = 5000;
export const MAX_RECORDS_PAGE = 1000;
export const DEFAULT_MAX_DB_BYTES = 256 * 1024 * 1024;
export const GENESIS_HASH = '0'.repeat(64);

const KIND_SET = new Set(EVIDENCE_KINDS);
const HASHED_ID_RE = /^sha256:[0-9a-f]{64}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const FORECAST_STATUSES = new Set(['pending', 'resolved_true', 'resolved_false', 'expired']);
const PROVENANCE_KINDS = new Set(['direct', 'proxy']);
const NOTE_ORIGINS = new Set(['direct', 'proxy', 'other']);
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const OUTCOME_ACTIONS = new Set([
  'dismissed', 'acted-on', 'escalated', 'de-escalated', 'confirmed-real', 'marked-false-positive',
]);
// Upper bound for a millisecond timestamp (year ~5138). Rejects seconds-vs-ms
// mix-ups in the other direction only loosely; the floor rejects 0/negatives.
const MAX_TIMESTAMP_MS = 1e14;

export class EvidenceInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EvidenceInputError';
  }
}

export class EvidenceFullError extends Error {
  constructor(sizeBytes, maxBytes) {
    super(`evidence journal is full (${sizeBytes} of ${maxBytes} bytes)`);
    this.name = 'EvidenceFullError';
    this.sizeBytes = sizeBytes;
    this.maxBytes = maxBytes;
  }
}

// ── Canonical JSON + hashing ────────────────────────────────────────────────

/** Deterministic JSON: object keys sorted, undefined members omitted. The
 *  renderer implements the same function; a cross-check test pins equality. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const members = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort(compareCodeUnits)
    .map((key) => [JSON.stringify(key), canonicalJson(value[key])].join(':'));
  return `{${members.join(',')}}`;
}

/** Plain UTF-16 code-unit order (what a bare `.sort()` does), spelled out so
 *  it can never drift into locale-aware ordering. */
export function compareCodeUnits(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** True when the string holds an ASCII control character (C0 or DEL). */
function hasControlChar(value) {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function chainHash(prevHash, row) {
  return sha256Hex([prevHash, row.kind, row.recordId, row.digest, row.recordedAt, row.appendedAt].join('\n'));
}

// ── Field validators (return undefined when invalid) ───────────────────────

function text(value, max) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) return undefined;
  return hasControlChar(value) ? undefined : value;
}

function timestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < MAX_TIMESTAMP_MS
    ? value
    : undefined;
}

function finiteIn(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function member(set) {
  return (value) => (typeof value === 'string' && set.has(value) ? value : undefined);
}

function hashedId(value) {
  return typeof value === 'string' && HASHED_ID_RE.test(value) ? value : undefined;
}

function bool(value) {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Build a normalized payload from an allowlist. `required` fields must all be
 * valid; an `optional` field that is present must be valid too (rejecting
 * keeps the renderer and sidecar digests identical instead of silently
 * dropping a field). Fields outside both lists are dropped.
 */
function pick(raw, required, optional) {
  const out = {};
  for (const [field, check] of Object.entries(required)) {
    const value = check(raw[field]);
    if (value === undefined) return { error: `invalid ${field}` };
    out[field] = value;
  }
  for (const [field, check] of Object.entries(optional)) {
    if (raw[field] === undefined || raw[field] === null) continue;
    const value = check(raw[field]);
    if (value === undefined) return { error: `invalid ${field}` };
    out[field] = value;
  }
  return { payload: out };
}

const id200 = (value) => text(value, 200);
const VALIDATORS = {
  forecast(raw) {
    const result = pick(raw, {
      id: id200,
      sourceId: (value) => text(value, 128),
      domain: (value) => text(value, 64),
      probability: (value) => finiteIn(value, 0, 1),
      predictedAt: timestamp,
      resolveBy: timestamp,
      status: member(FORECAST_STATUSES),
    }, {
      targetKeyHash: hashedId,
      resolvedAt: timestamp,
      provenanceKind: member(PROVENANCE_KINDS),
      resolverId: (value) => text(value, 128),
      noteOrigin: member(NOTE_ORIGINS),
      algorithmVersion: (value) => text(value, 128),
    });
    return result.payload ? { ...result, recordedAt: result.payload.predictedAt } : result;
  },
  'alert-outcome'(raw) {
    const result = pick(raw, {
      id: id200,
      domain: (value) => text(value, 64),
      predictedSeverity: member(SEVERITIES),
      actualOutcome: member(OUTCOME_ACTIONS),
      recordedAt: timestamp,
    }, {
      alertIdHash: hashedId,
      situationIdHash: hashedId,
    });
    return result.payload ? { ...result, recordedAt: result.payload.recordedAt } : result;
  },
  'ema-forecast'(raw) {
    const result = pick(raw, {
      id: id200,
      region: (value) => text(value, 160),
      risk24h: (value) => finiteIn(value, 0, 100),
      baselineCount: count,
      createdAt: timestamp,
    }, {
      resolvedAt: timestamp,
      hit: bool,
    });
    if (!result.payload) return result;
    if ((result.payload.resolvedAt === undefined) !== (result.payload.hit === undefined)) {
      return { error: 'resolvedAt and hit must appear together' };
    }
    return { ...result, recordedAt: result.payload.createdAt };
  },
  'ema-forecast-totals'(raw) {
    const result = pick(raw, {
      id: (value) => (value === 'totals' ? value : undefined),
      totalHits: count,
      totalMisses: count,
      updatedAt: timestamp,
    }, {});
    return result.payload ? { ...result, recordedAt: result.payload.updatedAt } : result;
  },
};

/**
 * Validate and normalize one `{ kind, payload }` entry. Returns
 * `{ entry }` or `{ error }` (a short, value-free reason).
 */
export function normalizeEvidenceEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'entry must be an object' };
  if (typeof raw.kind !== 'string' || !KIND_SET.has(raw.kind)) return { error: 'unknown kind' };
  const payload = raw.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { error: 'payload must be an object' };
  const result = VALIDATORS[raw.kind](payload);
  if (result.error) return { error: result.error };
  const payloadJson = canonicalJson(result.payload);
  if (Buffer.byteLength(payloadJson, 'utf8') > MAX_ENTRY_BYTES) return { error: 'entry too large' };
  return {
    entry: {
      kind: raw.kind,
      recordId: result.payload.id,
      digest: sha256Hex(payloadJson),
      recordedAt: result.recordedAt,
      payloadJson,
    },
  };
}

// ── Store ───────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS evidence (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  record_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  recorded_at REAL NOT NULL,
  appended_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  UNIQUE (kind, record_id, digest)
);
CREATE INDEX IF NOT EXISTS evidence_kind_seq ON evidence (kind, seq);
CREATE TRIGGER IF NOT EXISTS evidence_no_update BEFORE UPDATE ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence journal is append-only'); END;
CREATE TRIGGER IF NOT EXISTS evidence_no_delete BEFORE DELETE ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence journal is append-only'); END;
CREATE TABLE IF NOT EXISTS evidence_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const VERIFY_PAGE = 5000;

export class EvidenceStore {
  constructor({ dataDir, dbPath, maxBytes = DEFAULT_MAX_DB_BYTES, clock = Date.now } = {}) {
    this._filePath = dbPath ?? path.join(dataDir ?? '.', 'evidence.db');
    this.maxBytes = maxBytes;
    this._clock = clock;
    this.db = new DatabaseSync(this._filePath);
    try { chmodSync(this._filePath, 0o600); } catch { /* best effort; non-POSIX filesystems */ }
    // A supervisor restart can briefly overlap the old process; wait for its
    // lock instead of failing the open.
    this.db.exec('PRAGMA busy_timeout = 2000');
    this.db.exec('PRAGMA journal_mode = WAL');
    // Evidence is low-volume and must survive power loss: FULL syncs every commit.
    this.db.exec('PRAGMA synchronous = FULL');
    this.db.exec(SCHEMA_SQL);
    this._stmt = {
      exists: this.db.prepare('SELECT 1 AS present FROM evidence WHERE kind = ? AND record_id = ? AND digest = ?'),
      insert: this.db.prepare(`INSERT INTO evidence
        (kind, record_id, digest, recorded_at, appended_at, payload, prev_hash, entry_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      head: this.db.prepare('SELECT seq, entry_hash FROM evidence ORDER BY seq DESC LIMIT 1'),
      metaGet: this.db.prepare('SELECT value FROM evidence_meta WHERE key = ?'),
      metaSet: this.db.prepare('INSERT INTO evidence_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      byKind: this.db.prepare('SELECT kind, COUNT(*) AS n FROM evidence GROUP BY kind'),
      bounds: this.db.prepare('SELECT COUNT(*) AS n, MIN(appended_at) AS first, MAX(appended_at) AS last FROM evidence'),
      page: this.db.prepare(`SELECT seq, kind, record_id, digest, recorded_at, appended_at, payload, prev_hash, entry_hash
        FROM evidence WHERE seq > ? ORDER BY seq ASC LIMIT ?`),
      kindPage: this.db.prepare(`SELECT seq, kind, record_id, digest, recorded_at, appended_at, payload
        FROM evidence WHERE kind = ? AND seq < ? ORDER BY seq DESC LIMIT ?`),
    };
    if (this._stmt.metaGet.get('schema_version') === undefined) {
      this._stmt.metaSet.run('schema_version', String(EVIDENCE_SCHEMA_VERSION));
    }
    this._head = this._stmt.head.get()?.entry_hash ?? GENESIS_HASH;
    this._chain = this.verifyChain();
  }

  get filePath() {
    return this._filePath;
  }

  sizeBytes() {
    let total = 0;
    for (const suffix of ['', '-wal']) {
      try { total += statSync(`${this._filePath}${suffix}`).size; } catch { /* absent */ }
    }
    return total;
  }

  /**
   * Append a batch. Each entry is validated on its own: invalid entries are
   * reported as `rejected` with a value-free reason and never block the rest.
   */
  append(rawEntries) {
    if (!Array.isArray(rawEntries) || rawEntries.length === 0) throw new EvidenceInputError('entries must be a non-empty array');
    if (rawEntries.length > MAX_APPEND_BATCH) throw new EvidenceInputError(`at most ${MAX_APPEND_BATCH} entries per batch`);
    const normalized = rawEntries.map((raw) => normalizeEvidenceEntry(raw));
    const size = this.sizeBytes();
    if (size >= this.maxBytes) throw new EvidenceFullError(size, this.maxBytes);

    const results = [];
    let appended = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let head = this._head;
      for (const item of normalized) {
        if (item.error) { results.push({ status: 'rejected', reason: item.error }); continue; }
        const { entry } = item;
        if (this._stmt.exists.get(entry.kind, entry.recordId, entry.digest)) {
          results.push({ status: 'duplicate' });
          continue;
        }
        const row = { ...entry, appendedAt: this._clock() };
        const entryHash = chainHash(head, row);
        this._stmt.insert.run(row.kind, row.recordId, row.digest, row.recordedAt, row.appendedAt, row.payloadJson, head, entryHash);
        head = entryHash;
        appended += 1;
        results.push({ status: 'appended' });
      }
      if (appended > 0) {
        const total = Number(this._stmt.metaGet.get('count')?.value ?? 0) + appended;
        this._stmt.metaSet.run('count', String(total));
        this._stmt.metaSet.run('head_hash', head);
      }
      this.db.exec('COMMIT');
      this._head = head;
      if (this._chain.ok && appended > 0) this._chain = { ...this._chain, count: this._chain.count + appended };
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw error;
    }
    return { appended, results };
  }

  /**
   * Return the indexes of the `{ kind, id, digest }` triples the journal
   * lacks. A malformed triple counts as missing, so the caller posts the entry
   * and receives a per-entry rejection reason instead of the whole query
   * failing on one bad record.
   */
  missing(triples) {
    if (!Array.isArray(triples)) throw new EvidenceInputError('entries must be an array');
    if (triples.length > MAX_MISSING_QUERY) throw new EvidenceInputError(`at most ${MAX_MISSING_QUERY} entries per query`);
    const absent = [];
    for (const [index, triple] of triples.entries()) {
      const kind = triple?.kind;
      const id = text(triple?.id, 200);
      const digest = triple?.digest;
      const wellFormed = KIND_SET.has(kind) && id !== undefined && typeof digest === 'string' && DIGEST_RE.test(digest);
      if (!wellFormed || !this._stmt.exists.get(kind, id, digest)) absent.push(index);
    }
    return absent;
  }

  /** Newest-first page of one kind, for rebuilding renderer ledgers. */
  records({ kind, beforeSeq, limit } = {}) {
    if (!KIND_SET.has(kind)) throw new EvidenceInputError('unknown kind');
    const before = Number.isSafeInteger(beforeSeq) && beforeSeq > 0 ? beforeSeq : Number.MAX_SAFE_INTEGER;
    const size = Number.isSafeInteger(limit) ? Math.min(Math.max(1, limit), MAX_RECORDS_PAGE) : MAX_RECORDS_PAGE;
    const rows = this._stmt.kindPage.all(kind, before, size);
    const entries = rows.map((row) => ({
      seq: row.seq,
      kind: row.kind,
      recordId: row.record_id,
      digest: row.digest,
      recordedAt: row.recorded_at,
      appendedAt: row.appended_at,
      payload: JSON.parse(row.payload),
    }));
    const nextBeforeSeq = rows.length === size ? rows.at(-1).seq : null;
    return { entries, nextBeforeSeq };
  }

  /**
   * Walk the whole journal in seq order, recomputing each digest and chain
   * link, then compare the head and count with the meta row.
   */
  verifyChain() {
    let prev = GENESIS_HASH;
    let checked = 0;
    let afterSeq = 0;
    for (;;) {
      const rows = this._stmt.page.all(afterSeq, VERIFY_PAGE);
      for (const row of rows) {
        const recomputed = chainHash(prev, {
          kind: row.kind,
          recordId: row.record_id,
          digest: row.digest,
          recordedAt: row.recorded_at,
          appendedAt: row.appended_at,
        });
        if (row.prev_hash !== prev || sha256Hex(row.payload) !== row.digest || row.entry_hash !== recomputed) {
          return { ok: false, brokenAtSeq: row.seq, count: checked, checkedAt: this._clock() };
        }
        prev = row.entry_hash;
        checked += 1;
      }
      if (rows.length < VERIFY_PAGE) break;
      afterSeq = rows.at(-1).seq;
    }
    const metaCount = Number(this._stmt.metaGet.get('count')?.value ?? 0);
    const metaHead = this._stmt.metaGet.get('head_hash')?.value ?? GENESIS_HASH;
    if (metaCount !== checked || metaHead !== prev) {
      return { ok: false, brokenAtSeq: null, reason: 'head mismatch', count: checked, checkedAt: this._clock() };
    }
    return { ok: true, count: checked, checkedAt: this._clock() };
  }

  summary() {
    const byKind = Object.fromEntries(EVIDENCE_KINDS.map((kind) => [kind, 0]));
    for (const row of this._stmt.byKind.all()) byKind[row.kind] = row.n;
    const bounds = this._stmt.bounds.get();
    return {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      total: bounds.n,
      byKind,
      firstAppendedAt: bounds.first ?? null,
      lastAppendedAt: bounds.last ?? null,
      sizeBytes: this.sizeBytes(),
      maxBytes: this.maxBytes,
      headHash: this._head,
      chain: this._chain,
    };
  }

  /**
   * JSONL export: a header line, then every row in seq order with its chain
   * fields so the file can be verified offline. Re-verifies the chain first.
   */
  exportJsonl() {
    this._chain = this.verifyChain();
    const summary = this.summary();
    const lines = [canonicalJson({
      type: 'crystal-ball-evidence-export',
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      exportedAt: this._clock(),
      total: summary.total,
      byKind: summary.byKind,
      headHash: summary.headHash,
      chain: summary.chain,
    })];
    let afterSeq = 0;
    for (;;) {
      const rows = this._stmt.page.all(afterSeq, VERIFY_PAGE);
      for (const row of rows) {
        lines.push(canonicalJson({
          seq: row.seq,
          kind: row.kind,
          recordId: row.record_id,
          digest: row.digest,
          recordedAt: row.recorded_at,
          appendedAt: row.appended_at,
          prevHash: row.prev_hash,
          entryHash: row.entry_hash,
          payload: JSON.parse(row.payload),
        }));
      }
      if (rows.length < VERIFY_PAGE) break;
      afterSeq = rows.at(-1).seq;
    }
    return `${lines.join('\n')}\n`;
  }

  close() {
    try { this.db.close(); } catch { /* already closed */ }
  }
}
