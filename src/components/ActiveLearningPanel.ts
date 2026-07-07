/**
 * Active Learning Panel (panel id: `active-learning`).
 *
 * Surfaces the highest-uncertainty observations for explicit human
 * review. Each card shows the auto-generated question, context,
 * uncertainty sources as pill badges, and Confirm / Correct / Skip
 * actions. "Correct" reveals a corrected-severity dropdown + note
 * textarea so the reviewer can capture the right answer in one pass.
 */

import { Panel } from './Panel';
import {
  getActiveLearningQueue,
  type LearningItem,
  type LearningSeverity,
  type ReviewerOutcome,
  type UncertaintySource,
} from '@/services/intelligence/active-learning-queue';
import { escapeHtml } from '@/utils/sanitize';
import { statLine } from './ui/statLine';

const REFRESH_MS = 30_000;
const REVIEW_HISTORY_LIMIT = 20;

const SOURCE_LABEL: Record<UncertaintySource, string> = {
  'low-meta-confidence': 'low meta-confidence',
  'competing-hypotheses': 'competing hypotheses',
  'fragile-conclusion': 'fragile conclusion',
  'high-assumption-risk': 'assumption risk',
  'novel-pattern': 'novel pattern',
  'contradicting-evidence': 'contradicting evidence',
};

const OUTCOME_COLOR: Record<ReviewerOutcome, string> = {
  confirmed: '#2ec27e',
  corrected: '#e94f37',
  'insufficient-data': '#9ca3af',
};

type Tab = 'pending' | 'reviewed';

export class ActiveLearningPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private tab: Tab = 'pending';
  private correctingId: string | null = null;

  constructor() {
    super({
      id: 'active-learning',
      title: 'Active Learning',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Reviewing the highest-uncertainty observations is the highest-leverage way to improve the model. Confirmed/corrected reviews feed back into the outcome ledger.',
    });
    this.render();
    this.refreshTimer = setInterval(() => this.render(), REFRESH_MS);
    this.unsubscribe = getActiveLearningQueue().subscribe(() => this.render());
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
    const svc = getActiveLearningQueue();
    const pending = svc.getPending();
    this.setCount(pending.length);
    this.setContent(this.buildHtml(pending, svc.getAll()), () => this.wireHandlers());
  }

  private buildHtml(pending: LearningItem[], all: LearningItem[]): string {
    const svc = getActiveLearningQueue();
    const stats = svc.stats();
    const reviewedList = all.filter((i) => i.status === 'reviewed')
      .sort((a, b) => (b.reviewedAt?.getTime() ?? 0) - (a.reviewedAt?.getTime() ?? 0))
      .slice(0, REVIEW_HISTORY_LIMIT);
    const showing = this.tab === 'pending' ? pending : reviewedList;

    return `<div class="al-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderHeader(pending.length, stats)}
      ${this.renderTabs(pending.length, reviewedList.length)}
      ${showing.length === 0
        ? renderEmptyState(this.tab)
        : `<div style="display:flex;flex-direction:column;gap:6px;">${showing.map((i) => this.renderRow(i)).join('')}</div>`}
    </div>`;
  }

  private renderHeader(
    pendingCount: number,
    stats: ReturnType<ReturnType<typeof getActiveLearningQueue>['stats']>,
  ): string {
    const topSourceEntry = Object.entries(stats.bySource).sort((a, b) => b[1] - a[1])[0];
    const topSource = topSourceEntry ? `${topSourceEntry[0]} (${topSourceEntry[1]})` : '—';
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div style="font-size:11px;color:var(--text-secondary,#bbb);">
        ${statLine([
          { value: pendingCount, label: 'pending', valueColor: 'var(--accent,#4a9eff)' },
          { value: stats.reviewed, label: 'reviewed' },
          { value: stats.avgUncertaintyScore.toFixed(2), label: 'avg score', labelFirst: true },
          { value: topSource, label: 'top:', labelFirst: true },
        ])}
      </div>
      <button class="al-purge" type="button" style="padding:3px 8px;background:transparent;color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:3px;cursor:pointer;font-size:11px;">Purge expired</button>
    </div>`;
  }

  private renderTabs(pendingCount: number, reviewedCount: number): string {
    return `<div style="display:flex;gap:4px;">
      ${tabBtnHtml('pending', this.tab, 'Pending', pendingCount)}
      ${tabBtnHtml('reviewed', this.tab, 'Reviewed', reviewedCount)}
    </div>`;
  }

  private renderRow(item: LearningItem): string {
    const scorePct = Math.round(item.uncertaintyScore * 100);
    const ts = ageLabel(item.queuedAt, Date.now());
    const sources = item.uncertaintySources.map((s) =>
      `<span style="background:rgba(155,89,182,0.18);color:#9b59b6;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(SOURCE_LABEL[s])}</span>`,
    ).join(' ');
    const sevColor = severityColor(item.currentSeverity);
    const reviewedBadge = item.status === 'reviewed' && item.reviewerOutcome
      ? `<span style="background:${OUTCOME_COLOR[item.reviewerOutcome]};color:#fff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">${item.reviewerOutcome}</span>`
      : '';
    const actions = item.status === 'pending' ? this.renderActions(item) : '';

    return `<div data-id="${escapeHtml(item.id)}" style="border-left:3px solid ${sevColor};background:rgba(255,255,255,0.02);border-radius:0 3px 3px 0;padding:6px 8px;">
      <div style="display:flex;justify-content:space-between;gap:6px;align-items:start;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <span style="background:rgba(74,158,255,0.18);color:#4a9eff;font-size:9px;padding:1px 5px;border-radius:2px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(item.domain)}</span>
            <span style="color:${sevColor};font-size:9px;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;">${item.currentSeverity}</span>
            ${reviewedBadge}
            <span style="font-size:10px;opacity:0.55;">${ts}</span>
          </div>
          <div style="font-weight:600;color:#ddd;margin-top:3px;">${escapeHtml(item.question)}</div>
          <div style="font-size:11px;opacity:0.75;margin-top:2px;">${escapeHtml(item.context)}</div>
          <div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap;">${sources}</div>
          ${this.renderScoreBar(scorePct)}
          ${item.status === 'reviewed' && item.reviewerNote
            ? `<div style="font-size:11px;opacity:0.75;margin-top:4px;border-left:2px solid rgba(255,255,255,0.15);padding-left:6px;">${escapeHtml(item.reviewerNote)}</div>`
            : ''}
        </div>
      </div>
      ${actions}
    </div>`;
  }

  private renderScoreBar(pct: number): string {
    const color = scoreColor(pct);
    return `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
      <span style="font-size:10px;opacity:0.55;">uncertainty</span>
      <div style="flex:1;height:5px;border-radius:3px;background:rgba(255,255,255,0.06);overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};"></div>
      </div>
      <span style="font-size:10px;opacity:0.75;font-family:ui-monospace,monospace;">${pct}</span>
    </div>`;
  }

  private renderActions(item: LearningItem): string {
    if (this.correctingId === item.id) {
      const sevOpts = (['low', 'medium', 'high', 'critical'] as LearningSeverity[])
        .map((s) => `<option value="${s}"${s === item.currentSeverity ? ' selected' : ''}>${s}</option>`)
        .join('');
      return `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;gap:4px;">
        <div style="display:flex;gap:6px;align-items:center;font-size:11px;color:#bbb;">
          <span>Corrected severity:</span>
          <select class="al-corrected" data-id="${escapeHtml(item.id)}" style="background:#222;color:#ddd;border:1px solid rgba(255,255,255,0.15);border-radius:3px;padding:2px 4px;font-size:11px;">${sevOpts}</select>
        </div>
        <textarea class="al-note" data-id="${escapeHtml(item.id)}" placeholder="Why is this wrong?" style="background:#222;color:#ddd;border:1px solid rgba(255,255,255,0.15);border-radius:3px;padding:4px;font-size:11px;font-family:inherit;resize:vertical;min-height:48px;"></textarea>
        <div style="display:flex;gap:4px;justify-content:flex-end;">
          <button class="al-correct-cancel" data-id="${escapeHtml(item.id)}" type="button" style="padding:3px 8px;background:transparent;color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:2px;cursor:pointer;font-size:10px;">Cancel</button>
          <button class="al-correct-submit" data-id="${escapeHtml(item.id)}" type="button" style="padding:3px 8px;background:rgba(233,79,55,0.18);color:#e94f37;border:1px solid rgba(233,79,55,0.4);border-radius:2px;cursor:pointer;font-size:10px;">Submit correction</button>
        </div>
      </div>`;
    }
    return `<div style="display:flex;gap:4px;margin-top:6px;justify-content:flex-end;">
      <button class="al-confirm" data-id="${escapeHtml(item.id)}" type="button" style="padding:3px 8px;background:rgba(46,194,126,0.18);color:#2ec27e;border:1px solid rgba(46,194,126,0.4);border-radius:2px;cursor:pointer;font-size:10px;">Confirm</button>
      <button class="al-correct" data-id="${escapeHtml(item.id)}" type="button" style="padding:3px 8px;background:rgba(233,79,55,0.18);color:#e94f37;border:1px solid rgba(233,79,55,0.4);border-radius:2px;cursor:pointer;font-size:10px;">Correct</button>
      <button class="al-skip" data-id="${escapeHtml(item.id)}" type="button" style="padding:3px 8px;background:transparent;color:inherit;border:1px solid rgba(255,255,255,0.15);border-radius:2px;cursor:pointer;font-size:10px;">Skip</button>
    </div>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    const svc = getActiveLearningQueue();

    root.querySelector<HTMLButtonElement>('.al-purge')?.addEventListener('click', () => {
      svc.purgeExpired();
    });

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.al-tab')) {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tab;
        if (t === 'pending' || t === 'reviewed') {
          this.tab = t;
          this.render();
        }
      });
    }

    for (const btn of root.querySelectorAll<HTMLButtonElement>('.al-confirm')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (id) svc.review(id, 'confirmed');
      });
    }
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.al-skip')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (id) svc.skip(id);
      });
    }
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.al-correct')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (!id) return;
        this.correctingId = id;
        this.render();
      });
    }
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.al-correct-cancel')) {
      btn.addEventListener('click', () => {
        this.correctingId = null;
        this.render();
      });
    }
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.al-correct-submit')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (!id) return;
        const note = root.querySelector<HTMLTextAreaElement>(`.al-note[data-id="${id}"]`)?.value ?? '';
        svc.review(id, 'corrected', note);
        this.correctingId = null;
      });
    }
  }
}

function tabBtnHtml(key: Tab, activeKey: Tab, label: string, count: number): string {
  const isActive = activeKey === key;
  const bg = isActive ? 'rgba(74,158,255,0.18)' : 'transparent';
  const borderAlpha = isActive ? '0.4' : '0.15';
  return `<button class="al-tab" data-tab="${key}" type="button"
    style="padding:3px 10px;background:${bg};color:inherit;border:1px solid rgba(74,158,255,${borderAlpha});border-radius:3px;cursor:pointer;font-size:11px;">${escapeHtml(label)} (${count})</button>`;
}

function renderEmptyState(tab: Tab): string {
  const msg = tab === 'pending'
    ? 'No pending review items — system is confident in its current output.'
    : 'No reviewed items yet.';
  return `<div style="padding:14px;text-align:center;opacity:0.55;font-size:12px;">${msg}</div>`;
}

function scoreColor(pct: number): string {
  if (pct >= 70) return '#e94f37';
  if (pct >= 40) return '#f5a524';
  return '#2ec27e';
}

function severityColor(severity: LearningSeverity): string {
  if (severity === 'critical') return '#a626a4';
  if (severity === 'high') return '#e94f37';
  if (severity === 'medium') return '#f5a524';
  return '#9ca3af';
}

function ageLabel(then: Date, now: number): string {
  const ms = now - then.getTime();
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s ago`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))}h ago`;
  return `${Math.round(ms / (24 * 60 * 60_000))}d ago`;
}
