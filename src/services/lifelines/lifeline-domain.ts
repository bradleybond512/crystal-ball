import type {
  AccessStatus,
  AreaCondition,
  InventoryStatus,
  LocalLogisticsSnapshot,
  OperationalStatus,
  PowerStatus,
  ResourceObservation,
  ResourceSite,
} from '../local-logistics-types';
import type {
  LifelineAreaSituation,
  LifelineFact,
  LifelineFactAttribute,
  LifelineSiteSituation,
  LifelineSituation,
  LifelineUnknownReason,
} from './lifeline-types';

function validTime(date: Date): boolean {
  return date instanceof Date && Number.isFinite(date.getTime());
}

function currentAt(expiresAt: Date, now: number): boolean {
  return validTime(expiresAt) && expiresAt.getTime() > now;
}

function providerForSite(site: ResourceSite): 'fema' | 'osm' {
  return site.sourceRefs.some((reference) => reference.provider === 'fema') ? 'fema' : 'osm';
}

function unknownStatusFact<T extends OperationalStatus | InventoryStatus | PowerStatus | AccessStatus>(
  siteId: string,
  attribute: 'operational' | 'inventory' | 'power' | 'access',
  provider: 'fema' | 'osm',
  reason: LifelineUnknownReason,
  observation?: ResourceObservation,
): LifelineFact<T> {
  return {
    id: `site:${siteId}:${attribute}`,
    scope: 'site',
    subjectId: siteId,
    attribute,
    value: 'unknown' as T,
    knowledge: 'unknown',
    provider,
    observedAt: observation?.observedAt ?? null,
    expiresAt: observation?.expiresAt ?? null,
    ...(observation ? { sourceObservationId: observation.id } : {}),
    reason,
  };
}

function statusFact<T extends OperationalStatus | InventoryStatus | PowerStatus | AccessStatus>(
  siteId: string,
  attribute: 'operational' | 'inventory' | 'power' | 'access',
  value: T,
  observation: ResourceObservation,
): LifelineFact<T> {
  if (value === 'unknown') {
    return unknownStatusFact(siteId, attribute, 'fema', 'not-reported', observation);
  }
  return {
    id: `site:${siteId}:${attribute}`,
    scope: 'site',
    subjectId: siteId,
    attribute,
    value,
    knowledge: 'reported',
    provider: 'fema',
    observedAt: observation.observedAt,
    expiresAt: observation.expiresAt,
    sourceObservationId: observation.id,
  };
}

function latestObservation(observations: readonly ResourceObservation[]): ResourceObservation | undefined {
  return [...observations]
    .filter((observation) => validTime(observation.observedAt) && validTime(observation.expiresAt))
    .sort((left, right) => {
      const timeDiff = right.observedAt.getTime() - left.observedAt.getTime();
      return timeDiff !== 0 ? timeDiff : left.id.localeCompare(right.id);
    })[0];
}

function capacityFacts(
  site: ResourceSite,
  official: ResourceObservation | undefined,
  now: number,
): Array<LifelineFact<number | null>> {
  if (!site.sourceRefs.some((reference) => reference.provider === 'fema')) return [];
  const definitions: Array<[LifelineFactAttribute, number | undefined]> = [
    ['evacuation-capacity', site.capabilities.evacuationCapacity],
    ['post-impact-capacity', site.capabilities.postImpactCapacity],
    ['reported-population', site.capabilities.reportedPopulation],
  ];
  return definitions.flatMap(([attribute, value]) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !official) return [];
    const expired = !currentAt(official.expiresAt, now);
    return [{
      id: `site:${site.id}:${attribute}`,
      scope: 'site' as const,
      subjectId: site.id,
      attribute,
      value: expired ? null : value,
      knowledge: expired ? 'unknown' as const : 'reported' as const,
      provider: 'fema' as const,
      observedAt: official.observedAt,
      expiresAt: official.expiresAt,
      ...(expired ? { reason: 'expired' as const } : {}),
    }];
  });
}

function availabilityCameFromCapacity(site: ResourceSite, observation: ResourceObservation): boolean {
  if (observation.inventory !== 'available') return false;
  const capacity = site.capabilities.postImpactCapacity ?? site.capabilities.evacuationCapacity;
  const population = site.capabilities.reportedPopulation;
  return typeof capacity === 'number'
    && Number.isFinite(capacity)
    && capacity > 0
    && typeof population === 'number'
    && Number.isFinite(population)
    && population >= 0
    && population < capacity;
}

function deriveSite(
  site: ResourceSite,
  observations: readonly ResourceObservation[],
  now: number,
): LifelineSiteSituation {
  const provider = providerForSite(site);
  const official = latestObservation(observations.filter((observation) => (
    observation.provider === 'fema' && observation.verification === 'official'
  )));
  const directory = latestObservation(observations.filter((observation) => (
    observation.provider === 'osm' || observation.verification === 'directory'
  )));
  const evidence = official ?? directory;
  const identity: LifelineFact<string> = {
    id: `site:${site.id}:identity`,
    scope: 'site',
    subjectId: site.id,
    attribute: 'identity',
    value: site.name,
    knowledge: provider === 'fema' ? 'reported' : 'directory',
    provider,
    observedAt: evidence?.observedAt ?? null,
    expiresAt: null,
    ...(evidence ? { sourceObservationId: evidence.id } : {}),
  };

  if (!official) {
    const reason: LifelineUnknownReason = directory ? 'directory-not-operational' : 'not-reported';
    return {
      site,
      identity,
      operational: unknownStatusFact(site.id, 'operational', provider, reason, directory),
      inventory: unknownStatusFact(site.id, 'inventory', provider, reason, directory),
      power: unknownStatusFact(site.id, 'power', provider, reason, directory),
      access: unknownStatusFact(site.id, 'access', provider, reason, directory),
      capacities: capacityFacts(site, official, now),
    };
  }

  if (!currentAt(official.expiresAt, now)) {
    return {
      site,
      identity,
      operational: unknownStatusFact(site.id, 'operational', 'fema', 'expired', official),
      inventory: unknownStatusFact(site.id, 'inventory', 'fema', 'expired', official),
      power: unknownStatusFact(site.id, 'power', 'fema', 'expired', official),
      access: unknownStatusFact(site.id, 'access', 'fema', 'expired', official),
      capacities: capacityFacts(site, official, now),
    };
  }

  const inventory = availabilityCameFromCapacity(site, official)
    ? unknownStatusFact<InventoryStatus>(site.id, 'inventory', 'fema', 'capacity-is-not-availability', official)
    : statusFact(site.id, 'inventory', official.inventory, official);
  return {
    site,
    identity,
    operational: statusFact(site.id, 'operational', official.operational, official),
    inventory,
    power: statusFact(site.id, 'power', official.power, official),
    access: statusFact(site.id, 'access', official.access, official),
    capacities: capacityFacts(site, official, now),
  };
}

function areaFact(
  condition: AreaCondition,
  attribute: 'county-customers-out' | 'county-customers-restored',
  value: number,
  now: number,
): LifelineFact<number | null> {
  const expired = !currentAt(condition.expiresAt, now);
  const unknownCoverage = condition.coverage !== 'reported';
  return {
    id: `area:${condition.id}:${attribute}`,
    scope: 'area',
    subjectId: condition.id,
    attribute,
    value: expired || unknownCoverage ? null : value,
    knowledge: expired || unknownCoverage ? 'unknown' : 'reported',
    provider: 'ornl-odin',
    observedAt: condition.observedAt,
    expiresAt: condition.expiresAt,
    ...(expired ? { reason: 'expired' as const } : {}),
    ...(!expired && unknownCoverage ? { reason: 'coverage-unknown' as const } : {}),
  };
}

function deriveArea(condition: AreaCondition, now: number): LifelineAreaSituation {
  return {
    areaConditionId: condition.id,
    countyFips: condition.countyFips,
    county: condition.county,
    state: condition.state,
    customersOut: areaFact(condition, 'county-customers-out', condition.customersOut, now),
    ...(typeof condition.customersRestored === 'number' && Number.isFinite(condition.customersRestored)
      ? { customersRestored: areaFact(condition, 'county-customers-restored', condition.customersRestored, now) }
      : {}),
  };
}

/**
 * Derive the fail-closed domain view. This function does no fetching, caching,
 * notification dispatch, or provider inference.
 */
export function deriveLifelineSituation(
  snapshot: Pick<
    LocalLogisticsSnapshot,
    'schemaVersion' | 'queryFingerprint' | 'placeId' | 'placeName' | 'sites' | 'observations' | 'areaConditions'
  >,
  now = Date.now(),
): LifelineSituation {
  const observationsBySite = new Map<string, ResourceObservation[]>();
  for (const observation of snapshot.observations) {
    const values = observationsBySite.get(observation.siteId) ?? [];
    values.push(observation);
    observationsBySite.set(observation.siteId, values);
  }
  const sites = snapshot.sites.map((site) => deriveSite(site, observationsBySite.get(site.id) ?? [], now));
  const areas = snapshot.areaConditions.map((condition) => deriveArea(condition, now));
  const facts: LifelineFact[] = [
    ...sites.flatMap((site) => [
      site.identity,
      site.operational,
      site.inventory,
      site.power,
      site.access,
      ...site.capacities,
    ]),
    ...areas.flatMap((area) => [
      area.customersOut,
      ...(area.customersRestored ? [area.customersRestored] : []),
    ]),
  ];
  return {
    schemaVersion: 1,
    sourceSchemaVersion: 2,
    queryFingerprint: snapshot.queryFingerprint,
    placeId: snapshot.placeId,
    placeName: snapshot.placeName,
    derivedAt: new Date(now),
    sites,
    areas,
    facts,
  };
}

export type {
  LifelineAreaSituation,
  LifelineFact,
  LifelineSiteSituation,
  LifelineSituation,
} from './lifeline-types';
