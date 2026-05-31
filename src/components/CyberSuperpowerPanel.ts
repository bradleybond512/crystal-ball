/**
 * CyberSuperpowerPanel — deep intelligence view for the cyber domain.
 *
 * Five sections render from existing in-memory stores; each store read
 * is wrapped in safe() so a misbehaving singleton can't crash the
 * whole panel. The panel itself does no fetching — feed adapters
 * push into ObservationStore / SituationStore / EntityRegistry and we
 * project the result here.
 *
 * Refresh: every 45s, plus an on-ingest listener so new observations
 * paint without waiting for the timer.
 *
 * Pure helpers + renderer live in cyber-superpower-helpers.ts so they
 * are testable without spinning up the Panel base class.
 */

import { Panel } from './Panel';
import * as obsStore from '@/services/intelligence/observation-store';
import * as situationStore from '@/services/intelligence/situation-store';
import * as entityRegistry from '@/services/intelligence/entity-registry';
import type { ObservationEvent, Situation } from '@/types/intelligence';
import type { Entity } from '@/services/intelligence/entity-registry';
import {
  computeThreatLevel,
  buildActiveCampaigns,
  buildInfrastructureExposure,
  buildZeroDayWatch,
  buildAttributionSignals,
  renderCyberSuperpowerHtml,
  type CyberPanelState,
} from './cyber-superpower-helpers';

const REFRESH_MS = 45_000;
const TOOLTIP =
  'Deep cyber-domain intelligence: posture gauge from live severity, ranked active cyber campaigns, BGP/DNS infrastructure anomalies, CVE / CISA-KEV zero-day watch, and threat-actor attribution. 45-second refresh.';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}

export class CyberSuperpowerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubIngest: (() => void) | null = null;
  private state: CyberPanelState | null = null;

  constructor() {
    super({
      id: 'cyber-superpower',
      title: 'Cyber Intelligence',
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
    const cyberEvents = safe<ObservationEvent[]>(
      () => obsStore.query({ domain: 'cyber', limit: 500 }),
      [],
    );
    const situations = safe<Situation[]>(
      () => situationStore.findByDomain('cyber'),
      [],
    );
    const entities = safe<Entity[]>(
      () => entityRegistry.getByDomain('cyber'),
      [],
    );

    const state: CyberPanelState = {
      threat: computeThreatLevel(cyberEvents),
      campaigns: buildActiveCampaigns(situations),
      exposure: buildInfrastructureExposure(cyberEvents),
      zeroDays: buildZeroDayWatch(cyberEvents),
      attribution: buildAttributionSignals(entities, cyberEvents),
      generatedAt: Date.now(),
    };
    this.state = state;
    this.setCount(state.campaigns.length);
    this.render();
  }

  private render(): void {
    if (!this.state) {
      this.setContent('<div class="cyber-sp-loading">Loading cyber intelligence…</div>');
      return;
    }
    this.setContent(renderCyberSuperpowerHtml(this.state));
  }
}
