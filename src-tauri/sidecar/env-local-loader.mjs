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

import { existsSync, readFileSync } from 'node:fs';

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
 */
export function loadEnvFile(path, env = process.env) {
  if (!existsSync(path)) return 0;
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return 0;
  }
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
