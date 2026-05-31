/**
 * GeopoliticalRiskPanel — composite geopolitical-risk index.
 *
 * Differentiates from GeopoliticalSuperpowerPanel (raw situation feed)
 * and PoliticalRiskSuperpowerPanel (static instability tables) by being
 * a *scoring* surface: every signal is collapsed into a per-country
 * composite, regions get a top-heavy mean, and great-power dyads get
 * a competition score derived from signals naming both sides.
 *
 * Refresh: every 10 minutes. Live event reads run through safe()
 * because a misbehaving store must not crash the panel.
 *
 * Pure helpers live in geopolitical-risk-helpers.ts so unit tests
 * never need the Panel base class.
 */

import { Panel } from './Panel';
import * as obsStore from '@/services/intelligence/observation-store';
import type { ObservationEvent } from '@/types/intelligence';
import {
  buildGeopoliticalRiskState,
  eventsToRiskSignals,
  renderGeopoliticalRiskHtml,
  type GeopoliticalRiskState,
  type RiskSignal,
} from './geopolitical-risk-helpers';

const REFRESH_MS = 10 * 60_000;
const TOOLTIP =
  'Composite geopolitical risk: 7-dimension per-country score (territorial / alliance / sanctions / coup / diplomatic / great-power / economic-statecraft), top-heavy region rollups, and great-power dyadic tension. Older signals decay (14-day half-life) but never vanish. 10-minute refresh.';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}

export class GeopoliticalRiskPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubIngest: (() => void) | null = null;
  private extraSignals: readonly RiskSignal[] = [];
  private state: GeopoliticalRiskState | null = null;

  constructor() {
    super({
      id: 'geopolitical-risk',
      title: 'Geopolitical Risk',
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
   * Host can inject extra risk signals not derivable from the
   * observation store (e.g. curated sanctions feed adapters).
   */
  public setExtraSignals(signals: readonly RiskSignal[]): void {
    this.extraSignals = signals;
    this.refresh();
  }

  private refresh(): void {
    const geoEvents = safe<ObservationEvent[]>(
      () => obsStore.query({ domain: 'geopolitical', limit: 500 }),
      [],
    );
    const polEvents = safe<ObservationEvent[]>(
      () => obsStore.query({ domain: 'political', limit: 500 }),
      [],
    );
    const conflictEvents = safe<ObservationEvent[]>(
      () => obsStore.query({ domain: 'conflict', limit: 500 }),
      [],
    );
    const sanctionsEvents = safe<ObservationEvent[]>(
      () => obsStore.query({ domain: 'sanctions', limit: 500 }),
      [],
    );
    const liveSignals = eventsToRiskSignals([
      ...geoEvents,
      ...polEvents,
      ...conflictEvents,
      ...sanctionsEvents,
    ]);
    const signals = [...liveSignals, ...this.extraSignals];

    const state = buildGeopoliticalRiskState({ signals });
    this.state = state;
    const criticalRegions = state.regions.filter((r) => r.tier === 'critical' || r.tier === 'high').length;
    const criticalDyads = state.dyads.filter((d) => d.tier === 'critical' || d.tier === 'high').length;
    this.setCount(criticalRegions + criticalDyads);
    this.render();
  }

  private render(): void {
    if (!this.state) {
      this.setContent('<div class="geo-risk-loading">Loading geopolitical risk index…</div>');
      return;
    }
    this.setContent(renderGeopoliticalRiskHtml(this.state));
  }
}
