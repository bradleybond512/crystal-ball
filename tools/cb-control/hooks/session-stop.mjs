#!/usr/bin/env node
// Claude Code Stop hook — marks the session ended in cb-control.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DAEMON = process.env.CB_CONTROL_URL ?? 'http://127.0.0.1:46987';
const TOKEN_PATH = process.env.CB_CONTROL_TOKEN_PATH ?? join(homedir(), '.config', 'cb-control', 'token');

function readStdin() { try { return readFileSync(0, 'utf8'); } catch { return ''; } }
function readToken() { try { return readFileSync(TOKEN_PATH, 'utf8').trim(); } catch { return ''; } }

(async () => {
  const token = readToken();
  if (!token) process.exit(0);
  const raw = readStdin();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch {}
  const id = payload.session_id || payload.sessionId || process.env.CLAUDE_SESSION_ID;
  if (!id) process.exit(0);
  try {
    await fetch(`${DAEMON}/api/hooks/session-stop`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token },
      body: JSON.stringify({ id, exitCode: payload.exitCode ?? null }),
      signal: AbortSignal.timeout(1500),
    });
  } catch {}
  process.exit(0);
})();
