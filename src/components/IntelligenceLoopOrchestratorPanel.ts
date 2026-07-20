/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Intelligence Loop Orchestrator Panel — surfaces the pipeline
 * health and recent runs. Top: stats row (total runs, success rate,
 * avg duration). Middle: 6-stage pipeline diagram with per-stage
 * success rate + last duration. Bottom: recent runs table with
 * "Run Test Observation" button.
 */

import { Panel } from './Panel';
import {
  getIntelligenceLoopOrchestrator,
  PIPELINE_STAGES,
  type PipelineRun,
  type PipelineStage,
  type PipelineStats,
  type StageResult,
} from '@/services/intelligence/intelligence-loop-orchestrator';
import type { ObservationEvent } from '@/services/intelligence/observation-types';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const RUNS_DISPLAY_LIMIT = 25;

const STAGE_LABEL: Record<PipelineStage, string> = {
  normalize: 'Normalize',
  correlate: 'Correlate',
  explain: 'Explain',
  prioritize: 'Prioritize',
  act: 'Act',
  learn: 'Learn',
};

function stageColor(rate: number): string {
  if (rate >= 0.8) return '#4caf50';
  if (rate >= 0.5) return '#ffb74d';
  return '#ff453a';
}

export class IntelligenceLoopOrchestratorPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;

  constructor() {
    super({
      id: 'intelligence-loop-orchestrator',
      title: 'Intelligence Loop Orchestrator',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Pipes observations through Normalize → Correlate → Explain → Prioritize → Act → Learn. Each stage is timed and traced. Errors in one stage do not break the rest of the pipeline.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsub = getIntelligenceLoopOrchestrator().subscribe(() => this.render());
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private render(): void {
    const svc = getIntelligenceLoopOrchestrator();
    const stats = svc.getStats();
    const runs = svc.getHistory(RUNS_DISPLAY_LIMIT);
    this.setCount(stats.totalRuns);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${renderStatsRow(stats)}
      ${renderPipelineDiagram(stats, runs[0])}
      ${renderRunsTable(runs)}
      ${renderFooter()}
    </div>`;
    this.setContent(html, () => this.wireHandlers());
  }

  private wireHandlers(): void {
    setTimeout(() => {
      const root = this.content;
      const btn = root.querySelector<HTMLButtonElement>('#iloRunTest');
      btn?.addEventListener('click', () => {
        getIntelligenceLoopOrchestrator().run(buildTestObservation());
      });
    }, 0);
  }
}

function buildTestObservation(): ObservationEvent {
  const now = Date.now();
  return {
    id: `test-${now}`,
    domain: 'cyber',
    eventType: 'panel-test',
    title: 'Panel-generated test observation',
    severity: 5,
    occurredAt: now,
    entities: ['TEST'],
    sourceIds: ['panel'],
    active: true,
  };
}

// ── Rendering helpers ───────────────────────────────────────────────

function renderStatsRow(stats: PipelineStats): string {
  const successPct = Math.round(stats.successRate * 100);
  return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
    ${statCard('Total Runs', String(stats.totalRuns), '#4a9eff')}
    ${statCard('Success Rate', `${successPct}%`, stageColor(stats.successRate))}
    ${statCard('Avg Duration', `${stats.avgDurationMs.toFixed(1)} ms`, '#ffb74d')}
  </div>`;
}

function statCard(label: string, value: string, color: string): string {
  return `<div style="padding:10px;border:1px solid var(--border-subtle,#333);border-radius:4px;background:var(--surface-2,#1a1a1a);display:flex;flex-direction:column;gap:3px;">
    <span style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(label)}</span>
    <span style="font-size:18px;font-weight:600;color:${color};">${escapeHtml(value)}</span>
  </div>`;
}

function renderPipelineDiagram(stats: PipelineStats, latestRun: PipelineRun | undefined): string {
  const cards = PIPELINE_STAGES.map((stage) => {
    const rate = stats.stageSuccessRates[stage];
    const last = latestRun?.stages.find((s) => s.stage === stage);
    return renderStageBox(stage, rate, last);
  }).join('<span style="color:var(--text-secondary,#666);font-size:14px;align-self:center;">→</span>');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Pipeline</div>
    <div style="display:flex;align-items:stretch;gap:6px;flex-wrap:wrap;">${cards}</div>
  </div>`;
}

function renderStageBox(stage: PipelineStage, rate: number, last: StageResult | undefined): string {
  const color = stageColor(rate);
  const pct = Math.round(rate * 100);
  const duration = last ? `${last.durationMs.toFixed(1)} ms` : '—';
  let statusGlyph: string;
  let statusColor: string;
  if (!last) {
    statusGlyph = '·';
    statusColor = '#9e9e9e';
  } else if (last.success) {
    statusGlyph = '✓';
    statusColor = '#4caf50';
  } else {
    statusGlyph = '✗';
    statusColor = '#ff453a';
  }
  return `<div style="flex:1;min-width:90px;padding:8px;border:1px solid ${color}66;border-radius:4px;background:var(--surface-2,#1a1a1a);display:flex;flex-direction:column;gap:3px;">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:11px;font-weight:600;">${escapeHtml(STAGE_LABEL[stage])}</span>
      <span style="font-size:14px;color:${statusColor};">${statusGlyph}</span>
    </div>
    <span style="font-size:10px;color:var(--text-secondary,#aaa);">${pct}% success</span>
    <span style="font-size:10px;font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);">${escapeHtml(duration)}</span>
  </div>`;
}

function renderRunsTable(runs: readonly PipelineRun[]): string {
  if (runs.length === 0) {
    return `<div style="font-size:12px;color:var(--text-secondary,#aaa);padding:16px;text-align:center;border:1px dashed var(--border-subtle,#333);border-radius:4px;">No pipeline runs yet. Click <strong>Run Test Observation</strong> to begin.</div>`;
  }
  const rows = runs.map((r) => renderRunRow(r)).join('');
  return `<div>
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Recent Runs</div>
    <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px;max-height:280px;overflow-y:auto;">${rows}</ul>
  </div>`;
}

function renderRunRow(run: PipelineRun): string {
  const success = run.overallSuccess;
  const color = success ? '#4caf50' : '#ff453a';
  const glyph = success ? '✓' : '✗';
  return `<li style="display:grid;grid-template-columns:18px 1fr 80px 60px;gap:8px;align-items:center;padding:6px 10px;border:1px solid var(--border-subtle,#333);border-radius:3px;background:var(--surface-2,#1a1a1a);font-size:11px;">
    <span style="color:${color};font-weight:600;">${glyph}</span>
    <span style="font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(run.observationId)}</span>
    <span style="font-family:ui-monospace,monospace;text-align:right;color:var(--text-secondary,#aaa);">${run.totalDurationMs.toFixed(1)} ms</span>
    <span style="font-family:ui-monospace,monospace;text-align:right;color:var(--text-secondary,#aaa);">${run.stages.filter((s) => s.success).length}/${run.stages.length}</span>
  </li>`;
}

function renderFooter(): string {
  return `<div style="display:flex;justify-content:flex-end;">
    <button id="iloRunTest" style="padding:5px 14px;font-size:11px;background:#4a9eff26;color:#4a9eff;border:1px solid #4a9eff55;border-radius:3px;cursor:pointer;">Run Test Observation</button>
  </div>`;
}
