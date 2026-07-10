/**
 * CriticalMineralsPanel (panel id: `critical-minerals`).
 *
 * Critical minerals + rare earth supply chain intelligence — pure aggregator
 * over ObservationStore (`domain: 'resources'`). Five sections, each backed
 * by a deterministic helper:
 *
 *   1. Supply Disruption Watch     — observations tagged `disruption`
 *   2. Export Restriction Tracker  — observations tagged `export-restriction`
 *   3. Concentration Risk Map      — static MINERAL_PRODUCERS fact table
 *   4. Processing Bottleneck Alert — refining chokepoints + live alerts
 *   5. Strategic Reserve Status    — observations tagged `stockpile`
 *
 * Auto-refresh every 10 minutes. Helpers live in
 * `critical-minerals-helpers.ts` so unit tests can import them without
 * dragging in the Panel base class.
 */

import { Panel } from './Panel';
import { query as queryObservationStore } from '@/services/intelligence/observation-store';
import {
  buildViewModel,
  renderHtml,
  safe,
  type CriticalMineralsDeps,
  type PanelViewModel,
} from './critical-minerals-helpers';

const REFRESH_MS = 10 * 60_000;
const DEFAULT_QUERY_LIMIT = 500;

const DEFAULT_DEPS: CriticalMineralsDeps = {
  queryObservations: () =>
    safe(() => queryObservationStore({ domain: 'resources', limit: DEFAULT_QUERY_LIMIT })) ?? [],
};

export class CriticalMineralsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly deps: CriticalMineralsDeps;

  constructor(deps: Partial<CriticalMineralsDeps> = {}) {
    super({
      id: 'critical-minerals',
      title: 'Critical Minerals',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Critical minerals + rare earth intelligence: live supply disruptions, export restrictions, ' +
        'concentration risk (HHI), processing bottlenecks, and strategic reserve status. ' +
        'Aggregates resource-domain observations + static USGS/IEA producer fact table.',
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

  /** Force a re-render. Exposed for tests + external refresh triggers. */
  public render(): void {
    const now = (this.deps.now ?? Date.now)();
    const vm = buildViewModel(this.deps);
    this.setCount(vm.disruptions.length);
    this.setContent(renderHtml(vm, now));
  }

  /** View-model snapshot — exposed for tests / diagnostics. */
  public snapshot(): PanelViewModel {
    return buildViewModel(this.deps);
  }
}

// Re-export the pure helpers for callers that previously imported them
// from this module.
export {
  buildViewModel,
  renderHtml,
  computeDisruptions,
  computeExportRestrictions,
  computeConcentrationRisk,
  computeProcessingBottlenecks,
  computeStrategicReserves,
  MINERAL_PRODUCERS,
  type CriticalMineralsDeps,
  type PanelViewModel,
  type SupplyDisruption,
  type ExportRestriction,
  type ConcentrationRow,
  type ProcessingBottleneck,
  type ReserveStatus,
  type Mineral,
} from './critical-minerals-helpers';
