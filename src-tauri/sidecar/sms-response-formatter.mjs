// SMS-friendly response formatters.
//
// Constraint: prefer fitting in one 160-char GSM-7 SMS segment. Each formatter
// trims aggressively and rejoins lines with '\n' (the carrier counts the
// newline as one char). Multi-segment messages are billed per ~153 chars after
// the first, so longer responses are summarized rather than padded.
//
// All formatters return the text only. Callers compute segment count via
// segmentCount() to expose it in the API response and the audit log.

const SEGMENT_SIZE = 160;
const DOMAIN_LABEL = {
  earthquake: 'EQ',
  wildfire: 'FIRE',
  aviation: 'AVN',
  weather: 'WX',
  cyber: 'CYB',
};

function trim(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + '…';
}

export function segmentCount(text) {
  const len = String(text ?? '').length;
  if (len === 0) return 0;
  if (len <= SEGMENT_SIZE) return 1;
  return Math.ceil(len / 153);
}

function shortDomain(d) {
  if (!d) return '?';
  return DOMAIN_LABEL[d] ?? String(d).slice(0, 4).toUpperCase();
}

export function formatStatus(analystState, feedSnapshots) {
  const posture = String(analystState?.posture ?? 'unknown').toUpperCase();
  const threads = (analystState?.threads ?? []).slice(0, 3);
  const top = threads
    .map(t => `${shortDomain(t.domain)}:${trim(t.label ?? t.id ?? '?', 18)}`)
    .join(' | ');
  const feedTotal = feedSnapshots?.length ?? 0;
  const errored = (feedSnapshots ?? []).filter(s => s?.lastError).length;
  const head = `CB ${posture}`;
  const body = top || 'no active threads';
  const tail = `feeds ${feedTotal - errored}/${feedTotal} ok`;
  return trim(`${head} · ${body}\n${tail}`, SEGMENT_SIZE * 2);
}

export function formatBrief(analystState) {
  const threads = (analystState?.threads ?? []).slice(0, 3);
  if (threads.length === 0) return 'CB Brief: no active hypotheses.';
  const lines = threads.map((t, i) => {
    const conf = typeof t.confidence === 'number' ? ` (${Math.round(t.confidence * 100)}%)` : '';
    return `${i + 1}. ${trim(t.label ?? t.id ?? '?', 40)}${conf}`;
  });
  return trim(['CB Brief:', ...lines].join('\n'), SEGMENT_SIZE * 2);
}

export function formatSitrep(analystState, feedSnapshots) {
  const posture = String(analystState?.posture ?? 'unknown').toUpperCase();
  const top = (analystState?.threads ?? [])[0];
  const topLine = top
    ? `Lead: ${trim(top.label ?? top.id ?? '?', 60)}`
    : 'Lead: none';
  const entityCount = analystState?.entities?.length ?? 0;
  const feedHealth = feedSnapshots?.length
    ? `${(feedSnapshots ?? []).filter(s => !s?.lastError).length}/${feedSnapshots.length} feeds ok`
    : 'no feed data';
  return trim([
    `CB Sitrep: ${posture}`,
    topLine,
    `${entityCount} entities tracked · ${feedHealth}`,
  ].join('\n'), SEGMENT_SIZE * 2);
}

export function formatHelp() {
  return [
    'CB Commands:',
    'STATUS · BRIEF · SITREP',
    'WATCH <keyword> (admin)',
    'ALERT <0-1> <domain> (admin)',
    'HELP',
  ].join('\n');
}

export function formatWatchConfirm(keyword) {
  const kw = trim(String(keyword ?? '').trim(), 40);
  if (!kw) return 'CB: WATCH requires a keyword. Try: CB WATCH cobalt';
  return `CB: watching for "${kw}". Reply CB CANCEL to stop.`;
}

export function formatAlertConfirm(threshold, domain) {
  const t = Number(threshold);
  if (!Number.isFinite(t) || t < 0 || t > 1) {
    return 'CB: ALERT needs threshold 0-1 and a domain.';
  }
  const d = String(domain ?? '').toLowerCase();
  return `CB: alerts on ${shortDomain(d)} when confidence ≥ ${t.toFixed(2)}.`;
}

export function formatError(reason) {
  const r = String(reason ?? '').slice(0, 80);
  return `CB error: ${r || 'unknown'}.`;
}

export function formatUnauthorized(reason) {
  if (reason === 'tier_required') {
    return 'CB: admin tier required for that command.';
  }
  if (reason === 'rate_limit') {
    return 'CB: rate limit reached. Try again later.';
  }
  return 'CB: unauthorized.';
}
