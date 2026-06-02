/**
 * FoodSecuritySuperpowerPanel — deep intelligence view for the food domain.
 *
 * Five sections render from existing in-memory stores + caller-supplied
 * commodity forecasts / famine alerts. Every live-store read is wrapped
 * in safe() so a misbehaving singleton can't crash the panel.
 *
 * The panel itself does no fetching — feed adapters push into
 * ObservationStore and host code calls `setForecasts()` / `setAlerts()`
 * after running the shortage radar and food-insecurity fetcher.
 *
 * Refresh: every 60s, plus an on-ingest listener so new observations
 * paint without waiting for the timer.
 *
 * Pure helpers + renderer live in food-security-superpower-helpers.ts
 * so they're testable without spinning up the Panel base class.
 */

import { Panel } from './Panel';
import * as obsStore from '@/services/intelligence/observation-store';
import type { ObservationEvent } from '@/types/intelligence';
import type { FoodInsecurityAlert } from '@/services/food-insecurity';
import type { ShortageForecast } from '@/services/shortage/shortage-types';
import {
  buildFoodSecurityState,
  renderFoodSecurityHtml,
  type FoodSecurityState,
} from './food-security-superpower-helpers';

const REFRESH_MS = 60_000;
const TOOLTIP =
  'Deep food-domain intelligence: pressure gauge from live severity, ranked commodity risk forecasts (wheat / corn / rice / soybeans + softs), IPC Phase 3+ famine watch, supply-chain chokepoint signals, and breadbasket drought/crop-stress monitor. 60-second refresh.';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}

export class FoodSecuritySuperpowerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubIngest: (() => void) | null = null;
  private forecasts: readonly ShortageForecast[] = [];
  private alerts: readonly FoodInsecurityAlert[] = [];
  private state: FoodSecurityState | null = null;

  constructor() {
    super({
      id: 'food-security-superpower',
      title: 'Food Security Intelligence',
      showCount: true,
      trackActivity: true,
      infoTooltip: TOOLTIP,
    });
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_MS);
    this.unsubIngest = safe(
      () => obsStore.onIngest(() => this.refresh()),
      () => undefined,
    );
  }

  public override destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsubIngest) {
      safe(() => this.unsubIngest?.(), undefined);
      this.unsubIngest = null;
    }
    super.destroy();
  }

  /** Caller injects commodity forecasts from the shortage radar. */
  public setForecasts(forecasts: readonly ShortageForecast[]): void {
    this.forecasts = forecasts;
    this.refresh();
  }

  /** Caller injects FEWS NET + IPC alerts. */
  public setAlerts(alerts: readonly FoodInsecurityAlert[]): void {
    this.alerts = alerts;
    this.refresh();
  }

  private refresh(): void {
    const events = safe<ObservationEvent[]>(
      () => obsStore.query({ domain: 'food', limit: 500 }),
      [],
    );
    const agEvents = safe<ObservationEvent[]>(
      () => obsStore.query({ domain: 'agriculture', limit: 500 }),
      [],
    );
    const combined = [...events, ...agEvents];

    const state = buildFoodSecurityState({
      events: combined,
      forecasts: this.forecasts,
      alerts: this.alerts,
    });
    this.state = state;
    this.setCount(state.famine.phase3Plus + state.commodities.filter((c) => c.tier === 'critical' || c.tier === 'high').length);
    this.render();
  }

  private render(): void {
    if (!this.state) {
      this.setContent('<div class="food-sp-loading">Loading food security intelligence…</div>');
      return;
    }
    this.setContent(renderFoodSecurityHtml(this.state));
  }
}
