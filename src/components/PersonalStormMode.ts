/**
 * Personal Storm Mode UI component.
 *
 * Per docs/MISSED_FEATURES_FOR_CLAUDE.md item 2 ("Personal Storm Mode UI")
 * and docs/WEATHER_WARNING_REMEDIATION_PLAN.md PR 5. Minimal macOS-native
 * presentation that renders a `WeatherDispatchDecision` from the
 * `weather-warning-router` into:
 *
 *   - A persistent critical strip (always visible while active)
 *   - An expandable Storm Mode card with hazard, arrival window,
 *     confidence, matched place, and the time-budget-aware action list
 *   - Acknowledge + snooze controls, persisted to localStorage so an
 *     acked threat stays dismissed across reloads until it materially
 *     changes (meaningful-change rules mirror `weather-urgency.ts`)
 *   - Auto-hide at alert expiry ("persistent in-app status until the
 *     threat expires or is acknowledged")
 *   - A "Why did I get this?" link that opens the diagnostic packet
 *
 * Vanilla TypeScript + DOM, textContent-only rendering (no HTML strings).
 * No fetch in this module — it renders whatever decision the caller hands
 * it. The caller (data-loader → 'cb:storm-decision' event) is responsible
 * for re-rendering when the decision changes. Show/hide + display-string
 * logic lives in `personal-storm-mode-view.ts` so it is unit-testable.
 *
 * Plan invariant: "Every weather notification should say why."
 */

import { h, replaceChildren } from '../utils/dom-utils';
import type { WeatherDispatchDecision } from '../services/weather/weather-warning-router';
import { guideForWeatherHazard } from '../services/survival-guide/guide-links';
import {
  STORM_MODE_UI_STORAGE_KEY,
  ackRecordFor,
  computeStormModeVisibility,
  emptyStormModeUiState,
  nextVisibilityTransitionAt,
  parseStormModeUiState,
  pruneStormModeUiState,
  serializeStormModeUiState,
  snoozeRecordFor,
  stormMetaPairs,
  stormStripTitle,
  stormTierLabel,
  withAck,
  withSnooze,
  type StormModeUiState,
} from './personal-storm-mode-view';

// ── Public API ──────────────────────────────────────────────────────────

export interface PersonalStormModeCallbacks {
  /** User pressed the Acknowledge button — caller should record + collapse. */
  onAcknowledge?: (alertId: string) => void;
  /** User pressed Snooze — caller should suppress for `minutes` and re-render. */
  onSnooze?: (alertId: string, minutes: number) => void;
  /** User clicked "Why did I get this?" — caller can open the
   *  diagnostic surface. The component already renders a basic
   *  inline summary; this gives callers a hook for richer display. */
  onShowDiagnostic?: (alertId: string) => void;
}

export interface PersonalStormModeOptions {
  /** Container element to mount into. The component takes ownership of
   *  the inside; callers should give it a dedicated div. */
  mount: HTMLElement;
  /** Callbacks for user actions. */
  callbacks?: PersonalStormModeCallbacks;
}

const SNOOZE_MINUTES = 15;

export class PersonalStormMode {
  private readonly mount: HTMLElement;
  private readonly callbacks: PersonalStormModeCallbacks;
  private current?: WeatherDispatchDecision;
  private uiState: StormModeUiState;
  private transitionTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: PersonalStormModeOptions) {
    this.mount = options.mount;
    this.callbacks = options.callbacks ?? {};
    this.mount.classList.add('cb-storm-mode-host');
    this.uiState = this.loadUiState();
    this.render();
  }

  /** Update the displayed decision. Pass `undefined` to clear. */
  update(decision: WeatherDispatchDecision | undefined, now: number = Date.now()): void {
    this.current = decision;
    this.uiState = pruneStormModeUiState(this.uiState, now);
    this.render(now);
  }

  /** Manually clear the strip and card. */
  clear(): void {
    this.current = undefined;
    this.render();
  }

  /** Programmatic acknowledge — useful for keyboard shortcuts. */
  acknowledge(alertId: string): void {
    if (this.current?.alertId === alertId) {
      this.recordAcknowledge(this.current);
      this.callbacks.onAcknowledge?.(alertId);
      this.render();
    }
  }

  // ── Persistence ──────────────────────────────────────────────────────

  private loadUiState(): StormModeUiState {
    try {
      return pruneStormModeUiState(
        parseStormModeUiState(localStorage.getItem(STORM_MODE_UI_STORAGE_KEY)),
        Date.now(),
      );
    } catch {
      return emptyStormModeUiState();
    }
  }

  private saveUiState(): void {
    try {
      localStorage.setItem(STORM_MODE_UI_STORAGE_KEY, serializeStormModeUiState(this.uiState));
    } catch { /* storage unavailable (private mode / quota) — session-only state */ }
  }

  private recordAcknowledge(decision: WeatherDispatchDecision, now: number = Date.now()): void {
    const ack = ackRecordFor(decision, now);
    if (!ack) return;
    this.uiState = withAck(this.uiState, ack);
    this.saveUiState();
  }

  private recordSnooze(decision: WeatherDispatchDecision, now: number = Date.now()): void {
    this.uiState = withSnooze(this.uiState, snoozeRecordFor(decision, SNOOZE_MINUTES, now));
    this.saveUiState();
  }

  // ── Render ────────────────────────────────────────────────────────────

  private render(now: number = Date.now()): void {
    this.scheduleVisibilityTransition(now);
    const decision = this.current;
    const visibility = computeStormModeVisibility(decision, this.uiState, now);
    if (!visibility.visible || !decision) {
      replaceChildren(this.mount);
      return;
    }

    const tier = decision.urgency!.threatLevel;
    const persistent = decision.urgency!.persistentInApp;

    const root = h('div', {
      className: `cb-storm-mode cb-storm-mode--${tier}${persistent ? ' cb-storm-mode--persistent' : ''}`,
      role: 'alert',
      'aria-live': 'assertive',
    });

    root.append(this.renderStrip(decision));
    if (persistent) {
      root.append(this.renderCard(decision));
    }

    replaceChildren(this.mount, root);
  }

  /** Re-render on the next timed boundary (alert expiry or snooze end)
   *  so the strip honors "until the threat expires" even when no data
   *  refresh lands in the meantime. */
  private scheduleVisibilityTransition(now: number): void {
    if (this.transitionTimer !== undefined) {
      clearTimeout(this.transitionTimer);
      this.transitionTimer = undefined;
    }
    const at = nextVisibilityTransitionAt(this.current, this.uiState, now);
    if (at === undefined || at <= now) return;
    // Cap so a multi-day expiry doesn't overflow the timer; the regular
    // data refresh will re-arm long horizons.
    const delay = Math.min(at - now, 6 * 60 * 60 * 1000) + 250;
    this.transitionTimer = setTimeout(() => { this.render(); }, delay);
  }

  private renderStrip(decision: WeatherDispatchDecision): HTMLElement {
    const strip = h('div', { className: 'cb-storm-mode__strip' },
      h('span', { className: 'cb-storm-mode__tier' }, stormTierLabel(decision)),
      h('span', { className: 'cb-storm-mode__title' }, stormStripTitle(decision)),
      this.renderQuickActions(decision),
    );
    return strip;
  }

  private renderQuickActions(decision: WeatherDispatchDecision): HTMLElement {
    const ack = h('button', {
      className: 'cb-storm-mode__btn cb-storm-mode__btn--ack',
      type: 'button',
      'aria-label': 'Acknowledge alert',
    }, 'Acknowledge');
    ack.addEventListener('click', () => {
      this.recordAcknowledge(decision);
      this.callbacks.onAcknowledge?.(decision.alertId);
      this.render();
    });

    const snooze = h('button', {
      className: 'cb-storm-mode__btn cb-storm-mode__btn--snooze',
      type: 'button',
      'aria-label': `Snooze for ${SNOOZE_MINUTES} minutes`,
    }, `Snooze ${SNOOZE_MINUTES}m`);
    snooze.addEventListener('click', () => {
      this.recordSnooze(decision);
      this.callbacks.onSnooze?.(decision.alertId, SNOOZE_MINUTES);
      this.render();
    });

    return h('div', { className: 'cb-storm-mode__quick' }, ack, snooze);
  }

  private renderCard(decision: WeatherDispatchDecision): HTMLElement {
    const payload = decision.payload;
    const meta = this.renderMeta(decision);
    const actionsList = this.renderActionsList(payload);
    const whyLink = this.renderWhyLink(decision);

    return h('div', { className: 'cb-storm-mode__card', role: 'group', 'aria-label': 'Storm Mode details' },
      h('p', { className: 'cb-storm-mode__reason' }, decision.reason),
      meta,
      payload && payload.actions.length > 0
        ? h('div', { className: 'cb-storm-mode__actions-wrap' },
            h('h3', { className: 'cb-storm-mode__actions-heading' }, 'Do this now'),
            actionsList,
          )
        : null,
      decision.urgency?.watchWindow && decision.urgency.watchWindow.confirming.length > 0
        ? this.renderWatchWindow(decision.urgency.watchWindow)
        : null,
      h('div', { className: 'cb-storm-mode__footer' }, whyLink, this.renderFullGuideLink(decision)),
    );
  }

  private renderWatchWindow(window: { durationMinutes: number; confirming: readonly string[] }): HTMLElement {
    return h('div', { className: 'cb-storm-mode__watch' },
      h('h3', { className: 'cb-storm-mode__watch-heading' },
        `Watch next (${window.durationMinutes} min)`,
      ),
      h('ul', { className: 'cb-storm-mode__watch-list' },
        ...window.confirming.map((c: string) => h('li', null, c)),
      ),
    );
  }

  private renderMeta(decision: WeatherDispatchDecision): HTMLElement {
    const meta = h('dl', { className: 'cb-storm-mode__meta' });
    for (const pair of stormMetaPairs(decision)) {
      meta.append(h('dt', null, pair.label), h('dd', null, pair.value));
    }
    return meta;
  }

  private renderActionsList(payload: WeatherDispatchDecision['payload']): HTMLElement {
    const list = h('ul', { className: 'cb-storm-mode__actions' });
    if (!payload) return list;
    for (const action of payload.actions) {
      list.append(this.renderActionItem(action));
    }
    return list;
  }

  private renderActionItem(action: NonNullable<WeatherDispatchDecision['payload']>['actions'][number]): HTMLElement {
    const li = h('li', { className: `cb-storm-mode__action cb-storm-mode__action--p${action.priority}` },
      h('span', { className: 'cb-storm-mode__action-label' }, action.label),
    );
    if (action.estimatedMinutes > 0) {
      li.append(h('span', { className: 'cb-storm-mode__action-time' }, `~${action.estimatedMinutes}m`));
    }
    if (action.rationale) {
      li.append(h('div', { className: 'cb-storm-mode__action-rationale' }, action.rationale));
    }
    return li;
  }

  private renderWhyLink(decision: WeatherDispatchDecision): HTMLElement {
    const btn = h('button', {
      className: 'cb-storm-mode__why',
      type: 'button',
      'aria-label': 'Why did I get this alert?',
    }, 'Why did I get this?');
    btn.addEventListener('click', () => {
      this.callbacks.onShowDiagnostic?.(decision.alertId);
    });
    return btn;
  }

  private renderFullGuideLink(decision: WeatherDispatchDecision): HTMLElement | null {
    const hazard = decision.payload?.primaryHazard;
    const guideId = hazard ? guideForWeatherHazard(hazard) : undefined;
    if (!guideId) return null;
    const btn = h('button', {
      className: 'cb-storm-mode__guide',
      type: 'button',
      'aria-label': 'Open the full survival guide for this hazard',
    }, 'Full guide →');
    btn.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('cb:open-survival-guide', { detail: { guideId } }));
    });
    return btn;
  }
}
