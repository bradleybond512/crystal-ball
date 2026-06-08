/* eslint-disable sonarjs/cognitive-complexity, sonarjs/reduce-initial-value */
/**
 * Alert stories — clusters related alerts into narrative "stories" using
 * entity co-occurrence, geo proximity, and temporal windowing.
 *
 * A story is a group of alerts that share an entity (e.g. "Taiwan") or
 * are geo-proximate (≤500km) within a 6h window. Stories are ranked by
 * combined hotness of their member alerts.
 *
 * Used by TriageBar to show "Taiwan Strait Tensions (5 signals)" instead
 * of 5 separate rows.
 */

import type { UnifiedAlert } from './unified-alerts';
import { computeDistanceKm } from './unified-alerts';
import { computeEntityHeat } from './entity-heat';

const GEO_RADIUS_KM = 500;
const TIME_WINDOW_MS = 6 * 60 * 60_000;

export interface AlertStory {
  id: string;
  label: string;
  alerts: UnifiedAlert[];
  leadAlert: UnifiedAlert;
  entityName?: string;
}

/**
 * Group alerts into stories. Returns stories sorted by lead alert timestamp
 * (most recent first). Alerts not matching any story are returned as
 * single-alert stories.
 */
export function groupIntoStories(alerts: UnifiedAlert[]): AlertStory[] {
  if (alerts.length === 0) return [];
  const now = Date.now();
  const recent = alerts.filter(a => now - a.timestamp < TIME_WINDOW_MS);

  // Phase 1: entity-based clustering — group alerts sharing a top entity.
  const entityHeat = computeEntityHeat(TIME_WINDOW_MS);
  const topEntities = entityHeat.slice(0, 15);
  const assigned = new Set<string>();
  const stories: AlertStory[] = [];

  for (const ent of topEntities) {
    const entAlertIds = new Set(ent.alertIds);
    const members = recent.filter(a => entAlertIds.has(a.id) && !assigned.has(a.id));
    if (members.length < 2) continue;
    for (const m of members) assigned.add(m.id);
    const lead = members.reduce((best, a) => a.timestamp > best.timestamp ? a : best);
    stories.push({
      id: `story-entity-${ent.name}`,
      label: ent.name,
      alerts: members,
      leadAlert: lead,
      entityName: ent.name,
    });
  }

  // Phase 2: geo clustering for remaining unassigned alerts with locations.
  const unassigned = recent.filter(a => !assigned.has(a.id) && a.location);
  const geoClusters: UnifiedAlert[][] = [];
  const geoUsed = new Set<string>();

  for (const seed of unassigned) {
    if (geoUsed.has(seed.id)) continue;
    const cluster: UnifiedAlert[] = [seed];
    geoUsed.add(seed.id);
    for (const other of unassigned) {
      if (geoUsed.has(other.id)) continue;
      if (!seed.location || !other.location) continue;
      const dist = computeDistanceKm(
        seed.location.lat, seed.location.lon,
        other.location.lat, other.location.lon,
      );
      if (dist <= GEO_RADIUS_KM) {
        cluster.push(other);
        geoUsed.add(other.id);
      }
    }
    if (cluster.length >= 2) geoClusters.push(cluster);
  }

  for (const cluster of geoClusters) {
    for (const m of cluster) assigned.add(m.id);
    const lead = cluster.reduce((best, a) => a.timestamp > best.timestamp ? a : best);
    const loc = lead.location;
    const locLabel = loc?.label ?? `${loc?.lat.toFixed(1)}, ${loc?.lon.toFixed(1)}`;
    stories.push({
      id: `story-geo-${lead.id}`,
      label: locLabel,
      alerts: cluster,
      leadAlert: lead,
    });
  }

  // Phase 3: same-title + same-source grouping for location-less alerts
  // (e.g. NWS zone alerts: 3× "Red Flag Warning" → one story with count badge).
  const titleGroups = new Map<string, UnifiedAlert[]>();
  for (const a of recent) {
    if (assigned.has(a.id)) continue;
    const key = `${a.source}::${a.title}`;
    const g = titleGroups.get(key);
    if (g) g.push(a);
    else titleGroups.set(key, [a]);
  }
  for (const [, group] of titleGroups) {
    const lead = group.reduce((best, a) => a.timestamp > best.timestamp ? a : best);
    for (const m of group) assigned.add(m.id);
    stories.push({
      id: `story-title-${lead.id}`,
      label: lead.title,
      alerts: group,
      leadAlert: lead,
    });
  }

  return stories.sort((a, b) => b.leadAlert.timestamp - a.leadAlert.timestamp);
}
