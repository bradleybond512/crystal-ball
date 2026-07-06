/**
 * ActiveLearningQueuePanel — operator-facing view of the new
 * 5-state ActiveLearningQueueService. Tabs split by status,
 * priority badges drive ordering, and each row exposes Claim /
 * Skip / Resolve controls with a label input.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { formatDurationMinutes } from '@/utils/format-duration';
import {
  getActiveLearningQueueService,
  type ActiveLearningItem,
  type ActiveLearningQueueService,
  type LearningItemPriority,
  type LearningItemStatus,
} from '@/services/intelligence/active-learning-queue';

const REFRESH_MS = 30_000;
type Tab = 'pending' | 'claimed' | 'resolved';

const PRIORITY_COLOR: Record<LearningItemPriority, string> = {
  critical: 'var(--severity-critical, #ef4444)',
  high:     'var(--severity-high, #fb923c)',
  medium:   'var(--severity-medium, #facc15)',
  low:      'var(--severity-info, #60a5fa)',
};

const STATUS_COLOR: Record<LearningItemStatus, string> = {
  pending:  'var(--text-secondary, #aaa)',
  claimed:  'var(--severity-info, #60a5fa)',
  resolved: 'var(--severity-ok, #4ade80)',
  skipped:  'var(--text-secondary, #888)',
  expired:  'var(--severity-critical, #ef4444)',
};

export class ActiveLearningQueuePanel extends Panel {
  private readonly service: ActiveLearningQueueService;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private activeTab: Tab = 'pending';
  private labelInputs = new Map<string, string>();

  constructor() {
    super({
      id: 'active-learning-queue',
      title: 'Active Learning Queue',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Operator review queue. Claim, label, and resolve items to feed ground-truth back into the calibration loop.',
    });
    this.service = getActiveLearningQueueService();
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
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
      const stats = this.service.getStats();
      this.setCount(stats.pending + stats.claimed);
      this.setContent(this.buildHtml(stats), () => this.wireHandlers());
    } catch (error) {
      this.setContent(
        `<div style="padding:12px;color:var(--severity-critical);">Active-learning panel error: ${escapeHtml(String(error))}</div>`,
      );
    }
  }

  private buildHtml(stats: ReturnType<ActiveLearningQueueService['getStats']>): string {
    const items = this.service.getQueue({ status: this.activeTab });
    return `${renderStatsBar(stats)}${renderTabs(this.activeTab, stats)}${this.renderItemList(items)}`;
  }

  private renderItemList(items: readonly ActiveLearningItem[]): string {
    if (items.length === 0) {
      return `<div style="padding:24px 16px;color:var(--text-secondary,#aaa);font-size:12px;text-align:center;">
        No ${escapeHtml(this.activeTab)} items.
      </div>`;
    }
    const rows = items.map((item) => this.renderItem(item)).join('');
    return `<div style="max-height:440px;overflow:auto;">${rows}</div>`;
  }

  private renderItem(item: ActiveLearningItem): string {
    const priorityColor = PRIORITY_COLOR[item.priority];
    const statusColor = STATUS_COLOR[item.status];
    const labelInput = this.labelInputs.get(item.id) ?? item.operatorLabel ?? '';
    const ageMinutes = Math.round((Date.now() - item.queuedAt) / 60_000);
    const controls = this.renderControls(item, labelInput);
    const resolvedBadge = item.operatorLabel
      ? `<span style="font-size:10px;color:var(--severity-ok,#4ade80);font-weight:600;">label: ${escapeHtml(item.operatorLabel)}</span>`
      : '';
    return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <span style="font-size:9px;font-weight:700;padding:2px 5px;background:${priorityColor};color:#fff;border-radius:3px;text-transform:uppercase;">${escapeHtml(item.priority)}</span>
        <span style="font-size:9px;font-weight:700;padding:2px 5px;background:${statusColor};color:#fff;border-radius:3px;text-transform:uppercase;">${escapeHtml(item.status)}</span>
        <span style="font-size:9px;font-weight:600;padding:2px 5px;background:rgba(255,255,255,0.06);border-radius:3px;text-transform:uppercase;">${escapeHtml(item.domain)}</span>
        <span style="font-size:11px;color:var(--text-secondary,#bbb);">${escapeHtml(item.reason)}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--text-secondary,#aaa);">${formatDurationMinutes(ageMinutes)} ago</span>
      </div>
      <div style="margin-top:4px;font-size:10px;color:var(--text-secondary,#888);">obs <code>${escapeHtml(item.observationId)}</code></div>
      ${item.notes ? `<div style="margin-top:4px;font-size:11px;color:var(--text-secondary,#ccc);font-style:italic;">${escapeHtml(item.notes)}</div>` : ''}
      ${resolvedBadge}
      ${controls}
    </div>`;
  }

  private renderControls(item: ActiveLearningItem, labelInput: string): string {
    if (item.status === 'resolved' || item.status === 'skipped' || item.status === 'expired') return '';
    const claimBtn = item.status === 'pending'
      ? `<button data-action="claim" data-item-id="${escapeHtml(item.id)}" style="font-size:10px;padding:3px 8px;background:transparent;color:var(--text-secondary,#ccc);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Claim</button>`
      : '';
    return `<div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      ${claimBtn}
      <input class="alq-label" data-item-id="${escapeHtml(item.id)}" value="${escapeHtml(labelInput)}" placeholder="label (e.g. true-positive)" style="flex:1;min-width:180px;font-size:10px;padding:3px 6px;background:transparent;color:var(--text-primary,#ddd);border:1px solid var(--border-subtle,#333);border-radius:3px;"/>
      <button data-action="resolve" data-item-id="${escapeHtml(item.id)}" style="font-size:10px;padding:3px 8px;background:transparent;color:var(--severity-ok,#4ade80);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Resolve</button>
      <button data-action="skip" data-item-id="${escapeHtml(item.id)}" style="font-size:10px;padding:3px 8px;background:transparent;color:var(--text-secondary,#aaa);border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">Skip</button>
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    for (const tab of root.querySelectorAll<HTMLButtonElement>('.alq-tab')) {
      tab.addEventListener('click', () => {
        const next = tab.dataset.tab as Tab | undefined;
        if (next && next !== this.activeTab) {
          this.activeTab = next;
          this.render();
        }
      });
    }
    for (const input of root.querySelectorAll<HTMLInputElement>('.alq-label')) {
      input.addEventListener('input', () => {
        const id = input.dataset.itemId;
        if (id) this.labelInputs.set(id, input.value);
      });
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        const id = button.dataset.itemId;
        if (!id || !action) return;
        if (action === 'claim') this.service.claim(id);
        else if (action === 'skip') this.service.skip(id);
        else if (action === 'resolve') {
          const label = (this.labelInputs.get(id) ?? '').trim() || 'unlabeled';
          this.service.resolve(id, label);
          this.labelInputs.delete(id);
        }
        this.render();
      });
    }
  }
}

function renderStatsCell(label: string, value: number | string, color = 'var(--text-primary,#ddd)'): string {
  return `<div style="flex:1;text-align:center;">
    <div style="font-size:16px;font-weight:700;color:${color};">${escapeHtml(String(value))}</div>
    <div style="font-size:9px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(label)}</div>
  </div>`;
}

function renderStatsBar(stats: ReturnType<ActiveLearningQueueService['getStats']>): string {
  return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;gap:4px;">
    ${renderStatsCell('Pending', stats.pending, STATUS_COLOR.pending)}
    ${renderStatsCell('Claimed', stats.claimed, STATUS_COLOR.claimed)}
    ${renderStatsCell('Resolved', stats.resolved, STATUS_COLOR.resolved)}
    ${renderStatsCell('Skipped', stats.skipped, STATUS_COLOR.skipped)}
    ${renderStatsCell('Expired', stats.expired, STATUS_COLOR.expired)}
    ${renderStatsCell('Avg min', stats.avgResolutionMinutes.toFixed(1))}
  </div>`;
}

function renderTabButton(id: Tab, label: string, count: number, isActive: boolean): string {
  const bg = isActive ? 'rgba(96,165,250,0.18)' : 'transparent';
  const color = isActive ? 'var(--text-primary,#fff)' : 'var(--text-secondary,#aaa)';
  return `<button class="alq-tab" data-tab="${id}" style="font-size:11px;padding:4px 10px;background:${bg};color:${color};border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;">${escapeHtml(label)} (${count})</button>`;
}

function renderTabs(active: Tab, stats: ReturnType<ActiveLearningQueueService['getStats']>): string {
  return `<div style="padding:8px 12px;border-bottom:1px solid var(--border-subtle,#333);display:flex;gap:6px;">
    ${renderTabButton('pending', 'Pending', stats.pending, active === 'pending')}
    ${renderTabButton('claimed', 'Claimed', stats.claimed, active === 'claimed')}
    ${renderTabButton('resolved', 'Resolved', stats.resolved, active === 'resolved')}
  </div>`;
}
