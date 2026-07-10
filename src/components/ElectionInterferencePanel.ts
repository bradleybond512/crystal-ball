/**
 * Election Interference Tracker — visualizes active foreign interference
 * operations targeting upcoming elections, ranked by risk score.
 *
 * Pure helpers live in `election-interference-helpers.ts`.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildRenderData,
  classifyThreatLevel,
  computeNetRisk,
  type ElectionRisk,
  type InterferenceOperation,
  type InterferenceTactic,
} from './election-interference-helpers';

const REFRESH_MS = 30 * 60 * 1000;

const THREAT_COLOR: Record<'critical' | 'high' | 'medium' | 'low', string> = {
  critical: '#d50000',
  high: '#ff9800',
  medium: '#ffeb3b',
  low: '#9e9e9e',
};

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export class ElectionInterferencePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'election-interference',
      title: 'Election Interference Tracker',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks active foreign interference operations targeting upcoming elections. Shows risk scores, threat actors, active tactics, and resilience indicators per country.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  private render(): void {
    const data = safe(() => buildRenderData());
    if (!data) {
      this.setContent('<div style="padding:12px;color:var(--text-secondary,#aaa);font-size:11px;">Data unavailable</div>');
      return;
    }

    const criticalCount = data.risks.filter(r => classifyThreatLevel(r.riskScore) === 'critical').length;
    const highCount = data.risks.filter(r => classifyThreatLevel(r.riskScore) === 'high').length;
    this.setCount(criticalCount + highCount);
    this.setContent(this.buildHtml(data));
  }

  private buildHtml(data: {
    risks: ElectionRisk[];
    recentOps: InterferenceOperation[];
    tacticFrequency: Record<InterferenceTactic, number>;
    mostActiveActor: string;
  }): string {
    const headerBlock = this.renderHeader(data.mostActiveActor, data.risks.length);
    const risksBlock = this.renderRisks(data.risks);
    const opsBlock = this.renderRecentOps(data.recentOps);
    const tacticsBlock = this.renderTacticFrequency(data.tacticFrequency);
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${headerBlock}
      ${risksBlock}
      ${opsBlock}
      ${tacticsBlock}
    </div>`;
  }

  private renderHeader(mostActiveActor: string, totalAtRisk: number): string {
    return `<div style="display:flex;justify-content:space-between;align-items:center;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);">
        Most active: <strong style="color:#e5e5e5;">${escapeHtml(mostActiveActor)}</strong>
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);">
        ${totalAtRisk} election${totalAtRisk === 1 ? '' : 's'} at risk
      </div>
    </div>`;
  }

  private renderRisks(risks: ElectionRisk[]): string {
    if (risks.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Elections at Risk</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No elections currently tracked.</div>
      </div>`;
    }
    const rows = risks.slice(0, 7).map(r => this.renderRiskRow(r)).join('');
    const more = risks.length > 7
      ? `<div style="font-size:10px;color:var(--text-secondary,#aaa);margin-top:4px;">+ ${risks.length - 7} more</div>`
      : '';
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Elections at Risk (${risks.length})</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
      ${more}
    </div>`;
  }

  private renderRiskRow(r: ElectionRisk): string {
    const tier = classifyThreatLevel(r.riskScore);
    const color = THREAT_COLOR[tier];
    const netRisk = computeNetRisk(r);
    const threats = r.primaryThreats.join(' · ');
    const tactics = r.activeTactics.slice(0, 3).join(', ');
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;padding:6px 8px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;align-items:start;">
        <div style="font-weight:600;">${escapeHtml(r.country)}</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="font-family:ui-monospace,monospace;font-weight:700;color:${color};">${r.riskScore}</span>
          <span style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.05em;">${tier}</span>
        </div>
      </div>
      <div style="margin-top:2px;font-size:10px;color:var(--text-secondary,#aaa);">
        ${escapeHtml(r.electionDate)} &nbsp;·&nbsp; net risk ${netRisk} &nbsp;·&nbsp; resilience ${r.resilienceScore}
      </div>
      <div style="margin-top:2px;font-size:10px;color:var(--text-secondary,#aaa);">
        <span style="color:${color};">${escapeHtml(threats)}</span>
        &nbsp;·&nbsp; ${escapeHtml(tactics)}
      </div>
    </div>`;
  }

  private renderRecentOps(ops: InterferenceOperation[]): string {
    if (ops.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Operations</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No operations on record.</div>
      </div>`;
    }
    const rows = ops.map(op => this.renderOpRow(op)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Operations (${ops.length})</div>
      <div style="display:flex;flex-direction:column;gap:3px;">${rows}</div>
    </div>`;
  }

  private renderOpRow(op: InterferenceOperation): string {
    const confirmed = op.confirmed
      ? '<span style="color:#4caf50;font-size:10px;">confirmed</span>'
      : '<span style="color:#ff9800;font-size:10px;">unconfirmed</span>';
    const tactics = op.tactics.join(', ');
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:11px;gap:8px;">
      <div style="min-width:0;flex:1;">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(op.actor)} → ${escapeHtml(op.targetCountry)}
          &nbsp;${confirmed}
        </div>
        <div style="color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(tactics)}</div>
      </div>
      <div style="font-family:ui-monospace,monospace;font-size:10px;color:var(--text-secondary,#aaa);white-space:nowrap;">${escapeHtml(op.detectionDate)}</div>
    </div>`;
  }

  private renderTacticFrequency(freq: Record<InterferenceTactic, number>): string {
    const entries = Object.entries(freq)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a);
    if (entries.length === 0) {
      return '';
    }
    const badges = entries.map(([tactic, count]) =>
      `<span style="display:inline-block;padding:2px 8px;border:1px solid var(--border-subtle,#333);border-radius:8px;font-size:10px;margin-right:4px;margin-bottom:4px;">
        ${escapeHtml(tactic)} <strong>${count}</strong>
      </span>`
    ).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Tactic Frequency</div>
      <div>${badges}</div>
    </div>`;
  }
}
