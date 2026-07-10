/**
 * Kill Chain Tracker Panel
 *
 * Visualizes observed MITRE ATT&CK phases across active attack chains.
 * Shows chain completeness, phase distribution, and per-chain detail.
 *
 * Inspired by Palantir Gotham attack chain analysis.
 */

import { Panel } from './Panel';
import {
  getActiveChains,
  getPhaseDistribution,
  type AttackChain,
  type KillChainPhase,
} from '@/services/kill-chain';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

const PHASE_SHORT: Record<KillChainPhase, string> = {
  'Reconnaissance': 'RECON',
  'Resource Development': 'RES DEV',
  'Initial Access': 'INIT',
  'Execution': 'EXEC',
  'Persistence': 'PERSIST',
  'Privilege Escalation': 'PRIV ESC',
  'Defense Evasion': 'DEF EVA',
  'Credential Access': 'CRED',
  'Discovery': 'DISC',
  'Lateral Movement': 'LATERAL',
  'Collection': 'COLLECT',
  'C2': 'C2',
  'Exfiltration': 'EXFIL',
  'Impact': 'IMPACT',
};

const PHASE_ORDER: KillChainPhase[] = [
  'Reconnaissance', 'Resource Development', 'Initial Access', 'Execution',
  'Persistence', 'Privilege Escalation', 'Defense Evasion', 'Credential Access',
  'Discovery', 'Lateral Movement', 'Collection', 'C2',
  'Exfiltration', 'Impact',
];

export class KillChainPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private expandedChainId: string | null = null;

  constructor() {
 super({
 id: 'kill-chain',
 title: 'Kill Chain Tracker',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Tracks observed MITRE ATT&CK kill chain phases across active attack chains. Shows chain completeness and phase coverage to identify how far adversaries have progressed.',
 });
 this.showLoading('Scanning attack chains\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 60 * 1000);
  }

  private render(): void {
 const chains = getActiveChains();
 const phaseDist = getPhaseDistribution();

 this.setCount(chains.length);

 if (chains.length === 0) {
 this.setContent(`
 <div class="panel-empty">
 No active attack chains detected. Kill chain entries will appear as cyber threat feeds report MITRE ATT&CK-mapped techniques.
 </div>
 `);
 return;
 }

 const phaseBar = this.renderPhaseBar(phaseDist);
 const chainCards = chains.slice(0, 15).map(c => this.renderChain(c)).join('');

 this.setContent(`
 <div style="padding:8px 12px;">
 <div class="kc-phase-bar">${phaseBar}</div>
 <div class="kc-chains">${chainCards}</div>
 </div>
 `);

 this.getContentElement().querySelectorAll('.kc-chain-card').forEach(card => {
 card.addEventListener('click', () => {
 const id = card.getAttribute('data-chain-id');
 this.expandedChainId = this.expandedChainId === id ? null : id;
 this.render();
 });
 });
  }

  private renderPhaseBar(dist: Map<KillChainPhase, number>): string {
 const maxCount = Math.max(1, ...dist.values());
 return `<div class="kc-bar-grid">${PHASE_ORDER.map(phase => {
 const count = dist.get(phase) ?? 0;
 const pct = Math.round((count / maxCount) * 100);
 const active = count > 0 ? 'kc-phase-active' : '';
 return `<div class="kc-phase-cell ${active}" title="${phase}: ${count}">
 <div class="kc-phase-fill" style="height:${pct}%"></div>
 <span class="kc-phase-label">${PHASE_SHORT[phase]}</span>
 </div>`;
 }).join('')}</div>`;
  }

  private renderChain(chain: AttackChain): string {
 const expanded = this.expandedChainId === chain.id;
 const name = escapeHtml(chain.name);
 const adversary = chain.adversary ? escapeHtml(chain.adversary) : 'Unknown';
 const completePct = chain.completeness;
 const compColor = completePct >= 70 ? '#e53e3e' : completePct >= 40 ? '#ed8936' : '#ecc94b';
 const lastSeen = formatTime(new Date(chain.lastSeen));

 const phases = new Set(chain.entries.map(e => e.phase));
 const phaseChips = PHASE_ORDER
 .filter(p => phases.has(p))
 .map(p => `<span class="kc-chip">${PHASE_SHORT[p]}</span>`)
 .join('');

 const detailHtml = expanded ? `
 <div class="kc-expanded">
 <div class="kc-entries">${chain.entries.map(e => `
 <div class="kc-entry">
 <span class="kc-entry-phase">${PHASE_SHORT[e.phase]}</span>
 <span class="kc-entry-tech">${escapeHtml(e.technique)}</span>
 <span class="kc-entry-conf">${e.confidence}%</span>
 </div>
 `).join('')}</div>
 </div>
 ` : '';

 return `<div class="kc-chain-card" data-chain-id="${chain.id}">
 <div class="kc-chain-header">
 <span class="kc-chain-name">${name}</span>
 <span class="kc-adversary">${adversary}</span>
 <span class="kc-completeness" style="color:${compColor}">${completePct}%</span>
 </div>
 <div class="kc-chain-phases">${phaseChips}</div>
 <div class="kc-chain-meta">${chain.entries.length} events \u2022 last seen ${lastSeen}</div>
 ${detailHtml}
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
