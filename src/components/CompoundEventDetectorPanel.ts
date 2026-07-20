/**
 * CompoundEventDetectorPanel — surfaces compound (multi-domain)
 * threat scenarios. Shows the active compound event with severity
 * badge + domain pills + description + age, recent history with
 * duration and max-domain-count, summary stats (maxDomainsEver), and
 * a Simulate button that injects a synthetic 3-domain event so the
 * panel can be exercised in isolation.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getCompoundEventDetectorService,
  type CompoundEvent,
  type CompoundEventDetectorService,
  type CompoundEventSummary,
  type CompoundSeverity,
  type ElevatedDomain,
} from '@/services/intelligence/compound-event-detector';

const REFRESH_MS = 15_000;
const HISTORY_LIMIT = 12;

const SEVERITY_COLOR: Record<CompoundSeverity, string> = {
  watch: 'var(--severity-medium, #facc15)',
  warning: 'var(--severity-high, #fb923c)',
  emergency: 'var(--severity-critical, #ef4444)',
};

const SEVERITY_BG: Record<CompoundSeverity, string> = {
  watch: 'rgba(250,204,21,0.08)',
  warning: 'rgba(251,146,60,0.10)',
  emergency: 'rgba(239,68,68,0.12)',
};

export class CompoundEventDetectorPanel extends Panel {
  private readonly service: CompoundEventDetectorService;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'compound-event-detector',
      title: 'Compound Events',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Detects when N domains are simultaneously elevated. 2 elevated = watch, 3-4 = warning, 5+ = emergency. Compound events are historically more dangerous than single-domain incidents.',
    });
    this.service = getCompoundEventDetectorService();
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = this.service.subscribe(() => this.render());
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

  private render(): void {
    try {
      const active = this.service.getActive();
      const history = this.service.getHistory(HISTORY_LIMIT);
      const summary = this.service.getSummary();
      this.setCount(summary.activeEvents.length);
      this.setContent(this.buildHtml(active, history, summary), () => this.wireHandlers());
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Compound Events panel error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(
    active: CompoundEvent | null,
    history: readonly CompoundEvent[],
    summary: CompoundEventSummary,
  ): string {
    return `<div style="padding:14px 16px;max-height:560px;overflow:auto;">
      ${renderActive(active)}
      ${renderSummary(summary)}
      ${renderHistory(history.filter((h) => !h.active))}
      ${renderControls()}
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const simulate = root.querySelector<HTMLButtonElement>('.ce-simulate');
    simulate?.addEventListener('click', () => {
      this.service.update([
        { domain: 'earthquake', activeSituationCount: 1, highestSeverity: 'critical', situationIds: ['sim-eq-1'] },
        { domain: 'weather', activeSituationCount: 2, highestSeverity: 'high', situationIds: ['sim-wx-1', 'sim-wx-2'] },
        { domain: 'biosurv', activeSituationCount: 1, highestSeverity: 'critical', situationIds: ['sim-bio-1'] },
      ]);
      this.render();
    });
    const clearSim = root.querySelector<HTMLButtonElement>('.ce-resolve');
    clearSim?.addEventListener('click', () => {
      this.service.update([]);
      this.render();
    });
  }
}

function renderActive(active: CompoundEvent | null): string {
  if (!active) {
    return `<section style="margin-bottom:14px;padding:14px;border:1px dashed var(--border-subtle,#333);border-radius:6px;text-align:center;">
      <div style="font-size:12px;color:var(--text-secondary,#aaa);">No active compound event.</div>
      <div style="margin-top:4px;font-size:10px;color:var(--text-secondary,#888);">Two or more simultaneously elevated domains will trigger a compound event.</div>
    </section>`;
  }
  const color = SEVERITY_COLOR[active.compoundSeverity];
  const bg = SEVERITY_BG[active.compoundSeverity];
  const age = formatDuration(Date.now() - active.detectedAt);
  const pills = active.elevatedDomains.map((d) => renderDomainPill(d)).join(' ');
  return `<section style="margin-bottom:16px;padding:14px;background:${bg};border:1px solid ${color};border-radius:6px;">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
      <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;padding:3px 10px;border-radius:10px;background:${color};color:#000;">${escapeHtml(active.compoundSeverity)}</span>
      <span style="font-size:14px;font-weight:700;">${escapeHtml(active.description)}</span>
      <span style="margin-left:auto;font-size:10px;color:var(--text-secondary,#aaa);">active ${escapeHtml(age)}</span>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">${pills}</div>
  </section>`;
}

function renderDomainPill(d: ElevatedDomain): string {
  return `<span style="padding:3px 9px;font-size:11px;background:rgba(255,255,255,0.05);border:1px solid var(--border-subtle,#333);border-radius:12px;">
    <strong>${escapeHtml(d.domain)}</strong>
    <span style="color:var(--text-secondary,#aaa);"> · ${d.activeSituationCount} active · ${escapeHtml(d.highestSeverity)}</span>
  </span>`;
}

function renderSummary(summary: CompoundEventSummary): string {
  return `<section style="margin-bottom:16px;display:flex;gap:18px;flex-wrap:wrap;">
    ${statCell('Active', summary.activeEvents.length)}
    ${statCell('Resolved 24h', summary.resolvedToday)}
    ${statCell('Max ever', summary.maxDomainsEver)}
    ${statCell('Currently elevated', summary.currentElevatedDomains.length)}
  </section>`;
}

function statCell(label: string, value: number): string {
  return `<div style="text-align:center;min-width:64px;">
    <div style="font-size:20px;font-weight:700;line-height:1;">${value}</div>
    <div style="font-size:9px;color:var(--text-secondary,#888);text-transform:uppercase;letter-spacing:0.08em;margin-top:2px;">${escapeHtml(label)}</div>
  </div>`;
}

function renderHistory(history: readonly CompoundEvent[]): string {
  if (history.length === 0) {
    return `<section style="margin-bottom:14px;">
      <h3 style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Recent (resolved)</h3>
      <div style="font-size:11px;color:var(--text-secondary,#888);font-style:italic;">(none)</div>
    </section>`;
  }
  const rows = history.map((h) => renderHistoryRow(h)).join('');
  return `<section style="margin-bottom:14px;">
    <h3 style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-secondary,#aaa);">Recent (resolved)</h3>
    <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;">${rows}</ul>
  </section>`;
}

function renderHistoryRow(e: CompoundEvent): string {
  const color = SEVERITY_COLOR[e.compoundSeverity];
  const duration = e.resolvedAt ? formatDuration(e.resolvedAt - e.detectedAt) : '—';
  return `<li style="padding:7px 10px;background:rgba(255,255,255,0.03);border-left:3px solid ${color};border-radius:3px;">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;">
      <div style="display:flex;gap:8px;align-items:baseline;">
        <span style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:${color};">[${escapeHtml(e.compoundSeverity)}]</span>
        <span style="font-size:11px;font-weight:600;">${e.domainCount}-domain</span>
        <span style="font-size:10px;color:var(--text-secondary,#888);">${e.elevatedDomains.map((d) => escapeHtml(d.domain)).join(' + ')}</span>
      </div>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);font-variant-numeric:tabular-nums;">lasted ${escapeHtml(duration)}</span>
    </div>
  </li>`;
}

function renderControls(): string {
  return `<section style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px dashed var(--border-subtle,#333);padding-top:10px;">
    <button class="ce-simulate" style="font-size:11px;padding:4px 12px;background:var(--severity-medium,#facc15);color:#000;border:none;border-radius:3px;cursor:pointer;font-weight:600;">Simulate 3-Domain Event</button>
    <button class="ce-resolve" style="font-size:11px;padding:4px 12px;background:transparent;color:var(--text-secondary,#ccc);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Resolve Active</button>
  </section>`;
}

function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 1000) return `${ms}ms`;
  const sec = Math.round(abs / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h`;
  const days = Math.round(hr / 24);
  return `${days}d`;
}
