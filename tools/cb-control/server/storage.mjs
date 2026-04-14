// SQLite persistence: session registry + transcript ring buffer.
// Sessions are spawned in-memory (see sessions.mjs); this table is the
// durable record of what existed, when, and the last captured output.

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
    source TEXT NOT NULL DEFAULT 'daemon'
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

const insertSession = db.prepare(`
  INSERT INTO sessions (id, label, cwd, branch, pid, status, created_at, source)
  VALUES (@id, @label, @cwd, @branch, @pid, @status, @created_at, @source)
  ON CONFLICT(id) DO UPDATE SET
    label = excluded.label,
    cwd = excluded.cwd,
    branch = excluded.branch,
    pid = excluded.pid,
    status = excluded.status
`);

const updateSessionStatus = db.prepare(`
  UPDATE sessions SET status = ?, ended_at = ?, exit_code = ? WHERE id = ?
`);

const selectSessions = db.prepare(`
  SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?
`);

const selectSession = db.prepare(`SELECT * FROM sessions WHERE id = ?`);

const insertEvent = db.prepare(`
  INSERT INTO events (session_id, ts, kind, payload) VALUES (?, ?, ?, ?)
`);

const selectEvents = db.prepare(`
  SELECT * FROM events WHERE session_id = ? AND id > ? ORDER BY id ASC LIMIT ?
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
    });
  },
  markEnded(id, exitCode) {
    updateSessionStatus.run('ended', Date.now(), exitCode ?? null, id);
  },
  listSessions(limit = 100) {
    return selectSessions.all(limit);
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
};
