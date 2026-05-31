/**
 * CurrencyWarfarePanel — composite monetary-conflict surface.
 *
 * Folds seven dimensions (FX intervention, peg stress, capital flight,
 * dollar weaponization, SWIFT exclusion, competitive devaluation,
 * reserve shift) into per-currency scores, currency-bloc rollups, and
 * dedicated USD-weaponization / SWIFT-exclusion / reserve-shift slices.
 *
 * 5-minute refresh because FX moves and intervention rumors are
 * shorter-lived than territorial signals. Live observation-store reads
 * are guarded by safe() — a misbehaving store must not crash the panel.
 *
 * Pure helpers live in currency-warfare-helpers.ts so the unit tests
 * never have to mount the Panel base class.
 */

import { Panel } from './Panel';
import * as obsStore from '@/services/intelligence/observation-store';
import type { ObservationEvent } from '@/types/intelligence';
import {
  buildCurrencyWarfareState,
  eventsToWarfareSignals,
  renderCurrencyWarfareHtml,
  type CurrencyWarfareState,
  type WarfareSignal,
} from './currency-warfare-helpers';

const REFRESH_MS = 5 * 60_000;
const TOOLTIP =
  'Composite currency-warfare index: 7-dimension per-currency score (fx-intervention / peg-stress / capital-flight / dollar-weaponization / swift-exclusion / competitive-devaluation / reserve-shift), bloc rollups, and dedicated USD-weaponization + SWIFT-exclusion + reserve-shift slices. Older signals decay (10-day half-life). 5-minute refresh.';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}

export class CurrencyWarfarePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubIngest: (() => void) | null = null;
  private extraSignals: readonly WarfareSignal[] = [];
  private state: CurrencyWarfareState | null = null;

  constructor() {
    super({
      id: 'currency-warfare',
      title: 'Currency Warfare',
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

  /**
   * Host can inject curated signals not derivable from the observation
   * store (e.g. dedicated FX-intervention adapter).
   */
  public setExtraSignals(signals: readonly WarfareSignal[]): void {
    this.extraSignals = signals;
    this.refresh();
  }

  private refresh(): void {
    const financeEvents = safe<ObservationEvent[]>(
      () => obsStore.query({ domain: 'finance', limit: 500 }),
      [],
    );
    const marketsEvents = safe<ObservationEvent[]>(
      () => obsStore.query({ domain: 'markets', limit: 500 }),
      [],
    );
    const sanctionsEvents = safe<ObservationEvent[]>(
      () => obsStore.query({ domain: 'sanctions', limit: 500 }),
      [],
    );
    const economicEvents = safe<ObservationEvent[]>(
      () => obsStore.query({ domain: 'economic', limit: 500 }),
      [],
    );
    const currencyEvents = safe<ObservationEvent[]>(
      () => obsStore.query({ domain: 'currency', limit: 500 }),
      [],
    );
    const liveSignals = eventsToWarfareSignals([
      ...financeEvents,
      ...marketsEvents,
      ...sanctionsEvents,
      ...economicEvents,
      ...currencyEvents,
    ]);
    const signals = [...liveSignals, ...this.extraSignals];

    const state = buildCurrencyWarfareState({ signals });
    this.state = state;
    const stressedCurrencies = state.topCurrencies.filter(
      (c) => c.tier === 'crisis' || c.tier === 'stressed',
    ).length;
    const stressedBlocs = state.blocs.filter(
      (b) => b.tier === 'crisis' || b.tier === 'stressed',
    ).length;
    this.setCount(stressedCurrencies + stressedBlocs);
    this.render();
  }

  private render(): void {
    if (!this.state) {
      this.setContent('<div class="cw-loading">Loading currency-warfare index…</div>');
      return;
    }
    this.setContent(renderCurrencyWarfareHtml(this.state));
  }
}
