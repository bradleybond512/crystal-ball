import { createHash } from 'node:crypto';

export const MONITOR_EVENT_SCHEMA_VERSION = 1;

const DEFAULT_EVENT_COOLDOWN_MS = 60 * 60_000;
const DEFAULT_MAX_EVENTS = 100;
const MONITOR_SUBJECT = 'monitor.scheduler';
const EVENT_TYPES = new Set(['opened', 'resolved', 'materially_escalated', 'stopped', 'resumed']);

export function reconcileMonitorEvents(rawState, findings, at, options = {}) {
  const previous = validEventState(rawState) ? rawState : emptyEventState();
  const expectedIntervalMs = positiveFinite(options.expectedIntervalMs)
    ?? positiveFinite(previous.schedule?.expectedIntervalMs);
  const stoppedGraceMs = nonNegativeFinite(options.stoppedGraceMs)
    ?? nonNegativeFinite(previous.schedule?.stoppedGraceMs)
    ?? 0;
  const cooldownMs = nonNegativeFinite(options.eventCooldownMs)
    ?? DEFAULT_EVENT_COOLDOWN_MS;
  const maxEvents = boundedEventLimit(options.maxEvents);
  const events = Array.isArray(previous.events) ? [...previous.events] : [];
  const cooldowns = isRecord(previous.cooldowns) ? { ...previous.cooldowns } : {};
  const priorFindings = normalizeActiveFindings(previous.activeFindings);
  const currentFindings = Object.fromEntries(findings.map((finding) => [finding.id, {
    severity: finding.severity,
    summary: finding.summary,
  }]));

  const lastRunAt = finite(previous.schedule?.lastRunAt);
  const stoppedThresholdMs = expectedIntervalMs === null
    ? null
    : Math.max(expectedIntervalMs * 2, stoppedGraceMs);
  if (
    lastRunAt !== null
    && stoppedThresholdMs !== null
    && at >= lastRunAt + stoppedThresholdMs
  ) {
    appendEvent(events, cooldowns, {
      type: 'stopped',
      subject: MONITOR_SUBJECT,
      occurredAt: lastRunAt + stoppedThresholdMs,
      summary: 'The monitor missed its expected run window.',
    }, cooldownMs);
    appendEvent(events, cooldowns, {
      type: 'resumed',
      subject: MONITOR_SUBJECT,
      occurredAt: at,
      summary: 'The monitor completed a cycle after a missed run window.',
    }, cooldownMs);
  }

  for (const finding of findings) {
    const prior = priorFindings[finding.id];
    if (!prior) {
      appendEvent(events, cooldowns, {
        type: 'opened',
        subject: finding.id,
        occurredAt: at,
        toSeverity: finding.severity,
        summary: finding.summary,
      }, cooldownMs);
    } else if (severityRank(finding.severity) > severityRank(prior.severity)) {
      appendEvent(events, cooldowns, {
        type: 'materially_escalated',
        subject: finding.id,
        occurredAt: at,
        fromSeverity: prior.severity,
        toSeverity: finding.severity,
        summary: finding.summary,
      }, cooldownMs);
    }
  }
  for (const [subject, finding] of Object.entries(priorFindings)) {
    if (currentFindings[subject]) continue;
    appendEvent(events, cooldowns, {
      type: 'resolved',
      subject,
      occurredAt: at,
      fromSeverity: finding.severity,
      summary: `${finding.summary} The finding is no longer active.`,
    }, cooldownMs);
  }

  return {
    schemaVersion: MONITOR_EVENT_SCHEMA_VERSION,
    schedule: {
      expectedIntervalMs,
      stoppedGraceMs,
      lastRunAt: at,
      nextRunAt: expectedIntervalMs === null ? null : at + expectedIntervalMs,
      stoppedAt: null,
    },
    activeFindings: currentFindings,
    cooldowns: Object.fromEntries(Object.entries(cooldowns)
      .filter(([, occurredAt]) => at - occurredAt < cooldownMs)),
    events: events.slice(-maxEvents),
  };
}

export function publicMonitorEvents(rawState, at) {
  if (!validEventState(rawState)) {
    return {
      schedule: unknownSchedule(),
      events: [],
    };
  }
  const expectedIntervalMs = positiveFinite(rawState.schedule?.expectedIntervalMs);
  const stoppedGraceMs = nonNegativeFinite(rawState.schedule?.stoppedGraceMs);
  const lastRunAt = finite(rawState.schedule?.lastRunAt);
  const nextRunAt = finite(rawState.schedule?.nextRunAt);
  let status = 'unknown';
  let stoppedAt = null;
  if (expectedIntervalMs !== null && stoppedGraceMs !== null && lastRunAt !== null && at >= lastRunAt) {
    stoppedAt = lastRunAt + Math.max(expectedIntervalMs * 2, stoppedGraceMs);
    if (at >= stoppedAt) {
      status = 'stopped';
    } else {
      status = 'running';
      stoppedAt = null;
    }
  }
  return {
    schedule: {
      schemaVersion: MONITOR_EVENT_SCHEMA_VERSION,
      status,
      expectedIntervalMs,
      stoppedGraceMs,
      lastRunAt,
      nextRunAt,
      stoppedAt,
    },
    events: rawState.events.map(publicEvent),
  };
}

function appendEvent(events, cooldowns, input, cooldownMs) {
  const cooldownKey = `${input.subject}\u0000${input.type}`;
  const previousAt = finite(cooldowns[cooldownKey]);
  if (previousAt !== null && input.occurredAt - previousAt < cooldownMs) return;
  const event = {
    schemaVersion: MONITOR_EVENT_SCHEMA_VERSION,
    id: eventId(input),
    type: input.type,
    subject: input.subject,
    occurredAt: input.occurredAt,
    ...(input.fromSeverity ? { fromSeverity: input.fromSeverity } : {}),
    ...(input.toSeverity ? { toSeverity: input.toSeverity } : {}),
    summary: input.summary,
  };
  if (!events.some((existing) => existing?.id === event.id)) events.push(event);
  cooldowns[cooldownKey] = input.occurredAt;
}

function eventId(event) {
  const stable = [
    MONITOR_EVENT_SCHEMA_VERSION,
    event.type,
    event.subject,
    event.occurredAt,
    event.fromSeverity ?? '',
    event.toSeverity ?? '',
  ].join('\u0000');
  return `monitor-event-v1-${createHash('sha256').update(stable).digest('hex').slice(0, 24)}`;
}

function publicEvent(event) {
  return {
    schemaVersion: MONITOR_EVENT_SCHEMA_VERSION,
    id: event.id,
    type: event.type,
    subject: event.subject,
    occurredAt: event.occurredAt,
    ...(event.fromSeverity ? { fromSeverity: event.fromSeverity } : {}),
    ...(event.toSeverity ? { toSeverity: event.toSeverity } : {}),
    summary: event.summary,
  };
}

function emptyEventState() {
  return {
    schemaVersion: MONITOR_EVENT_SCHEMA_VERSION,
    schedule: {},
    activeFindings: {},
    cooldowns: {},
    events: [],
  };
}

function validEventState(value) {
  return value?.schemaVersion === MONITOR_EVENT_SCHEMA_VERSION
    && isRecord(value.schedule)
    && isRecord(value.activeFindings)
    && isRecord(value.cooldowns)
    && Object.keys(value.activeFindings).length <= 1_000
    && Object.entries(value.activeFindings).every(([subject, finding]) => (
      subject.length > 0
      && subject.length <= 512
      && isRecord(finding)
      && (finding.severity === 'yellow' || finding.severity === 'red')
      && typeof finding.summary === 'string'
      && finding.summary.length <= 2_000
    ))
    && Object.keys(value.cooldowns).length <= 2_000
    && Object.entries(value.cooldowns).every(([key, at]) => key.length <= 600 && finite(at) !== null)
    && Array.isArray(value.events)
    && value.events.length <= 1_000
    && value.events.every(validStoredEvent);
}

function validStoredEvent(event) {
  return isRecord(event)
    && event.schemaVersion === MONITOR_EVENT_SCHEMA_VERSION
    && typeof event.id === 'string'
    && /^monitor-event-v1-[a-f0-9]{24}$/.test(event.id)
    && EVENT_TYPES.has(event.type)
    && typeof event.subject === 'string'
    && event.subject.length > 0
    && event.subject.length <= 512
    && finite(event.occurredAt) !== null
    && typeof event.summary === 'string'
    && event.summary.length <= 2_000
    && optionalSeverity(event.fromSeverity)
    && optionalSeverity(event.toSeverity);
}

function optionalSeverity(value) {
  return value === undefined || value === 'yellow' || value === 'red';
}

function normalizeActiveFindings(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, finding]) => (
    isRecord(finding)
    && typeof finding.severity === 'string'
    && typeof finding.summary === 'string'
  )));
}

function unknownSchedule() {
  return {
    schemaVersion: MONITOR_EVENT_SCHEMA_VERSION,
    status: 'unknown',
    expectedIntervalMs: null,
    stoppedGraceMs: null,
    lastRunAt: null,
    nextRunAt: null,
    stoppedAt: null,
  };
}

function boundedEventLimit(value) {
  if (!Number.isInteger(value) || value < 1) return DEFAULT_MAX_EVENTS;
  return Math.min(value, 1_000);
}

function severityRank(value) {
  return value === 'red' ? 2 : value === 'yellow' ? 1 : 0;
}

function positiveFinite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegativeFinite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
