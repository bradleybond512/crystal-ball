// SMS command parser + orchestrator.
//
// The parser is pure: parseCommand(body) -> { command, args, isValid, error? }.
// It strips three prefix variants (CB, CBall, crystal ball) case-insensitively
// before matching. Unknown commands fail with a descriptive error rather than
// returning null so the caller can surface a helpful response.
//
// handleSmsCommand wires the parser, sms-security, and sms-response-formatter
// into the route handler the sidecar imports. loadSmsConfig / saveSmsConfig
// preserve the legacy { enabled, allowlist } config shape on disk so the
// existing /api/sms/config endpoint and SmsSettingsPanel keep working — under
// the hood the allowlist now uses the tier-aware AllowedNumber shape.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  loadAllowlist,
  saveAllowlist,
  isAllowed,
  isDestructiveCommand,
  checkRateLimit,
  recordRateLimit,
  logCommand,
  DEFAULT_ALLOWLIST_PATH,
} from './sms-security.mjs';
import {
  formatStatus,
  formatBrief,
  formatSitrep,
  formatHelp,
  formatWatchConfirm,
  formatAlertConfirm,
  formatError,
  formatUnauthorized,
  segmentCount,
} from './sms-response-formatter.mjs';

const DEFAULT_CONFIG_PATH = path.join(homedir(), '.config', 'crystalball', 'sms-config.json');
const KNOWN_COMMANDS = new Set(['STATUS', 'BRIEF', 'WATCH', 'ALERT', 'SITREP', 'HELP']);
const PREFIX_PATTERN = /^\s*(?:crystal\s+ball|cball|cb)\b/i;

export function parseCommand(body) {
  const text = String(body ?? '').trim();
  if (!text) {
    return { command: null, args: [], isValid: false, error: 'empty' };
  }
  const match = PREFIX_PATTERN.exec(text);
  if (!match) {
    return { command: null, args: [], isValid: false, error: 'missing_prefix' };
  }
  const rest = text.slice(match[0].length).trim();
  if (!rest) {
    return { command: null, args: [], isValid: false, error: 'missing_command' };
  }
  const parts = rest.split(/\s+/);
  const head = (parts[0] ?? '').toUpperCase();
  if (!KNOWN_COMMANDS.has(head)) {
    return { command: null, args: [], isValid: false, error: `unknown:${head}` };
  }
  const args = parts.slice(1);
  return { command: head, args, isValid: true };
}

export function loadSmsConfig(configPath = DEFAULT_CONFIG_PATH, allowlistPath = DEFAULT_ALLOWLIST_PATH) {
  let enabled = false;
  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    enabled = Boolean(parsed?.enabled);
  } catch {
    // missing file -> defaults
  }
  const allowlist = loadAllowlist(allowlistPath);
  return { enabled, allowlist };
}

export function saveSmsConfig(config, configPath = DEFAULT_CONFIG_PATH, allowlistPath = DEFAULT_ALLOWLIST_PATH) {
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ enabled: Boolean(config?.enabled) }, null, 2), { mode: 0o600 });
  saveAllowlist(config?.allowlist ?? [], allowlistPath);
}

function runCommand(parsed, context) {
  const { analystState, feedSnapshots } = context;
  switch (parsed.command) {
    case 'STATUS':
      return { text: formatStatus(analystState, feedSnapshots), outcome: 'status' };
    case 'BRIEF':
      return { text: formatBrief(analystState), outcome: 'brief' };
    case 'SITREP':
      return { text: formatSitrep(analystState, feedSnapshots), outcome: 'sitrep' };
    case 'WATCH': {
      const keyword = parsed.args.join(' ').trim();
      const text = formatWatchConfirm(keyword);
      const outcome = keyword ? `watch:${keyword.slice(0, 32)}` : 'watch:invalid';
      if (keyword && context.watchRegistry) {
        context.watchRegistry.push({ keyword, addedBy: context.from, at: Date.now() });
        if (context.watchRegistry.length > 100) context.watchRegistry.length = 100;
      }
      return { text, outcome };
    }
    case 'ALERT': {
      const [thresholdStr, domain] = parsed.args;
      const text = formatAlertConfirm(thresholdStr, domain);
      const threshold = Number(thresholdStr);
      const ok = Number.isFinite(threshold) && threshold >= 0 && threshold <= 1 && Boolean(domain);
      if (ok && context.alertRegistry) {
        context.alertRegistry.push({ threshold, domain: String(domain).toLowerCase(), addedBy: context.from, at: Date.now() });
        if (context.alertRegistry.length > 100) context.alertRegistry.length = 100;
      }
      return { text, outcome: ok ? `alert:${threshold}:${domain}` : 'alert:invalid' };
    }
    case 'HELP':
    default:
      return { text: formatHelp(), outcome: 'help' };
  }
}

export async function handleSmsCommand({
  from,
  body,
  analystState,
  feedSnapshots,
  allowlist,
  rateLimitMap,
  commandLog,
  watchRegistry,
  alertRegistry,
}) {
  const parsed = parseCommand(body);

  if (!parsed.isValid) {
    const text = `${formatError(parsed.error)}\n${formatHelp()}`;
    logCommand(from, String(body ?? ''), `invalid:${parsed.error ?? 'unknown'}`, commandLog);
    return { text, status: 200, segments: segmentCount(text) };
  }

  const requiredTier = isDestructiveCommand(parsed.command) ? 'admin' : 'readonly';
  const auth = isAllowed(from, allowlist, requiredTier);
  if (!auth.allowed) {
    const text = formatUnauthorized(auth.reason);
    logCommand(from, parsed.command, `denied:${auth.reason}`, commandLog);
    return { text, status: 403, segments: segmentCount(text) };
  }

  const rl = checkRateLimit(from, rateLimitMap);
  if (!rl.allowed) {
    const text = `CB: rate limit reached. Try in ${rl.resetInMin} min.`;
    logCommand(from, parsed.command, 'denied:rate_limit', commandLog);
    return { text, status: 429, segments: segmentCount(text) };
  }
  recordRateLimit(from, rateLimitMap);

  const { text, outcome } = runCommand(parsed, {
    analystState, feedSnapshots, watchRegistry, alertRegistry, from,
  });
  logCommand(from, parsed.command, outcome, commandLog);
  return { text, status: 200, segments: segmentCount(text) };
}
