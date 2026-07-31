import type { AlgorithmHealth } from '@/services/algorithms/algorithm-health';
import { escapeHtml } from '@/utils/sanitize';

export type AgentIntelligenceState =
  | 'protected'
  | 'protection-active'
  | 'evidence-building';

export type AgentMonitorProjectionState =
  | 'live'
  | 'stale'
  | 'degraded'
  | 'stopped'
  | 'incompatible'
  | 'unavailable'
  | 'unknown';

export interface AgentMonitorProjection {
  schemaVersion: 1;
  generatedAt: number;
  state: AgentMonitorProjectionState;
  lastRunAt: number | null;
  nextRunAt: number | null;
  compatibility: {
    status: 'compatible' | 'incompatible' | 'unknown';
    stateSchemaVersion: number | null;
    supportedSchemaVersion: number;
  };
  findings: readonly { id: string; severity: 'green' | 'yellow' | 'red' | 'unknown' }[];
  events: readonly {
    id: string;
    type: 'opened' | 'resolved' | 'escalated' | 'stopped' | 'resumed';
    at: number;
    findingId?: string;
    severity?: 'green' | 'yellow' | 'red' | 'unknown';
  }[];
  recovered: readonly string[];
  quarantine: { activeCount: number; algorithmIds: readonly string[] };
  capabilities: {
    liveCollection: boolean | null;
    algorithmDiagnostics: boolean | null;
    feeds: { ready: number; degraded: number; unavailable: number; unknown: number; total: number };
  };
}

export interface AgentFlowStep {
  label: string;
  detail: string;
}

export interface AgentIntelligenceView {
  state: AgentIntelligenceState;
  label: string;
  summary: string;
  directSourcePolicy: string;
  quarantinedAlgorithmIds: readonly string[];
  flow: readonly AgentFlowStep[];
  monitor: AgentMonitorProjection | null;
}

const FLOW: readonly AgentFlowStep[] = [
  {
    label: 'Direct sources',
    detail: 'Provider observations enter Crystal Ball with source and collection context.',
  },
  {
    label: 'Local sidecar',
    detail: 'The running app authenticates, normalizes, and serves approved local routes.',
  },
  {
    label: 'MCP safety layer',
    detail: 'Capability checks, route policy, structured output, and quarantine rules are applied.',
  },
  {
    label: 'Claude and Codex',
    detail: 'Agents receive observations, derived analysis, timestamps, and collection caveats.',
  },
];

export function buildAgentIntelligenceView(
  algorithms: readonly AlgorithmHealth[],
  monitor: AgentMonitorProjection | null = null,
): AgentIntelligenceView {
  const quarantinedAlgorithmIds = algorithms
    .filter((algorithm) => (
      algorithm.status === 'unsafe'
      || (algorithm.status === 'failing' && algorithm.criticality === 'safety')
    ))
    .map((algorithm) => algorithm.algorithmId)
    .sort((a, b) => a.localeCompare(b));
  const algorithmFailurePresent = algorithms.some((algorithm) => algorithm.status === 'failing');
  const healthyEvidenceComplete = algorithms.length > 0
    && algorithms.every((algorithm) => algorithm.status === 'healthy');

  let state: AgentIntelligenceState = 'protected';
  let label = 'Agent safeguards ready';
  let summary = 'Derived outputs are within their current release floors.';
  if (quarantinedAlgorithmIds.length > 0) {
    state = 'protection-active';
    label = 'Derived-output protection active';
    summary = `${quarantinedAlgorithmIds.length} derived algorithm${quarantinedAlgorithmIds.length === 1 ? ' is' : 's are'} blocked from agent conclusions pending better evidence.`;
  } else if (algorithmFailurePresent) {
    state = 'evidence-building';
    label = 'Algorithm review needed';
    summary = 'At least one algorithm is failing its current release floor and needs review.';
  } else if (!healthyEvidenceComplete) {
    state = 'evidence-building';
    label = 'Algorithm evidence still building';
    summary = algorithms.length === 0
      ? 'No algorithm health evidence is available yet.'
      : 'At least one algorithm is degraded or lacks enough graded evidence for a healthy verdict.';
  }

  return {
    state,
    label,
    summary,
    directSourcePolicy:
      'Independent direct-source feeds are not disabled by an algorithm quarantine; their own availability and provenance still apply.',
    quarantinedAlgorithmIds,
    flow: FLOW,
    monitor,
  };
}

export function nextAgentMonitorPollDelayMs(failureCount: number): number {
  if (failureCount <= 0) return 60_000;
  return Math.min(300_000, 15_000 * (2 ** Math.min(5, failureCount - 1)));
}

function renderMonitorTime(value: number | null): string {
  return value === null ? 'not available' : new Date(value).toLocaleString();
}

function renderAgentMonitorHtml(monitor: AgentMonitorProjection | null): string {
  if (!monitor) return '';
  const display = {
    live: { label: 'Monitor live', color: 'var(--status-ok)' },
    stale: { label: 'Monitor stale', color: 'var(--status-warn)' },
    degraded: { label: 'Monitor degraded', color: 'var(--status-warn)' },
    stopped: { label: 'Monitor stopped', color: 'var(--status-error, #ff453a)' },
    incompatible: { label: 'Monitor incompatible', color: 'var(--status-error, #ff453a)' },
    unavailable: { label: 'Monitor unavailable', color: 'var(--text-secondary)' },
    unknown: { label: 'Monitor status unknown', color: 'var(--text-secondary)' },
  }[monitor.state];
  const findingHtml = monitor.findings.length === 0
    ? ''
    : `<div style="margin-top:6px;">Active findings: ${monitor.findings
      .map((finding) => `<span style="font-family:ui-monospace,monospace;">${escapeHtml(finding.id)}</span>`)
      .join(' · ')}</div>`;
  const recoveredHtml = monitor.recovered.length === 0
    ? ''
    : `<div style="margin-top:4px;">Recovered: ${monitor.recovered
      .map((id) => `<span style="font-family:ui-monospace,monospace;">${escapeHtml(id)}</span>`)
      .join(' · ')}</div>`;
  const quarantineHtml = monitor.quarantine.algorithmIds.length === 0
    ? ''
    : `<div style="margin-top:4px;">Monitor quarantine: ${monitor.quarantine.algorithmIds
      .map((id) => `<span style="font-family:ui-monospace,monospace;">${escapeHtml(id)}</span>`)
      .join(' · ')}</div>`;
  const feeds = monitor.capabilities.feeds;
  return `<div data-agent-monitor-state="${escapeHtml(monitor.state)}" style="margin-top:9px;padding-top:8px;border-top:1px solid var(--surface-border);font-size:10px;line-height:1.45;color:var(--text-secondary);">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <strong style="color:${display.color};">${escapeHtml(display.label)}</strong>
      <button type="button" data-agent-monitor-refresh aria-label="Refresh agent monitor status" style="font:inherit;color:var(--text-secondary);background:transparent;border:1px solid var(--surface-border);border-radius:3px;padding:2px 6px;cursor:pointer;">Refresh status</button>
    </div>
    <div style="margin-top:4px;">Last run: ${escapeHtml(renderMonitorTime(monitor.lastRunAt))} · Next run: ${escapeHtml(renderMonitorTime(monitor.nextRunAt))}</div>
    <div>Compatibility: ${escapeHtml(monitor.compatibility.status)} · Feeds: ${feeds.ready}/${feeds.total} ready${feeds.degraded > 0 ? ` · ${feeds.degraded} degraded` : ''}${feeds.unavailable > 0 ? ` · ${feeds.unavailable} unavailable` : ''}</div>
    ${findingHtml}${recoveredHtml}${quarantineHtml}
  </div>`;
}

export function renderAgentIntelligenceHtml(view: AgentIntelligenceView): string {
  const appearance = {
    protected: {
      color: 'var(--status-ok)',
      background: 'color-mix(in srgb, var(--status-ok) 8%, transparent)',
    },
    'protection-active': {
      color: 'var(--status-warn)',
      background: 'color-mix(in srgb, var(--status-warn) 9%, transparent)',
    },
    'evidence-building': {
      color: 'var(--text-secondary)',
      background: 'color-mix(in srgb, var(--text-secondary) 8%, transparent)',
    },
  }[view.state];
  const quarantineHtml = view.quarantinedAlgorithmIds.length === 0
    ? ''
    : `<div style="margin-top:7px;font-size:10px;color:var(--text-secondary);">
        Quarantined: <span style="font-family:ui-monospace,monospace;">${view.quarantinedAlgorithmIds.map((algorithmId) => escapeHtml(algorithmId)).join(' · ')}</span>
      </div>`;
  const flowHtml = view.flow.map((step, index) => `
    <div style="display:grid;grid-template-columns:20px minmax(0,1fr);gap:7px;align-items:start;">
      <span aria-hidden="true" style="width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:var(--surface-3);color:var(--text-secondary);font-size:9px;">${index + 1}</span>
      <div>
        <div style="font-size:11px;font-weight:650;">${escapeHtml(step.label)}</div>
        <div style="font-size:10px;line-height:1.4;color:var(--text-secondary);">${escapeHtml(step.detail)}</div>
      </div>
    </div>`).join('');

  return `<section data-agent-safety-state="${escapeHtml(view.state)}" aria-label="Agent intelligence safeguards" style="border:1px solid var(--surface-border);border-left:3px solid ${appearance.color};border-radius:5px;background:${appearance.background};padding:10px;">
    <div style="font-size:12px;font-weight:700;color:${appearance.color};">${escapeHtml(view.label)}</div>
    <div style="font-size:11px;line-height:1.45;margin-top:3px;">${escapeHtml(view.summary)}</div>
    ${quarantineHtml}
    <div style="font-size:10px;line-height:1.4;color:var(--text-secondary);margin-top:7px;">${escapeHtml(view.directSourcePolicy)}</div>
    ${renderAgentMonitorHtml(view.monitor)}
    <details style="margin-top:9px;">
      <summary style="font-size:10px;font-weight:650;cursor:pointer;color:var(--text-secondary);">How local agent access works</summary>
      <div style="display:flex;flex-direction:column;gap:7px;margin-top:8px;">${flowHtml}</div>
      <div style="font-size:10px;line-height:1.4;color:var(--text-secondary);margin-top:8px;">Crystal Ball must be open for live agent data. The optional local background monitor rechecks drift and quarantine state every 15 minutes when installed.</div>
    </details>
  </section>`;
}
