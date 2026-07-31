import type { AlgorithmHealth } from '@/services/algorithms/algorithm-health';
import { escapeHtml } from '@/utils/sanitize';

export type AgentIntelligenceState =
  | 'protected'
  | 'protection-active'
  | 'evidence-building';

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
  };
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
    <details style="margin-top:9px;">
      <summary style="font-size:10px;font-weight:650;cursor:pointer;color:var(--text-secondary);">How local agent access works</summary>
      <div style="display:flex;flex-direction:column;gap:7px;margin-top:8px;">${flowHtml}</div>
      <div style="font-size:10px;line-height:1.4;color:var(--text-secondary);margin-top:8px;">Crystal Ball must be open for live agent data. The optional local background monitor rechecks drift and quarantine state every 15 minutes when installed.</div>
    </details>
  </section>`;
}
