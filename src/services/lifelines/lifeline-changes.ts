import type {
  LifelineAreaSituation,
  LifelineFact,
  LifelineFactAttribute,
  LifelineFactValue,
  LifelineSiteSituation,
  LifelineSituation,
} from './lifeline-types';

export type LifelineChangeKind =
  | 'site-status-reported'
  | 'site-status-changed'
  | 'site-evidence-became-unknown'
  | 'site-coverage-lost'
  | 'area-outage-reported'
  | 'area-outage-changed'
  | 'area-coverage-lost';

export interface LifelineChange {
  id: string;
  kind: LifelineChangeKind;
  scope: 'site' | 'area';
  subjectId: string;
  attribute: LifelineFactAttribute;
  from: LifelineFactValue;
  to: LifelineFactValue;
  observedAt: Date;
  evidenceIds: string[];
  shadowOnly: true;
}

export interface DeriveLifelineChangesOptions {
  maxCandidates?: number;
}

const SITE_STATUS_FACTS = ['operational', 'inventory', 'power', 'access'] as const;

function evidenceIds(previous: LifelineFact, current?: LifelineFact): string[] {
  return [...new Set([
    previous.sourceObservationId,
    current?.sourceObservationId,
  ].filter((value): value is string => Boolean(value)))];
}

function candidate(
  kind: LifelineChangeKind,
  previous: LifelineFact,
  current: LifelineFact | undefined,
  observedAt: Date,
): LifelineChange {
  const to = current?.knowledge === 'reported' ? current.value : 'unknown';
  return {
    id: `${kind}:${previous.scope}:${previous.subjectId}:${previous.attribute}:${observedAt.toISOString()}`,
    kind,
    scope: previous.scope,
    subjectId: previous.subjectId,
    attribute: previous.attribute,
    from: previous.knowledge === 'reported' ? previous.value : 'unknown',
    to,
    observedAt: current?.observedAt ?? observedAt,
    evidenceIds: evidenceIds(previous, current),
    shadowOnly: true,
  };
}

function compareSite(
  previous: LifelineSiteSituation,
  current: LifelineSiteSituation | undefined,
  observedAt: Date,
): LifelineChange[] {
  const changes: LifelineChange[] = [];
  for (const attribute of SITE_STATUS_FACTS) {
    const before = previous[attribute];
    const after = current?.[attribute];
    if (!after) {
      if (before.knowledge === 'reported') changes.push(candidate('site-coverage-lost', before, undefined, observedAt));
      continue;
    }
    if (before.knowledge === 'reported' && after.knowledge !== 'reported') {
      changes.push(candidate('site-evidence-became-unknown', before, after, observedAt));
    } else if (before.knowledge !== 'reported' && after.knowledge === 'reported') {
      changes.push(candidate('site-status-reported', before, after, observedAt));
    } else if (before.knowledge === 'reported' && after.knowledge === 'reported' && before.value !== after.value) {
      changes.push(candidate('site-status-changed', before, after, observedAt));
    }
  }
  return changes;
}

function compareArea(
  previous: LifelineAreaSituation,
  current: LifelineAreaSituation | undefined,
  observedAt: Date,
): LifelineChange[] {
  const before = previous.customersOut;
  const after = current?.customersOut;
  if (!after) {
    return before.knowledge === 'reported'
      ? [candidate('area-coverage-lost', before, undefined, observedAt)]
      : [];
  }
  if (before.knowledge === 'reported' && after.knowledge !== 'reported') {
    return [candidate('area-coverage-lost', before, after, observedAt)];
  }
  if (before.knowledge !== 'reported' && after.knowledge === 'reported') {
    return [candidate('area-outage-reported', before, after, observedAt)];
  }
  if (before.knowledge === 'reported' && after.knowledge === 'reported' && before.value !== after.value) {
    return [candidate('area-outage-changed', before, after, observedAt)];
  }
  return [];
}

function currentOnlyCandidate(
  kind: 'site-status-reported' | 'area-outage-reported',
  current: LifelineFact,
  observedAt: Date,
): LifelineChange {
  return {
    id: `${kind}:${current.scope}:${current.subjectId}:${current.attribute}:${observedAt.toISOString()}`,
    kind,
    scope: current.scope,
    subjectId: current.subjectId,
    attribute: current.attribute,
    from: 'unknown',
    to: current.value,
    observedAt: current.observedAt ?? observedAt,
    evidenceIds: current.sourceObservationId ? [current.sourceObservationId] : [],
    shadowOnly: true,
  };
}

/**
 * Compare two established baselines and emit inert shadow candidates. This
 * module has no notifier import and no dispatch side effect by construction.
 */
export function deriveLifelineChanges(
  previous: LifelineSituation | null,
  current: LifelineSituation,
  options: DeriveLifelineChangesOptions = {},
): LifelineChange[] {
  if (!previous) return [];
  if (previous.placeId !== current.placeId || previous.queryFingerprint !== current.queryFingerprint) return [];
  if (current.derivedAt.getTime() <= previous.derivedAt.getTime()) return [];
  const currentSites = new Map(current.sites.map((site) => [site.site.id, site]));
  const currentAreas = new Map(current.areas.map((area) => [area.areaConditionId, area]));
  const previousSiteIds = new Set(previous.sites.map((site) => site.site.id));
  const previousAreaIds = new Set(previous.areas.map((area) => area.areaConditionId));
  const changes = [
    ...previous.sites.flatMap((site) => compareSite(site, currentSites.get(site.site.id), current.derivedAt)),
    ...previous.areas.flatMap((area) => compareArea(area, currentAreas.get(area.areaConditionId), current.derivedAt)),
    ...current.sites
      .filter((site) => !previousSiteIds.has(site.site.id))
      .flatMap((site) => SITE_STATUS_FACTS
        .map((attribute) => site[attribute])
        .filter((fact) => fact.knowledge === 'reported')
        .map((fact) => currentOnlyCandidate('site-status-reported', fact, current.derivedAt))),
    ...current.areas
      .filter((area) => !previousAreaIds.has(area.areaConditionId) && area.customersOut.knowledge === 'reported')
      .map((area) => currentOnlyCandidate('area-outage-reported', area.customersOut, current.derivedAt)),
  ].sort((left, right) => {
    const subjectDiff = left.subjectId.localeCompare(right.subjectId);
    if (subjectDiff !== 0) return subjectDiff;
    const attributeDiff = left.attribute.localeCompare(right.attribute);
    return attributeDiff !== 0 ? attributeDiff : left.kind.localeCompare(right.kind);
  });
  const requestedMax = Number.isFinite(options.maxCandidates)
    ? Math.trunc(options.maxCandidates as number)
    : 100;
  const maxCandidates = Math.max(1, Math.min(500, requestedMax));
  return changes.slice(0, maxCandidates);
}
