// Session manager. Two kinds of sessions:
//
//   1. "managed" — the daemon spawned Claude inside a PTY. We own stdin/stdout.
//   2. "external" — user launched `claude` in a terminal. If that terminal is
//      tmux, we bridge I/O via `tmux send-keys` + `tmux pipe-pane`. Otherwise
//      it's metadata-only.
//
// Both surface the same interface through sessionBus + sessions.get(), so
// the HTTP + WebSocket layers don't care which kind they're driving.

import { spawn as ptySpawn } from 'node-pty';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { storage } from './storage.mjs';
import { config } from './config.mjs';
import * as tmux from './tmux-bridge.mjs';

const RING_SIZE = 200_000;

export const sessionBus = new EventEmitter();
sessionBus.setMaxListeners(0);

/** @type {Map<string, ManagedSession>} */
const managed = new Map();

/** @type {Map<string, ExternalTmuxSession>} */
const externals = new Map();

// --------------------------- Managed (PTY) ---------------------------------

class ManagedSession {
  constructor({ id, label, cwd, argv, env }) {
    this.id = id;
    this.label = label ?? 'claude';
    this.cwd = cwd;
    this.kind = 'managed';
    this.status = 'running';
    this.ring = Buffer.alloc(0);
    this.createdAt = Date.now();

    this.pty = ptySpawn(argv[0], argv.slice(1), {
      name: 'xterm-256color', cols: 120, rows: 40, cwd,
      env: { ...process.env, ...env, TERM: 'xterm-256color' },
    });
    this.pid = this.pty.pid;

    this.pty.onData((data) => {
      const chunk = Buffer.from(data, 'utf8');
      this.ring = this.ring.length + chunk.length > RING_SIZE
        ? Buffer.concat([this.ring.subarray(this.ring.length + chunk.length - RING_SIZE), chunk])
        : Buffer.concat([this.ring, chunk]);
      sessionBus.emit('data', { id: this.id, data });
    });

    this.pty.onExit(({ exitCode, signal }) => {
      this.status = 'ended';
      storage.markEnded(this.id, exitCode);
      storage.appendEvent(this.id, 'exit', { exitCode, signal });
      sessionBus.emit('exit', { id: this.id, exitCode, signal });
      managed.delete(this.id);
    });

    storage.upsertSession({
      id: this.id, label: this.label, cwd, pid: this.pid,
      status: 'running', created_at: this.createdAt, source: 'daemon',
    });
    storage.appendEvent(this.id, 'spawn', { argv, cwd });
  }

  write(input)      { if (this.status === 'running') this.pty.write(input); }
  resize(cols, rows){ if (this.status === 'running') { try { this.pty.resize(cols, rows); } catch {} } }
  kill(signal='SIGTERM'){ if (this.status === 'running') { try { this.pty.kill(signal); } catch {} } }
  snapshot()        { return this.ring.toString('utf8'); }
}

// ------------------------ External (tmux bridge) ---------------------------

class ExternalTmuxSession {
  constructor({ id, label, cwd, pane, branch, pid, rehydrated = false }) {
    this.id = id;
    this.label = label ?? 'external';
    this.cwd = cwd;
    this.pane = pane;
    this.kind = 'external-tmux';
    this.status = 'running';
    this.watcher = null;

    storage.upsertSession({
      id, label: this.label, cwd, branch, pid,
      status: 'running', source: 'external', tmux_pane: pane,
    });
    // Only log a new "register" event on first registration — rehydration
    // after a daemon restart is an implementation detail, not a user event.
    if (!rehydrated) storage.appendEvent(id, 'register', { branch, pid, pane });

    // Enable pipe-pane so subsequent pane output gets written to a log file
    // we can tail. Idempotent (`-o` skips if already piping).
    tmux.attachPane(id, pane);

    // Start streaming immediately so multiple subscribers share one watcher.
    this.watcher = tmux.watchLog(id, (chunk) => {
      sessionBus.emit('data', { id: this.id, data: chunk });
    });
  }

  write(input) {
    if (this.status !== 'running') return;
    // If input ends with \r we split it into literal+Enter for tmux, which
    // treats \r as a key it does not accept literally.
    const hasCR = input.endsWith('\r') || input.endsWith('\n');
    const literal = hasCR ? input.slice(0, -1) : input;
    if (literal) tmux.sendText(this.pane, literal);
    if (hasCR) tmux.sendKey(this.pane, 'Enter');
  }
  resize(){ /* tmux panes size with the tmux window; no-op */ }
  kill(){
    if (this.status !== 'running') return;
    this.status = 'ended';
    try { this.watcher?.stop(); } catch {}
    tmux.detachPane(this.pane);
    storage.markEnded(this.id, null);
    sessionBus.emit('exit', { id: this.id, exitCode: null });
    externals.delete(this.id);
  }
  snapshot() {
    // Prefer the tmux capture (has the live scrollback) over the log file,
    // which only has bytes written since pipe-pane started.
    const cap = tmux.capture(this.pane, { lines: 2000 });
    return cap || '';
  }
}

// ---------------------------- Public API -----------------------------------

export const sessions = {
  spawn({ cwd, label, args = [], env = {} }) {
    const id = randomUUID();
    const argv = [config.claudeBinary, ...args];
    const s = new ManagedSession({ id, label, cwd, argv, env });
    managed.set(id, s);
    return s;
  },

  registerExternal({ id, label, cwd, branch, pid, tmuxPane }) {
    // If we already have it live, refresh metadata and keep the watcher.
    const existing = externals.get(id);
    if (existing) {
      storage.upsertSession({
        id, label: label ?? existing.label, cwd, branch, pid,
        status: 'running', source: 'external', tmux_pane: tmuxPane ?? existing.pane,
      });
      return existing;
    }

    if (tmuxPane && tmux.paneExists(tmuxPane)) {
      const s = new ExternalTmuxSession({ id, label, cwd, pane: tmuxPane, branch, pid });
      externals.set(id, s);
      sessionBus.emit('register', { id });
      return s;
    }

    // Fallback: metadata-only (no I/O bridge)
    storage.upsertSession({
      id, label: label ?? 'external', cwd, branch, pid,
      status: 'running', source: 'external', tmux_pane: null,
    });
    storage.appendEvent(id, 'register', { branch, pid });
    sessionBus.emit('register', { id });
    return null;
  },

  markExternalEnded(id, exitCode) {
    const s = externals.get(id);
    if (s) s.kill();
    else {
      storage.markEnded(id, exitCode ?? null);
      storage.appendEvent(id, 'exit', { exitCode: exitCode ?? null, external: true });
      sessionBus.emit('exit', { id, exitCode: exitCode ?? null });
    }
  },

  /** Returns a writable session (managed or bridged external) or null. */
  get(id) {
    return managed.get(id) ?? externals.get(id) ?? null;
  },

  has(id) { return managed.has(id) || externals.has(id); },

  /** Rich detail for the list view: merges durable row with live flags. */
  list() {
    const durable = storage.listSessions(200);
    return durable.map((row) => ({
      ...row,
      live: this.has(row.id),
      bridge: externals.has(row.id) ? 'tmux' : managed.has(row.id) ? 'pty' : null,
    }));
  },

  snapshot(id) {
    const s = this.get(id);
    return s ? s.snapshot() : '';
  },

  /** On daemon startup, re-attach to any external tmux sessions still alive. */
  rehydrate() {
    const rows = storage.listRunningExternalWithTmux();
    for (const row of rows) {
      if (!row.tmux_pane) continue;
      if (!tmux.paneExists(row.tmux_pane)) {
        storage.markEnded(row.id, null);
        continue;
      }
      const s = new ExternalTmuxSession({
        id: row.id, label: row.label, cwd: row.cwd, pane: row.tmux_pane,
        branch: row.branch, pid: row.pid, rehydrated: true,
      });
      externals.set(row.id, s);
    }
  },

  shutdownAll() {
    for (const s of managed.values()) s.kill('SIGTERM');
    for (const s of externals.values()) {
      try { s.watcher?.stop(); } catch {}
      // Leave tmux pipe-pane in place — the pane is still a real terminal.
    }
  },
};

process.on('SIGINT',  () => { sessions.shutdownAll(); process.exit(0); });
process.on('SIGTERM', () => { sessions.shutdownAll(); process.exit(0); });
