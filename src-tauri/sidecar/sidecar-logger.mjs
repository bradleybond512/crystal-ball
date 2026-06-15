/**
 * Sidecar JSON file logger with size-based rotation.
 *
 * Writes single-line JSON to <dir>/sidecar.log.
 * Rotates to sidecar.log.1 (and deletes .{keep+1}) when file size
 * exceeds maxBytes. Also mirrors warn/error to the console so Tauri's
 * stdout capture keeps working.
 *
 * Invariants:
 *  - Never throws from a log call — all appends are try/catch'd.
 *  - Console mirror happens even when the file append fails.
 *  - Default dir is ~/Library/Logs/com.bradleybond.crystalball on Darwin,
 *    os.tmpdir() elsewhere.
 */

import { appendFileSync, chmodSync, renameSync, unlinkSync, existsSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { homedir, tmpdir } from 'node:os';

const { join } = path;

function defaultLogDir() {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Logs', 'com.bradleybond.crystalball');
  }
  return tmpdir();
}

/**
 * Create a sidecar logger that writes JSON lines to <dir>/sidecar.log.
 *
 * @param {object} opts
 * @param {string}  [opts.dir]       Directory for log files. Default: platform-dependent.
 * @param {number}  [opts.maxBytes]  Rotate when file exceeds this size. Default 5_000_000.
 * @param {number}  [opts.keep]      Number of rotated files to keep. Default 2.
 * @param {object}  [opts.console]   Console to mirror warn/error to. Default: global console.
 * @param {() => number} [opts.now]  Clock function. Default: Date.now.
 */
export function createSidecarLogger(opts = {}) {
  const dir = opts.dir ?? defaultLogDir();
  const maxBytes = opts.maxBytes ?? 5_000_000;
  const keep = opts.keep ?? 2;
  const con = opts.console ?? console;
  const now = opts.now ?? (() => Date.now());

  const logPath = join(dir, 'sidecar.log');
  let logPermsSet = false;

  function rotate() {
    // Delete overflow: sidecar.log.{keep}
    const overflow = join(dir, `sidecar.log.${keep}`);
    try { if (existsSync(overflow)) unlinkSync(overflow); } catch { /* ignore */ }

    // Shift existing rotated files: .{n-1} → .{n}
    for (let i = keep - 1; i >= 1; i--) {
      const suffix = i === 0 ? '' : `.${i}`;
      const from = join(dir, `sidecar.log${suffix}`);
      const to = join(dir, `sidecar.log.${i + 1}`);
      try { if (existsSync(from)) renameSync(from, to); } catch { /* ignore */ }
    }

    // Rename current log to .1
    try { if (existsSync(logPath)) renameSync(logPath, join(dir, 'sidecar.log.1')); } catch { /* ignore */ }
    logPermsSet = false;
  }

  function appendLine(line) {
    try {
      mkdirSync(dir, { recursive: true });
      // Check size before append
      try {
        const size = statSync(logPath).size;
        if (size >= maxBytes) rotate();
      } catch { /* file doesn't exist yet, skip */ }
      appendFileSync(logPath, line, 'utf8');
      if (!logPermsSet) {
        try { chmodSync(logPath, 0o600); } catch { /* best effort */ }
        logPermsSet = true;
      }
      // Post-write rotation: if the file grew past maxBytes after append,
      // rotate now so the log can never grow unbounded. Concurrent-instance
      // races may cause slightly early/late rotation — that is acceptable.
      try {
        const sizeAfter = statSync(logPath).size;
        if (sizeAfter >= maxBytes) rotate();
      } catch { /* ignore */ }
    } catch { /* never propagate */ }
  }

  function mirrorToConsole(level, msg, fields) {
    // Throwing injected console must not propagate.
    try {
      if (level === 'warn') {
        con.warn(`[sidecar] ${msg}`, fields ?? '');
      } else if (level === 'error') {
        con.error(`[sidecar] ${msg}`, fields ?? '');
      }
    } catch { /* never propagate */ }
  }

  function write(level, msg, fields) {
    // Serialize inside try/catch — circular refs or BigInt fields must not throw.
    let line;
    try {
      const record = { at: now(), level, msg, ...fields };
      line = JSON.stringify(record) + '\n';
    } catch {
      try {
        line = JSON.stringify({ at: Date.now(), level, msg, _serializeErr: true }) + '\n';
      } catch { /* give up on the line */ }
    }

    if (line !== undefined) appendLine(line);
    mirrorToConsole(level, msg, fields);
  }

  return {
    info(msg, fields) { write('info', msg, fields); },
    warn(msg, fields) { write('warn', msg, fields); },
    error(msg, fields) { write('error', msg, fields); },
    /** Alias of info — provided so callers using logger.log() work correctly. */
    log(msg, fields) { write('info', msg, fields); },
    child(extra) {
      return {
        info(msg, fields) { write('info', msg, { ...extra, ...fields }); },
        warn(msg, fields) { write('warn', msg, { ...extra, ...fields }); },
        error(msg, fields) { write('error', msg, { ...extra, ...fields }); },
        log(msg, fields) { write('info', msg, { ...extra, ...fields }); },
      };
    },
  };
}
