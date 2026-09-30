#!/usr/bin/env node
/* eslint-disable sonarjs/no-os-command-from-path -- CI/dev tooling: git on PATH is intentional; all args are fixed or a git ref. */
// Install-script drift gate (R4-SEC-002).
//
// A supply-chain worm's defining move is shipping a new version of a package
// that suddenly has an install script (or a new command that shadows a tool
// our npm scripts call). Install scripts are disabled by `.npmrc`, but that
// setting is one PR away from removal, and CI/review should see the change
// either way. This gate compares the PR's lockfiles with the BASE branch's
// (via `git show`, so there is no baseline file to tamper with) and fails when:
//   - a package gains `hasInstallScript` (new package or existing one);
//   - a package that has an install script changes version;
//   - a package gains a `bin` command name it did not have.
// Removals pass and are reported. Bradley can approve a flagged change by
// applying the `install-scripts-reviewed` label to the PR.
//
// Usage: node scripts/check-install-script-drift.mjs [--base <git-ref>]
//        (labels from --labels "a,b" or the PR_LABELS env var)
// Exit: 0 clean or approved, 1 unapproved drift, 2 base ref unreadable.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const LOCKFILES = ['package-lock.json', 'tools/mcp-server/package-lock.json'];
export const OVERRIDE_LABEL = 'install-scripts-reviewed';

/** Packages with install scripts (key -> version) and bin names (key -> names). */
export function installSurface(lock) {
  const scripted = new Map();
  const bins = new Map();
  const packages = lock && typeof lock.packages === 'object' && lock.packages !== null ? lock.packages : {};
  for (const [key, entry] of Object.entries(packages)) {
    // '' is our own root project; its scripts are reviewed as code.
    if (!key || !entry || typeof entry !== 'object') continue;
    if (entry.hasInstallScript === true) scripted.set(key, String(entry.version ?? ''));
    if (entry.bin && typeof entry.bin === 'object') {
      bins.set(key, Object.keys(entry.bin).sort());
    } else if (typeof entry.bin === 'string') {
      bins.set(key, [key.split('node_modules/').pop()]);
    }
  }
  return { scripted, bins };
}

export function diffInstallSurface(base, head) {
  const findings = [];
  for (const [key, version] of head.scripted) {
    if (!base.scripted.has(key)) findings.push({ kind: 'new-install-script', key, version });
    else if (base.scripted.get(key) !== version) findings.push({ kind: 'scripted-version-change', key, from: base.scripted.get(key), version });
  }
  for (const [key, names] of head.bins) {
    const before = new Set(base.bins.get(key));
    const added = names.filter((name) => !before.has(name));
    if (added.length > 0) findings.push({ kind: 'new-bin', key, bins: added });
  }
  const removed = [...base.scripted.keys()].filter((key) => !head.scripted.has(key));
  return { findings, removed };
}

export function describeFinding(finding) {
  switch (finding.kind) {
    case 'new-install-script': {
      return `NEW install script: ${finding.key}@${finding.version}`;
    }
    case 'scripted-version-change': {
      return `install-script package changed version: ${finding.key} ${finding.from} -> ${finding.version}`;
    }
    default: {
      return `NEW command(s) ${finding.bins.join(', ')} from ${finding.key}`;
    }
  }
}

function parseLock(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function readBaseLock(ref, file) {
  try {
    return parseLock(execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }), `${ref}:${file}`);
  } catch (error) {
    if (error instanceof Error && error.message.endsWith('is not valid JSON')) throw error;
    return null; // file absent at base: everything in the head counts as new
  }
}

export function runGate({ baseRef, labels, log = console.log }) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], { stdio: 'ignore' });
  } catch {
    log(`[install-script-drift] cannot read base ref "${baseRef}"; failing closed.`);
    return 2;
  }
  const approved = labels.includes(OVERRIDE_LABEL);
  let unapproved = 0;
  for (const file of LOCKFILES) {
    if (!existsSync(file)) continue;
    const head = installSurface(parseLock(readFileSync(file, 'utf8'), file));
    const base = installSurface(readBaseLock(baseRef, file) ?? {});
    const { findings, removed } = diffInstallSurface(base, head);
    for (const key of removed) log(`[install-script-drift] ${file}: install script removed: ${key} (ok)`);
    for (const finding of findings) log(`[install-script-drift] ${file}: ${describeFinding(finding)}`);
    unapproved += findings.length;
  }
  if (unapproved === 0) {
    log('[install-script-drift] OK — no new install scripts or commands.');
    return 0;
  }
  if (approved) {
    log(`[install-script-drift] ${unapproved} change(s) approved by the "${OVERRIDE_LABEL}" label.`);
    return 0;
  }
  log(`[install-script-drift] ${unapproved} change(s) need Bradley's review: inspect each package, then apply the "${OVERRIDE_LABEL}" label.`);
  return 1;
}

function main(argv) {
  const baseAt = argv.indexOf('--base');
  const baseRef = baseAt === -1 ? 'origin/main' : argv[baseAt + 1];
  const labelsAt = argv.indexOf('--labels');
  const rawLabels = labelsAt === -1 ? (process.env.PR_LABELS ?? '') : argv[labelsAt + 1] ?? '';
  const labels = rawLabels.split(',').map((label) => label.trim()).filter(Boolean);
  if (!baseRef) {
    console.log('[install-script-drift] --base needs a ref');
    return 2;
  }
  return runGate({ baseRef, labels });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
