#!/usr/bin/env node
/* eslint-disable sonarjs/no-os-command-from-path -- CI/dev tooling: git on PATH is intentional; all args are fixed or a git ref. */
// Dependency release-age gate (R4-SEC-002 step 3).
//
// Hijacked releases are usually caught and pulled within hours to days. A PR
// that brings in a package version published less than MIN_AGE_DAYS ago fails
// here, so a bad release has time to be detected before it can land. The PR's
// lockfiles are compared with the BASE branch's (via `git show`, so there is no
// baseline file to tamper with); every registry package version that is new in
// the head is looked up:
//   - npm:       https://registry.npmjs.org/<name>  -> time[<version>]
//   - crates.io: https://crates.io/api/v1/crates/<name>/<version> -> version.created_at
// Unreadable publish times fail closed. Bradley can approve an urgent change
// (for example a security fix) with the `dependency-age-reviewed` label.
//
// Usage: node scripts/check-dependency-age.mjs [--base <git-ref>] [--labels "a,b"]
//        (labels also from the PR_LABELS env var)
// Exit: 0 clean or approved, 1 too new or unknown, 2 base ref unreadable.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MIN_AGE_DAYS = 7;
export const OVERRIDE_LABEL = 'dependency-age-reviewed';
export const NPM_LOCKFILES = ['package-lock.json', 'tools/mcp-server/package-lock.json'];
export const CARGO_LOCKFILES = ['src-tauri/Cargo.lock'];
const DAY_MS = 24 * 60 * 60 * 1000;
const NPM_REGISTRY = 'https://registry.npmjs.org/';
const CRATES_REGISTRY_SOURCES = new Set([
  'registry+https://github.com/rust-lang/crates.io-index',
  'sparse+https://index.crates.io/',
]);
const LOOKUP_CONCURRENCY = 6;
const LOOKUP_TIMEOUT_MS = 10_000;
const USER_AGENT = 'crystal-ball-ci (https://github.com/bradleybond512/crystal-ball)';

/** npm lockfile v2/v3 → registry versions `name@version`, plus non-registry entries. */
export function npmRegistryVersions(lock) {
  const versions = new Set();
  const skipped = new Set();
  const packages = lock && typeof lock.packages === 'object' && lock.packages !== null ? lock.packages : {};
  for (const [key, entry] of Object.entries(packages)) {
    if (!key.includes('node_modules/') || !entry || typeof entry !== 'object' || entry.link === true) continue;
    const name = typeof entry.name === 'string' ? entry.name : key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const version = typeof entry.version === 'string' ? entry.version : '';
    const resolved = typeof entry.resolved === 'string' ? entry.resolved : '';
    if (resolved.startsWith(NPM_REGISTRY) && version) versions.add(`${name}@${version}`);
    else skipped.add(`${name}@${version || resolved || 'unknown'}`);
  }
  return { versions, skipped };
}

/** Cargo.lock → crates.io versions `name@version`, plus git/path entries. */
export function cargoRegistryVersions(text) {
  const versions = new Set();
  const skipped = new Set();
  for (const block of String(text ?? '').split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const field = (key) => block.match(new RegExp(String.raw`^${key} = "([^"\n]*)"$`, 'm'))?.[1];
    const name = field('name');
    const version = field('version');
    const source = field('source');
    if (!name || !version) continue;
    if (source && CRATES_REGISTRY_SOURCES.has(source)) versions.add(`${name}@${version}`);
    else if (source) skipped.add(`${name}@${version}`);
    // No `source`: a workspace/path crate of our own — reviewed as code.
  }
  return { versions, skipped };
}

/** Versions present in the head lockfile but not the base one. */
export function newVersions(base, head) {
  return [...head].filter((entry) => !base.has(entry)).sort();
}

function splitSpec(spec) {
  const at = spec.lastIndexOf('@');
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Publish time (ms) of one version, or throws. Documents are cached per package. */
export function createPublishTimeLookup(fetchImpl) {
  const npmDocs = new Map();
  return async function lookup(ecosystem, spec) {
    const { name, version } = splitSpec(spec);
    let iso;
    if (ecosystem === 'npm') {
      if (!npmDocs.has(name)) npmDocs.set(name, fetchJson(fetchImpl, `${NPM_REGISTRY}${name.replace('/', '%2F')}`));
      const doc = await npmDocs.get(name);
      iso = doc?.time?.[version];
    } else {
      const doc = await fetchJson(fetchImpl, `https://crates.io/api/v1/crates/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
      iso = doc?.version?.created_at;
    }
    const at = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
    if (!Number.isFinite(at)) throw new Error('no publish time');
    return at;
  };
}

/** Look up every spec (bounded concurrency); results keep the input order. */
export async function lookupAges(items, lookup, now) {
  const results = Array.from({ length: items.length });
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      const { ecosystem, spec, file } = items[index];
      try {
        const publishedAt = await lookup(ecosystem, spec);
        results[index] = { ecosystem, spec, file, ageDays: (now - publishedAt) / DAY_MS };
      } catch (error) {
        results[index] = { ecosystem, spec, file, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, items.length) }, () => worker()));
  return results;
}

/** Too-new and unknown versions both block; a version exactly MIN_AGE_DAYS old passes. */
export function blockingResults(results, minAgeDays = MIN_AGE_DAYS) {
  return results.filter((r) => r.error !== undefined || r.ageDays < minAgeDays);
}

function gitShow(ref, file) {
  try {
    return execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null; // absent at base: everything in the head counts as new
  }
}

function parseJsonOrThrow(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

/** The new registry versions across every lockfile, with what was skipped. */
export function collectNewVersions(baseRef) {
  const items = [];
  const skipped = [];
  for (const file of NPM_LOCKFILES) {
    if (!existsSync(file)) continue;
    const head = npmRegistryVersions(parseJsonOrThrow(readFileSync(file, 'utf8'), file));
    const baseText = gitShow(baseRef, file);
    const base = npmRegistryVersions(baseText === null ? {} : parseJsonOrThrow(baseText, `${baseRef}:${file}`));
    for (const spec of newVersions(base.versions, head.versions)) items.push({ ecosystem: 'npm', spec, file });
    skipped.push(...newVersions(base.skipped, head.skipped).map((spec) => `${file}: ${spec}`));
  }
  for (const file of CARGO_LOCKFILES) {
    if (!existsSync(file)) continue;
    const head = cargoRegistryVersions(readFileSync(file, 'utf8'));
    const base = cargoRegistryVersions(gitShow(baseRef, file) ?? '');
    for (const spec of newVersions(base.versions, head.versions)) items.push({ ecosystem: 'cargo', spec, file });
    skipped.push(...newVersions(base.skipped, head.skipped).map((spec) => `${file}: ${spec}`));
  }
  return { items, skipped };
}

export async function runAgeGate({ baseRef, labels, fetchImpl = fetch, now = Date.now(), log = console.log }) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], { stdio: 'ignore' });
  } catch {
    log(`[dependency-age] cannot read base ref "${baseRef}"; failing closed.`);
    return 2;
  }
  const { items, skipped } = collectNewVersions(baseRef);
  for (const entry of skipped) log(`[dependency-age] not from a registry (reviewed as code): ${entry}`);
  if (items.length === 0) {
    log('[dependency-age] OK — no new registry package versions.');
    return 0;
  }
  const results = await lookupAges(items, createPublishTimeLookup(fetchImpl), now);
  for (const r of results) {
    const age = r.error === undefined ? `${r.ageDays.toFixed(1)} days old` : `publish time unknown (${r.error})`;
    log(`[dependency-age] ${r.file}: ${r.spec} — ${age}`);
  }
  const blocking = blockingResults(results);
  if (blocking.length === 0) {
    log(`[dependency-age] OK — ${results.length} new version(s), all at least ${MIN_AGE_DAYS} days old.`);
    return 0;
  }
  if (labels.includes(OVERRIDE_LABEL)) {
    log(`[dependency-age] ${blocking.length} version(s) approved by the "${OVERRIDE_LABEL}" label.`);
    return 0;
  }
  log(`[dependency-age] ${blocking.length} version(s) are under ${MIN_AGE_DAYS} days old or could not be checked. Wait, or have Bradley review and apply "${OVERRIDE_LABEL}".`);
  return 1;
}

async function main(argv) {
  const baseAt = argv.indexOf('--base');
  const baseRef = baseAt === -1 ? 'origin/main' : argv[baseAt + 1];
  const labelsAt = argv.indexOf('--labels');
  const rawLabels = labelsAt === -1 ? (process.env.PR_LABELS ?? '') : argv[labelsAt + 1] ?? '';
  const labels = rawLabels.split(',').map((label) => label.trim()).filter(Boolean);
  if (!baseRef) {
    console.log('[dependency-age] --base needs a ref');
    return 2;
  }
  return runAgeGate({ baseRef, labels });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
