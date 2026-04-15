// tmux bridge for external Claude CLI sessions.
//
// External sessions — those launched in a real terminal by the user —
// can become fully interactive as long as they run inside tmux. The
// SessionStart hook reports $TMUX_PANE; this module uses the tmux command
// line to:
//   - inject keystrokes   via `tmux send-keys`
//   - mirror live output  via `tmux pipe-pane -o "cat >> <logfile>"`
//
// One log file per session is opened for append by tmux. We tail it with
// fs.watch and emit new bytes over the session event bus, exactly like
// managed PTY sessions do. So the PWA treats the two identically.

import { spawnSync } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { createReadStream, watch, statSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.mjs';

const PANES_DIR = join(config.dataDir, 'panes');
mkdirSync(PANES_DIR, { recursive: true });

function paneLogPath(sessionId) {
  // sessionId is a UUID or cli-<pid>-<ts>; both safe as filenames.
  return join(PANES_DIR, `${sessionId}.log`);
}

/** Runs a tmux command, returns {ok, stdout, stderr}. */
function tmux(args, { input } = {}) {
  const res = spawnSync('tmux', args, {
    encoding: 'utf8',
    input,
    timeout: 3000,
  });
  return {
    ok: res.status === 0,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    error: res.error,
  };
}

/** Returns true if a pane exists in any tmux server. */
export function paneExists(pane) {
  if (!pane) return false;
  const r = tmux(['display-message', '-p', '-t', pane, '#{pane_id}']);
  return r.ok && r.stdout.trim().length > 0;
}

/**
 * Attach to an external session's tmux pane: enable pipe-pane to a log file.
 * Idempotent (uses `-o` to skip if already piping).
 */
export function attachPane(sessionId, pane) {
  const log = paneLogPath(sessionId);
  // Ensure file exists so fs.watch can start before tmux writes.
  try { if (!existsSync(log)) fsp.writeFile(log, ''); } catch {}
  // Quote the log path once — tmux will re-parse the command.
  const quoted = log.replace(/'/g, "'\\''");
  const r = tmux(['pipe-pane', '-o', '-t', pane, `cat >> '${quoted}'`]);
  return { ok: r.ok, log, error: r.stderr || r.error?.message };
}

/** Disable pipe-pane for the pane (called on Stop). */
export function detachPane(pane) {
  if (!pane) return;
  tmux(['pipe-pane', '-t', pane]);
}

/**
 * Send text to the pane. We use `-l` (literal) so ANSI/control bytes aren't
 * re-parsed as tmux key names. For Ctrl/special keys, use sendKey().
 */
export function sendText(pane, text) {
  if (!pane || !text) return { ok: false, error: 'no pane or text' };
  const r = tmux(['send-keys', '-t', pane, '-l', text]);
  return { ok: r.ok, error: r.stderr || r.error?.message };
}

/** Send a named key ("Enter", "C-c", "Escape", etc.) */
export function sendKey(pane, keyName) {
  if (!pane || !keyName) return { ok: false };
  const r = tmux(['send-keys', '-t', pane, keyName]);
  return { ok: r.ok, error: r.stderr || r.error?.message };
}

/**
 * Convenience: send text + Enter (the typical "relay a command" action).
 * Sends text literally, then the Enter key name.
 */
export function relayCommand(pane, text, { enter = true } = {}) {
  if (text) {
    const r1 = sendText(pane, text);
    if (!r1.ok) return r1;
  }
  if (enter) return sendKey(pane, 'Enter');
  return { ok: true };
}

/**
 * Snapshot the pane's current visible contents + scrollback.
 * Used to bootstrap a PWA client before live tailing kicks in.
 */
export function capture(pane, { lines = 2000 } = {}) {
  if (!pane) return '';
  const r = tmux(['capture-pane', '-t', pane, '-p', '-J', '-e', '-S', String(-lines)]);
  return r.ok ? r.stdout : '';
}

/**
 * Watch a pane's pipe-pane log file and emit new bytes via callback.
 * Returns { stop } to cancel the watcher.
 *
 * We use a polling fallback alongside fs.watch because macOS fs.watch on
 * append-only files is unreliable — watch can miss writes, especially on
 * APFS network volumes. A 500ms poll interval is cheap and robust.
 */
export function watchLog(sessionId, onData) {
  const log = paneLogPath(sessionId);
  let offset = 0;
  try { offset = existsSync(log) ? statSync(log).size : 0; } catch { offset = 0; }

  let stopped = false;
  let reading = false;

  const drain = async () => {
    if (stopped || reading) return;
    reading = true;
    try {
      const stat = existsSync(log) ? statSync(log) : null;
      if (!stat) { reading = false; return; }
      if (stat.size < offset) offset = 0; // truncation
      if (stat.size > offset) {
        await new Promise((resolve) => {
          const stream = createReadStream(log, { start: offset, end: stat.size - 1, encoding: 'utf8' });
          let buf = '';
          stream.on('data', (chunk) => { buf += chunk; });
          stream.on('end', () => { offset = stat.size; if (buf) onData(buf); resolve(); });
          stream.on('error', () => resolve());
        });
      }
    } finally { reading = false; }
  };

  // Initial snapshot replay if log already has content.
  drain();

  let watcher = null;
  try { watcher = watch(log, { persistent: false }, () => { drain(); }); }
  catch { /* fs.watch unsupported — polling still works */ }

  const interval = setInterval(drain, 500);

  return {
    stop() {
      stopped = true;
      try { watcher?.close(); } catch {}
      clearInterval(interval);
    },
  };
}

/** Read the entire pane log file (used for HTTP snapshot endpoint). */
export async function readLog(sessionId, { maxBytes = 200_000 } = {}) {
  const log = paneLogPath(sessionId);
  try {
    if (!existsSync(log)) return '';
    const s = statSync(log);
    const start = Math.max(0, s.size - maxBytes);
    return await new Promise((resolve) => {
      const stream = createReadStream(log, { start, encoding: 'utf8' });
      let buf = '';
      stream.on('data', (c) => { buf += c; });
      stream.on('end', () => resolve(buf));
      stream.on('error', () => resolve(''));
    });
  } catch { return ''; }
}
