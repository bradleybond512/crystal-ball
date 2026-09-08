#!/usr/bin/env node
// Diagnose a Claude Code CLI that will not stay logged in.
//
// Read-only by default. `--fix` removes only leftover config scratch files we
// already own; every credential-adjacent remediation is printed for you to run
// deliberately. This tool NEVER invokes `security(1)` — see CLAUDE.md.

import {
  accessSync,
  constants,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  statfsSync,
} from 'node:fs';
import { homedir, userInfo } from 'node:os';
import path from 'node:path';
import { autoFixableFindings, buildClaudeAuthReport } from './claude-auth-core.mjs';

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  console.log(`Claude Code login doctor

Usage:
  npm run doctor:claude-auth
  npm run doctor:claude-auth -- --json
  npm run doctor:claude-auth -- --fix

Options:
  --json   Print the report as JSON (home path redacted).
  --fix    Delete leftover config scratch files. Nothing else is modified.
  --help   Show this help.`);
  process.exit(0);
}

const HOME = homedir();
const CONFIG_PATH = path.join(HOME, '.claude.json');
const CLAUDE_DIR = path.join(HOME, '.claude');
const CREDENTIALS_PATH = path.join(CLAUDE_DIR, '.credentials.json');
const STRAY_PATTERN = /^\.claude\.json\.(tmp[\w.-]*|lock|swp)$/;

const report = buildClaudeAuthReport(collectProbe());

if (options.json) {
  console.log(JSON.stringify(redactHome(report), null, 2));
} else {
  printReport(report);
}

if (options.fix) applyFixes(report);

process.exit(report.status === 'red' ? 1 : 0);

function collectProbe() {
  const info = userInfo();
  return {
    platform: process.platform,
    uid: info.uid,
    gid: info.gid,
    home: HOME,
    configPath: CONFIG_PATH,
    config: inspectPath(CONFIG_PATH, { parseJson: true }),
    claudeDir: inspectPath(CLAUDE_DIR),
    credentialsFile: inspectPath(CREDENTIALS_PATH),
    strayFiles: findStrayFiles(),
    diskFreeBytes: freeBytes(HOME),
    env: readAuthEnv(),
    envSources: findEnvSources(),
    installs: findInstalls(),
  };
}

function inspectPath(target, { parseJson = false } = {}) {
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    return { exists: false, path: target };
  }
  const resolved = stat.isSymbolicLink() ? safeRealpath(target) : target;
  // A symlink's own stat says nothing about the file it points at.
  const effective = stat.isSymbolicLink() ? safeStat(resolved) ?? stat : stat;

  const result = {
    exists: true,
    path: target,
    realPath: resolved,
    isSymlink: stat.isSymbolicLink(),
    uid: effective.uid,
    gid: effective.gid,
    mode: effective.mode,
    size: effective.size,
    writable: canWrite(target),
  };

  if (parseJson) {
    try {
      const parsed = JSON.parse(readFileSync(target, 'utf8'));
      result.hasOAuthAccount = Boolean(parsed?.oauthAccount);
    } catch (err) {
      // A zero-byte file is reported as empty, not as a parse failure.
      if (result.size > 0) result.parseError = err.message;
    }
  }
  return result;
}

function findStrayFiles() {
  try {
    return readdirSync(HOME).filter((name) => STRAY_PATTERN.test(name));
  } catch {
    return [];
  }
}

function readAuthEnv() {
  const names = [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ];
  // Presence only — values are secrets and never leave this function.
  return Object.fromEntries(names.map((name) => [name, Boolean(process.env[name])]));
}

function findEnvSources() {
  const files = [
    '.zshrc', '.zprofile', '.zshenv', '.zlogin',
    '.bashrc', '.bash_profile', '.profile',
    path.join('.config', 'fish', 'config.fish'),
  ];
  const pattern = /^\s*(?:export\s+|set\s+-[gx]+\s+)([A-Z_]*(?:ANTHROPIC|CLAUDE)[A-Z_]*)\b/;
  const sources = [];
  for (const rel of files) {
    const file = path.join(HOME, rel);
    let lines;
    try {
      lines = readFileSync(file, 'utf8').split('\n');
    } catch {
      continue;
    }
    lines.forEach((line, index) => {
      const match = pattern.exec(line);
      if (match) sources.push({ file: rel, line: index + 1, variable: match[1] });
    });
  }
  return sources;
}

function findInstalls() {
  const seen = new Set();
  const installs = [];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, 'claude');
    try {
      accessSync(candidate, constants.X_OK);
    } catch {
      continue;
    }
    // Two PATH entries pointing at one binary are one install, not two.
    const real = safeRealpath(candidate);
    if (seen.has(real)) continue;
    seen.add(real);
    installs.push({ path: candidate, realPath: real });
  }
  return installs;
}

function applyFixes(current) {
  const fixable = autoFixableFindings(current);
  if (fixable.length === 0) {
    console.log('\nNothing safe to auto-fix. Apply the fixes above by hand.');
    return;
  }
  for (const item of fixable) {
    for (const name of item.paths ?? []) {
      // Re-validate independently of the finding: only ever delete a plain
      // scratch file that sits directly in $HOME and matches the pattern.
      if (!STRAY_PATTERN.test(name)) continue;
      const target = path.join(HOME, name);
      if (path.dirname(target) !== HOME) continue;
      let stat;
      try {
        stat = lstatSync(target);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      rmSync(target);
      console.log(`Removed leftover ${name}`);
    }
  }
}

function printReport(current) {
  const icon = { ok: '✓', yellow: '!', red: '✗' }[current.status];
  console.log(`${icon} Claude CLI login: ${current.status.toUpperCase()} (${current.platform})`);
  if (current.findings.length === 0) {
    console.log('\nNo known logout cause found. If the session still drops, capture');
    console.log('`claude --debug` output from the launch that loses it.');
    return;
  }
  for (const item of current.findings) {
    const tag = item.severity === 'red' ? 'BLOCKER' : 'WARN';
    console.log(`\n[${tag}] ${item.title}`);
    console.log(`  ${item.detail}`);
    console.log(`  Fix: ${item.fix}`);
  }
}

function redactHome(value) {
  return JSON.parse(JSON.stringify(value).split(HOME).join('~'));
}

function canWrite(target) {
  try {
    accessSync(target, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function freeBytes(target) {
  try {
    const stats = statfsSync(target);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

function safeRealpath(target) {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

function safeStat(target) {
  try {
    return statSync(target);
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  return {
    help: argv.includes('--help') || argv.includes('-h'),
    json: argv.includes('--json'),
    fix: argv.includes('--fix'),
  };
}

