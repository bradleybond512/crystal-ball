/**
 * .env.local fallback loader for the sidecar.
 *
 * Why this exists: a 2026-05-08 incident wiped the macOS Keychain entries
 * for `crystal-ball/secrets-vault` and `crystal-ball/CESIUM_ION_TOKEN`,
 * forcing manual re-entry of 29 API credentials. This loader reads a
 * plaintext `.env.local` if the keychain is empty so a wipe doesn't
 * brick the running app — Brad keeps a synced copy of `.env.local` in
 * iCloud Drive (see `scripts/backup-keys.sh`).
 *
 * Pure parser is exported for tests; IO sits in `loadEnvFile`.
 */

import { readFileSync, statSync } from 'node:fs';

/**
 * Parse a `.env.local` blob into a Map<key, value>. Handles:
 *  - blank lines and `# comments`
 *  - leading `export ` (sourced shell scripts)
 *  - surrounding double or single quotes around values
 *  - whitespace around the `=` sign
 *  - trailing whitespace on the value
 *
 * Lines that don't match `KEY=value` are silently skipped — recovery
 * tooling shouldn't crash on a malformed line.
 */
export function parseEnvFile(content) {
  const out = new Map();
  if (typeof content !== 'string') return out;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/^﻿/, '').trim();
    if (line === '' || line.startsWith('#')) continue;
    const stripped = line.replace(/^export\s+/, '');
    const eq = stripped.indexOf('=');
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue;
    let value = stripped.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

/**
 * Read `path` and apply each KEY=value to `env`, but never overwrite an
 * already-set var. Returns the number of keys actually applied so the
 * caller can log "loaded N fallback keys from .env.local".
 *
 * Returns 0 (no error thrown) when the file is missing — fallback is
 * advisory; a real keychain read should still be the primary source.
 *
 * Also returns 0 (refuses to load) when the file is group- or
 * world-readable. Plaintext credentials must live in a 0600 file; loading
 * from a looser mode would leak every API key to any local user, so we
 * warn and decline rather than silently regress after the initial chmod.
 */
export function loadEnvFile(path, env = process.env) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return 0; // missing or unreadable — fallback is advisory
  }
  if ((stat.mode & 0o077) !== 0) {
    console.warn(
      `[env-local-loader] WARNING: ${path} is readable by other users ` +
      `(mode ${(stat.mode & 0o777).toString(8)}). ` +
      `Run \`chmod 600 ${path}\` to fix. Refusing to load plaintext credentials from an insecure file.`
    );
    return 0;
  }
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return 0;
  }
  console.info('[env-local-loader] INFO: Loading API keys from plaintext .env.local fallback (keychain unavailable).');
  const parsed = parseEnvFile(content);
  let applied = 0;
  for (const [key, value] of parsed) {
    if (env[key] === undefined || env[key] === '') {
      env[key] = value;
      applied += 1;
    }
  }
  return applied;
}
