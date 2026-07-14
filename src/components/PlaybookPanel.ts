// All string interpolations use escapeHtml(); numeric values (step.order,
// pct, doneCount) are numbers and cannot carry XSS payloads.
import { Panel } from './Panel';
import { getPlaybook, formatPlaybookForNotification } from '@/services/intelligence/playbook-engine';
import type {  PlaybookStep, ObservationEvent } from '@/types/intelligence';
import { escapeHtml } from '@/utils/sanitize';

const STORAGE_KEY = 'cb:playbook-panel:done-steps';
const RECENT_KEY = 'cb:playbook-panel:recent';
const MAX_RECENT = 20;

interface RecentEntry {
  playbookId: string;
  playbookName: string;
  eventTitle: string;
  triggeredAt: number;
  steps: PlaybookStep[];
}

const CATEGORY_ICON: Record<PlaybookStep['category'], string> = {
  monitor: '📡',
  notify: '🔔',
  prepare: '🧰',
  act: '⚡',
  verify: '✅',
};

const CATEGORY_COLOR: Record<PlaybookStep['category'], string> = {
  monitor: '#4a9eff',
  notify: '#ffb74d',
  prepare: '#81c784',
  act: '#ff453a',
  verify: '#9c27b0',
};

export class PlaybookPanel extends Panel {
  private doneSteps = new Set<string>();
  private recent: RecentEntry[] = [];

  constructor() {
    super({ id: 'playbook', title: 'Response Playbooks' });
    this.loadState();
    this.render();
  }

  destroy(): void {
    // no timers or event listeners to clean up
  }

  /** Attach a matching playbook whenever a HIGH/CRITICAL event fires. */
  triggerPlaybook(event: ObservationEvent): void {
    const playbook = getPlaybook(event);
    if (!playbook) return;
    const entry: RecentEntry = {
      playbookId: playbook.id,
      playbookName: playbook.name,
      eventTitle: event.title,
      triggeredAt: Date.now(),
      steps: [...playbook.steps].sort((a, b) => a.order - b.order),
    };
    this.recent.unshift(entry);
    if (this.recent.length > MAX_RECENT) this.recent.length = MAX_RECENT;
    this.saveState();
    this.render();
  }

  private stepKey(playbookId: string, stepOrder: number): string {
    return `${playbookId}:${stepOrder}`;
  }

  private toggleStep(playbookId: string, stepOrder: number): void {
    const key = this.stepKey(playbookId, stepOrder);
    if (this.doneSteps.has(key)) {
      this.doneSteps.delete(key);
    } else {
      this.doneSteps.add(key);
    }
    this.saveState();
    this.render();
  }

  private loadState(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.doneSteps = new Set(JSON.parse(raw) as string[]);
      const rawRecent = localStorage.getItem(RECENT_KEY);
      if (rawRecent) this.recent = JSON.parse(rawRecent) as RecentEntry[];
    } catch {
      this.doneSteps = new Set();
      this.recent = [];
    }
  }

  private saveState(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.doneSteps]));
      localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent));
    } catch {
      // storage quota exceeded — non-fatal
    }
  }

  private buildHtml(): string {
    if (this.recent.length === 0) {
      return `<div style="padding:16px;color:#8899a6;font-size:13px;">
        No playbooks triggered yet.<br>
        Playbooks activate automatically when HIGH or CRITICAL alerts fire.
      </div>`;
    }
    const count = this.recent.length;
    const entries = this.recent.map(e => this.buildEntryHtml(e)).join('');
    return `
      <div style="padding:12px 16px 4px;font-size:13px;color:#8899a6;">
        ${count} playbook${count === 1 ? '' : 's'} triggered
        <button data-action="clear-done"
          style="float:right;font-size:11px;background:none;border:1px solid #2a3a4a;
                 color:#8899a6;border-radius:3px;padding:1px 6px;cursor:pointer;">
          Clear completed
        </button>
      </div>
      ${entries}`;
  }

  private render(): void {
    const el = this.element;
    if (!el) return;
    el.innerHTML = this.buildHtml();

    el.querySelectorAll<HTMLElement>('[data-step]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-playbook-id') ?? '';
        const order = Number(btn.getAttribute('data-step-order') ?? '0');
        this.toggleStep(id, order);
      });
    });

    el.querySelector<HTMLElement>('[data-action="clear-done"]')?.addEventListener('click', () => {
      this.doneSteps.clear();
      this.saveState();
      this.render();
    });
  }

  private buildEntryHtml(entry: RecentEntry): string {
    const when = new Date(entry.triggeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const doneCount = entry.steps.filter(s => this.doneSteps.has(this.stepKey(entry.playbookId, s.order))).length;
    const pct = Math.round((doneCount / entry.steps.length) * 100);
    const stepsHtml = entry.steps.map(s => this.buildStepHtml(entry.playbookId, s)).join('');
    return `
      <div style="margin:8px 12px;background:#111c24;border:1px solid #1e2d3d;border-radius:6px;overflow:hidden;">
        <div style="padding:10px 12px;border-bottom:1px solid #1e2d3d;">
          <div style="font-size:13px;font-weight:600;color:#e1e8ed;">${escapeHtml(entry.playbookName)}</div>
          <div style="font-size:11px;color:#8899a6;margin-top:2px;">${escapeHtml(entry.eventTitle)} · ${escapeHtml(when)}</div>
          <div style="margin-top:6px;height:3px;background:#1e2d3d;border-radius:2px;">
            <div style="height:100%;width:${pct}%;background:#4a9eff;border-radius:2px;transition:width 0.2s;"></div>
          </div>
          <div style="font-size:10px;color:#8899a6;margin-top:3px;">${doneCount}/${entry.steps.length} steps done</div>
        </div>
        <div>${stepsHtml}</div>
      </div>`;
  }

  private buildStepHtml(playbookId: string, step: PlaybookStep): string {
    const done = this.doneSteps.has(this.stepKey(playbookId, step.order));
    const icon = CATEGORY_ICON[step.category];
    const color = CATEGORY_COLOR[step.category];
    const autoTag = step.automated
      ? `<span style="font-size:9px;color:#4a9eff;margin-left:6px;background:rgba(74,158,255,0.12);padding:1px 4px;border-radius:3px;">AUTO</span>`
      : '';
    const checkmark = done ? `<span style="color:#0a1828;font-size:10px;font-weight:700;">✓</span>` : '';
    return `
      <div data-step
           data-playbook-id="${escapeHtml(playbookId)}"
           data-step-order="${step.order}"
           style="display:flex;align-items:flex-start;gap:10px;padding:8px 12px;cursor:pointer;
                  border-top:1px solid #1e2d3d;${done ? 'opacity:0.45;' : ''}">
        <div style="flex-shrink:0;width:18px;height:18px;border-radius:50%;
                    border:2px solid ${done ? '#4a9eff' : '#2a3a4a'};
                    background:${done ? '#4a9eff' : 'transparent'};
                    margin-top:1px;display:flex;align-items:center;justify-content:center;">
          ${checkmark}
        </div>
        <div style="flex:1;min-width:0;">
          <span style="font-size:10px;color:${escapeHtml(color)};text-transform:uppercase;letter-spacing:0.5px;">
            ${icon} ${escapeHtml(step.category)}
          </span>${autoTag}
          <div style="font-size:12px;color:${done ? '#5a7a8a' : '#c8d8e0'};margin-top:2px;
                      line-height:1.4;${done ? 'text-decoration:line-through;' : ''}">
            ${escapeHtml(step.action)}
          </div>
        </div>
      </div>`;
  }
}

/**
 * Appends a playbook summary to a notification body string when a match exists.
 * Used by the notification pipeline to surface "What to do:" guidance inline.
 */
export function attachPlaybookSummary(body: string, event: ObservationEvent): string {
  const playbook = getPlaybook(event);
  if (!playbook) return body;
  return `${body}\n▶ ${formatPlaybookForNotification(playbook, event)}`;
}



export {type Playbook} from '@/types/intelligence';