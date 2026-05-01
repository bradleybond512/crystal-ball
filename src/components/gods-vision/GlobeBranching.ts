/**
 * GlobeBranching — Tier 2 scenario-fork visualization.
 *
 * Renders 3 forecast branches as polylines diverging from an entity, with:
 *   • Polyline thickness encoding probability (max 5px at p=1.0)
 *   • Polyline alpha encoding probability (min 0.15)
 *   • Color encoding outcome (green deescalation, yellow stalemate,
 *     red escalation)
 *
 * Used together with GlobePredictions for click-only Tier 2 deep analysis.
 *
 * Plan: docs/superpowers/plans/2026-04-13-gods-eye-4d.md (Task 11)
 */

import {
  Cartesian3,
  Color,
  CustomDataSource,
  Entity,
  PolylineGraphics,
  type Viewer,
} from 'cesium';
import type { BranchingForecast, ScenarioBranch } from '@/services/forecast-engine';

const OUTCOME_COLORS: Record<ScenarioBranch['outcome'], Color> = {
  deescalation: Color.fromCssColorString('#00ffaa'),
  stalemate:    Color.fromCssColorString('#ffc800'),
  escalation:   Color.fromCssColorString('#ff3333'),
};

const MAX_BRANCH_WIDTH_PX = 5;
const MIN_BRANCH_ALPHA = 0.15;

export class GlobeBranching {
  private viewer: Viewer;
  private source: CustomDataSource;
  private activeEntities: Entity[] = [];
  private onBranchHoverCb: ((branch: ScenarioBranch | null) => void) | null = null;

  constructor(viewer: Viewer) {
    this.viewer = viewer;
    this.source = new CustomDataSource('4d-branching');
  }

  mount(): void {
    this.viewer.dataSources.add(this.source).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[GlobeBranching] dataSources.add failed', error);
    });
  }

  destroy(): void {
    this.clear();
    this.viewer.dataSources.remove(this.source, true);
  }

  setOnBranchHover(cb: (branch: ScenarioBranch | null) => void): void {
    this.onBranchHoverCb = cb;
  }

  hasActive(): boolean { return this.activeEntities.length > 0; }

  clear(): void {
    for (const e of this.activeEntities) this.source.entities.remove(e);
    this.activeEntities = [];
    this.onBranchHoverCb?.(null);
  }

  showBranches(forecast: BranchingForecast): void {
    this.clear();

    for (const branch of forecast.branches) {
      if (branch.path.length < 2) continue;
      const positions = branch.path.map(p => Cartesian3.fromDegrees(p.lon, p.lat));
      const color = OUTCOME_COLORS[branch.outcome];
      const width = Math.max(1, branch.probability * MAX_BRANCH_WIDTH_PX);
      const alpha = Math.max(MIN_BRANCH_ALPHA, branch.probability);

      this.activeEntities.push(this.source.entities.add(new Entity({
        polyline: new PolylineGraphics({
          positions,
          width,
          material: color.withAlpha(alpha),
          clampToGround: true,
        }),
        description: `${branch.label} (${Math.round(branch.probability * 100)}%): ${branch.conditions}`,
      })));
    }
  }
}
