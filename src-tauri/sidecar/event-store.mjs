// Temporal World Store — append-only event log backed by node:sqlite.
//
// The renderer-side semantics live in src/components/event-store-helpers.ts
// (pure, browser-safe). This module is the authoritative persistent store; it
// mirrors those query/partition/retention semantics against a real SQLite DB.
// node:sqlite is built into the bundled Node (>=22.5), so the sidecar stays
// free of native modules and bundles as a plain .mjs resource.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { statSync } from 'node:fs';

const EVENT_TYPES = new Set([
  'observation',
  'situation_created',
  'situation_updated',
  'situation_closed',
  'alert_fired',
  'score_updated',
]);

const DEFAULT_QUERY_LIMIT = 1000;

function resolveRetentionMonths(explicit) {
  if (Number.isFinite(explicit)) return explicit;
  const envMonths = Number(process.env.EVENT_STORE_RETENTION_MONTHS);
  if (Number.isFinite(envMonths) && envMonths > 0) return envMonths;
  return 3;
}

function partitionKeyForTimestamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new TypeError(`partitionKeyForTimestamp: unparseable timestamp ${String(iso)}`);
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function retentionCutoffISO(months, now) {
  const base = new Date(now instanceof Date ? now.getTime() : now);
  if (Number.isNaN(base.getTime())) throw new TypeError('retentionCutoffISO: invalid now');
  base.setUTCMonth(base.getUTCMonth() - Math.max(0, Math.floor(months)));
  return base.toISOString();
}

// Each statement is issued individually through prepare().run() / .get() so the
// store never needs DatabaseSync.exec().
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    domain TEXT,
    entity_ids TEXT,
    source_id TEXT,
    severity REAL,
    payload TEXT NOT NULL,
    partition_key TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON events(occurred_at)',
  'CREATE INDEX IF NOT EXISTS idx_events_domain ON events(domain)',
  'CREATE INDEX IF NOT EXISTS idx_events_partition ON events(partition_key)',
  'CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)',
];

export class EventStore {
  constructor({ dataDir, dbPath, retentionMonths } = {}) {
    this._filePath = dbPath ?? path.join(dataDir ?? '.', 'events.db');
    this.db = new DatabaseSync(this._filePath);
    this.db.prepare('PRAGMA journal_mode = WAL').get();
    this.db.prepare('PRAGMA synchronous = NORMAL').get();
    for (const stmt of SCHEMA_STATEMENTS) this.db.prepare(stmt).run();
    this.retentionMonths = resolveRetentionMonths(retentionMonths);
    this._insert = this.db.prepare(
      `INSERT OR REPLACE INTO events
        (id, event_type, occurred_at, domain, entity_ids, source_id, severity, payload, partition_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  journalMode() {
    const row = this.db.prepare('PRAGMA journal_mode').get();
    return row ? String(row.journal_mode).toLowerCase() : null;
  }

  appendEvent(event) {
    if (!event || typeof event !== 'object') throw new Error('appendEvent: event must be an object');
    if (!EVENT_TYPES.has(event.event_type)) {
      throw new Error(`appendEvent: invalid event_type ${String(event.event_type)}`);
    }
    if (typeof event.id !== 'string' || event.id.length === 0) {
      throw new Error('appendEvent: id is required');
    }
    if (typeof event.occurred_at !== 'string' || event.occurred_at.length === 0) {
      throw new Error('appendEvent: occurred_at is required');
    }
    if (event.payload == null) throw new Error('appendEvent: payload is required');
    const partitionKey = event.partition_key ?? partitionKeyForTimestamp(event.occurred_at);
    this._insert.run(
      event.id,
      event.event_type,
      event.occurred_at,
      event.domain ?? null,
      typeof event.entity_ids === 'string' ? event.entity_ids : JSON.stringify(event.entity_ids ?? []),
      event.source_id ?? null,
      typeof event.severity === 'number' ? event.severity : null,
      typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload),
      partitionKey,
    );
  }

  queryEvents(opts = {}) {
    const where = [];
    const params = [];
    if (opts.from) { where.push('occurred_at >= ?'); params.push(opts.from); }
    if (opts.to) { where.push('occurred_at <= ?'); params.push(opts.to); }
    if (opts.domain) { where.push('domain = ?'); params.push(opts.domain); }
    if (opts.sourceId) { where.push('source_id = ?'); params.push(opts.sourceId); }
    if (Array.isArray(opts.eventTypes) && opts.eventTypes.length > 0) {
      where.push(`event_type IN (${opts.eventTypes.map(() => '?').join(', ')})`);
      params.push(...opts.eventTypes);
    }
    if (Array.isArray(opts.entityIds) && opts.entityIds.length > 0) {
      const clauses = opts.entityIds.map(() => 'entity_ids LIKE ?');
      where.push(`(${clauses.join(' OR ')})`);
      // entity_ids is a JSON array string like ["a","b"]; match the quoted token.
      params.push(...opts.entityIds.map((id) => `%${JSON.stringify(String(id))}%`));
    }
    const limit = Number.isFinite(opts.limit) ? Math.max(0, Math.floor(opts.limit)) : DEFAULT_QUERY_LIMIT;
    const offset = Number.isFinite(opts.offset) ? Math.max(0, Math.floor(opts.offset)) : 0;
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sql =
      `SELECT id, event_type, occurred_at, domain, entity_ids, source_id, severity, payload, partition_key
       FROM events
       ${whereClause}
       ORDER BY occurred_at DESC, id DESC
       LIMIT ? OFFSET ?`;
    return this.db.prepare(sql).all(...params, limit, offset);
  }

  getEventCount(opts = {}) {
    const where = [];
    const params = [];
    if (opts.domain) { where.push('domain = ?'); params.push(opts.domain); }
    if (opts.from) { where.push('occurred_at >= ?'); params.push(opts.from); }
    if (opts.to) { where.push('occurred_at <= ?'); params.push(opts.to); }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `SELECT COUNT(*) AS c FROM events ${whereClause}`;
    const row = this.db.prepare(sql).get(...params);
    return row ? Number(row.c) : 0;
  }

  // Deletes events whose occurred_at is older than `months` before `now`.
  pruneOlderThan(months, now = new Date().toISOString()) {
    const cutoff = retentionCutoffISO(months, now);
    const res = this.db.prepare('DELETE FROM events WHERE occurred_at < ?').run(cutoff);
    return Number(res.changes ?? 0);
  }

  health() {
    const agg = this.db
      .prepare('SELECT COUNT(*) AS c, MIN(occurred_at) AS oldest, MAX(occurred_at) AS latest FROM events')
      .get();
    const partitions = this.db
      .prepare('SELECT DISTINCT partition_key FROM events ORDER BY partition_key')
      .all()
      .map((r) => String(r.partition_key));
    const byDomain = {};
    for (const r of this.db
      .prepare("SELECT COALESCE(domain, '(none)') AS d, COUNT(*) AS c FROM events GROUP BY d")
      .all()) {
      byDomain[String(r.d)] = Number(r.c);
    }
    let dbSizeBytes = 0;
    for (const suffix of ['', '-wal', '-shm']) {
      try { dbSizeBytes += statSync(`${this._filePath}${suffix}`).size; } catch { /* not present */ }
    }
    return {
      totalEvents: agg ? Number(agg.c) : 0,
      oldestEvent: agg && agg.oldest ? String(agg.oldest) : null,
      latestEvent: agg && agg.latest ? String(agg.latest) : null,
      dbSizeBytes,
      partitions,
      byDomain,
    };
  }

  close() {
    try { this.db.close(); } catch { /* already closed */ }
  }
}

export { partitionKeyForTimestamp, retentionCutoffISO };
