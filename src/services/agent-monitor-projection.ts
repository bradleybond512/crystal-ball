import type {
  AgentMonitorProjection,
  AgentMonitorProjectionState,
} from '@/components/agent-intelligence-view';

const STATES = new Set<AgentMonitorProjectionState>([
  'live', 'stale', 'degraded', 'stopped', 'incompatible', 'unavailable', 'unknown',
]);
const COMPATIBILITY = new Set(['compatible', 'incompatible', 'unknown']);
const SEVERITIES = new Set(['green', 'yellow', 'red', 'unknown']);
const EVENT_TYPES = new Set(['opened', 'resolved', 'escalated', 'stopped', 'resumed']);
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function timestamp(value: unknown, nullable: true): number | null | undefined;
function timestamp(value: unknown, nullable?: false): number | undefined;
function timestamp(value: unknown, nullable = false): number | null | undefined {
  if (nullable && value === null) return null;
  return Number.isFinite(value) && Number(value) > 0 ? Math.trunc(Number(value)) : undefined;
}

function count(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 256
    ? Number(value)
    : undefined;
}

function id(value: unknown): string | null {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : null;
}

function ids(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 24) return null;
  const parsed = value.map((entry) => id(entry));
  return parsed.every((entry): entry is string => entry !== null) ? parsed : null;
}

export function parseAgentMonitorProjection(value: unknown): AgentMonitorProjection | null {
  const root = record(value);
  if (root?.schemaVersion !== 1 || !STATES.has(root.state as AgentMonitorProjectionState)) return null;
  const generatedAt = timestamp(root.generatedAt);
  const lastRunAt = timestamp(root.lastRunAt, true);
  const nextRunAt = timestamp(root.nextRunAt, true);
  const compatibility = record(root.compatibility);
  const quarantine = record(root.quarantine);
  const capabilities = record(root.capabilities);
  const feeds = record(capabilities?.feeds);
  if (generatedAt === undefined || lastRunAt === undefined || nextRunAt === undefined
      || !compatibility || !COMPATIBILITY.has(compatibility.status as string)
      || !Number.isInteger(compatibility.supportedSchemaVersion)
      || (compatibility.stateSchemaVersion !== null && !Number.isInteger(compatibility.stateSchemaVersion))
      || !quarantine || !capabilities || !feeds) return null;

  const algorithmIds = ids(quarantine.algorithmIds);
  const activeCount = count(quarantine.activeCount);
  const recovered = ids(root.recovered);
  const ready = count(feeds.ready);
  const degraded = count(feeds.degraded);
  const unavailable = count(feeds.unavailable);
  const unknown = count(feeds.unknown);
  const total = count(feeds.total);
  if (!algorithmIds || activeCount === undefined || activeCount !== algorithmIds.length || !recovered
      || ready === undefined || degraded === undefined || unavailable === undefined
      || unknown === undefined || total === undefined || ready + degraded + unavailable + unknown !== total
      || (capabilities.liveCollection !== null && typeof capabilities.liveCollection !== 'boolean')
      || (capabilities.algorithmDiagnostics !== null && typeof capabilities.algorithmDiagnostics !== 'boolean')) return null;

  if (!Array.isArray(root.findings) || root.findings.length > 16
      || !Array.isArray(root.events) || root.events.length > 16) return null;
  const findings = root.findings.flatMap((value) => {
    const row = record(value);
    const findingId = id(row?.id);
    if (!findingId || !SEVERITIES.has(row?.severity as string)) return [];
    return [{ id: findingId, severity: row?.severity as AgentMonitorProjection['findings'][number]['severity'] }];
  });
  const events = root.events.flatMap((value) => {
    const row = record(value);
    const eventId = id(row?.id);
    const at = timestamp(row?.at);
    const findingId = row?.findingId === undefined ? undefined : id(row.findingId);
    if (!eventId || at === undefined || !EVENT_TYPES.has(row?.type as string)
        || findingId === null || (row?.severity !== undefined && !SEVERITIES.has(row.severity as string))) return [];
    return [{
      id: eventId,
      type: row?.type as AgentMonitorProjection['events'][number]['type'],
      at,
      ...(findingId ? { findingId } : {}),
      ...(row?.severity ? { severity: row.severity as AgentMonitorProjection['findings'][number]['severity'] } : {}),
    }];
  });
  if (findings.length !== root.findings.length || events.length !== root.events.length) return null;

  return {
    schemaVersion: 1,
    generatedAt,
    state: root.state as AgentMonitorProjectionState,
    lastRunAt,
    nextRunAt,
    compatibility: {
      status: compatibility.status as AgentMonitorProjection['compatibility']['status'],
      stateSchemaVersion: compatibility.stateSchemaVersion as number | null,
      supportedSchemaVersion: compatibility.supportedSchemaVersion as number,
    },
    findings,
    events,
    recovered,
    quarantine: { activeCount, algorithmIds },
    capabilities: {
      liveCollection: capabilities.liveCollection as boolean | null,
      algorithmDiagnostics: capabilities.algorithmDiagnostics as boolean | null,
      feeds: { ready, degraded, unavailable, unknown, total },
    },
  };
}

export async function fetchAgentMonitorProjection(signal?: AbortSignal): Promise<AgentMonitorProjection> {
  const response = await fetch('/api/local-agent-monitor', { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`Agent monitor status unavailable (${response.status})`);
  const projection = parseAgentMonitorProjection(await response.json());
  if (!projection) throw new Error('Agent monitor returned an incompatible projection');
  return projection;
}
