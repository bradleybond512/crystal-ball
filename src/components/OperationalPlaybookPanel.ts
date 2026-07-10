/**
 * OperationalPlaybookPanel — surface active operational playbooks
 * with per-step checklist + complete/skip/abandon controls. A History
 * tab shows completed and abandoned runs with stats.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  getOperationalPlaybookEngine,
  type OperationalPlaybookEngine,
  type Playbook,
  type PlaybookStep,
  type StepStatus,
} from '@/services/intelligence/operational-playbook';

const REFRESH_MS = 30_000;
type Tab = 'active' | 'history';

const STATUS_COLOR: Record<StepStatus, string> = {
  pending:       'var(--text-secondary, #888)',
  'in-progress': 'var(--severity-info, #60a5fa)',
  complete:      'var(--severity-ok, #4ade80)',
  skipped:       'var(--text-secondary, #aaa)',
};

const RESPONSIBLE_COLOR: Record<PlaybookStep['responsible'], string> = {
  analyst:  'var(--severity-info, #60a5fa)',
  system:   'var(--severity-ok, #4ade80)',
  external: 'var(--severity-medium, #facc15)',
};

export class OperationalPlaybookPanel extends Panel {
  private readonly engine: OperationalPlaybookEngine;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private activeTab: Tab = 'active';
  private expandedPlaybookId: string | null = null;

  constructor() {
    super({
      id: 'operational-playbook',
      title: 'Operational Playbooks',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Response protocols auto-activated when situations match trigger conditions. Walk the steps to track response progress.',
    });
    this.engine = getOperationalPlaybookEngine();
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsubscribe = this.engine.subscribe(() => this.render());
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
      const active = this.engine.getActive();
      const history = this.engine.getAll().filter((p) => p.status !== 'active');
      const stats = this.engine.stats();
      this.setCount(active.length);
      this.setContent(this.buildHtml(active, history, stats), () => this.wireHandlers());
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Operational-playbook panel error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(active: readonly Playbook[], history: readonly Playbook[], stats: ReturnType<OperationalPlaybookEngine['stats']>): string {
    const header = `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <button class="opp-tab" data-tab="active" style="${tabStyle(this.activeTab === 'active')}">Active (${active.length})</button>
      <button class="opp-tab" data-tab="history" style="${tabStyle(this.activeTab === 'history')}">History (${history.length})</button>
      <span style="margin-left:auto;font-size:11px;color:var(--text-secondary,#aaa);">
        ${stats.totalActivated} total · ${stats.totalCompleted} completed · ${Math.round(stats.stepCompletionRate * 100)}% step rate
      </span>
    </div>`;

    const body = this.activeTab === 'active'
      ? renderActiveList(active, this.expandedPlaybookId)
      : renderHistoryList(history);

    return `${header}${body}`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    for (const tab of root.querySelectorAll<HTMLButtonElement>('.opp-tab')) {
      tab.addEventListener('click', () => {
        const next = tab.dataset.tab as Tab | undefined;
        if (next && next !== this.activeTab) {
          this.activeTab = next;
          this.render();
        }
      });
    }
    for (const card of root.querySelectorAll<HTMLElement>('.opp-card')) {
      card.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        const id = card.dataset.playbookId ?? null;
        this.expandedPlaybookId = this.expandedPlaybookId === id ? null : id;
        this.render();
      });
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const action = button.dataset.action;
        const playbookId = button.dataset.playbookId ?? '';
        const stepId = button.dataset.stepId ?? '';
        if (action === 'complete') this.engine.advanceStep(playbookId, stepId);
        else if (action === 'skip') this.engine.skipStep(playbookId, stepId, 'skipped from panel');
        else if (action === 'abandon') this.engine.abandonPlaybook(playbookId, 'abandoned from panel');
        this.render();
      });
    }
  }
}

function tabStyle(active: boolean): string {
  const bg = active ? 'rgba(96,165,250,0.18)' : 'transparent';
  const color = active ? 'var(--text-primary,#fff)' : 'var(--text-secondary,#aaa)';
  return `font-size:11px;padding:4px 10px;background:${bg};color:${color};border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;`;
}

function renderActiveList(active: readonly Playbook[], expandedId: string | null): string {
  if (active.length === 0) {
    return `<div style="padding:24px 16px;color:var(--text-secondary,#aaa);font-size:12px;text-align:center;">
      No active playbooks. The engine activates one whenever a situation matches a trigger template.
    </div>`;
  }
  return `<div style="max-height:480px;overflow:auto;">${active.map((p) => renderPlaybook(p, p.id === expandedId)).join('')}</div>`;
}

function renderHistoryList(history: readonly Playbook[]): string {
  if (history.length === 0) {
    return `<div style="padding:24px 16px;color:var(--text-secondary,#aaa);font-size:12px;text-align:center;">No completed playbooks yet.</div>`;
  }
  return `<div style="max-height:480px;overflow:auto;">${history.map((p) => renderHistoryRow(p)).join('')}</div>`;
}

function renderPlaybook(pb: Playbook, expanded: boolean): string {
  const completedCount = pb.steps.filter((s) => s.status === 'complete' || s.status === 'skipped').length;
  const pct = Math.round((completedCount / pb.steps.length) * 100);
  const elapsedMin = Math.round((Date.now() - pb.activatedAt) / 60_000);
  const stepsHtml = expanded
    ? `<div style="margin-top:8px;border-top:1px solid var(--border-subtle,#333);padding-top:8px;display:flex;flex-direction:column;gap:6px;">
        ${pb.steps.map((s) => renderStep(pb.id, s)).join('')}
        <div style="margin-top:6px;display:flex;justify-content:flex-end;">
          <button data-action="abandon" data-playbook-id="${escapeHtml(pb.id)}" style="font-size:10px;padding:3px 8px;background:transparent;color:var(--severity-critical,#ef4444);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Abandon</button>
        </div>
      </div>`
    : '';
  return `<div class="opp-card" data-playbook-id="${escapeHtml(pb.id)}" style="padding:12px;border-bottom:1px solid var(--border-subtle,#333);cursor:pointer;">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:9px;font-weight:600;padding:2px 5px;background:rgba(255,255,255,0.06);border-radius:3px;text-transform:uppercase;">${escapeHtml(pb.domain)}</span>
      <span style="font-size:9px;font-weight:600;padding:2px 5px;background:rgba(255,255,255,0.06);border-radius:3px;text-transform:uppercase;">${escapeHtml(pb.severity)}</span>
      <span style="font-size:12px;font-weight:600;">${escapeHtml(pb.name)}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--text-secondary,#aaa);">${completedCount}/${pb.steps.length} · ${elapsedMin}m elapsed</span>
    </div>
    <div style="margin-top:6px;height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;">
      <div style="height:100%;width:${pct}%;background:var(--severity-ok,#4ade80);"></div>
    </div>
    <div style="margin-top:4px;font-size:10px;color:var(--text-secondary,#888);">situation: <code>${escapeHtml(pb.situationId)}</code></div>
    ${stepsHtml}
  </div>`;
}

function renderStep(playbookId: string, step: PlaybookStep): string {
  const statusColor = STATUS_COLOR[step.status];
  const responsibleColor = RESPONSIBLE_COLOR[step.responsible];
  const actions = step.status === 'pending' || step.status === 'in-progress'
    ? `<button data-action="complete" data-playbook-id="${escapeHtml(playbookId)}" data-step-id="${escapeHtml(step.id)}" style="font-size:10px;padding:3px 8px;background:transparent;color:var(--text-secondary,#ccc);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Complete</button>
       <button data-action="skip" data-playbook-id="${escapeHtml(playbookId)}" data-step-id="${escapeHtml(step.id)}" style="font-size:10px;padding:3px 8px;background:transparent;color:var(--text-secondary,#aaa);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Skip</button>`
    : '';
  const notesHtml = step.notes
    ? `<div style="margin-top:4px;font-size:10px;color:var(--text-secondary,#aaa);font-style:italic;">${escapeHtml(step.notes)}</div>`
    : '';
  return `<div style="padding:6px 8px;background:rgba(0,0,0,0.18);border-radius:4px;">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:9px;font-weight:700;color:${statusColor};text-transform:uppercase;min-width:80px;">${escapeHtml(step.status)}</span>
      <span style="font-size:9px;font-weight:600;padding:2px 5px;background:${responsibleColor};color:#fff;border-radius:3px;text-transform:uppercase;">${escapeHtml(step.responsible)}</span>
      <span style="font-size:11px;flex:1;min-width:0;">${escapeHtml(`${step.order}. ${step.action}`)}</span>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);">~${step.estimatedMinutes}m</span>
      ${actions}
    </div>
    ${notesHtml}
  </div>`;
}

function renderHistoryRow(pb: Playbook): string {
  const completedAt = pb.completedAt ?? pb.abandonedAt;
  const durationMin = completedAt ? Math.round((completedAt - pb.activatedAt) / 60_000) : 0;
  const statusLabel = pb.status === 'complete' ? '✓ complete' : '× abandoned';
  const statusColor = pb.status === 'complete' ? 'var(--severity-ok,#4ade80)' : 'var(--severity-critical,#ef4444)';
  return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:9px;font-weight:700;color:${statusColor};">${statusLabel}</span>
      <span style="font-size:12px;font-weight:600;">${escapeHtml(pb.name)}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--text-secondary,#aaa);">${durationMin}m</span>
    </div>
    <div style="margin-top:2px;font-size:10px;color:var(--text-secondary,#888);">${escapeHtml(pb.domain)} · situation <code>${escapeHtml(pb.situationId)}</code>${pb.abandonReason ? ` · ${escapeHtml(pb.abandonReason)}` : ''}</div>
  </div>`;
}
