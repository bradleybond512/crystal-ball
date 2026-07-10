/* eslint-disable unicorn/no-array-callback-reference */
import { Panel } from './Panel';
import {
  buildRenderData,
  computeGlobalEscalationIndex,
} from './nuclear-deterrence-helpers';
import type { NuclearPosture, DeterrenceEvent, NuclearTreaty } from './nuclear-deterrence-helpers';

const REFRESH_MS = 3_600_000;

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escalationColor(risk: number): string {
  if (risk >= 75) return '#d50000';
  if (risk >= 55) return '#ff9800';
  if (risk >= 35) return '#ffeb3b';
  return '#4caf50';
}

function stabilityColor(score: number): string {
  if (score >= 75) return '#4caf50';
  if (score >= 50) return '#ffeb3b';
  if (score >= 30) return '#ff9800';
  return '#d50000';
}

function treatyStatusColor(status: NuclearTreaty['status']): string {
  if (status === 'in-force') return '#4caf50';
  if (status === 'suspended' || status === 'negotiating') return '#ff9800';
  return '#d50000';
}

function alertLevelColor(level: NuclearPosture['alertLevel']): string {
  if (level === 'DEFCON-1' || level === 'DEFCON-2') return '#d50000';
  if (level === 'DEFCON-3' || level === 'elevated') return '#ff9800';
  if (level === 'DEFCON-4') return '#ffeb3b';
  return '#9e9e9e';
}

function renderGlobalIndexBar(index: number): string {
  const color = escalationColor(index);
  const pct = Math.min(100, index);
  return `<div style="margin-bottom:8px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Global Escalation Index</div>
      <div style="font-size:14px;font-weight:700;color:${color};">${index}</div>
    </div>
    <div style="background:var(--border-subtle,#333);border-radius:3px;height:6px;overflow:hidden;">
      <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div>
    </div>
  </div>`;
}

function renderPostureRow(p: NuclearPosture): string {
  const eColor = escalationColor(p.escalationRisk);
  const sColor = stabilityColor(p.stabilityScore);
  const aColor = alertLevelColor(p.alertLevel);
  const triad = p.triadLegs.map((l) => {
    if (l === 'land-based') return 'L';
    if (l === 'sea-based') return 'S';
    return 'A';
  }).join('');
  const mod = p.modernizationActive
    ? '<span style="color:#ff9800;font-size:9px;margin-left:4px;">MOD</span>'
    : '';
  return `<div style="display:grid;grid-template-columns:80px 1fr 70px 50px;gap:6px;align-items:center;padding:5px 8px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${eColor};border-radius:3px;font-size:11px;">
    <div>
      <span style="font-weight:700;">${escHtml(p.nation)}</span>${mod}
      <div style="color:${aColor};font-size:9px;margin-top:1px;">${escHtml(p.alertLevel)}</div>
    </div>
    <div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);">${escHtml(p.doctrine)}</div>
      <div style="font-size:9px;color:var(--text-secondary,#aaa);">${escHtml(p.treatyStatus)} · ${escHtml(triad)}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;color:var(--text-secondary,#aaa);">dep ${p.deployedWarheads.toLocaleString()}</div>
      <div style="font-size:9px;color:var(--text-secondary,#aaa);">est ${p.estimatedWarheads.toLocaleString()}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-weight:700;color:${eColor};font-size:11px;">${p.escalationRisk}</div>
      <div style="color:${sColor};font-size:9px;">stab ${p.stabilityScore}</div>
    </div>
  </div>`;
}

function renderPostures(postures: NuclearPosture[]): string {
  const rows = postures.map(renderPostureRow).join('');
  return `<div>
    <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Nuclear Postures (${postures.length})</div>
    <div style="display:flex;flex-direction:column;gap:3px;">${rows}</div>
  </div>`;
}

function renderEvent(ev: DeterrenceEvent): string {
  let color: string;
  if (ev.escalationImpact >= 7) {
    color = '#d50000';
  } else if (ev.escalationImpact >= 4) {
    color = '#ff9800';
  } else {
    color = '#ffeb3b';
  }
  const nationsText = ev.nations.join(', ');
  return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;padding:6px 8px;font-size:11px;">
    <div style="display:flex;justify-content:space-between;align-items:start;">
      <div style="font-weight:600;">${escHtml(ev.eventType.replace(/-/g, ' '))} · ${escHtml(nationsText)}</div>
      <div style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);font-size:10px;">${escHtml(ev.date)}</div>
    </div>
    <div style="margin-top:2px;color:var(--text-secondary,#aaa);font-size:10px;">${escHtml(ev.description)}</div>
    <div style="margin-top:2px;font-size:10px;">Impact: <span style="color:${color};font-weight:700;">${ev.escalationImpact > 0 ? '+' : ''}${ev.escalationImpact}</span></div>
  </div>`;
}

function renderEvents(events: DeterrenceEvent[]): string {
  if (events.length === 0) {
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Escalations</div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);">No recent escalation events.</div>
    </div>`;
  }
  const rows = events.map(renderEvent).join('');
  return `<div>
    <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Escalations (${events.length})</div>
    <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
  </div>`;
}

function renderTreaty(tr: NuclearTreaty): string {
  const color = treatyStatusColor(tr.status);
  const partiesText = tr.parties.length === 0 ? 'No nuclear-armed parties' : tr.parties.join(', ');
  const expiry = tr.expiryYear == null ? '' : ` · expires ${tr.expiryYear}`;
  return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${color};border-radius:3px;padding:6px 8px;font-size:11px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <div style="font-weight:700;">${escHtml(tr.name)}</div>
      <div style="font-size:10px;font-weight:700;color:${color};text-transform:uppercase;">${escHtml(tr.status)}${escHtml(expiry)}</div>
    </div>
    <div style="margin-top:2px;color:var(--text-secondary,#aaa);font-size:10px;">${escHtml(tr.keyProvision)}</div>
    <div style="margin-top:2px;font-size:9px;color:var(--text-secondary,#aaa);">${escHtml(partiesText)}</div>
  </div>`;
}

function renderTreaties(treaties: NuclearTreaty[], health: { active: number; degraded: number; collapsed: number }): string {
  const rows = treaties.map(renderTreaty).join('');
  return `<div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);">Treaty Health</div>
      <div style="font-size:11px;">
        <span style="color:#4caf50;">${health.active} active</span>
        <span style="margin:0 4px;color:var(--text-secondary,#aaa);">·</span>
        <span style="color:#ff9800;">${health.degraded} degraded</span>
        <span style="margin:0 4px;color:var(--text-secondary,#aaa);">·</span>
        <span style="color:#d50000;">${health.collapsed} collapsed</span>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
  </div>`;
}

function renderSummaryBar(totalDeployed: number, totalEstimated: number, doctrineSummary: Record<string, number>): string {
  const docEntries = Object.entries(doctrineSummary)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `<span style="display:inline-block;padding:2px 6px;border:1px solid var(--border-subtle,#333);border-radius:8px;font-size:10px;margin-right:4px;margin-bottom:4px;">${escHtml(k)} <strong>${v}</strong></span>`)
    .join('');
  return `<div>
    <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Warhead Summary</div>
    <div style="display:flex;gap:16px;font-size:12px;margin-bottom:8px;">
      <div><span style="color:var(--text-secondary,#aaa);">Deployed</span> <strong>${totalDeployed.toLocaleString()}</strong></div>
      <div><span style="color:var(--text-secondary,#aaa);">Estimated total</span> <strong>${totalEstimated.toLocaleString()}</strong></div>
    </div>
    <div>${docEntries}</div>
  </div>`;
}

export class NuclearDeterrencePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastFetchAt: number | null = null;

  constructor() {
    super({
      id: 'nuclear-deterrence',
      title: 'Nuclear Deterrence Monitor',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tracks the nuclear postures of 9 nuclear-armed states — alert levels, doctrine, warhead counts, treaty health, and a global escalation index derived from per-nation escalation risk scores.',
    });
    this.start();
  }

  public destroy(): void {
    super.destroy();
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
    this.lastFetchAt = Date.now();
    const data = buildRenderData();
    const index = computeGlobalEscalationIndex(data.postures);
    const highRiskCount = data.postures.filter((p) => p.escalationRisk >= 55).length;
    this.setCount(highRiskCount);
    this.setContent(this.buildHtml(data, index));
  }

  private buildHtml(
    data: ReturnType<typeof buildRenderData>,
    index: number,
  ): string {
    const indexBar = renderGlobalIndexBar(index);
    const summary = renderSummaryBar(data.totalDeployed, data.totalEstimated, data.doctrineSummary);
    const postures = renderPostures(data.postures);
    const events = renderEvents(data.recentEvents);
    const treaties = renderTreaties(data.treaties, data.treatyHealth);
    const footer = this.renderFooter();
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${indexBar}
      ${summary}
      ${postures}
      ${events}
      ${treaties}
      ${footer}
    </div>`;
  }

  private renderFooter(): string {
    if (this.lastFetchAt === null) {
      return `<div style="font-size:10px;color:var(--text-secondary,#aaa);">Loading…</div>`;
    }
    const ageMs = Date.now() - this.lastFetchAt;
    const ageStr = ageMs < 60_000 ? 'just now' : `${Math.round(ageMs / 60_000)}m ago`;
    return `<div style="font-size:10px;color:var(--text-secondary,#aaa);">Updated ${ageStr} · static posture data</div>`;
  }
}
