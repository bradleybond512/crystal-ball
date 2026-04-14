#!/usr/bin/env node
// Claude Code SessionStart hook.
// Reads the hook payload from stdin, extracts session metadata, and
// registers the session with the cb-control daemon so it shows up in the PWA.
//
// Fails silently on any error (missing daemon, missing token, network): a
// hook must never block a session from starting.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const DAEMON = process.env.CB_CONTROL_URL ?? 'http://127.0.0.1:46987';
const TOKEN_PATH = process.env.CB_CONTROL_TOKEN_PATH ?? join(homedir(), '.config', 'cb-control', 'token');

function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

function readToken() {
  try { return readFileSync(TOKEN_PATH, 'utf8').trim(); } catch { return ''; }
}

function currentBranch(cwd) {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch { return null; }
}

(async () => {
  const token = readToken();
  if (!token) process.exit(0);

  const raw = readStdin();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { /* stdin may be empty */ }

  const body = {
    id: payload.session_id || payload.sessionId || process.env.CLAUDE_SESSION_ID || `cli-${process.pid}-${Date.now()}`,
    cwd: payload.cwd || process.cwd(),
    label: payload.label || `cli:${(payload.cwd || process.cwd()).split('/').pop()}`,
    branch: currentBranch(payload.cwd || process.cwd()),
    pid: process.ppid,
  };

  try {
    const res = await fetch(`${DAEMON}/api/hooks/session-start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + token,
      },
      body: JSON.stringify(body),
      // short timeout so a dead daemon can't slow Claude startup
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) process.exit(0);
  } catch { /* ignore */ }
  process.exit(0);
})();
