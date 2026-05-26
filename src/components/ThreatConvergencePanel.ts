/**
 * Threat Convergence Panel — surfaces multi-domain alert correlation
 * picked up by `ThreatConvergenceDetector`.
 *
 * Four sections (top → bottom):
 *   1. Convergence Alert       — banner when a convergence is active
 *   2. Active Window Status    — counts + peak severity + fatigue
 *   3. Convergence History     — last 20 convergence detections
 *   4. Domain Elevation Feed   — recent per-domain elevation events
 *
 * The detector is registered through the mission-bridge slot (see
 * `mission-bridges/threat-convergence-bridge.ts`). All pure rendering
 * lives in `threat-convergence-panel-helpers.ts`; this class is a thin
 * shell that wires the timer, count, and helper output together.
 */

import { Panel } from './Panel';
import {
  computeActiveWindowStats,
  getThreatConvergenceDetector,
  type ActiveWindowStats,
} from '@/services/intelligence/mission-bridges/threat-convergence-bridge';
import {
  HISTORY_LIMIT,
  WINDOW_MS,
  renderAlert,
  renderElevationFeed,
  renderHistory,
  renderUnavailable,
  renderWindowStatus,
  resolveFatigueScore,
  safe,
} from './threat-convergence-panel-helpers';

const REFRESH_MS = 30_000;

export class ThreatConvergencePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'threat-convergence',
      title: 'Threat Convergence',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Multi-domain alert correlation: detects "perfect storm" patterns when 3+ domains elevate within a short window.',
    });
    this.render();
    if (typeof setInterval !== 'undefined') {
      this.refreshTimer = setInterval(() => { this.render(); }, REFRESH_MS);
    }
  }

  override destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private render(): void {
    const detector = safe(() => getThreatConvergenceDetector());
    if (!detector) {
      this.setCount(0);
      this.setContent(renderUnavailable());
      return;
    }
    const elevations = safe(() => detector.getElevations()) ?? [];
    const history = safe(() => detector.getHistory(HISTORY_LIMIT)) ?? [];
    const current = safe(() => detector.detect(WINDOW_MS)) ?? null;
    const stats: ActiveWindowStats = safe(() => computeActiveWindowStats(elevations, WINDOW_MS)) ?? {
      elevatedDomains: 0, peakSeverity: 0, msSinceLastElevation: null,
    };
    const fatigueScore = resolveFatigueScore(WINDOW_MS);
    if (fatigueScore !== undefined) stats.fatigueScore = fatigueScore;

    this.setCount(stats.elevatedDomains);
    this.setContent(`<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${renderAlert(current)}
      ${renderWindowStatus(stats)}
      ${renderHistory(history)}
      ${renderElevationFeed(elevations)}
    </div>`);
    this.markFresh();
  }
}
