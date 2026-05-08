/**
 * Pure mapping helpers for the enhanced-brief snapshot collector.
 *
 * Extracted from enhanced-brief-snapshot.ts so they can be unit-tested
 * without importing the snapshot module's full dependency tree (which
 * pulls in Vite-specific `?worker` query imports through the situation
 * engine and alert store).
 */

import type { ThreatSeverity } from '../intelligence-briefing';
import type { HealthStatus } from '../diagnostics/system-health-types';
import type { FeedStatus } from './enhanced-brief-generator';

/** Map FeatureHealthRegistry status → traffic-light feed status.
 *
 *  Why three buckets instead of seven:
 *    - 'healthy' is unambiguous → green
 *    - 'degraded' / 'stale' / 'unknown' all mean "working with caveats"
 *      that the user should know about but doesn't need to act on → yellow
 *    - 'failing' / 'blind' / 'unsafe' all mean a feed needs attention → red
 *      ('unsafe' must always be red since the renderer sorts red-first)
 */
export function mapHealthStatusToFeedStatus(s: HealthStatus): FeedStatus {
  switch (s) {
    case 'healthy': { return 'green';
    }
    case 'degraded':
    case 'stale':
    case 'unknown': { return 'yellow';
    }
    case 'failing':
    case 'blind':
    case 'unsafe': { return 'red';
    }
    default: { return 'yellow';
    }
  }
}

/** Map situation-engine ScenarioSeverity (catastrophic / severe /
 *  moderate / minor / positive) → renderer's ThreatSeverity (critical /
 *  high / medium / low / info).
 *
 *  Default for unknown / undefined is 'medium' rather than 'info' or
 *  'low' — an unmapped severity is more likely a real signal we
 *  haven't categorized than a benign one. */
export function topScenarioSeverity(scenarioSev: string | undefined): ThreatSeverity {
  switch (scenarioSev) {
    case 'catastrophic': { return 'critical';
    }
    case 'severe': {       return 'high';
    }
    case 'moderate': {     return 'medium';
    }
    case 'minor': {        return 'low';
    }
    case 'positive': {     return 'info';
    }
    default: {             return 'medium';
    }
  }
}
