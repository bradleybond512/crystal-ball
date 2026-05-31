/**
 * ClimateSuperpowerPanel — deep-intelligence climate/environment domain panel.
 *
 * Five sections project the in-memory observation store into a view
 * model. The panel does no fetching of its own — feed adapters push
 * climate-domain ObservationEvents into the store and we project here.
 *
 * Refresh: every 5 minutes plus an on-ingest listener.
 * Pure helpers + renderer live in climate-superpower-helpers.ts.
 */

import { Panel } from './Panel';
import * as obsStore from '@/services/intelligence/observation-store';
import type { ObservationEvent } from '@/types/intelligence';
import {
  buildExtremeEvents,
  buildSeaIceMonitor,
  buildMigrationRisk,
  buildTippingPoints,
  buildClimateSecurityIndex,
  renderClimateSuperpowerHtml,
  type ClimatePanelState,
} from './climate-superpower-helpers';

const REFRESH_MS = 5 * 60 * 1000;
const TOOLTIP =
  'Deep climate intelligence: extreme events (wildfire/drought/heatwave/flood/blizzard), sea level and ice anomalies, climate migration risk, tipping-point watch (AMOC/Greenland/Amazon/Permafrost), and per-region climate security index. 5-minute refresh.';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}

export class ClimateSuperpowerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubIngest: (() => void) | null = null;
  private state: ClimatePanelState | null = null;

  constructor() {
    super({
      id: 'climate-superpower',
      title: 'Climate Intelligence',
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

  public destroy(): void {
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

  private refresh(): void {
    const events = safe<ObservationEvent[]>(
      () => obsStore.query({ domain: 'climate', limit: 500 }),
      [],
    );
    const state: ClimatePanelState = {
      extreme: buildExtremeEvents(events),
      seaIce: buildSeaIceMonitor(events),
      migration: buildMigrationRisk(events),
      tipping: buildTippingPoints(events),
      security: buildClimateSecurityIndex(events),
      generatedAt: Date.now(),
    };
    this.state = state;
    this.setCount(state.extreme.length);
    this.render();
  }

  private render(): void {
    if (!this.state) {
      this.setContent('<div class="climate-sp-loading">Loading climate intelligence…</div>');
      return;
    }
    this.setContent(renderClimateSuperpowerHtml(this.state));
  }
}
