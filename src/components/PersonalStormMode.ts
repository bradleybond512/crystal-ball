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
 *   - Acknowledge + snooze controls
 *   - A "Why did I get this?" link that opens the diagnostic packet
 *
 * Vanilla TypeScript + DOM. No framework. No fetch in this module — it
 * renders whatever decision the caller hands it. The caller (router /
 * dispatcher / sidecar push) is responsible for re-rendering when the
 * decision changes.
 *
 * Plan invariant: "Every weather notification should say why."
 */

import { h, replaceChildren } from '../utils/dom-utils';
import type { WeatherDispatchDecision } from '../services/weather/weather-warning-router';

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

export class PersonalStormMode {
  private readonly mount: HTMLElement;
  private readonly callbacks: PersonalStormModeCallbacks;
  private current?: WeatherDispatchDecision;
  private acknowledged = new Set<string>();
  private snoozedUntil = new Map<string, number>();

  constructor(options: PersonalStormModeOptions) {
    this.mount = options.mount;
    this.callbacks = options.callbacks ?? {};
    this.mount.classList.add('cb-storm-mode-host');
    this.render();
  }

  /** Update the displayed decision. Pass `undefined` to clear. */
  update(decision: WeatherDispatchDecision | undefined, now: number = Date.now()): void {
    this.current = decision;
    this.pruneSnoozes(now);
    this.render(now);
  }

  /** Manually clear the strip and card. */
  clear(): void {
    this.current = undefined;
    this.render();
  }

  /** Programmatic acknowledge — useful for keyboard shortcuts. */
  acknowledge(alertId: string): void {
    this.acknowledged.add(alertId);
    if (this.current?.alertId === alertId) {
      this.callbacks.onAcknowledge?.(alertId);
      this.render();
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  private render(now: number = Date.now()): void {
    const decision = this.current;
    if (!decision || decision.shouldSuppress || !decision.urgency) {
      replaceChildren(this.mount);
      return;
    }
    if (this.acknowledged.has(decision.alertId)) {
      replaceChildren(this.mount);
      return;
    }
    if ((this.snoozedUntil.get(decision.alertId) ?? 0) > now) {
      replaceChildren(this.mount);
      return;
    }

    const tier = decision.urgency.threatLevel;
    const persistent = decision.urgency.persistentInApp;

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

  private renderStrip(decision: WeatherDispatchDecision): HTMLElement {
    const tier = decision.urgency!.threatLevel.toUpperCase();
    const placeLabel = decision.matchedPlaceLabel ?? 'your area';
    const hazard = decision.payload?.mainThreatLabel ?? decision.urgency!.hazardKind;

    const strip = h('div', { className: 'cb-storm-mode__strip' },
      h('span', { className: 'cb-storm-mode__tier' }, tier),
      h('span', { className: 'cb-storm-mode__title' }, `${capitalizeFirst(hazard)} near ${placeLabel}`),
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
      this.acknowledged.add(decision.alertId);
      this.callbacks.onAcknowledge?.(decision.alertId);
      this.render();
    });

    const snooze = h('button', {
      className: 'cb-storm-mode__btn cb-storm-mode__btn--snooze',
      type: 'button',
      'aria-label': 'Snooze for 15 minutes',
    }, 'Snooze 15m');
    snooze.addEventListener('click', () => {
      this.snoozedUntil.set(decision.alertId, Date.now() + 15 * 60 * 1000);
      this.callbacks.onSnooze?.(decision.alertId, 15);
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
      h('div', { className: 'cb-storm-mode__footer' }, whyLink),
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
    const payload = decision.payload;
    const meta = h('dl', { className: 'cb-storm-mode__meta' });
    const matched = decision.matchedPlaceLabel;
    if (matched) meta.append(metaPair('Place', matched));
    if (payload?.arrivalWindow?.label) meta.append(metaPair('Arrival', payload.arrivalWindow.label));
    meta.append(metaPair('Confidence', capitalizeFirst(payload?.confidenceLabel ?? 'medium')));
    if (payload?.nextUpdateLabel) meta.append(metaPair('Next update', payload.nextUpdateLabel));
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

  private pruneSnoozes(now: number): void {
    for (const [id, until] of this.snoozedUntil) {
      if (until <= now) this.snoozedUntil.delete(id);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function metaPair(label: string, value: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.append(
    h('dt', null, label),
    h('dd', null, value),
  );
  return frag;
}

function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}
