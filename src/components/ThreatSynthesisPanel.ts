/**
 * ThreatSynthesisPanel — Cross-Domain Threat Synthesis
 *
 * Displays AI-powered (or template-based) analysis of how signals across
 * different domains (military, economic, cyber, disaster) relate to each other.
 * Shows causal chain visualizations, risk gauges, and recommended actions.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  synthesizeThreats,
  getCachedSynthesis,
  type SynthesisReport,
  type CrossDomainCluster,
  type EscalationRisk,
} from '@/services/threat-synthesis';
import { CAUSAL_TEMPLATES } from '@/services/situation-forecaster';
import type { CausalTemplate } from '@/services/situation-types';

// ── Constants ─────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<EscalationRisk, string> = {
  low: '#27ae60',
  moderate: '#f39c12',
  high: '#e67e22',
  critical: '#c0392b',
};

const RISK_LABELS: Record<EscalationRisk, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  critical: 'Critical',
};

const DOMAIN_ICONS: Record<string, string> = {
  Military: '\u2694\uFE0F',
  Economic: '\uD83D\uDCC8',
  'Natural Hazard': '\uD83C\uDF0A',
  Cyber: '\uD83D\uDD10',
  Infrastructure: '\u26A1',
  Health: '\uD83C\uDFE5',
  'Civil Unrest': '\uD83D\uDEA8',
  Compound: '\u26A0\uFE0F',
};

// ── Panel ─────────────────────────────────────────────────────────────────────

export class ThreatSynthesisPanel extends Panel {
  private report: SynthesisReport | null = null;
  private isAnalyzing = false;

  constructor() {
 super({
 id: 'threat-synthesis',
 title: 'Threat Synthesis',
 showCount: true,
 trackActivity: true,
 infoTooltip:
 'Cross-domain threat synthesis groups concurrent signals from different domains ' +
 '(military, economic, cyber, disaster) in the same region and uses AI to analyze ' +
 'causal relationships and coordinated activity patterns.',
 });

 // Load cached report
 this.report = getCachedSynthesis();
 if (this.report) {
 this.renderReport(this.report);
 } else {
 this.renderEmpty();
 }
  }

  /** Trigger a fresh analysis. Called by the "Analyze" button or externally. */
  async analyze(): Promise<void> {
 if (this.isAnalyzing) return;
 this.isAnalyzing = true;
 this.showLoading('Synthesizing cross-domain threats...');

 try {
 this.report = await synthesizeThreats();
 this.renderReport(this.report);
 } catch {
 this.showError('Synthesis failed. Retry later.');
 } finally {
 this.isAnalyzing = false;
 }
  }

  /** Public update hook — called by data-loader or panel-layout refresh. */
  updateSynthesis(report: SynthesisReport): void {
 this.report = report;
 this.renderReport(report);
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private renderEmpty(): void {
 const wrapper = h('div', { className: 'synthesis-empty' });

 const msg = h('div', { style: 'padding:16px;text-align:center;opacity:0.6;font-size:12px' },
 'No cross-domain synthesis available yet.');

 const btn = h('button', {
 className: 'synthesis-analyze-btn',
 style: 'margin:8px auto;display:block;padding:6px 16px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:inherit;cursor:pointer;font-size:11px',
 onClick: () => void this.analyze(),
 }, 'Analyze Now');

 wrapper.append(msg, btn);
 replaceChildren(this.content, wrapper);
  }

  private renderReport(report: SynthesisReport): void {
 this.setCount(report.clusters.length);

 const wrapper = h('div', { style: 'overflow-y:auto;max-height:100%;padding:0' });

 // Risk gauge
 wrapper.append(this.buildRiskGauge(report.escalationRisk, report.aiPowered));

 // Overall assessment
 if (report.overallAssessment) {
 wrapper.append(this.buildAssessment(report.overallAssessment));
 }

 // Cluster cards
 for (const cluster of report.clusters) {
 wrapper.append(this.buildClusterCard(cluster));
 }

 // Causal hypotheses
 if (report.causalHypotheses.length > 0) {
 wrapper.append(this.buildSection('Causal Hypotheses', report.causalHypotheses));
 }

 // Recommended actions
 if (report.recommendedActions.length > 0) {
 wrapper.append(this.buildSection('Recommended Actions', report.recommendedActions));
 }

 // Analyze button
 const btnRow = h('div', { style: 'padding:8px;text-align:center;border-top:1px solid rgba(255,255,255,0.06)' });
 const btn = h('button', {
 className: 'synthesis-analyze-btn',
 style: 'padding:5px 14px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:inherit;cursor:pointer;font-size:11px',
 onClick: () => void this.analyze(),
 }, 'Re-Analyze');

 const timestamp = h('span', {
 style: 'display:block;margin-top:4px;font-size:9px;opacity:0.4',
 }, `Last: ${new Date(report.timestamp).toLocaleTimeString()}`);

 btnRow.append(btn, timestamp);
 wrapper.append(btnRow);

 replaceChildren(this.content, wrapper);
  }

  private buildRiskGauge(risk: EscalationRisk, aiPowered: boolean): HTMLElement {
 const color = RISK_COLORS[risk];
 const label = RISK_LABELS[risk];

 const gauge = h('div', {
 style: 'padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.06)',
 });

 const header = h('div', {
 style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px',
 });

 const title = h('span', {
 style: 'font-size:10px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.6',
 }, 'Escalation Risk');

 const badge = h('span', {
 style: `font-size:10px;padding:1px 6px;border-radius:3px;background:${color};color:#fff;font-weight:600`,
 }, label);

 const aiBadge = h('span', {
 style: `font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px;background:${aiPowered ? 'rgba(52,152,219,0.3)' : 'rgba(255,255,255,0.1)'};opacity:0.7`,
 }, aiPowered ? 'AI' : 'Template');

 header.append(title, h('div', null, badge, aiBadge));
 gauge.append(header);

 // Gradient bar
 const barTrack = h('div', {
 style: 'height:6px;border-radius:3px;background:linear-gradient(to right, #27ae60, #f39c12, #e67e22, #c0392b);position:relative;overflow:visible',
 });

 const riskPositions: Record<EscalationRisk, number> = { low: 12.5, moderate: 37.5, high: 62.5, critical: 87.5 };
 const pos = riskPositions[risk];

 const indicator = h('div', {
 style: `position:absolute;top:-3px;left:${pos}%;transform:translateX(-50%);width:12px;height:12px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,0.8);box-shadow:0 0 6px ${color}`,
 });

 barTrack.append(indicator);
 gauge.append(barTrack);

 return gauge;
  }

  private buildAssessment(text: string): HTMLElement {
 return h('div', {
 style: 'padding:8px 12px;font-size:11px;line-height:1.5;border-bottom:1px solid rgba(255,255,255,0.06);opacity:0.85',
 }, escapeHtml(text));
  }

  private buildClusterCard(cluster: CrossDomainCluster): HTMLElement {
 const borderColor = RISK_COLORS[cluster.escalationRisk];

 const card = h('div', {
 style: `padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06);border-left:3px solid ${borderColor}`,
 });

 // Header: region + domains
 const headerRow = h('div', {
 style: 'display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap',
 });

 const regionLabel = h('span', {
 style: 'font-size:11px;font-weight:600',
 }, escapeHtml(cluster.region));

 const riskBadge = h('span', {
 style: `font-size:9px;padding:1px 5px;border-radius:3px;background:${borderColor};color:#fff`,
 }, RISK_LABELS[cluster.escalationRisk]);

 headerRow.append(regionLabel, riskBadge);

 // Domain icons row
 const domainsRow = h('div', {
 style: 'display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap',
 });

 for (const [domain, signals] of Object.entries(cluster.signalsByDomain)) {
 const icon = DOMAIN_ICONS[domain] ?? '';
 const domainTag = h('span', {
 style: 'font-size:9px;padding:1px 5px;border-radius:2px;background:rgba(255,255,255,0.08);white-space:nowrap',
 title: signals.join(', '),
 }, `${icon} ${domain} (${signals.length})`);
 domainsRow.append(domainTag);
 }

 card.append(headerRow, domainsRow);

 // Causal hypothesis
 if (cluster.causalHypothesis) {
 const hypothesis = h('div', {
 style: 'font-size:10px;line-height:1.4;opacity:0.8;margin-bottom:6px;padding:4px 6px;background:rgba(255,255,255,0.03);border-radius:3px',
 }, escapeHtml(cluster.causalHypothesis));
 card.append(hypothesis);
 }

 // Causal chain visualization (if template matched)
 if (cluster.matchedTemplate) {
 card.append(this.buildCausalChain(cluster.matchedTemplate));
 }

 // Confidence bar
 const confRow = h('div', {
 style: 'display:flex;align-items:center;gap:6px;margin-top:4px',
 });

 const confLabel = h('span', {
 style: 'font-size:9px;opacity:0.5',
 }, 'Confidence:');

 const confBar = h('div', {
 style: 'flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,0.1)',
 });

 const confFill = h('div', {
 style: `height:100%;border-radius:2px;background:${borderColor};width:${(cluster.confidence * 100).toFixed(0)}%`,
 });

 const confValue = h('span', {
 style: 'font-size:9px;opacity:0.5',
 }, `${(cluster.confidence * 100).toFixed(0)}%`);

 confBar.append(confFill);
 confRow.append(confLabel, confBar, confValue);
 card.append(confRow);

 return card;
  }

  private buildCausalChain(templateId: string): HTMLElement {
 const template: CausalTemplate | undefined = CAUSAL_TEMPLATES.find(t => t.id === templateId);

 const chain = h('div', {
 style: 'padding:4px 0;margin-bottom:4px',
 });

 if (!template) return chain;

 const chainTitle = h('div', {
 style: 'font-size:9px;opacity:0.5;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.3px',
 }, 'Causal Chain');

 chain.append(chainTitle);

 const flowContainer = h('div', {
 style: 'display:flex;align-items:center;flex-wrap:wrap;gap:2px;font-size:9px',
 });

 for (let i = 0; i < template.links.length; i++) {
 const link = template.links[i];
 if (!link) continue;

 if (i > 0) {
 const arrow = h('span', {
 style: 'opacity:0.4;font-size:10px',
 }, ' \u2192 ');
 flowContainer.append(arrow);
 }

 const trigger = h('span', {
 style: 'padding:1px 4px;border-radius:2px;background:rgba(255,255,255,0.08)',
 title: link.label,
 }, escapeHtml(link.triggerType.replace(/_/g, ' ')));

 flowContainer.append(trigger);

 // Show last effect
 if (i === template.links.length - 1) {
 const arrow = h('span', {
 style: 'opacity:0.4;font-size:10px',
 }, ' \u2192 ');
 const effect = h('span', {
 style: 'padding:1px 4px;border-radius:2px;background:rgba(231,76,60,0.15);color:#e74c3c',
 title: 'Final effect',
 }, escapeHtml(link.effectType.replace(/_/g, ' ')));
 flowContainer.append(arrow, effect);
 }
 }

 chain.append(flowContainer);
 return chain;
  }

  private buildSection(title: string, items: string[]): HTMLElement {
 const section = h('div', {
 style: 'padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06)',
 });

 const heading = h('div', {
 style: 'font-size:10px;text-transform:uppercase;letter-spacing:0.5px;opacity:0.5;margin-bottom:4px',
 }, title);

 section.append(heading);

 for (const item of items) {
 const row = h('div', {
 style: 'font-size:11px;padding:2px 0 2px 10px;position:relative;line-height:1.4',
 });

 const bullet = h('span', {
 style: 'position:absolute;left:0;opacity:0.4',
 }, '\u2022');

 const text = h('span', null, escapeHtml(item));

 row.append(bullet, text);
 section.append(row);
 }

 return section;
  }
}
