#!/usr/bin/env node
import { accessSync, constants, lstatSync, openSync, closeSync, fstatSync, readSync, readdirSync, realpathSync, statSync, statfsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AUTH_ENV_VARS, buildClaudeAuthReport, isConfigScratchFile } from './claude-auth-core.mjs';

const MAX_TEXT_BYTES = 1024 * 1024;
const SHELL_FILES = ['.zshrc', '.zprofile', '.zshenv', '.zlogin', '.bashrc', '.bash_profile', '.profile', '.config/fish/config.fish'];

export function collectProbe({ home = homedir(), env = process.env, platform = process.platform } = {}) {
  const configPath = path.join(home, '.claude.json');
  return {
    platform,
    uid: process.getuid?.(),
    home,
    configPath,
    config: inspectPath(configPath, true),
    claudeDir: inspectPath(path.join(home, '.claude')),
    credentialsFile: inspectPath(path.join(home, '.claude', '.credentials.json')),
    strayFiles: scratchFiles(home),
    diskFreeBytes: freeBytes(home),
    env: Object.fromEntries(AUTH_ENV_VARS.map((name) => [name, Boolean(env[name])])),
    envSources: findEnvSources(home),
    installs: findInstalls(env.PATH ?? ''),
  };
}

export function runDoctor(argv, options = {}) {
  const { stdout = process.stdout, stderr = process.stderr, collect = collectProbe } = options;
  if (argv.some((arg) => !['--json', '--help', '-h'].includes(arg))) {
    stderr.write('Unsupported argument. Use --help for this read-only diagnostic.\n');
    return 2;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    stdout.write('Claude Code login doctor (strictly read-only)\n\nUsage: npm run doctor:claude-auth -- [--json | --help | -h]\n\nInspects local metadata without changing files, invoking Claude or accessing Keychain.\nResults do not verify authentication or session validity.\n');
    return 0;
  }
  try {
    const probe = collect(options);
    const report = redactHome(buildClaudeAuthReport(probe), probe.home);
    stdout.write(argv.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : renderReport(report));
    return report.status === 'red' ? 1 : 0;
  } catch {
    stderr.write('Diagnostic collection failed. No changes were made.\n');
    return 1;
  }
}

function inspectPath(target, parseJson = false) {
  let entry;
  try {
    entry = lstatSync(target);
  } catch (error) {
    return error.code === 'ENOENT' ? { exists: false } : { readError: true };
  }
  let effective;
  let realPath;
  try {
    realPath = realpathSync(target);
    effective = entry.isSymbolicLink() ? statSync(target) : entry;
  } catch {
    return { exists: true, readError: true };
  }
  const result = { exists: true, realPath, isSymlink: entry.isSymbolicLink(), uid: effective.uid, mode: effective.mode, size: effective.size, writable: canWrite(target) };
  if (!parseJson) return result;
  let text;
  try {
    text = readBoundedText(target);
  } catch {
    result.readError = true;
    return result;
  }
  if (text.length === 0) { result.size = 0; return result; }
  try {
    const parsed = JSON.parse(text);
    result.hasOAuthAccount = Boolean(parsed?.oauthAccount);
  } catch {
    result.parseError = true;
  }
  return result;
}

function readBoundedText(target) {
  const descriptor = openSync(target, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) throw new Error('Unsupported text file');
    const buffer = Buffer.alloc(MAX_TEXT_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(descriptor, buffer, bytes, buffer.length - bytes, null);
      if (count === 0) break;
      bytes += count;
    }
    if (bytes > MAX_TEXT_BYTES) throw new Error('Text file exceeds limit');
    return buffer.subarray(0, bytes).toString('utf8');
  } finally {
    closeSync(descriptor);
  }
}

function scratchFiles(home) {
  try { return readdirSync(home).filter((name) => isConfigScratchFile(name)); } catch { return []; }
}

function findEnvSources(home) {
  const sources = [];
  for (const file of SHELL_FILES) {
    let text;
    try { text = readBoundedText(path.join(home, file)); } catch { continue; }
    for (const [index, line] of text.split('\n').entries()) {
      const match = /^\s*(?:export\s+|set\s+-[gx]+\s+)([A-Z_]+)\b/.exec(line);
      if (match && AUTH_ENV_VARS.includes(match[1])) sources.push({ file, line: index + 1, variable: match[1] });
    }
  }
  return sources;
}

function findInstalls(searchPath) {
  const seen = new Set();
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, 'claude');
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) seen.add(realpathSync(candidate));
    } catch { /* Missing or inaccessible PATH entries are not executable evidence. */ }
  }
  return Array.from(seen, () => ({ executable: true }));
}

function canWrite(target) {
  try { accessSync(target, constants.W_OK); return true; } catch { return false; }
}

function freeBytes(home) {
  try { const stat = statfsSync(home); return Number(stat.bavail) * Number(stat.bsize); } catch { return null; }
}

function redactHome(value, home) {
  if (typeof value === 'string') return home ? value.split(home).join('~') : value;
  if (Array.isArray(value)) return value.map((item) => redactHome(item, home));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactHome(item, home)]));
  return value;
}

function renderReport(report) {
  const lines = [`Claude CLI metadata: ${report.status.toUpperCase()} (${report.platform})`, 'Read-only observations; authentication and session validity were not verified.'];
  if (!report.findings.length) lines.push('No listed metadata concerns found.');
  for (const item of report.findings) lines.push('', `[${item.severity === 'red' ? 'BLOCKER' : 'WARN'}] ${item.title}`, `  ${item.detail}`, `  Guidance: ${item.fix}`);
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = runDoctor(process.argv.slice(2));
}
