/**
 * GeopoliticalSuperpowerPanel (panel id: `geopolitical-superpower`).
 *
 * Domain superpower panel — the deepest single-pane intelligence view for
 * geopolitical activity. Pure aggregator over Situation Store, Entity
 * Registry, and Geopolitical Event Calendar.
 *
 * Sections:
 *   1. Conflict Heat Index       — per-region 0–100 composite.
 *   2. Sanctions Radar            — OFAC-tagged entities + recent additions.
 *   3. GDELT Event Stream         — latest geopolitical situations.
 *   4. Alliance Stability Monitor — summits + treaty deadlines.
 *   5. Flashpoint Watch           — top high-severity situations.
 *
 * The aggregator helpers live in `geopolitical-superpower-helpers.ts` so
 * unit tests can import them without dragging in the Panel base class.
 */

import { Panel } from './Panel';
import { getSituationStoreV2 } from '@/services/intelligence/situation-store-v2';
import { getGeopoliticalEventCalendar } from '@/services/intelligence/geopolitical-event-calendar';
import { allEntities } from '@/services/intelligence/entity-registry';
import {
  buildViewModel,
  renderHtml,
  safe,
  type GeopoliticalSuperpowerDeps,
  type PanelViewModel,
} from './geopolitical-superpower-helpers';

const REFRESH_MS = 60_000;

const DEFAULT_DEPS: GeopoliticalSuperpowerDeps = {
  getSituations: () => safe(() => getSituationStoreV2().list()) ?? [],
  getEntities: () => safe(() => allEntities()) ?? [],
  getCalendarEvents: (withinMs) => safe(() => getGeopoliticalEventCalendar().getUpcoming(withinMs)) ?? [],
};

export class GeopoliticalSuperpowerPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly deps: GeopoliticalSuperpowerDeps;

  constructor(deps: Partial<GeopoliticalSuperpowerDeps> = {}) {
    super({
      id: 'geopolitical-superpower',
      title: 'Geopolitical Superpower',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep geopolitical intelligence view: Conflict Heat Index, Sanctions Radar, GDELT Event Stream, Alliance Stability, and Flashpoint Watch — aggregated from Situation Store, Entity Registry, and Event Calendar.',
    });
    this.deps = { ...DEFAULT_DEPS, ...deps };
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.render();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  /** Force a re-render. Exposed for tests + external triggers. */
  public render(): void {
    const now = (this.deps.now ?? Date.now)();
    const vm = buildViewModel(this.deps);
    this.setCount(vm.flashpoints.length);
    this.setContent(renderHtml(vm, now));
  }

  /** View-model snapshot — exposed for tests/diagnostics. */
  public snapshot(): PanelViewModel {
    return buildViewModel(this.deps);
  }
}

// Re-export the pure helpers for callers that previously imported them from
// this module.
export {
  buildViewModel,
  renderHtml,
  regionOf,
  computeConflictHeat,
  computeSanctionsView,
  computeEventStream,
  computeAllianceMonitor,
  computeFlashpoints,
  type GeopoliticalSuperpowerDeps,
  type PanelViewModel,
  type RegionHeat,
  type SanctionsView,
  type StreamEntry,
  type AllianceSignal,
  type Flashpoint,
} from './geopolitical-superpower-helpers';
