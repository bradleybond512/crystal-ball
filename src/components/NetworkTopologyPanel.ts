/**
 * Network Topology Panel
 *
 * Displays network nodes, edges, and security alerts in a
 * tabular/list format. Tracks asset health and connection status.
 *
 * Inspired by Dragos asset visibility and Palantir Gotham graph view.
 */

import { Panel } from './Panel';
import {
  getNodes,
  getTopoDashboard,
  getTopoAlerts,
  getNeighbors,
  type TopoNode,
  type TopoAlert,
} from '@/services/network-topology';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

const NODE_ICONS: Record<string, string> = {
  server: '\uD83D\uDDA5\uFE0F', // 🖥️
  workstation: '\uD83D\uDCBB', // 💻
  router: '\uD83D\uDD00', // 🔀
  firewall: '\uD83E\uDDE1', // 🧱
  switch: '\uD83D\uDD18', // 🔘
  ics_device: '\u2699\uFE0F', // ⚙️
  cloud_service: '\u2601\uFE0F', // ☁️
  external: '\uD83C\uDF10', // 🌐
  unknown: '\u2753', // ❓
};

const STATUS_COLORS: Record<string, string> = {
  healthy: '#38a169',
  degraded: '#ed8936',
  down: '#e53e3e',
  compromised: '#9b2c2c',
};

const SEV_ICONS: Record<string, string> = {
  critical: '\uD83D\uDD34',
  high: '\uD83D\uDFE0',
  medium: '\uD83D\uDFE1',
  low: '\uD83D\uDFE2',
};

export class NetworkTopologyPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private selectedNodeId: string | null = null;

  constructor() {
 super({
 id: 'network-topology',
 title: 'Network Topology',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Network topology and asset visibility dashboard. Tracks nodes (servers, firewalls, ICS devices), connections, and security alerts. Highlights compromised assets and suspicious connections.',
 });
 // Delegate node-row clicks once so re-renders never accumulate listeners.
 this.getContentElement().addEventListener('click', (e) => {
 const row = (e.target as Element).closest<HTMLElement>('.topo-node-row');
 if (!row) return;
 const id = row.dataset.nodeId ?? null;
 this.selectedNodeId = this.selectedNodeId === id ? null : id;
 this.render();
 });
 this.showLoading('Mapping network topology\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 60 * 1000);
  }

  private render(): void {
 const dash = getTopoDashboard();
 const alerts = getTopoAlerts();

 this.setCount(dash.compromisedNodes + alerts.length);

 if (dash.nodeCount === 0) {
 this.setContent(`
 <div class="panel-empty">
 No network nodes discovered. Network topology will build as assets are detected through IDS, asset scans, and manual registration.
 </div>
 `);
 return;
 }

 const statusBar = `<div class="topo-status">
 <span>\uD83D\uDDA5\uFE0F ${dash.nodeCount} nodes</span>
 <span class="topo-sep">\u2502</span>
 <span>\uD83D\uDD17 ${dash.edgeCount} edges</span>
 <span class="topo-sep">\u2502</span>
 <span style="color:#38a169">\u2705 ${dash.healthyNodes}</span>
 <span class="topo-sep">\u2502</span>
 <span style="color:#e53e3e">\uD83D\uDD34 ${dash.compromisedNodes} compromised</span>
 <span class="topo-sep">\u2502</span>
 <span style="color:#ed8936">\u26A0\uFE0F ${dash.activeAlerts} alerts</span>
 </div>`;

 const nodes = getNodes();
 const compromised = nodes.filter(n => n.status === 'compromised');
 const down = nodes.filter(n => n.status === 'down');

 const criticalHtml = (compromised.length + down.length) > 0 ? `
 <div class="topo-section-title">CRITICAL NODES</div>
 <div class="topo-node-list">${[...compromised, ...down].slice(0, 10).map(n => this.renderNode(n)).join('')}</div>
 ` : '';

 const selectedHtml = this.selectedNodeId ? this.renderNodeDetail(this.selectedNodeId) : '';

 const alertHtml = alerts.length > 0 ? `
 <div class="topo-section-title">ALERTS</div>
 <div class="topo-alert-list">${alerts.slice(0, 10).map(a => this.renderAlert(a)).join('')}</div>
 ` : '';

 this.setContent(`
 <div style="padding:8px 12px;">
 ${statusBar}
 ${criticalHtml}
 ${selectedHtml}
 ${alertHtml}
 </div>
 `);
  }

  private renderNode(n: TopoNode): string {
 const icon = NODE_ICONS[n.type] ?? '\u2753';
 const color = STATUS_COLORS[n.status] ?? '#888';
 const label = escapeHtml(n.label);
 const ip = n.ip ? escapeHtml(n.ip) : '';

 return `<div class="topo-node-row" data-node-id="${n.id}">
 <span>${icon}</span>
 <span class="topo-node-label">${label}</span>
 ${ip ? `<span class="topo-node-ip">${ip}</span>` : ''}
 <span class="topo-node-status" style="color:${color}">${n.status}</span>
 </div>`;
  }

  private renderNodeDetail(nodeId: string): string {
 const { nodes: neighbors, edges } = getNeighbors(nodeId);
 if (neighbors.length === 0) return '';

 return `<div class="topo-section-title">CONNECTIONS (${neighbors.length})</div>
 <div class="topo-neighbors">${neighbors.slice(0, 10).map(n => {
 const edge = edges.find(e => e.sourceId === n.id || e.targetId === n.id);
 const proto = edge?.protocol ? escapeHtml(edge.protocol) : '';
 const port = edge?.port ? `:${edge.port}` : '';
 return this.renderNode(n) + (proto ? `<span class="topo-edge-info">${proto}${port}</span>` : '');
 }).join('')}</div>`;
  }

  private renderAlert(a: TopoAlert): string {
 const icon = SEV_ICONS[a.severity] ?? '\u2B55';
 const time = formatTime(new Date(a.timestamp));

 return `<div class="topo-alert-row">
 <span>${icon}</span>
 <span class="topo-alert-type">${escapeHtml(a.alertType.replace(/_/g, ' '))}</span>
 <span class="topo-alert-desc">${escapeHtml(a.description)}</span>
 <span class="topo-alert-time">${time}</span>
 </div>`;
  }

  public override destroy(): void {
 if (this.refreshTimer) {
 clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }
}
