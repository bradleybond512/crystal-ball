/**
 * Scheduler Panel (panel id: `improvement-scheduler`).
 *
 * Surfaces the autonomous self-improvement loop: per-task enable
 * toggles, "Run now" buttons, last-result badges, and a recent-history
 * table. Header has a Start / Stop toggle for the underlying interval
 * timer.
 */

import { Panel } from './Panel';
import {
  getImprovementScheduler,
  type RunResult,
  type ScheduledTask,
  type ScheduledTaskId,
  type SchedulerRun,
} from '@/services/intelligence/improvement-scheduler';
import { escapeHtml } from '@/utils/sanitize';
import { statLine } from './ui/statLine';

const REFRESH_MS = 15_000;
const HISTORY_DISPLAY_LIMIT = 20;

const RESULT_COLOR: Record<RunResult, string> = {
  success: '#2ec27e',
  error: '#e94f37',
  skipped: '#9ca3af',
};

export class SchedulerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'improvement-scheduler',
      title: 'Improvement Scheduler',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Autonomous loop that fires self-improvement tasks on per-task cadences: attention recalibration, trust budget recharge, safety evaluation, bias scan, repair recommendations, scorecard refresh.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = getImprovementScheduler().subscribe(() => this.render());
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    super.destroy();
  }

  private render(): void {
    const svc = getImprovementScheduler();
    const tasks = svc.getAllTasks();
    const enabledCount = tasks.filter((t) => t.enabled).length;
    this.setCount(enabledCount);
    this.setContent(this.buildHtml(tasks, svc.getHistory(undefined, HISTORY_DISPLAY_LIMIT), svc.isRunning(), svc.stats()), () => this.wireHandlers());
  }

  private buildHtml(
    tasks: ScheduledTask[],
    history: SchedulerRun[],
    running: boolean,
    stats: ReturnType<ReturnType<typeof getImprovementScheduler>['stats']>,
  ): string {
    return `<div class="sch-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderHeader(running, stats)}
      ${this.renderTasksTable(tasks)}
      ${this.renderHistory(history)}
    </div>`;
  }

  private renderHeader(running: boolean, stats: ReturnType<ReturnType<typeof getImprovementScheduler>['stats']>): string {
    const stateLabel = running ? 'running' : 'stopped';
    const stateColor = running ? '#2ec27e' : '#9ca3af';
    const btnLabel = running ? 'Stop' : 'Start';
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text-secondary,#bbb);">
        <span style="background:${stateColor};color:#fff;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">${stateLabel}</span>
        <span>${statLine([
          { value: stats.totalRuns, label: 'runs' },
          { value: `${(stats.successRate * 100).toFixed(0)}%`, label: 'success' },
          { value: `${stats.avgDurationMs.toFixed(0)}ms`, label: 'avg', labelFirst: true },
        ])}</span>
      </div>
      <button class="sch-toggle" type="button" style="padding:3px 10px;background:rgba(74,158,255,0.18);color:inherit;border:1px solid rgba(74,158,255,0.4);border-radius:3px;cursor:pointer;font-size:11px;">${btnLabel}</button>
    </div>`;
  }

  private renderTasksTable(tasks: ScheduledTask[]): string {
    const rows = tasks.map((t) => this.renderTaskRow(t)).join('');
    return `<div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:11px;color:#bbb;">
        <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.12);">
          <th style="text-align:left;padding:5px 6px;">On</th>
          <th style="text-align:left;padding:5px 6px;">Task</th>
          <th style="text-align:left;padding:5px 6px;">Interval</th>
          <th style="text-align:left;padding:5px 6px;">Last run</th>
          <th style="text-align:left;padding:5px 6px;">Next run</th>
          <th style="text-align:left;padding:5px 6px;">Last</th>
          <th style="text-align:right;padding:5px 6px;"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  private renderTaskRow(t: ScheduledTask): string {
    const lastRun = t.lastRunAt ? ageLabel(t.lastRunAt, Date.now()) : '—';
    const nextRun = futureLabel(t.nextRunAt, Date.now());
    const lastResultBadge = t.lastResult
      ? `<span style="background:${RESULT_COLOR[t.lastResult]};color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">${t.lastResult}</span>`
      : '<span style="opacity:0.55;">—</span>';
    const tint = t.enabled ? '' : 'opacity:0.55;';
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);${tint}">
      <td style="padding:5px 6px;text-align:center;">
        <input type="checkbox" data-task-id="${escapeHtml(t.id)}" class="sch-enabled" ${t.enabled ? 'checked' : ''}
          style="accent-color:#4a9eff;width:14px;height:14px;cursor:pointer;">
      </td>
      <td style="padding:5px 6px;color:#ddd;">
        <div style="font-weight:600;">${escapeHtml(t.name)}</div>
        <div style="font-size:10px;opacity:0.6;">${escapeHtml(t.description)}</div>
      </td>
      <td style="padding:5px 6px;font-family:ui-monospace,monospace;font-size:10px;">${intervalLabel(t.intervalMs)}</td>
      <td style="padding:5px 6px;font-size:10px;">${escapeHtml(lastRun)}</td>
      <td style="padding:5px 6px;font-size:10px;">${escapeHtml(nextRun)}</td>
      <td style="padding:5px 6px;">${lastResultBadge}</td>
      <td style="padding:5px 6px;text-align:right;">
        <button class="sch-run-now" data-task-id="${escapeHtml(t.id)}" type="button" style="padding:2px 8px;background:rgba(74,158,255,0.18);color:inherit;border:1px solid rgba(74,158,255,0.4);border-radius:2px;cursor:pointer;font-size:10px;">Run now</button>
      </td>
    </tr>`;
  }

  private renderHistory(history: SchedulerRun[]): string {
    if (history.length === 0) {
      return `<div style="padding:10px;text-align:center;opacity:0.55;font-size:11px;">No runs recorded yet.</div>`;
    }
    const rows = history.map((r) => {
      const errorCell = r.errorMessage
        ? `<span style="font-size:10px;color:#e94f37;">${escapeHtml(r.errorMessage)}</span>`
        : '<span style="opacity:0.55;">—</span>';
      return `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
        <td style="padding:4px 6px;font-family:ui-monospace,monospace;font-size:10px;color:#ddd;">${escapeHtml(r.taskId)}</td>
        <td style="padding:4px 6px;font-size:10px;">${escapeHtml(ageLabel(r.startedAt, Date.now()))}</td>
        <td style="padding:4px 6px;font-size:10px;font-family:ui-monospace,monospace;">${r.durationMs.toFixed(0)}ms</td>
        <td style="padding:4px 6px;"><span style="background:${RESULT_COLOR[r.result]};color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">${r.result}</span></td>
        <td style="padding:4px 6px;">${errorCell}</td>
      </tr>`;
    }).join('');
    return `<div style="overflow-x:auto;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:#888;padding:4px 0;">Recent runs</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;color:#bbb;">
        <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.12);">
          <th style="text-align:left;padding:4px 6px;">Task</th>
          <th style="text-align:left;padding:4px 6px;">Started</th>
          <th style="text-align:left;padding:4px 6px;">Duration</th>
          <th style="text-align:left;padding:4px 6px;">Result</th>
          <th style="text-align:left;padding:4px 6px;">Error</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const svc = getImprovementScheduler();

    root.querySelector<HTMLButtonElement>('.sch-toggle')?.addEventListener('click', () => {
      if (svc.isRunning()) svc.stop();
      else svc.start();
      this.render();
    });

    for (const input of root.querySelectorAll<HTMLInputElement>('.sch-enabled')) {
      input.addEventListener('change', () => {
        const id = input.dataset.taskId as ScheduledTaskId | undefined;
        if (!id) return;
        if (input.checked) svc.enableTask(id);
        else svc.disableTask(id);
      });
    }

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.sch-run-now')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.taskId as ScheduledTaskId | undefined;
        if (!id) return;
        void svc.runNow(id);
      });
    }
  }
}

function intervalLabel(ms: number): string {
  const hours = ms / 60 / 60_000;
  if (hours >= 24) return `${Math.round(hours / 24)}d`;
  if (hours >= 1) return `${Math.round(hours)}h`;
  return `${Math.round(ms / 60_000)}m`;
}

function ageLabel(then: Date, now: number): string {
  const ms = now - then.getTime();
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s ago`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))}h ago`;
  return `${Math.round(ms / (24 * 60 * 60_000))}d ago`;
}

function futureLabel(then: Date, now: number): string {
  const ms = then.getTime() - now;
  if (ms <= 0) return 'now';
  if (ms < 60_000) return `in ${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `in ${Math.round(ms / 60_000)}m`;
  if (ms < 24 * 60 * 60_000) return `in ${Math.round(ms / (60 * 60_000))}h`;
  return `in ${Math.round(ms / (24 * 60 * 60_000))}d`;
}
