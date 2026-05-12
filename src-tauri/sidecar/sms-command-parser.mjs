import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const DEFAULT_CONFIG_PATH = path.join(homedir(), '.config', 'crystalball', 'sms-config.json');
const VALID_DOMAINS = new Set(['earthquake', 'wildfire', 'aviation', 'weather', 'cyber']);
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function defaultConfig() {
  return { enabled: false, allowlist: [] };
}

export function loadSmsConfig(configPath = DEFAULT_CONFIG_PATH) {
  try {
    const raw = readFileSync(configPath, 'utf8');
    return { ...defaultConfig(), ...JSON.parse(raw) };
  } catch {
    return defaultConfig();
  }
}

export function saveSmsConfig(config, configPath = DEFAULT_CONFIG_PATH) {
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function normalizePhone(num) {
  return String(num).replace(/\D/g, '');
}

export function isAllowed(from, allowlist) {
  if (!allowlist || allowlist.length === 0) return false;
  const norm = normalizePhone(from);
  return allowlist.some(entry => normalizePhone(entry) === norm);
}

export function checkRateLimit(from, rateLimitMap) {
  const norm = normalizePhone(from);
  const entry = rateLimitMap.get(norm);
  const now = Date.now();
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    return { allowed: true, remaining: RATE_LIMIT_MAX, resetInMin: 60 };
  }
  const elapsed = now - entry.windowStart;
  const resetInMin = Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 60_000);
  const remaining = Math.max(0, RATE_LIMIT_MAX - entry.count);
  return { allowed: entry.count < RATE_LIMIT_MAX, remaining, resetInMin };
}

export function recordRateLimit(from, rateLimitMap) {
  const norm = normalizePhone(from);
  const now = Date.now();
  const entry = rateLimitMap.get(norm);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(norm, { windowStart: now, count: 1 });
  } else {
    entry.count += 1;
  }
}

export function parseCommand(body) {
  if (!body) return null;
  const trimmed = body.trim().toUpperCase();
  if (!trimmed.startsWith('CB ') && trimmed !== 'CB') return null;
  const rest = trimmed.slice(2).trim();
  if (!rest) return null;
  const parts = rest.split(/\s+/);
  const cmd = parts[0] ?? '';
  if (!cmd) return null;
  const rawDomain = parts[1] ? parts[1].toLowerCase() : null;
  let domain = null;
  if (rawDomain) {
    domain = VALID_DOMAINS.has(rawDomain) ? rawDomain : `unknown:${rawDomain}`;
  }
  return { cmd, domain };
}

export function formatStatusResponse(analystState) {
  if (!analystState) return 'CB: No analyst state available.';
  const posture = analystState.posture ?? 'unknown';
  const entityCount = analystState.entities?.length ?? 0;
  const threads = (analystState.threads ?? []).slice(0, 3);
  const threadLines = threads.map(t => `• ${t.label ?? t.id}: ${t.confidence ?? '?'}`).join('\n');
  return [
    `CB Status: ${posture.toUpperCase()}`,
    `Entities tracked: ${entityCount}`,
    threads.length > 0 ? `Top threads:\n${threadLines}` : 'No active threads.',
  ].join('\n');
}

export function formatBriefResponse(analystState) {
  if (!analystState) return 'CB: No analyst data available for brief.';
  const threads = analystState.threads ?? [];
  if (threads.length === 0) return 'CB Brief: No active hypotheses.';
  const debugLog = analystState.debugLog?.[0];
  if (debugLog) return `CB Brief: ${debugLog}`;
  const top = threads[0];
  return `CB Brief: ${top.label ?? top.id} — confidence ${top.confidence ?? '?'}`;
}

export function formatAlertsResponse(threads, domain) {
  if (!threads || threads.length === 0) return 'CB: No active alerts.';
  let filtered = threads;
  if (domain && !domain.startsWith('unknown:')) {
    filtered = threads.filter(t => t.domain === domain);
  }
  if (filtered.length === 0) return `CB: No alerts for domain "${domain}".`;
  const listed = filtered.slice(0, 5);
  const lines = listed.map(t => `• [${t.domain ?? '?'}] ${t.label ?? t.id}`).join('\n');
  const heading = domain ? `CB Alerts (${domain})` : 'CB Alerts';
  return `${heading}:\n${lines}`;
}

export function formatFeedsResponse(feedSnapshots) {
  if (!feedSnapshots || feedSnapshots.length === 0) return 'CB: No feed data tracked yet.';
  const now = Date.now();
  const staleThresh = 30 * 60 * 1000;
  const stale = feedSnapshots.filter(s => s.lastSuccessAt && (now - s.lastSuccessAt) > staleThresh);
  const errored = feedSnapshots.filter(s => s.lastError);
  return [
    `CB Feeds: ${feedSnapshots.length} tracked`,
    `Stale (>30m): ${stale.length}`,
    `Errored: ${errored.length}`,
  ].join('\n');
}

export function formatHelpResponse() {
  return [
    'CB Commands:',
    'CB STATUS — current posture + top threads',
    'CB BRIEF — top hypothesis detail',
    'CB ALERTS [domain] — active alerts (earthquake/wildfire/aviation/weather/cyber)',
    'CB FEEDS — feed health summary',
    'CB HELP — this message',
  ].join('\n');
}

export function formatUnknownResponse(body) {
  return `CB: Unknown command "${String(body ?? '').slice(0, 30)}". Reply CB HELP for options.`;
}

export async function handleSmsCommand({ from, body, analystState, feedSnapshots, allowlist, rateLimitMap, commandLog }) {
  if (!isAllowed(from, allowlist)) {
    return { text: 'Unauthorized.', status: 403 };
  }

  const rl = checkRateLimit(from, rateLimitMap);
  if (!rl.allowed) {
    return { text: `Rate limit exceeded. Try again in ${rl.resetInMin} min.`, status: 429 };
  }

  recordRateLimit(from, rateLimitMap);

  const parsed = parseCommand(body);
  let text;

  if (parsed) {
    const { cmd, domain } = parsed;
    switch (cmd) {
      case 'STATUS': {
        text = formatStatusResponse(analystState);
        break;
      }
      case 'BRIEF': {
        text = formatBriefResponse(analystState);
        break;
      }
      case 'ALERTS': {
        text = formatAlertsResponse(analystState?.threads ?? [], domain);
        break;
      }
      case 'FEEDS': {
        text = formatFeedsResponse(feedSnapshots);
        break;
      }
      case 'HELP': {
        text = formatHelpResponse();
        break;
      }
      default: {
        text = formatUnknownResponse(body);
      }
    }
  } else {
    text = formatUnknownResponse(body);
  }

  if (commandLog) {
    commandLog.unshift({ from: normalizePhone(from), body, response: text, at: Date.now() });
    if (commandLog.length > 20) commandLog.length = 20;
  }

  return { text, status: 200 };
}
