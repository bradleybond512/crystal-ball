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
    generationId: monitorGenerationId(at),
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

export function monitorGenerationId(at) {
  if (!Number.isFinite(at) || at <= 0) throw new Error('Monitor generation timestamp is invalid.');
  return `monitor-generation-v1-${Math.trunc(at)}`;
}

export function validCommittedMonitorState(state, eventState) {
  if (!isRecord(state)
      || state.schemaVersion !== 1
      || state.available !== true
      || !validEventState(eventState)
      || state.generationId !== eventState.generationId) return false;
  const lastRunAt = finite(state.lastRunAt);
  if (lastRunAt === null
      || state.generationId !== monitorGenerationId(lastRunAt)
      || finite(eventState.schedule?.lastRunAt) !== lastRunAt
      || !['green', 'yellow', 'red'].includes(state.status)
      || !Array.isArray(state.findings)
      || !Array.isArray(state.activeIds)
      || !Array.isArray(state.newlyTriggered)
      || !Array.isArray(state.recovered)
      || !isRecord(state.snapshot)
      || finite(state.snapshot.at) !== lastRunAt
      || !isRecord(state.snapshot.feeds)
      || !Array.isArray(state.snapshot.quarantinedAlgorithms)) return false;
  const findings = state.findings;
  if (findings.length > 1_000 || !findings.every(validMonitorFinding)) return false;
  const findingIds = findings.map((finding) => finding.id);
  if (new Set(findingIds).size !== findingIds.length
      || !sameStringSet(state.activeIds, findingIds)
      || !validIdList(state.newlyTriggered)
      || !validIdList(state.recovered)) return false;
  const expectedStatus = findings.some((finding) => finding.severity === 'red')
    ? 'red'
    : findings.length > 0 ? 'yellow' : 'green';
  if (state.status !== expectedStatus) return false;
  const persistedFindings = eventState.activeFindings;
  return sameStringSet(Object.keys(persistedFindings), findingIds)
    && findings.every((finding) => persistedFindings[finding.id]?.severity === finding.severity);
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
    generationId: rawState.generationId,
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
    && /^monitor-generation-v1-\d+$/.test(value.generationId)
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

function validMonitorFinding(finding) {
  return isRecord(finding)
    && typeof finding.id === 'string'
    && finding.id.length > 0
    && finding.id.length <= 512
    && (finding.severity === 'yellow' || finding.severity === 'red')
    && typeof finding.summary === 'string'
    && finding.summary.length <= 2_000;
}

function validIdList(values) {
  return values.length <= 1_000 && values.every((value) => (
    typeof value === 'string' && value.length > 0 && value.length <= 512
  ));
}

function sameStringSet(left, right) {
  if (!validIdList(left) || !validIdList(right)) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === left.length
    && rightSet.size === right.length
    && leftSet.size === rightSet.size
    && [...leftSet].every((value) => rightSet.has(value));
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
