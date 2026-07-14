/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Domain Dependency Panel — Phase 4 cascade risk map.
 *
 * Active risks section at top (computed from current Situations on
 * SituationStoreV2), then a domain selector that walks the static
 * dependency graph for the chosen source, surfacing every reachable
 * domain with hop count, total strength, and estimated propagation
 * time.
 */

import { Panel } from './Panel';
import {
  getDomainDependencyGraph,
  type CascadeRisk,
  type DependencyPath,
  type DependencyType,
  type DomainDependency,
} from '@/services/intelligence/domain-dependency';
import { getSituationStoreV2, type Situation } from '@/services/intelligence/situation-store-v2';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;

const TYPE_COLOR: Record<DependencyType, string> = {
  cascade: '#ff453a',
  amplification: '#ffb74d',
  inhibition: '#4a9eff',
  correlation: '#9e9e9e',
};

const SEVERITY_TO_NUM: Record<Situation['severity'], number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  critical: 1,
};

interface PanelState {
  selectedDomain: string;
}

export class DomainDependencyPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private state: PanelState;

  constructor() {
    super({
      id: 'domain-dependency',
      title: 'Domain Dependency',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Phase 4 cascade map. Walks the static dependency graph (26 built-in edges across 11 domains) to show every domain reachable from the selected source, with hop count, strength, and propagation time. Active risks section recomputes whenever an active Situation surfaces.',
    });
    this.state = { selectedDomain: getDomainDependencyGraph().getAllDomains()[0] ?? 'earthquake' };
    this.start();
  }

  private start(): void {
    this.recomputeActiveRisks();
    this.render();
    this.refreshTimer = setInterval(() => {
      this.recomputeActiveRisks();
      this.render();
    }, REFRESH_MS);
    this.unsub = getDomainDependencyGraph().subscribe(() => this.render());
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private recomputeActiveRisks(): void {
    const graph = getDomainDependencyGraph();
    const situations = getSituationStoreV2().getActive();
    const seen = new Set<string>();
    for (const s of situations) {
      if (seen.has(s.domain)) continue;
      seen.add(s.domain);
      const severityNum = SEVERITY_TO_NUM[s.severity] ?? 0.5;
      graph.computeCascadeRisk(s.domain, severityNum);
    }
  }

  private render(): void {
    const graph = getDomainDependencyGraph();
    const domains = graph.getAllDomains();
    if (!domains.includes(this.state.selectedDomain)) {
      this.state.selectedDomain = domains[0] ?? this.state.selectedDomain;
    }
    const selected = this.state.selectedDomain;
    const outgoing = graph.getDependencies(selected);
    const incoming = graph.getIncomingDependencies(selected);
    const paths = graph.findCascadePaths(selected, 3);
    const activeRisks = graph.getActiveRisks();
    this.setCount(activeRisks.length);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${renderActiveRisks(activeRisks)}
      ${this.renderSelector(domains)}
      ${renderEdgeLists(outgoing, incoming, selected)}
      ${renderPaths(selected, paths)}
    </div>`;
    this.setContent(html);
    this.wireSelect();
  }

  private renderSelector(domains: readonly string[]): string {
    const options = domains.map((d) =>
      `<option value="${escapeHtml(d)}"${d === this.state.selectedDomain ? ' selected' : ''}>${escapeHtml(d)}</option>`,
    ).join('');
    return `<label style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-secondary,#aaa);">
      Source domain
      <select id="domainDependencySelect" style="padding:4px 8px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;">${options}</select>
    </label>`;
  }

  private wireSelect(): void {
    setTimeout(() => {
      const sel = this.content.querySelector<HTMLSelectElement>('#domainDependencySelect');
      sel?.addEventListener('change', () => {
        this.state.selectedDomain = sel.value;
        this.render();
      });
    }, 0);
  }
}

function renderActiveRisks(risks: readonly CascadeRisk[]): string {
  if (risks.length === 0) {
    return `<div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Active cascade risks</div>
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">No active situations are propagating across domains right now.</div>
    </div>`;
  }
  const items = risks.map((r) => renderRiskRow(r)).join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Active cascade risks</div>
    <div style="display:flex;flex-direction:column;gap:6px;">${items}</div>
  </div>`;
}

function renderRiskRow(r: CascadeRisk): string {
  const chips = r.affectedDomains.slice(0, 8).map((d) =>
    `<span style="font-size:10px;padding:2px 6px;border-radius:3px;background:#ff453a26;color:#ff453a;">${escapeHtml(d)}</span>`,
  ).join(' ');
  const overflow = r.affectedDomains.length > 8 ? ` +${r.affectedDomains.length - 8}` : '';
  return `<div style="border:1px solid var(--border-subtle,#333);border-radius:3px;padding:8px 10px;background:var(--surface-2,#1a1a1a);">
    <div style="display:flex;align-items:center;gap:8px;font-size:12px;">
      <span style="font-weight:600;flex:1;">${escapeHtml(r.sourceDomain)} → ${r.totalExposedDomains} domain${r.totalExposedDomains === 1 ? '' : 's'}</span>
      <span style="font-size:11px;color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;">peak ${r.estimatedPeakHours.toFixed(1)} h</span>
    </div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;">${chips}${overflow}</div>
  </div>`;
}

function renderEdgeLists(
  outgoing: readonly DomainDependency[],
  incoming: readonly DomainDependency[],
  selected: string,
): string {
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
    <div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">From ${escapeHtml(selected)} (${outgoing.length})</div>
      ${renderEdgeList(outgoing)}
    </div>
    <div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Into ${escapeHtml(selected)} (${incoming.length})</div>
      ${renderEdgeList(incoming)}
    </div>
  </div>`;
}

function renderEdgeList(edges: readonly DomainDependency[]): string {
  if (edges.length === 0) {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No edges.</div>`;
  }
  const sorted = [...edges].sort((a, b) => b.strength - a.strength);
  const items = sorted.map((e) => {
    const color = TYPE_COLOR[e.dependencyType];
    return `<li style="display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,0.05));font-size:11px;">
      <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:${color}26;color:${color};">${escapeHtml(e.dependencyType)}</span>
      <span style="font-family:ui-monospace,monospace;flex:1;">${escapeHtml(e.fromDomain)} → ${escapeHtml(e.toDomain)}</span>
      <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);">${e.strength.toFixed(2)} · ${e.avgDelayHours}h</span>
    </li>`;
  }).join('');
  return `<ul style="margin:0;padding:0;list-style:none;">${items}</ul>`;
}

function renderPaths(selected: string, paths: readonly DependencyPath[]): string {
  if (paths.length === 0) {
    return `<div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Reachable paths from ${escapeHtml(selected)}</div>
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">No outgoing paths within depth 3.</div>
    </div>`;
  }
  const sorted = [...paths].sort((a, b) => b.totalStrength - a.totalStrength);
  const items = sorted.map((p) => {
    const hops = p.edges.length;
    const trail = p.nodes.map((n) => `<span style="font-family:ui-monospace,monospace;">${escapeHtml(n)}</span>`).join(`<span style="color:var(--text-secondary,#aaa);"> → </span>`);
    return `<li style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,0.05));font-size:11px;">
      <span style="font-size:9px;padding:1px 5px;border-radius:3px;background:var(--surface-2,#1a1a1a);color:var(--text-primary,#fff);">${hops} hop${hops === 1 ? '' : 's'}</span>
      <span style="flex:1;">${trail}</span>
      <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);">${p.totalStrength.toFixed(2)} · ${p.estimatedPropagationHours.toFixed(1)} h</span>
    </li>`;
  }).join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">Reachable paths from ${escapeHtml(selected)} (${paths.length})</div>
    <ul style="margin:0;padding:0;list-style:none;">${items}</ul>
  </div>`;
}
