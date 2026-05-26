/**
 * SignalNoiseFilterPanel — UI for the SignalNoiseFilter service.
 *
 * Renders four sections from the in-memory SignalNoiseFilter singleton:
 *   1. Quality Overview   — totalScored, signal%/noise% gauge
 *   2. Recent Scores      — last 20 scored observations
 *   3. Factor Breakdown   — averaged factor contributions
 *   4. Noise Filter Active — noise count + remediation hint
 *
 * The panel does no fetching — feed adapters call SignalNoiseFilter.score(...)
 * on ingest and we project the cached scores here. Each service call is
 * wrapped in safe() so a misbehaving singleton can't crash the page.
 *
 * Pure helpers + renderer live in signal-noise-filter-panel-helpers.ts so
 * they are testable without spinning up the Panel base class (which would
 * drag in i18next via Panel.ts).
 */

import { Panel } from './Panel';
import { SignalNoiseFilter, type FilterStats, type SignalScore } from '@/services/intelligence/signal-noise-filter';
import * as obsStore from '@/services/intelligence/observation-store';
import { safeHtml, replaceChildren } from '@/utils/dom-utils';
import {
  buildQualityOverview,
  buildRecentScoresView,
  buildFactorBreakdown,
  buildNoiseSummary,
  renderSignalNoiseFilterHtml,
  type SignalNoisePanelState,
} from './signal-noise-filter-panel-helpers';

const REFRESH_MS = 15_000;
const INFO_TOOLTIP =
  'Per-observation signal/noise scoring (sourceCount × 0.3 + corroboration × 0.4 + recency × 0.3). Shows quality gauge, last 20 scores, average factor contributions, and a remediation hint when noise > 60%.';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}

export class SignalNoiseFilterPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'signal-noise-filter',
      title: 'Signal Quality',
      showCount: true,
      trackActivity: true,
      infoTooltip: INFO_TOOLTIP,
    });
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  public destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private refresh(): void {
    const filter = safe<SignalNoiseFilter | null>(
      () => SignalNoiseFilter.getInstance(),
      null,
    );
    const stats: FilterStats = safe<FilterStats>(
      () => filter?.getStats() ?? emptyStats(),
      emptyStats(),
    );
    const recent: SignalScore[] = safe<SignalScore[]>(
      () => filter?.getRecent(20) ?? [],
      [],
    );

    const state: SignalNoisePanelState = {
      overview: buildQualityOverview(stats),
      rows: buildRecentScoresView(recent, (id) => this.lookupDomain(id)),
      breakdown: buildFactorBreakdown(recent),
      noise: buildNoiseSummary(stats),
      generatedAt: Date.now(),
    };

    this.setCount(state.overview.totalScored);
    const fragment = safeHtml(renderSignalNoiseFilterHtml(state));
    replaceChildren(this.getContentElement(), fragment);
  }

  /**
   * Cheap reverse lookup from observationId to domain. ObservationStore is
   * a 1000-entry ring buffer, so this is bounded; if we miss, the row falls
   * back to 'unknown' (caller-side `?? fallback`).
   */
  private lookupDomain(observationId: string): string {
    const found = safe<{ domain: string } | null>(
      () => obsStore.query({ limit: 200 }).find((e) => e.id === observationId) ?? null,
      null,
    );
    return found?.domain ?? 'unknown';
  }
}

function emptyStats(): FilterStats {
  return { totalScored: 0, signalCount: 0, noiseCount: 0, avgSignalScore: 0 };
}
