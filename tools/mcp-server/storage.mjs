import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_BASE = join(homedir(), '.crystal-ball');

export function createStorage(baseDir = DEFAULT_BASE) {
  // Resolve a caller-supplied relative path under baseDir and REFUSE anything
  // that escapes the sandbox (`../`, an absolute path, a null byte). Caller
  // input — e.g. an MCP watchlist `name` — reaches here, so without this guard a
  // name like `../../.ssh/authorized_keys` would read/write/delete outside
  // ~/.crystal-ball. Defense-in-depth for every tool that touches storage.
  function resolve(relPath) {
    const str = String(relPath);
    if (str.includes('\0')) throw new Error('Invalid path');
    const full = join(baseDir, str);
    const rel = relative(baseDir, full);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Path escapes storage sandbox: ${relPath}`);
    }
    return full;
  }

  function readJSON(relPath) {
    try {
      const raw = readFileSync(resolve(relPath), 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeJSON(relPath, data) {
    const full = resolve(relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, JSON.stringify(data, null, 2));
  }

  function appendToArray(relPath, item) {
    const existing = readJSON(relPath);
    const arr = Array.isArray(existing) ? existing : [];
    arr.push(item);
    writeJSON(relPath, arr);
  }

  function listFiles(subdir, pattern) {
    try {
      const dir = resolve(subdir);
      const files = readdirSync(dir);
      if (pattern === '*.json') return files.filter(f => f.endsWith('.json'));
      return files;
    } catch {
      return [];
    }
  }

  function pruneOlderThan(subdir, days) {
    const cutoff = Date.now() - days * 86400000;
    const dir = resolve(subdir);
    for (const file of listFiles(subdir, '*.json')) {
      try {
        const full = join(dir, file);
        const stat = statSync(full);
        if (stat.mtimeMs < cutoff) unlinkSync(full);
      } catch { /* ignore */ }
    }
  }

  return { readJSON, writeJSON, appendToArray, listFiles, pruneOlderThan, resolve };
}
