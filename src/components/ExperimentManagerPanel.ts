/**
 * Experiment Manager Panel (panel id: `experiment-manager`).
 *
 * List of A/B experiments with status badges, Create form
 * (name + algorithm + hypothesis + trafficSplit slider), and
 * per-experiment Start/Pause/Resume/Conclude controls. When the
 * experiment has enough observations the row expands with
 * control/treatment positive-rate bars, lift, and the result
 * recommendation badge (graduate/reject/continue/insufficient-data).
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  getExperimentManager,
  type Experiment,
  type ExperimentRecommendation,
  type ExperimentResult,
  type ExperimentStatus,
} from '@/services/intelligence/experiment-manager';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;

const STATUS_COLOR: Record<ExperimentStatus, string> = {
  draft: '#9ca3af',
  running: '#4a9eff',
  paused: '#f5a524',
  concluded: '#2ec27e',
};

const RECOMMENDATION_COLOR: Record<ExperimentRecommendation, string> = {
  graduate: '#2ec27e',
  reject: '#e94f37',
  continue: '#f5a524',
  'insufficient-data': '#9ca3af',
};

const RECOMMENDATION_LABEL: Record<ExperimentRecommendation, string> = {
  graduate: 'Graduate',
  reject: 'Reject',
  continue: 'Continue',
  'insufficient-data': 'Insufficient data',
};

export class ExperimentManagerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private listener: ((experiments: Experiment[]) => void) | null = null;
  private formExpanded = false;

  constructor() {
    super({
      id: 'experiment-manager',
      title: 'Experiments',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Lightweight A/B framework for algorithm tweaks. Create a draft, start it, record observations, and graduate or reject based on lift.',
    });
    const svc = getExperimentManager();
    this.listener = () => this.render();
    svc.subscribe(this.listener);
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.render();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.listener) {
      getExperimentManager().unsubscribe(this.listener);
      this.listener = null;
    }
    super.destroy();
  }

  private render(): void {
    const svc = getExperimentManager();
    const experiments = svc.getExperiments();
    const running = experiments.filter((e) => e.status === 'running').length;
    this.setCount(running);
    this.setContent(this.buildHtml(experiments), () => this.wireHandlers());
  }

  private buildHtml(experiments: readonly Experiment[]): string {
    return `<div class="exp-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderHeader(experiments.length)}
      ${this.formExpanded ? this.renderCreateForm() : ''}
      ${this.renderExperiments(experiments)}
    </div>`;
  }

  private renderHeader(total: number): string {
    const toggleLabel = this.formExpanded ? '× Cancel' : '+ New experiment';
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
      <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;">${total} experiment${total === 1 ? '' : 's'}</span>
      <button class="exp-toggle-form" type="button" style="padding:3px 10px;background:rgba(74,158,255,0.18);color:inherit;border:1px solid rgba(74,158,255,0.4);border-radius:3px;cursor:pointer;font-size:11px;">${escapeHtml(toggleLabel)}</button>
    </div>`;
  }

  private renderCreateForm(): string {
    return `<form class="exp-create-form" style="display:flex;flex-direction:column;gap:6px;padding:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:4px;">
      <input class="exp-input-name" type="text" placeholder="Name (e.g. Truth weights v2)" required style="padding:4px 6px;background:rgba(0,0,0,0.3);color:inherit;border:1px solid rgba(255,255,255,0.1);border-radius:3px;font-size:11px;font-family:inherit;" />
      <input class="exp-input-algo" type="text" placeholder="Algorithm id (e.g. truth-score)" required style="padding:4px 6px;background:rgba(0,0,0,0.3);color:inherit;border:1px solid rgba(255,255,255,0.1);border-radius:3px;font-size:11px;font-family:ui-monospace,monospace;" />
      <input class="exp-input-hyp" type="text" placeholder="Hypothesis (e.g. +10% positive rate)" required style="padding:4px 6px;background:rgba(0,0,0,0.3);color:inherit;border:1px solid rgba(255,255,255,0.1);border-radius:3px;font-size:11px;font-family:inherit;" />
      <input class="exp-input-metric" type="text" placeholder="Success metric (e.g. positive-rate)" required style="padding:4px 6px;background:rgba(0,0,0,0.3);color:inherit;border:1px solid rgba(255,255,255,0.1);border-radius:3px;font-size:11px;font-family:inherit;" />
      <textarea class="exp-input-desc" placeholder="Description (optional)" rows="2" style="padding:4px 6px;background:rgba(0,0,0,0.3);color:inherit;border:1px solid rgba(255,255,255,0.1);border-radius:3px;font-size:11px;font-family:inherit;resize:vertical;"></textarea>
      <label style="display:flex;align-items:center;gap:8px;font-size:11px;">
        <span style="opacity:0.7;flex-shrink:0;">Traffic split</span>
        <input class="exp-input-split" type="range" min="0" max="50" value="10" step="1" style="flex:1;" />
        <span class="exp-split-label" style="min-width:34px;text-align:right;font-family:ui-monospace,monospace;">10%</span>
      </label>
      <button class="exp-submit" type="submit" style="padding:4px 10px;background:rgba(46,194,126,0.2);color:inherit;border:1px solid rgba(46,194,126,0.5);border-radius:3px;cursor:pointer;font-size:11px;align-self:flex-end;">Create draft</button>
    </form>`;
  }

  private renderExperiments(experiments: readonly Experiment[]): string {
    if (experiments.length === 0) {
      return `<div style="font-size:11px;opacity:0.55;padding:6px 0;text-align:center;">No experiments yet — create one above.</div>`;
    }
    const sorted = [...experiments].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return `<div style="display:flex;flex-direction:column;gap:6px;">${sorted.map((e) => this.renderExperimentRow(e)).join('')}</div>`;
  }

  private renderExperimentRow(e: Experiment): string {
    const svc = getExperimentManager();
    const result = svc.getResult(e.id);
    const statusColor = STATUS_COLOR[e.status];
    return `<div style="border-left:3px solid ${statusColor};background:rgba(255,255,255,0.02);border-radius:0 3px 3px 0;padding:6px 8px;display:flex;flex-direction:column;gap:4px;" data-exp-id="${escapeHtml(e.id)}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <span style="font-size:11.5px;color:#ddd;font-weight:600;">${escapeHtml(e.name)}</span>
        <span style="font-size:9px;text-transform:uppercase;letter-spacing:0.05em;color:${statusColor};font-weight:700;">${e.status}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:10px;opacity:0.7;">
        <span style="font-family:ui-monospace,monospace;">${escapeHtml(e.algorithmId)} · ${(e.trafficSplit * 100).toFixed(0)}% treatment</span>
        <span>${result.sampleSize} obs</span>
      </div>
      ${result.sampleSize > 0 ? this.renderResult(result) : ''}
      ${this.renderControls(e)}
    </div>`;
  }

  private renderResult(r: ExperimentResult): string {
    const liftPct = (r.lift * 100).toFixed(1);
    const liftSign = r.lift >= 0 ? '+' : '';
    const liftColor = liftColorFor(r.lift, r.isSignificant);
    const recColor = RECOMMENDATION_COLOR[r.recommendation];
    const recLabel = RECOMMENDATION_LABEL[r.recommendation];
    return `<div style="display:flex;flex-direction:column;gap:3px;margin-top:2px;">
      <div style="display:flex;gap:6px;align-items:center;font-size:10px;">
        <span style="opacity:0.55;width:54px;">Control</span>
        <div style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,0.06);overflow:hidden;">
          <div style="width:${(r.controlPositiveRate * 100).toFixed(0)}%;height:100%;background:#9ca3af;"></div>
        </div>
        <span style="font-family:ui-monospace,monospace;width:42px;text-align:right;">${(r.controlPositiveRate * 100).toFixed(0)}%</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;font-size:10px;">
        <span style="opacity:0.55;width:54px;">Treatment</span>
        <div style="flex:1;height:4px;border-radius:2px;background:rgba(255,255,255,0.06);overflow:hidden;">
          <div style="width:${(r.treatmentPositiveRate * 100).toFixed(0)}%;height:100%;background:#4a9eff;"></div>
        </div>
        <span style="font-family:ui-monospace,monospace;width:42px;text-align:right;">${(r.treatmentPositiveRate * 100).toFixed(0)}%</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;margin-top:2px;">
        <span style="color:${liftColor};font-weight:600;">Lift ${liftSign}${liftPct}%${r.isSignificant ? ' (sig.)' : ''}</span>
        <span style="padding:1px 6px;background:${recColor}22;color:${recColor};border:1px solid ${recColor}55;border-radius:2px;font-size:9px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">${escapeHtml(recLabel)}</span>
      </div>
    </div>`;
  }

  private renderControls(e: Experiment): string {
    const buttons: string[] = [];
    if (e.status === 'draft') {
      buttons.push(this.actionButton('start', 'Start', '#4a9eff'));
    }
    if (e.status === 'running') {
      buttons.push(
        this.actionButton('pause', 'Pause', '#f5a524'),
        this.actionButton('conclude', 'Conclude', '#9ca3af'),
      );
    }
    if (e.status === 'paused') {
      buttons.push(
        this.actionButton('resume', 'Resume', '#4a9eff'),
        this.actionButton('conclude', 'Conclude', '#9ca3af'),
      );
    }
    if (buttons.length === 0) return '';
    return `<div style="display:flex;gap:4px;margin-top:2px;">${buttons.join('')}</div>`;
  }

  private actionButton(action: string, label: string, color: string): string {
    return `<button class="exp-action" data-action="${escapeHtml(action)}" type="button" style="padding:2px 8px;background:${color}22;color:${color};border:1px solid ${color}55;border-radius:2px;cursor:pointer;font-size:10px;font-family:inherit;">${escapeHtml(label)}</button>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const svc = getExperimentManager();

    root.querySelector<HTMLButtonElement>('.exp-toggle-form')?.addEventListener('click', () => {
      this.formExpanded = !this.formExpanded;
      this.render();
    });

    const form = root.querySelector<HTMLFormElement>('.exp-create-form');
    const split = form?.querySelector<HTMLInputElement>('.exp-input-split');
    const splitLabel = form?.querySelector<HTMLSpanElement>('.exp-split-label');
    if (split && splitLabel) {
      split.addEventListener('input', () => {
        splitLabel.textContent = `${split.value}%`;
      });
    }
    form?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = form.querySelector<HTMLInputElement>('.exp-input-name')?.value.trim() ?? '';
      const algorithmId = form.querySelector<HTMLInputElement>('.exp-input-algo')?.value.trim() ?? '';
      const hypothesis = form.querySelector<HTMLInputElement>('.exp-input-hyp')?.value.trim() ?? '';
      const successMetric = form.querySelector<HTMLInputElement>('.exp-input-metric')?.value.trim() ?? '';
      const description = form.querySelector<HTMLTextAreaElement>('.exp-input-desc')?.value.trim() ?? '';
      const trafficSplit = Number(split?.value ?? '10') / 100;
      if (!name || !algorithmId || !hypothesis || !successMetric) return;
      svc.create({ name, description, algorithmId, hypothesis, successMetric, trafficSplit });
      this.formExpanded = false;
      this.render();
    });

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.exp-action')) {
      btn.addEventListener('click', () => {
        const row = btn.closest<HTMLElement>('[data-exp-id]');
        const id = row?.getAttribute('data-exp-id');
        const action = btn.getAttribute('data-action');
        if (!id || !action) return;
        try {
          if (action === 'start') svc.start(id);
          else if (action === 'pause') svc.pause(id);
          else if (action === 'resume') svc.resume(id);
          else if (action === 'conclude') svc.conclude(id);
        } catch { /* lifecycle violation — handled by render() */ }
      });
    }
  }
}

function liftColorFor(lift: number, isSignificant: boolean): string {
  if (!isSignificant) return '#9ca3af';
  if (lift > 0) return '#2ec27e';
  return '#e94f37';
}
