/**
 * Cascade Simulator Panel
 *
 * Models infrastructure cascade failures by simulating the downstream impact
 * when a critical infrastructure node is disrupted. Displays infrastructure
 * nodes, prebuilt scenarios, and cascade tree visualizations.
 */

import { Panel } from './Panel';
import {
  getInfraNodes,
  getLastSimulation,
  getPrebuiltScenarios,
  simulateCascade,
  type CascadeSimResult,
  type CascadeEffect,
  type CascadeNodeType,
} from '@/services/cascade-simulator';
import { escapeHtml } from '@/utils/sanitize';

const NODE_TYPE_ICONS: Record<CascadeNodeType, string> = {
  power_grid: '\u26A1',
  telecom: '\uD83D\uDCE1',
  water: '\uD83D\uDCA7',
  transport: '\uD83D\uDE82',
  financial_system: '\uD83C\uDFE6',
  internet: '\uD83C\uDF10',
  fuel: '\u26FD',
  submarine_cable: '\uD83C\uDF0A',
};

const IMPACT_COLORS: Record<string, string> = {
  catastrophic: '#ff453a',
  severe: '#ff9800',
  moderate: '#ffc107',
  minor: '#4caf50',
};

export class CascadeSimulatorPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({
 id: 'cascade-simulator',
 title: 'Cascade Simulator',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Infrastructure cascade failure modeling — simulates downstream impact when critical nodes are disrupted.',
 });
 this.showLoading('Loading infrastructure nodes\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 120_000);
  }

  private render(): void {
 const nodes = getInfraNodes();
 const scenarios = getPrebuiltScenarios();
 const lastSim = getLastSimulation();

 this.setCount(nodes.length);

 if (nodes.length === 0) {
 this.setContent('<div class="panel-empty">No infrastructure nodes registered. Nodes will appear as data flows in.</div>');
 return;
 }

 const byType = new Map<CascadeNodeType, number>();
 for (const node of nodes) {
 byType.set(node.type, (byType.get(node.type) ?? 0) + 1);
 }
 const typeCounts = Array.from(byType.entries())
 .sort((a, b) => b[1] - a[1])
 .map(([type, count]) => `<span class="cascade-sim-stat">${NODE_TYPE_ICONS[type] ?? '\uD83D\uDCCD'} ${escapeHtml(type.replace(/_/g, ' '))} ${count}</span>`)
 .join('');

 const statsHtml = `<div class="cascade-sim-stats"><span class="cascade-sim-stat-total">${nodes.length} nodes</span>${typeCounts}</div>`;

 const scenariosHtml = scenarios.length > 0 ? `
 <div class="cascade-sim-section-title">Prebuilt Scenarios</div>
 <div class="cascade-sim-scenarios">${scenarios.map(s => `
 <div class="cascade-sim-scenario" data-trigger="${escapeHtml(s.triggerNodeId)}">
 <div class="cascade-sim-scenario-name">${escapeHtml(s.name)}</div>
 <div class="cascade-sim-scenario-desc">${escapeHtml(s.description)}</div>
 </div>
 `).join('')}</div>
 ` : '';

 const simHtml = lastSim ? this.renderSimulation(lastSim) : '<div class="panel-empty">No simulation run yet. Select a scenario above.</div>';

 this.setContent(`<div style="padding:8px 12px;">${statsHtml}${scenariosHtml}${simHtml}</div>`);

 this.getContentElement().querySelectorAll('.cascade-sim-scenario').forEach(card => {
 card.addEventListener('click', () => {
 const nodeId = (card as HTMLElement).dataset.trigger;
 if (!nodeId) return;
 simulateCascade(nodeId);
 this.render();
 });
 });
  }

  private renderSimulation(sim: CascadeSimResult): string {
 const effects = sim.effects.slice(0, 15);
 const effectRows = effects.map((e: CascadeEffect) => {
 const color = IMPACT_COLORS[e.impact] ?? '#999';
 return `<div class="cascade-sim-effect">
 <span>${NODE_TYPE_ICONS[e.nodeType] ?? '\u2022'}</span>
 <span class="cascade-sim-effect-name">${escapeHtml(e.nodeName)}</span>
 <span class="cascade-sim-effect-mode" style="color:${color}">${escapeHtml(e.impact)}</span>
 <span class="cascade-sim-effect-delay">${e.failureDelay}h delay</span>
 <span class="cascade-sim-effect-prob">${Math.round(e.probability * 100)}%</span>
 </div>`;
 }).join('');

 return `
 <div class="cascade-sim-section-title">Simulation Result</div>
 <div class="cascade-sim-summary">
 <div>Trigger: ${escapeHtml(sim.triggerName)}</div>
 <div>${sim.totalAffected} affected \u2022 max depth ${sim.maxCascadeDepth} \u2022 ~${sim.estimatedRecoveryHours}h recovery \u2022 risk ${sim.riskScore}</div>
 </div>
 <div class="cascade-sim-tree">${effectRows}</div>
 `;
  }

  public override destroy(): void {
 if (this.refreshTimer) {
 clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }
}
