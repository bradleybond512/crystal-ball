import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_BASE = join(homedir(), '.crystal-ball');

export function createStorage(baseDir = DEFAULT_BASE) {
  function resolve(relPath) {
    return join(baseDir, relPath);
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
