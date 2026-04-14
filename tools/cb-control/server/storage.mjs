// SQLite persistence: session registry, event log, FTS5 search index.

import Database from 'better-sqlite3';
import { config } from './config.mjs';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    label TEXT,
    cwd TEXT NOT NULL,
    branch TEXT,
    pid INTEGER,
    status TEXT NOT NULL DEFAULT 'running',
    created_at INTEGER NOT NULL,
    ended_at INTEGER,
    exit_code INTEGER,
    source TEXT NOT NULL DEFAULT 'daemon',
    tmux_pane TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS events_session_ts ON events(session_id, ts);
`);

// Lightweight schema evolution: add columns if missing.
function ensureColumn(table, column, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}
ensureColumn('sessions', 'tmux_pane', 'TEXT');

// FTS5 virtual table + triggers for full-text search over event payloads.
// We index kind + payload text; session_id is a filter column.
// External-content FTS would be nicer but keeps the schema simpler as an
// independent table with a trigger-maintained link.
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
    session_id UNINDEXED,
    kind,
    payload,
    tokenize = 'porter unicode61'
  );

  CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
    INSERT INTO events_fts(rowid, session_id, kind, payload)
    VALUES (new.id, new.session_id, new.kind, COALESCE(new.payload, ''));
  END;

  CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
    DELETE FROM events_fts WHERE rowid = old.id;
  END;
`);

const insertSession = db.prepare(`
  INSERT INTO sessions (id, label, cwd, branch, pid, status, created_at, source, tmux_pane)
  VALUES (@id, @label, @cwd, @branch, @pid, @status, @created_at, @source, @tmux_pane)
  ON CONFLICT(id) DO UPDATE SET
    label = excluded.label,
    cwd = excluded.cwd,
    branch = excluded.branch,
    pid = excluded.pid,
    status = excluded.status,
    tmux_pane = COALESCE(excluded.tmux_pane, sessions.tmux_pane)
`);

const updateSessionStatus = db.prepare(`
  UPDATE sessions SET status = ?, ended_at = ?, exit_code = ? WHERE id = ?
`);

const selectSessions = db.prepare(`
  SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?
`);

const selectRunningExternal = db.prepare(`
  SELECT * FROM sessions WHERE status = 'running' AND source = 'external' AND tmux_pane IS NOT NULL
`);

const selectSession = db.prepare(`SELECT * FROM sessions WHERE id = ?`);

const insertEvent = db.prepare(`
  INSERT INTO events (session_id, ts, kind, payload) VALUES (?, ?, ?, ?)
`);

const selectEvents = db.prepare(`
  SELECT * FROM events WHERE session_id = ? AND id > ? ORDER BY id ASC LIMIT ?
`);

// FTS query: joins back to events + sessions to build a helpful result row.
const searchEvents = db.prepare(`
  SELECT
    e.id           AS event_id,
    e.session_id   AS session_id,
    e.ts           AS ts,
    e.kind         AS kind,
    snippet(events_fts, 2, '<mark>', '</mark>', '…', 16) AS snippet,
    s.label        AS label,
    s.cwd          AS cwd,
    s.status       AS status
  FROM events_fts
  JOIN events   e ON e.id = events_fts.rowid
  JOIN sessions s ON s.id = e.session_id
  WHERE events_fts MATCH ?
  ORDER BY e.ts DESC
  LIMIT ?
`);

export const storage = {
  upsertSession(row) {
    insertSession.run({
      id: row.id,
      label: row.label ?? null,
      cwd: row.cwd,
      branch: row.branch ?? null,
      pid: row.pid ?? null,
      status: row.status ?? 'running',
      created_at: row.created_at ?? Date.now(),
      source: row.source ?? 'daemon',
      tmux_pane: row.tmux_pane ?? null,
    });
  },
  markEnded(id, exitCode) {
    updateSessionStatus.run('ended', Date.now(), exitCode ?? null, id);
  },
  listSessions(limit = 100) {
    return selectSessions.all(limit);
  },
  listRunningExternalWithTmux() {
    return selectRunningExternal.all();
  },
  getSession(id) {
    return selectSession.get(id);
  },
  appendEvent(sessionId, kind, payload) {
    insertEvent.run(sessionId, Date.now(), kind, payload == null ? null : JSON.stringify(payload));
  },
  readEvents(sessionId, afterId = 0, limit = 500) {
    return selectEvents.all(sessionId, afterId, limit);
  },
  /** Full-text search. Query string is passed to FTS5 directly. */
  search(query, limit = 50) {
    if (!query || typeof query !== 'string') return [];
    // Protect against FTS5 syntax errors by quoting the whole query as a phrase
    // unless the caller wrote an explicit FTS operator (AND/OR/NOT).
    const hasOp = /\b(AND|OR|NOT|NEAR)\b|"/.test(query);
    const q = hasOp ? query : '"' + query.replace(/"/g, '""') + '"';
    try { return searchEvents.all(q, limit); }
    catch { return []; }
  },
};
