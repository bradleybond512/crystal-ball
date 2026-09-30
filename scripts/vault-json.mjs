#!/usr/bin/env node
// Helper for scripts/backup-keys.sh and scripts/restore-keys.sh (R4-BUG-006).
//
// Reads secrets ONLY from stdin (or inherited pipe fds for `merge`) and never
// prints a value: diagnostics name keys and counts only. It never touches the
// Keychain or the filesystem, apart from reading main.rs for the list of
// supported key names.
//
//   normalize [--supported main.rs]  stdin: vault JSON, hex of it, or legacy
//                                     KEY=value lines -> canonical JSON on stdout
//   names                             stdin: canonical JSON -> one name per line
//   count                             stdin: canonical JSON -> number of keys
//   hex                               stdin: text -> lowercase hex
//   merge                             fd 3: current JSON, fd 4: backup JSON ->
//                                     merged JSON on stdout, summary on stderr
//   supported-keys <main.rs>          SUPPORTED_SECRET_KEYS names, one per line
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const HEX = /^(?:[0-9a-f]{2})+$/i;

function fail(message) {
  process.stderr.write(`vault-json: ${message}\n`);
  process.exit(1);
}

function readFd(fd) {
  try {
    return readFileSync(fd, 'utf8');
  } catch (error) {
    fail(`could not read input (${error?.code ?? 'error'})`);
  }
  return '';
}

export function supportedKeys(mainRsText) {
  const block = /const SUPPORTED_SECRET_KEYS: \[&str; \d+\] = \[([\s\S]*?)\];/.exec(mainRsText);
  if (!block) return [];
  return [...block[1].matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]);
}

function fromLegacyLines(text) {
  const vault = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at <= 0) throw new Error('a legacy line is not KEY=value');
    vault[line.slice(0, at)] = line.slice(at + 1);
  }
  return vault;
}

/** Parse vault JSON, its hex form (`security -w` prints hex for non-ASCII data), or legacy KEY=value lines. */
export function normalizeVault(input) {
  let text = input.trim();
  if (text !== '' && !text.startsWith('{') && HEX.test(text)) {
    text = Buffer.from(text, 'hex').toString('utf8').trim();
  }
  let raw;
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error('vault is not valid JSON');
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('vault JSON is not an object');
  } else {
    raw = fromLegacyLines(text);
  }
  const out = {};
  for (const name of Object.keys(raw).sort()) {
    if (!NAME.test(name)) throw new Error('vault contains an invalid key name');
    const value = raw[name];
    if (typeof value !== 'string') throw new Error(`value for ${name} is not a string`);
    if (value.trim() === '') continue;
    out[name] = value.trim();
  }
  return out;
}

/** Merge: backup values override the same names; names only in the current vault are kept. */
export function mergeVaults(current, backup) {
  const merged = { ...current };
  const added = [];
  const updated = [];
  for (const [name, value] of Object.entries(backup)) {
    if (!(name in current)) added.push(name);
    else if (current[name] !== value) updated.push(name);
    merged[name] = value;
  }
  const kept = Object.keys(current).filter((name) => !(name in backup));
  const sorted = Object.fromEntries(Object.keys(merged).sort().map((name) => [name, merged[name]]));
  return { merged: sorted, added: added.sort(), updated: updated.sort(), kept: kept.sort() };
}

function parseCanonical(text) {
  try {
    return normalizeVault(text);
  } catch (error) {
    fail(error.message);
  }
  return {};
}

function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case 'normalize': {
      const vault = parseCanonical(readFd(0));
      const supportedAt = rest.indexOf('--supported');
      if (supportedAt !== -1 && rest[supportedAt + 1]) {
        const supported = new Set(supportedKeys(readFileSync(rest[supportedAt + 1], 'utf8')));
        const unknown = Object.keys(vault).filter((name) => supported.size > 0 && !supported.has(name));
        if (unknown.length > 0) process.stderr.write(`note: not used by this app version: ${unknown.join(' ')}\n`);
      }
      process.stdout.write(JSON.stringify(vault));
      return;
    }
    case 'names': {
      for (const name of Object.keys(parseCanonical(readFd(0)))) process.stdout.write(`${name}\n`);
      return;
    }
    case 'count': {
      process.stdout.write(`${Object.keys(parseCanonical(readFd(0))).length}\n`);
      return;
    }
    case 'hex': {
      process.stdout.write(Buffer.from(readFd(0), 'utf8').toString('hex'));
      return;
    }
    case 'merge': {
      const { merged, added, updated, kept } = mergeVaults(parseCanonical(readFd(3)), parseCanonical(readFd(4)));
      const list = (names) => (names.length > 0 ? ` (${names.join(' ')})` : '');
      process.stderr.write(`merge: ${added.length} added${list(added)}, ${updated.length} updated${list(updated)}, ${kept.length} kept from the current vault${list(kept)}\n`);
      process.stdout.write(JSON.stringify(merged));
      return;
    }
    case 'supported-keys': {
      if (!rest[0]) fail('supported-keys needs the path to main.rs');
      for (const name of supportedKeys(readFileSync(rest[0], 'utf8'))) process.stdout.write(`${name}\n`);
      return;
    }
    default: {
      fail(`unknown command: ${command ?? '(none)'}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
