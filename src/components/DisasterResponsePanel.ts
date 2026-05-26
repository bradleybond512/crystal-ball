/**
 * DisasterResponsePanel — humanitarian disaster response coordination.
 *
 * Pulls observation events tagged `domain: 'disaster'` from the
 * shared observation-store and projects them into five sections:
 *   1. Active Disaster Operations
 *   2. Resource Deployment
 *   3. Access & Logistics
 *   4. Coordination Gaps
 *   5. Response Effectiveness Index
 *
 * All compute + section rendering lives in `disaster-response-helpers`
 * so unit tests can exercise the contract without DOM / i18n / Vite-
 * only imports.
 */

import { Panel } from './Panel';
import { query as queryObservations } from '@/services/intelligence/observation-store';
import {
  buildDisasterResponseState,
  renderAccessLogistics,
  renderActiveOperations,
  renderCoordinationGaps,
  renderEffectivenessIndex,
  renderResourceDeployment,
  type DisasterResponseState,
} from './disaster-response-helpers';

// Re-export the pure surface so other call sites can import either way.
export {
  buildDisasterResponseState,
  buildEffectivenessIndex,
  coordinationScore,
  coverageScore,
  effectivenessColor,
  effectivenessFor,
  effectivenessTier,
  formatQuantity,
  formatUsdMillions,
  parseAccessCorridors,
  parseCoordinationGaps,
  parseDisasterOperations,
  parseResources,
  renderAccessLogistics,
  renderActiveOperations,
  renderCoordinationGaps,
  renderEffectivenessIndex,
  renderResourceDeployment,
  speedScore,
  DEPLOYMENT_STATUS_COLOR,
  PHASE_COLOR,
  SEVERITY_COLOR,
  SEVERITY_LABEL,
  SEVERITY_TO_SCORE,
  STATUS_COLOR,
  type AccessCorridor,
  type BottleneckType,
  type CoordinationGap,
  type CoordinationSector,
  type CorridorStatus,
  type DeployedResource,
  type DeploymentStatus,
  type DisasterOperation,
  type DisasterResponseState,
  type DisasterType,
  type EffectivenessScore,
  type ResourceKind,
  type ResponsePhase,
  type SeverityScore,
} from './disaster-response-helpers';

const REFRESH_MS = 3 * 60_000;

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

export class DisasterResponsePanel extends Panel {
  private state: DisasterResponseState = buildDisasterResponseState([], 0);
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'disaster-response',
      title: 'Disaster Response',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Humanitarian disaster response coordination: active operations, deployed resources, access corridors, coordination gaps, and a per-operation effectiveness index (coverage × speed × coordination). 3-minute refresh.',
    });
    this.render();
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  /** Public seam for tests + manual injection. */
  public setData(next: DisasterResponseState): void {
    this.state = next;
    this.updateCount();
    this.render();
  }

  private refresh(): void {
    const events = safe(() => queryObservations({ domain: 'disaster' })) ?? [];
    this.state = buildDisasterResponseState(events, Date.now());
    this.updateCount();
    this.render();
  }

  private updateCount(): void {
    // Show the active-operations count as the panel header badge.
    this.setCount(this.state.operations.length);
  }

  private render(): void {
    const s = this.state;
    const stamp = s.generatedAt > 0
      ? `<div style="opacity:0.55;font-size:10px;margin-top:12px">Generated ${timeAgo(s.generatedAt)}</div>`
      : '';
    this.setContent(
      renderActiveOperations(s.operations)
      + renderResourceDeployment(s.resources)
      + renderAccessLogistics(s.corridors)
      + renderCoordinationGaps(s.gaps)
      + renderEffectivenessIndex(s.effectiveness)
      + stamp,
    );
  }
}

function timeAgo(epoch: number): string {
  const s = Math.max(0, Math.floor((Date.now() - epoch) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
