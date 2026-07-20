/**
 * Evidence Chain Builder Panel — surfaces persisted evidence chains
 * with a list view (situation id + confidence + depth) and a
 * click-to-expand vertical timeline of nodes and edges.
 *
 * Vanilla TS — subscribes to the service for push-driven refresh and
 * also falls back to a 10s timer.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getEvidenceChainBuilderService,
  type ChainEdge,
  type ChainNode,
  type ChainNodeType,
  type EdgeRelationshipType,
  type EvidenceChain,
} from '@/services/intelligence/evidence-chain-builder';

const REFRESH_MS = 10_000;

const NODE_COLOR: Record<ChainNodeType, string> = {
  observation: '#4a9eff',
  correlation: '#a78bfa',
  situation: '#facc15',
  assessment: '#22c55e',
  assumption: '#fb923c',
  counterfactual: '#f87171',
};

const NODE_ICON: Record<ChainNodeType, string> = {
  observation: 'OBS',
  correlation: 'COR',
  situation: 'SIT',
  assessment: 'ASS',
  assumption: 'ASM',
  counterfactual: 'CFR',
};

const REL_COLOR: Record<EdgeRelationshipType, string> = {
  'derived-from': 'var(--text-secondary,#aaa)',
  corroborates: 'var(--severity-info,#22c55e)',
  contradicts: 'var(--severity-high,#f87171)',
  assumes: 'var(--severity-medium,#facc15)',
  challenges: '#a78bfa',
};

export class EvidenceChainBuilderPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private expandedChainIds = new Set<string>();

  constructor() {
    super({
      id: 'evidence-chain-builder',
      title: 'Evidence Chain Builder',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Walks each conclusion back to the raw observations that support it. Each chain is a DAG (observation → correlation → situation → assessment) annotated with depth and overall-confidence along the critical path.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = getEvidenceChainBuilderService().subscribe(() => this.render());
    this.attachHandlers();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }

  // ── Rendering ──────────────────────────────────────────────────────

  private render(): void {
    try {
      const chains = getEvidenceChainBuilderService().getAll();
      this.setCount(chains.length);
      this.setContent(chains.length === 0 ? this.renderEmpty() : this.renderChains(chains));
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical,#dc2626);font-size:12px;">Evidence chain render error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private renderEmpty(): string {
    return `<div style="padding:16px;display:flex;flex-direction:column;gap:8px;font-size:12px;color:var(--text-secondary,#aaa);">
      <div style="font-size:13px;font-weight:600;color:var(--text-primary,#fff);">No evidence chains recorded</div>
      <div>Call <code>getEvidenceChainBuilderService().build({ rootObservationId, situationId, nodes, edges })</code> to populate this panel.</div>
    </div>`;
  }

  private renderChains(chains: readonly EvidenceChain[]): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:10px;font-size:12px;">
      ${chains.map((c) => this.renderChain(c)).join('')}
    </div>`;
  }

  private renderChain(c: EvidenceChain): string {
    const expanded = this.expandedChainIds.has(c.id);
    const confidencePct = Math.round(c.overallConfidence * 100);
    return `<div class="ech-chain" data-chain-id="${escapeHtml(c.id)}" style="border:1px solid var(--border-subtle,#333);border-radius:4px;background:rgba(255,255,255,0.02);">
      <div class="ech-chain-header" style="padding:10px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;cursor:pointer;">
        <strong style="font-size:13px;">${escapeHtml(c.situationId)}</strong>
        <span style="font-size:11px;color:var(--text-secondary,#aaa);">root <code style="font-family:ui-monospace,monospace;">${escapeHtml(c.rootObservationId)}</code></span>
        <span style="margin-left:auto;font-size:11px;color:var(--text-secondary,#aaa);">depth <strong style="color:var(--text-primary,#fff);">${c.depth}</strong></span>
        <span style="font-size:11px;color:var(--text-secondary,#aaa);">confidence <strong style="color:var(--text-primary,#fff);">${confidencePct}%</strong></span>
        <span style="font-size:10px;color:var(--text-secondary,#aaa);">${expanded ? '▼' : '▶'}</span>
      </div>
      ${expanded ? this.renderTimeline(c) : ''}
    </div>`;
  }

  private renderTimeline(chain: EvidenceChain): string {
    const sorted = [...chain.nodes].sort((a, b) => a.timestamp - b.timestamp);
    const edgesByFrom = new Map<string, ChainEdge[]>();
    for (const e of chain.edges) {
      const bucket = edgesByFrom.get(e.fromId);
      if (bucket) bucket.push(e);
      else edgesByFrom.set(e.fromId, [e]);
    }
    return `<div style="padding:0 12px 12px;display:flex;flex-direction:column;gap:0;">
      ${sorted.map((n, i) => this.renderTimelineEntry(n, i === sorted.length - 1, edgesByFrom.get(n.id) ?? [])).join('')}
    </div>`;
  }

  private renderTimelineEntry(node: ChainNode, isLast: boolean, outgoing: readonly ChainEdge[]): string {
    const color = NODE_COLOR[node.type];
    const icon = NODE_ICON[node.type];
    const confidencePct = Math.round(node.confidence * 100);
    const connector = isLast ? '' : `<div style="margin-left:18px;width:2px;height:14px;background:var(--border-subtle,#333);"></div>`;
    return `<div>
      <div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;">
        <span style="font-size:9px;font-weight:700;letter-spacing:0.04em;padding:2px 6px;border-radius:3px;background:${color}22;color:${color};min-width:36px;text-align:center;">${escapeHtml(icon)}</span>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;">
            <strong style="font-size:12px;">${escapeHtml(node.label)}</strong>
            <span style="font-size:10px;color:var(--text-secondary,#aaa);">conf ${confidencePct}%</span>
            <span style="font-family:ui-monospace,monospace;font-size:10px;color:var(--text-secondary,#aaa);">${escapeHtml(node.id)}</span>
          </div>
          ${outgoing.map((e) => this.renderEdgeArrow(e)).join('')}
        </div>
      </div>
      ${connector}
    </div>`;
  }

  private renderEdgeArrow(e: ChainEdge): string {
    const color = REL_COLOR[e.relationshipType];
    const weightPct = Math.round(e.weight * 100);
    return `<div style="font-size:10px;color:${color};margin-top:3px;">
      → ${escapeHtml(e.relationshipType)} <span style="opacity:0.7;">→</span> <code style="font-family:ui-monospace,monospace;">${escapeHtml(e.toId)}</code>
      <span style="margin-left:6px;color:var(--text-secondary,#aaa);">w=${weightPct}%</span>
    </div>`;
  }

  // ── Events ────────────────────────────────────────────────────────

  private attachHandlers(): void {
    this.content.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const header = target.closest<HTMLElement>('.ech-chain-header');
    if (!header) return;
    const chainEl = header.parentElement as HTMLElement | null;
    const id = chainEl?.dataset.chainId;
    if (!id) return;
    if (this.expandedChainIds.has(id)) this.expandedChainIds.delete(id);
    else this.expandedChainIds.add(id);
    this.render();
  }
}
