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
  type CompositeStatusInputs,
  type EewStatusPayload,
  type StatusBarState,
} from '../services/seismic/eew-status-bar-helpers';
import type { EewAlert } from '../services/seismic/eew-alert-engine';
import {
  deriveSpaceWxBanner,
  type SpaceWxBanner,
  type SpaceWxBannerSeverity,
} from '../services/spaceweather/globe-overlay';
import type { SpaceWxStatus } from '../services/spaceweather/swpc-monitor';
import { icon } from './ui/icons';

const ENDPOINT = '/api/eew-status';
const POLL_INTERVAL_MS = 30_000;
let detailsIdSequence = 0;

const COLOR_CLASSES: Record<StatusBarState['color'], string> = {
  gray: 'eew-bar-gray',
  blue: 'eew-bar-blue',
  yellow: 'eew-bar-yellow',
  orange: 'eew-bar-orange',
  red: 'eew-bar-red',
  crimson: 'eew-bar-crimson',
};

const SPACEWX_CLASSES: Record<SpaceWxBannerSeverity, string> = {
  none: '',
  g3: 'eew-bar-spacewx-g3',
  g4: 'eew-bar-spacewx-g4',
  g5: 'eew-bar-spacewx-g5',
  flare: 'eew-bar-spacewx-flare',
};

export class EEWStatusBar {
  private root: HTMLElement | null = null;
  private mainEl: HTMLButtonElement | null = null;
  private labelEl: HTMLElement | null = null;
  private subtitleEl: HTMLElement | null = null;
  private imessageBadgeEl: HTMLElement | null = null;
  private spaceWxEl: HTMLElement | null = null;
  private expandedEl: HTMLElement | null = null;
  private liveEl: HTMLElement | null = null;
  private mounted = false;
  private expanded = false;
  private currentPayload: EewStatusPayload | null = null;
  /** Supplies safety-case + readiness state for the composite chip.
   *  Wired by the layout layer; the bar itself never imports singletons. */
  private compositeProvider: (() => CompositeStatusInputs) | null = null;
  private currentState: StatusBarState = deriveStatusBarState(null);
  /** Listeners fed the derived composite state on every re-derive (SummaryStrip). */
  private readonly stateListeners = new Set<(state: StatusBarState) => void>();
  private currentSpaceWx: SpaceWxBanner = { severity: 'none', label: '', subtitle: '' };
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private subtitleTimer: ReturnType<typeof setInterval> | null = null;
  private lastAnnouncementKey = '';
  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.expanded) return;
    this.closeExpanded(true);
  };
  private readonly onDocumentPointerDown = (event: Event): void => {
    if (!this.expanded || !this.root) return;
    const target = event.target;
    if (target instanceof Node && this.root.contains(target)) return;
    this.closeExpanded(true);
  };

  mount(parent: HTMLElement): void {
    if (this.mounted) return;
    this.mounted = true;

    this.root = document.createElement('div');
    this.root.className = `eew-status-bar ${COLOR_CLASSES.gray}`;

    const main = document.createElement('button');
    main.className = 'eew-bar-main';
    main.type = 'button';
    const detailsId = `eew-status-details-${++detailsIdSequence}`;
    main.setAttribute('aria-expanded', 'false');
    main.setAttribute('aria-controls', detailsId);
    main.setAttribute('aria-label', 'Show alert details');
    this.mainEl = main;
    this.labelEl = document.createElement('span');
    this.labelEl.className = 'eew-bar-label';
    // Honest pre-render placeholder: weather has not been evaluated yet at mount,
    // so the boot label is the neutral CHECKING state (render() replaces it
    // synchronously below), never a false ALL CLEAR the chip has not verified.
    this.labelEl.textContent = 'CHECKING WEATHER';
    this.subtitleEl = document.createElement('span');
    this.subtitleEl.className = 'eew-bar-subtitle';
    this.imessageBadgeEl = document.createElement('span');
    this.imessageBadgeEl.className = 'eew-bar-imessage-badge';
    this.imessageBadgeEl.style.display = 'none';

    this.spaceWxEl = document.createElement('span');
    this.spaceWxEl.className = 'eew-bar-spacewx';
    this.spaceWxEl.style.display = 'none';

    const chevronEl = document.createElement('span');
    chevronEl.className = 'eew-bar-chevron';
    chevronEl.setAttribute('aria-hidden', 'true');
    chevronEl.innerHTML = icon('chevron-down');

    main.append(this.labelEl, this.subtitleEl, this.imessageBadgeEl, this.spaceWxEl, chevronEl);
    main.addEventListener('click', () => this.toggleExpanded());

    this.expandedEl = document.createElement('div');
    this.expandedEl.className = 'eew-bar-expanded';
    this.expandedEl.id = detailsId;
    this.expandedEl.hidden = true;
    this.expandedEl.setAttribute('role', 'region');
    this.expandedEl.setAttribute('aria-label', 'Alert details');

    this.liveEl = document.createElement('span');
    this.liveEl.className = 'eew-bar-live';
    this.liveEl.setAttribute('role', 'status');
    this.liveEl.setAttribute('aria-live', 'polite');
    this.liveEl.setAttribute('aria-atomic', 'true');

    this.root.append(main, this.expandedEl, this.liveEl);
    parent.prepend(this.root);
    document.addEventListener('keydown', this.onDocumentKeydown);
    document.addEventListener('pointerdown', this.onDocumentPointerDown);

    // Apply composite (safety/readiness) state immediately — don't wait
    // for the first EEW poll round-trip.
    this.refreshCompositeStatus();
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
    document.removeEventListener('keydown', this.onDocumentKeydown);
    document.removeEventListener('pointerdown', this.onDocumentPointerDown);
    this.root?.remove();
    this.root = null;
    this.mainEl = null;
    this.labelEl = null;
    this.subtitleEl = null;
    this.imessageBadgeEl = null;
    this.spaceWxEl = null;
    this.expandedEl = null;
    this.liveEl = null;
    this.expanded = false;
    this.lastAnnouncementKey = '';
  }

  /**
   * Update the space-weather banner overlay. The bar is shared with seismic
   * EEW, so a non-`none` severity adds a coloured pill to the right of the
   * subtitle without overriding the seismic state.
   */
  setSpaceWeatherStatus(status: SpaceWxStatus | null): void {
    this.currentSpaceWx = deriveSpaceWxBanner(status);
    this.renderSpaceWxBanner();
  }

  /** @internal */
  __getSpaceWxBanner(): SpaceWxBanner {
    return this.currentSpaceWx;
  }

  /**
   * Register the callback that supplies safety-case + readiness inputs
   * for the composite worst-of chip, then re-derive immediately.
   */
  setCompositeStatusProvider(provider: (() => CompositeStatusInputs) | null): void {
    this.compositeProvider = provider;
    this.refreshCompositeStatus();
  }

  /** Re-derive the chip from the current payload + fresh composite inputs.
   *  Called by subscriptions (e.g. safety-case re-evaluations) so the chip
   *  reacts without waiting for the next EEW poll. */
  refreshCompositeStatus(): void {
    if (!this.mounted) return;
    this.currentState = deriveStatusBarState(this.currentPayload, this.readCompositeInputs());
    this.render();
  }

  /**
   * Public for tests — apply a status payload directly.
   */
  applyPayload(payload: EewStatusPayload | null): void {
    this.currentPayload = payload;
    this.currentState = deriveStatusBarState(payload, this.readCompositeInputs());
    this.render();
  }

  private readCompositeInputs(): CompositeStatusInputs | undefined {
    if (!this.compositeProvider) return undefined;
    try {
      return this.compositeProvider();
    } catch {
      // Provider reads live singletons — never let a diagnostics hiccup
      // take down the status bar.
      return undefined;
    }
  }

  /** @internal */
  __getState(): StatusBarState {
    return this.currentState;
  }

  /**
   * Subscribe to the derived composite status (EEW ∪ Safety Case ∪
   * readiness). Fires immediately with the current state and again after
   * every re-derive — lets the SummaryStrip reuse this bar's worst-of
   * output instead of re-deriving its own.
   */
  subscribeState(cb: (state: StatusBarState) => void): () => void {
    this.stateListeners.add(cb);
    try {
      cb(this.currentState);
    } catch { /* listener errors must not break the bar */ }
    return () => this.stateListeners.delete(cb);
  }

  private notifyStateListeners(): void {
    for (const cb of this.stateListeners) {
      try {
        cb(this.currentState);
      } catch { /* listener errors must not break the bar */ }
    }
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
    let payload: EewStatusPayload | null = null;
    try {
      const res = await fetch(ENDPOINT);
      if (res.ok) {
        const body = (await res.json()) as Partial<EewStatusPayload> | null;
        if (body) {
          payload = {
            activeAlerts: Array.isArray(body.activeAlerts) ? body.activeAlerts : [],
            highestTier: body.highestTier ?? null,
            lastEventId: body.lastEventId ?? null,
            asOf: typeof body.asOf === 'number' ? body.asOf : Date.now(),
          };
        }
      }
    } catch { /* endpoint unreachable — fall through */ }
    if (payload) {
      this.applyPayload(payload);
    } else {
      // No usable EEW payload this tick. Keep the previous alerts on
      // screen but still re-derive so safety/readiness state is never
      // masked by a dead EEW feed.
      this.refreshCompositeStatus();
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────

  private render(): void {
    this.notifyStateListeners();
    if (!this.root || !this.labelEl) return;
    this.root.className = `eew-status-bar ${COLOR_CLASSES[this.currentState.color]}`;
    this.labelEl.textContent = this.displayLabel(this.currentState.label);
    this.refreshSubtitle();
    this.renderImessageBadge();
    this.renderSpaceWxBanner();
    this.renderExpanded();
    this.updateMainA11yLabel();
    this.announceStatusTransition();
  }

  private renderSpaceWxBanner(): void {
    if (!this.spaceWxEl) return;
    const banner = this.currentSpaceWx;
    if (banner.severity === 'none') {
      this.spaceWxEl.style.display = 'none';
      this.spaceWxEl.textContent = '';
      this.spaceWxEl.className = 'eew-bar-spacewx';
      return;
    }
    this.spaceWxEl.style.display = '';
    this.spaceWxEl.className = `eew-bar-spacewx ${SPACEWX_CLASSES[banner.severity]}`;
    this.spaceWxEl.textContent = banner.subtitle.length > 0
      ? `${banner.label} · ${banner.subtitle}`
      : banner.label;
    this.spaceWxEl.setAttribute('title', `${banner.label}\n${banner.subtitle}`);
  }

  private refreshSubtitle(): void {
    if (!this.subtitleEl) return;
    const lead = this.currentState.lastAlert;
    if (!lead) {
      const fallback = this.compositeSubtitle();
      if (this.subtitleEl.textContent !== fallback) {
        this.subtitleEl.textContent = fallback;
      }
      return;
    }
    const ago = formatTimeAgo(lead.triggeredAt, Date.now());
    this.subtitleEl.textContent = `${lead.reason} (${ago})`;
  }

  /** Subtitle when a non-EEW source drives the chip. */
  private compositeSubtitle(): string {
    if (this.currentState.source === 'safety') {
      return 'Safety Case: a safety property is failing — see Safety Case panel';
    }
    if (this.currentState.source === 'readiness') {
      return 'System readiness critical — see Command Center';
    }
    return '';
  }

  private displayLabel(label: string): string {
    if (!document.body.classList.contains('is-desktop-macos')) return label;
    const lower = label.toLocaleLowerCase();
    return `${lower.charAt(0).toLocaleUpperCase()}${lower.slice(1)}`;
  }

  private announceStatusTransition(): void {
    if (!this.liveEl) return;
    const alertId = this.currentState.lastAlert?.eventId ?? '';
    const key = `${this.currentState.source}:${this.currentState.label}:${alertId}`;
    if (key === this.lastAnnouncementKey) return;
    this.lastAnnouncementKey = key;
    const subtitle = this.subtitleEl?.textContent?.trim() ?? '';
    this.liveEl.textContent = subtitle
      ? `${this.displayLabel(this.currentState.label)}. ${subtitle}`
      : this.displayLabel(this.currentState.label);
  }

  private updateMainA11yLabel(): void {
    if (!this.mainEl) return;
    const action = this.expanded ? 'Hide alert details' : 'Show alert details';
    this.mainEl.setAttribute('aria-label', `${this.displayLabel(this.currentState.label)}. ${action}`);
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
    if (this.expanded) {
      this.closeExpanded(false);
      return;
    }
    this.expanded = true;
    if (this.mainEl) {
      this.mainEl.setAttribute('aria-expanded', 'true');
    }
    this.updateMainA11yLabel();
    if (this.expandedEl) this.expandedEl.hidden = false;
    this.renderExpanded();
  }

  private closeExpanded(returnFocus: boolean): void {
    if (!this.expanded) return;
    this.expanded = false;
    if (this.mainEl) {
      this.mainEl.setAttribute('aria-expanded', 'false');
    }
    this.updateMainA11yLabel();
    if (this.expandedEl) this.expandedEl.hidden = true;
    if (returnFocus) this.mainEl?.focus();
  }

  private renderExpanded(): void {
    if (!this.expandedEl) return;
    while (this.expandedEl.firstChild) this.expandedEl.firstChild.remove();
    this.appendSourceContext();
    // Slice copies, then iterate from the end → newest first.
    const tail = (this.currentPayload?.activeAlerts ?? []).slice(-5);
    const recent: EewAlert[] = [];
    for (let i = tail.length - 1; i >= 0; i -= 1) recent.push(tail[i]!);
    if (recent.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'eew-bar-empty';
      empty.textContent = 'No recent earthquake alerts';
      this.expandedEl.append(empty);
      return;
    }
    for (const alert of recent) {
      this.expandedEl.append(this.buildAlertRow(alert));
    }
  }

  private appendSourceContext(): void {
    if (!this.expandedEl) return;
    const messages: Partial<Record<StatusBarState['source'], string>> = {
      weather: 'Severe weather affects a saved place',
      safety: 'A safety property requires review',
      readiness: 'System readiness requires attention',
    };
    const message = messages[this.currentState.source];
    if (!message) return;
    const context = document.createElement('div');
    context.className = 'eew-bar-context';
    context.textContent = message;
    this.expandedEl.append(context);
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
