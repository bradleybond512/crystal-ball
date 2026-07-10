/**
 * Compound Threat Panel
 *
 * Detects and displays multi-domain threat convergence. Shows a compound
 * score gauge, per-domain threat levels, and active compound alerts when
 * two or more threat domains escalate simultaneously.
 */

import { Panel } from './Panel';
import {
  getCompoundAlerts,
  getDomainLevels,
  getCompoundScore,
  getCompoundHistory,
  type ThreatDomain,
} from '@/services/compound-threat-detector';
import { escapeHtml } from '@/utils/sanitize';
import { formatTime } from '@/utils';

const DOMAIN_ICONS: Record<ThreatDomain, string> = {
  cyber: '\uD83D\uDCBB',
  military: '\u2694\uFE0F',
  infrastructure: '\uD83C\uDFD7\uFE0F',
  natural_disaster: '\uD83C\uDF0B',
  financial: '\uD83D\uDCB0',
  health: '\uD83C\uDFE5',
  social_unrest: '\uD83D\uDC65',
  nuclear: '\u2622\uFE0F',
  sigint: '\uD83D\uDCE1',
};

function getScoreColor(score: number): string {
  if (score >= 75) return '#f44336';
  if (score >= 50) return '#ff9800';
  if (score >= 25) return '#ffeb3b';
  return '#4caf50';
}

export class CompoundThreatPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
 super({
 id: 'compound-threat',
 title: 'Compound Threats',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Multi-domain threat convergence detection. Monitors multiple threat domains for simultaneous escalation patterns.',
 });
 this.showLoading('Analyzing threat convergence\u2026');
 this.start();
  }

  private start(): void {
 this.render();
 this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), 45_000);
  }

  private render(): void {
 const alerts = getCompoundAlerts();
 const domainLevels = getDomainLevels();
 const compoundScore = getCompoundScore();
 const history = getCompoundHistory();

 this.setCount(alerts.length);

 const color = getScoreColor(compoundScore);
 const label = compoundScore >= 75 ? 'CRITICAL' : compoundScore >= 50 ? 'HIGH' : compoundScore >= 25 ? 'ELEVATED' : 'NORMAL';

 const gaugeHtml = `<div style="text-align:center;padding:12px 0 8px;">
 <div style="display:inline-block;width:80px;height:80px;border-radius:50%;border:4px solid ${color};position:relative;">
 <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
 <span style="font-size:24px;font-weight:700;color:${color};">${compoundScore}</span>
 <span style="font-size:9px;font-weight:600;color:${color};">${label}</span>
 </div>
 </div>
 <div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">Compound Threat Score</div>
 </div>`;

 const domainRows = domainLevels.map(d => {
 const icon = DOMAIN_ICONS[d.domain] ?? '\uD83D\uDCCD';
 const barWidth = Math.min(100, d.level);
 const barColor = getScoreColor(d.level);
 const domainName = escapeHtml(d.domain.replace(/_/g, ' '));
 return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border-subtle,#333);">
 <span style="font-size:14px;width:20px;text-align:center;">${icon}</span>
 <span style="width:90px;font-size:11px;">${domainName}</span>
 <div style="flex:1;height:4px;background:var(--bg-tertiary,#222);border-radius:2px;overflow:hidden;">
 <div style="width:${barWidth}%;height:100%;background:${barColor};border-radius:2px;"></div>
 </div>
 <span style="width:30px;font-size:10px;text-align:right;">${d.activeIndicators}</span>
 </div>`;
 }).join('');

 const alertsHtml = alerts.length > 0 ? alerts.slice(0, 10).map(a => {
 const aColor = getScoreColor(a.overallScore);
 const domains = a.domains.map(d => escapeHtml(d)).join(' \u00B7 ');
 const time = formatTime(new Date(a.detectedAt));
 return `<div style="border-left:3px solid ${aColor};padding:6px 8px;margin-bottom:6px;background:rgba(0,0,0,0.15);border-radius:0 4px 4px 0;">
 <div style="display:flex;justify-content:space-between;">
 <span style="font-size:12px;font-weight:600;">${escapeHtml(a.title)}</span>
 <span style="font-size:11px;font-weight:700;color:${aColor};">${a.overallScore}</span>
 </div>
 <div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:2px;">${domains}</div>
 <div style="font-size:10px;color:var(--text-muted,#888);margin-top:2px;">${escapeHtml(a.escalationRisk)} \u2022 ${time}</div>
 </div>`;
 }).join('') : '<div class="panel-empty">No active compound alerts.</div>';

 const historyHtml = history.length > 0 ? (() => {
 const recent = history.slice(-12);
 const maxS = Math.max(...recent.map(h => h.score), 1);
 const bars = recent.map(h => {
 const pct = Math.round((h.score / maxS) * 100);
 const hColor = getScoreColor(h.score);
 return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">
 <div style="width:100%;height:40px;display:flex;align-items:flex-end;">
 <div style="width:100%;height:${pct}%;background:${hColor};border-radius:2px 2px 0 0;min-height:2px;"></div>
 </div>
 <span style="font-size:8px;color:var(--text-muted,#888);">${h.activeDomains}</span>
 </div>`;
 }).join('');
 return `<div style="margin-top:10px;">
 <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Score History</div>
 <div style="display:flex;gap:2px;">${bars}</div>
 </div>`;
 })() : '';

 this.setContent(`<div style="padding:8px 12px;">
 ${gaugeHtml}
 <div style="margin-top:8px;"><div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Domain Levels</div>${domainRows}</div>
 <div style="margin-top:10px;"><div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Active Alerts (${alerts.length})</div>${alertsHtml}</div>
 ${historyHtml}
 </div>`);
  }

  public override destroy(): void {
 if (this.refreshTimer) {
 clearInterval(this.refreshTimer);
 this.refreshTimer = null;
 }
 super.destroy();
  }
}
