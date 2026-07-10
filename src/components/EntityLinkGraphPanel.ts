/**
 * Entity Link Graph Panel
 *
 * Visualizes entity relationships across intelligence sources.
 * Shows node/edge statistics, top entities by weight, recent connections,
 * and cluster counts for network analysis.
 */

import { Panel } from './Panel';
import {
  getGraphStats,
  getGraphNodes,
  getGraphEdges,
  type GraphStats,
  type GraphNode,
  type GraphEdge,
  type GraphNodeType,
} from '@/services/entity-link-graph';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

const NODE_TYPE_ICONS: Record<GraphNodeType, string> = {
  person: '\u{1F464}',
  organization: '\u{1F3E2}',
  location: '\u{1F4CD}',
  event: '\u{26A1}',
  ioc: '\u{1F6A8}',
  vessel: '\u{1F6A2}',
  unit: '\u{1F396}',
  infrastructure: '\u{1F5A7}',
};

export class EntityLinkGraphPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({
 id: 'entity-link-graph',
 title: 'Entity Link Graph',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Visualizes entity relationships extracted from intelligence sources. Maps connections between people, organizations, locations, events, IOCs, vessels, units, and infrastructure.',
 });
 this.showLoading('Building entity graph\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 60 * 1000);
  }

  private render(): void {
 const stats: GraphStats = getGraphStats();
 const nodes: GraphNode[] = getGraphNodes();
 const edges: GraphEdge[] = getGraphEdges();

 this.setCount(stats.nodeCount);

 if (stats.nodeCount === 0) {
 this.setContent(`
 <div class="panel-empty">
 No entities tracked. Graph nodes will appear as intelligence feeds identify people, organizations, locations, and other linked entities.
 </div>
 `);
 return;
 }

 const statsBar = `
 <div style="display:flex;gap:12px;padding:4px 0 8px;font-size:12px;opacity:0.85;">
 <span>Nodes: <strong>${stats.nodeCount}</strong></span>
 <span>Edges: <strong>${stats.edgeCount}</strong></span>
 <span>Clusters: <strong>${stats.clusters}</strong></span>
 </div>
 `;

 const typeBreakdown = (Object.keys(stats.byType) as GraphNodeType[])
 .filter(t => stats.byType[t] > 0)
 .map(t => `<span class="elg-type-chip">${NODE_TYPE_ICONS[t]} ${escapeHtml(t)} (${stats.byType[t]})</span>`)
 .join('');

 const topEntities = stats.topNodes.slice(0, 10).map(node => {
 const icon = NODE_TYPE_ICONS[node.type] ?? '';
 const label = escapeHtml(node.label.length > 40 ? node.label.slice(0, 38) + '\u2026' : node.label);
 const lastSeen = formatTime(new Date(node.lastSeen));
 return `<div class="elg-entity-row">
 <span class="elg-icon">${icon}</span>
 <span class="elg-label">${label}</span>
 <span class="elg-weight">${node.weight.toFixed(1)}</span>
 <span class="elg-seen">${lastSeen}</span>
 </div>`;
 }).join('');

 const recentEdges = [...edges]
 .sort((a, b) => b.timestamp - a.timestamp)
 .slice(0, 8);

 const nodeMap = new Map<string, GraphNode>();
 for (const n of nodes) {
 nodeMap.set(n.id, n);
 }

 const edgeRows = recentEdges.map(edge => {
 const src = nodeMap.get(edge.sourceId);
 const tgt = nodeMap.get(edge.targetId);
 const srcLabel = src ? escapeHtml(src.label.length > 20 ? src.label.slice(0, 18) + '\u2026' : src.label) : escapeHtml(edge.sourceId);
 const tgtLabel = tgt ? escapeHtml(tgt.label.length > 20 ? tgt.label.slice(0, 18) + '\u2026' : tgt.label) : escapeHtml(edge.targetId);
 const rel = escapeHtml(edge.relationship);
 const ts = formatTime(new Date(edge.timestamp));
 return `<div class="elg-edge-row">
 <span class="elg-edge-src">${srcLabel}</span>
 <span class="elg-edge-rel">\u2192 ${rel} \u2192</span>
 <span class="elg-edge-tgt">${tgtLabel}</span>
 <span class="elg-edge-ts">${ts}</span>
 </div>`;
 }).join('');

 this.setContent(`
 <div style="padding:8px 12px;">
 ${statsBar}
 <div class="elg-types" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">${typeBreakdown}</div>
 <div style="font-size:11px;font-weight:600;text-transform:uppercase;opacity:0.7;margin-bottom:4px;">Top Entities by Weight</div>
 <div class="elg-top-entities">${topEntities}</div>
 <div style="font-size:11px;font-weight:600;text-transform:uppercase;opacity:0.7;margin:10px 0 4px;">Recent Connections</div>
 <div class="elg-recent-edges">${edgeRows}</div>
 </div>
 `);
  }

  public override destroy(): void {
 if (this.refreshTimer) {
 clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }
}
