/**
 * EEWStatusBar — Layer 9 of the seismic intelligence stack.
 *
 * Persistent header showing the current EEW alert state at the top of
 * Crystal Ball:
 *   - Color-coded current tier (gray = ALL CLEAR, blue/yellow/orange/
 *     red/crimson for TIER_1..TIER_5)
 *   - Most recent significant event subtitle + time-ago
 *   - iMessage badge for TIER_5 (sent/failed/disabled)
 *   - Click to expand → last 5 alerts list
 *
 * Polls /api/eew-status every 5s. Web build still works (the route
 * returns the same shape, just typically empty if no renderer pushed).
 */

import {
  deriveStatusBarState,
  formatTimeAgo,
  type EewStatusPayload,
  type StatusBarState,
} from '../services/seismic/eew-status-bar-helpers';
import type { EewAlert } from '../services/seismic/eew-alert-engine';

const ENDPOINT = '/api/eew-status';
const POLL_INTERVAL_MS = 5000;

const COLOR_CLASSES: Record<StatusBarState['color'], string> = {
  gray: 'eew-bar-gray',
  blue: 'eew-bar-blue',
  yellow: 'eew-bar-yellow',
  orange: 'eew-bar-orange',
  red: 'eew-bar-red',
  crimson: 'eew-bar-crimson',
};

export class EEWStatusBar {
  private root: HTMLElement | null = null;
  private labelEl: HTMLElement | null = null;
  private subtitleEl: HTMLElement | null = null;
  private imessageBadgeEl: HTMLElement | null = null;
  private expandedEl: HTMLElement | null = null;
  private mounted = false;
  private expanded = false;
  private currentPayload: EewStatusPayload | null = null;
  private currentState: StatusBarState = deriveStatusBarState(null);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private subtitleTimer: ReturnType<typeof setInterval> | null = null;

  mount(parent: HTMLElement): void {
    if (this.mounted) return;
    this.mounted = true;

    this.root = document.createElement('div');
    this.root.className = `eew-status-bar ${COLOR_CLASSES.gray}`;
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');

    const main = document.createElement('div');
    main.className = 'eew-bar-main';
    this.labelEl = document.createElement('span');
    this.labelEl.className = 'eew-bar-label';
    this.labelEl.textContent = 'ALL CLEAR';
    this.subtitleEl = document.createElement('span');
    this.subtitleEl.className = 'eew-bar-subtitle';
    this.imessageBadgeEl = document.createElement('span');
    this.imessageBadgeEl.className = 'eew-bar-imessage-badge';
    this.imessageBadgeEl.style.display = 'none';

    main.append(this.labelEl, this.subtitleEl, this.imessageBadgeEl);
    main.addEventListener('click', () => this.toggleExpanded());

    this.expandedEl = document.createElement('div');
    this.expandedEl.className = 'eew-bar-expanded';
    this.expandedEl.style.display = 'none';

    this.root.append(main, this.expandedEl);
    parent.prepend(this.root);

    this.startPolling();
    // Tick the subtitle every second so countdowns / time-ago refresh.
    this.subtitleTimer = setInterval(() => this.refreshSubtitle(), 1000);
  }

  destroy(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.stopPolling();
    if (this.subtitleTimer !== null) {
      clearInterval(this.subtitleTimer);
      this.subtitleTimer = null;
    }
    this.root?.remove();
    this.root = null;
    this.labelEl = null;
    this.subtitleEl = null;
    this.imessageBadgeEl = null;
    this.expandedEl = null;
  }

  /**
   * Public for tests — apply a status payload directly.
   */
  applyPayload(payload: EewStatusPayload | null): void {
    this.currentPayload = payload;
    this.currentState = deriveStatusBarState(payload);
    this.render();
  }

  /** @internal */
  __getState(): StatusBarState {
    return this.currentState;
  }

  // ── Polling ──────────────────────────────────────────────────────────

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    void this.fetchAndApply();
    this.pollTimer = setInterval(() => { void this.fetchAndApply(); }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async fetchAndApply(): Promise<void> {
    try {
      const res = await fetch(ENDPOINT);
      if (!res.ok) return;
      const body = (await res.json()) as Partial<EewStatusPayload>;
      if (!body) return;
      const payload: EewStatusPayload = {
        activeAlerts: Array.isArray(body.activeAlerts) ? body.activeAlerts : [],
        highestTier: body.highestTier ?? null,
        lastEventId: body.lastEventId ?? null,
        asOf: typeof body.asOf === 'number' ? body.asOf : Date.now(),
      };
      this.applyPayload(payload);
    } catch { /* silent */ }
  }

  // ── Rendering ────────────────────────────────────────────────────────

  private render(): void {
    if (!this.root || !this.labelEl) return;
    this.root.className = `eew-status-bar ${COLOR_CLASSES[this.currentState.color]}`;
    this.labelEl.textContent = this.currentState.label;
    this.refreshSubtitle();
    this.renderImessageBadge();
    this.renderExpanded();
  }

  private refreshSubtitle(): void {
    if (!this.subtitleEl) return;
    const lead = this.currentState.lastAlert;
    if (!lead) {
      this.subtitleEl.textContent = '';
      return;
    }
    const ago = formatTimeAgo(lead.triggeredAt, Date.now());
    this.subtitleEl.textContent = `${lead.reason} (${ago})`;
  }

  private renderImessageBadge(): void {
    if (!this.imessageBadgeEl) return;
    const im = this.currentState.imessage;
    if (!im.visible) {
      this.imessageBadgeEl.style.display = 'none';
      return;
    }
    this.imessageBadgeEl.style.display = '';
    if (im.status === 'sent') {
      this.imessageBadgeEl.textContent = 'iMessage sent ✓';
      this.imessageBadgeEl.className = 'eew-bar-imessage-badge eew-bar-imessage-sent';
    } else if (im.status === 'failed') {
      this.imessageBadgeEl.textContent = `iMessage failed: ${im.error ?? 'unknown'}`;
      this.imessageBadgeEl.className = 'eew-bar-imessage-badge eew-bar-imessage-failed';
    } else if (im.status === 'disabled') {
      this.imessageBadgeEl.textContent = 'iMessage off';
      this.imessageBadgeEl.className = 'eew-bar-imessage-badge eew-bar-imessage-disabled';
    } else {
      this.imessageBadgeEl.textContent = 'iMessage pending';
      this.imessageBadgeEl.className = 'eew-bar-imessage-badge eew-bar-imessage-pending';
    }
  }

  private toggleExpanded(): void {
    this.expanded = !this.expanded;
    if (this.expandedEl) {
      this.expandedEl.style.display = this.expanded ? '' : 'none';
    }
    this.renderExpanded();
  }

  private renderExpanded(): void {
    if (!this.expandedEl) return;
    if (!this.expanded) return;
    while (this.expandedEl.firstChild) this.expandedEl.firstChild.remove();
    // Slice copies, then iterate from the end → newest first.
    const tail = (this.currentPayload?.activeAlerts ?? []).slice(-5);
    const recent: EewAlert[] = [];
    for (let i = tail.length - 1; i >= 0; i -= 1) recent.push(tail[i]!);
    if (recent.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'eew-bar-empty';
      empty.textContent = 'No active alerts';
      this.expandedEl.append(empty);
      return;
    }
    for (const alert of recent) {
      this.expandedEl.append(this.buildAlertRow(alert));
    }
  }

  private buildAlertRow(alert: EewAlert): HTMLElement {
    const row = document.createElement('div');
    row.className = `eew-bar-alert-row eew-bar-tier-${alert.tier}`;
    const tierEl = document.createElement('span');
    tierEl.className = 'eew-bar-alert-tier';
    tierEl.textContent = alert.tier.replace('TIER_', 'T').replace('_', ' ');
    const reasonEl = document.createElement('span');
    reasonEl.className = 'eew-bar-alert-reason';
    reasonEl.textContent = alert.reason;
    const agoEl = document.createElement('span');
    agoEl.className = 'eew-bar-alert-ago';
    agoEl.textContent = formatTimeAgo(alert.triggeredAt, Date.now());
    row.append(tierEl, reasonEl, agoEl);
    return row;
  }
}
