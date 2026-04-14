// In-memory PTY session manager.
//
// Two kinds of sessions exist:
//   1. "managed" — the daemon spawned the Claude CLI itself inside a PTY.
//      We own stdin/stdout, so we can relay commands and stream output.
//   2. "external" — a Claude CLI running somewhere else (e.g. a terminal on
//      the same Mac) registered itself via the SessionStart hook. We have
//      metadata only; input relay goes through a named pipe the hook creates.
//
// The MVP implements (1) fully and (2) as read-only registration.

import { spawn as ptySpawn } from 'node-pty';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { storage } from './storage.mjs';
import { config } from './config.mjs';

const RING_SIZE = 200_000; // bytes of recent output kept per session for replay

export const sessionBus = new EventEmitter();
sessionBus.setMaxListeners(0);

/** @type {Map<string, ManagedSession>} */
const managed = new Map();

class ManagedSession {
  constructor({ id, label, cwd, argv, env }) {
    this.id = id;
    this.label = label ?? 'claude';
    this.cwd = cwd;
    this.status = 'running';
    this.ring = Buffer.alloc(0);
    this.createdAt = Date.now();

    this.pty = ptySpawn(argv[0], argv.slice(1), {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd,
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
      id: this.id,
      label: this.label,
      cwd,
      pid: this.pid,
      status: 'running',
      created_at: this.createdAt,
      source: 'daemon',
    });
    storage.appendEvent(this.id, 'spawn', { argv, cwd });
  }

  write(input) {
    if (this.status !== 'running') return false;
    this.pty.write(input);
    return true;
  }

  resize(cols, rows) {
    if (this.status !== 'running') return;
    try { this.pty.resize(cols, rows); } catch { /* ignore */ }
  }

  kill(signal = 'SIGTERM') {
    if (this.status !== 'running') return;
    try { this.pty.kill(signal); } catch { /* ignore */ }
  }

  snapshot() {
    return this.ring.toString('utf8');
  }
}

export const sessions = {
  spawn({ cwd, label, args = [], env = {} }) {
    const id = randomUUID();
    const argv = [config.claudeBinary, ...args];
    const session = new ManagedSession({ id, label, cwd, argv, env });
    managed.set(id, session);
    return session;
  },

  /** Register an external session that isn't spawned by us (via hook). */
  registerExternal({ id, label, cwd, branch, pid }) {
    storage.upsertSession({
      id,
      label: label ?? 'external',
      cwd,
      branch,
      pid,
      status: 'running',
      created_at: Date.now(),
      source: 'external',
    });
    storage.appendEvent(id, 'register', { branch, pid });
    sessionBus.emit('register', { id });
  },

  markExternalEnded(id, exitCode) {
    storage.markEnded(id, exitCode ?? null);
    storage.appendEvent(id, 'exit', { exitCode: exitCode ?? null, external: true });
    sessionBus.emit('exit', { id, exitCode: exitCode ?? null });
  },

  get(id) {
    return managed.get(id);
  },

  has(id) {
    return managed.has(id);
  },

  list() {
    const durable = storage.listSessions(200);
    return durable.map((row) => ({
      ...row,
      live: managed.has(row.id),
    }));
  },

  snapshot(id) {
    const s = managed.get(id);
    return s ? s.snapshot() : '';
  },

  shutdownAll() {
    for (const s of managed.values()) s.kill('SIGTERM');
  },
};

process.on('SIGINT', () => { sessions.shutdownAll(); process.exit(0); });
process.on('SIGTERM', () => { sessions.shutdownAll(); process.exit(0); });
