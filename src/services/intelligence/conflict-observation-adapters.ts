import type { AirstrikeEvent } from '@/services/airstrikes';
import type { ConflictEvent } from '@/services/conflict';
import type { OrefAlert } from '@/services/oref-validate';
import type {
  ClusteredEvent,
  SocialUnrestEvent,
  UcdpGeoEvent,
} from '@/types';
import type {
  ObservationEvent,
  ObservationSeverity,
} from '@/types/intelligence';
import { countryEntitySlugs, slugifyEntity } from './entity-slug';
import {
  EVENT_REGION_TAG_PREFIX,
  EVENT_TYPE_TAG_PREFIX,
  type EventOccurrenceType,
} from './event-occurrence-contract';

const MAX_STRUCTURED_BATCH = 200;
const MAX_NEWS_OBSERVATIONS = 100;
const MAX_ENTITIES = 16;
const MAX_REGIONS = 4;
const MAX_TITLE_LENGTH = 280;

export function createConflictObservationDeduper(
  capacity = 2000,
): (observations: readonly ObservationEvent[]) => ObservationEvent[] {
  const boundedCapacity = Number.isInteger(capacity)
    ? Math.max(1, Math.min(10_000, capacity))
    : 2000;
  const seen = new Set<string>();
  return (observations) => {
    const fresh: ObservationEvent[] = [];
    for (const observation of observations) {
      const key = `${observation.sourceId}\u0000${observation.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(observation);
      while (seen.size > boundedCapacity) {
        const oldest = seen.values().next().value as string | undefined;
        if (oldest === undefined) break;
        seen.delete(oldest);
      }
    }
    return fresh;
  };
}

function timestampOf(value: Date | string | number): number | null {
  let timestamp: number;
  if (value instanceof Date) {
    timestamp = value.getTime();
  } else if (typeof value === 'number') {
    timestamp = value;
  } else {
    timestamp = Date.parse(value);
  }
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
}

function safeText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, maxLength)
    : '';
}

function safeId(value: unknown): string {
  return safeText(value, 256);
}

function validCoordinate(lat: unknown, lon: unknown): boolean {
  return Number.isFinite(lat)
    && Number(lat) >= -90
    && Number(lat) <= 90
    && Number.isFinite(lon)
    && Number(lon) >= -180
    && Number(lon) <= 180;
}

function boundedSlugs(values: readonly unknown[]): string[] {
  const slugs = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const slug = slugifyEntity(value).slice(0, 80);
    if (slug) slugs.add(slug);
    if (slugs.size >= MAX_ENTITIES) break;
  }
  return [...slugs];
}

function entitySlugs(
  country: unknown,
  others: readonly unknown[],
): string[] {
  const countrySlugs = typeof country === 'string'
    ? countryEntitySlugs(country)
    : [];
  return boundedSlugs([...countrySlugs, ...others]);
}

function regionTags(values: readonly unknown[]): string[] {
  const regions = boundedSlugs(values).slice(0, MAX_REGIONS);
  return regions.map((region) => `${EVENT_REGION_TAG_PREFIX}${region}`);
}

function severityForFatalities(fatalities: unknown): ObservationSeverity {
  const count = Number(fatalities);
  if (!Number.isFinite(count) || count <= 0) return 'LOW';
  if (count >= 25) return 'CRITICAL';
  if (count >= 5) return 'HIGH';
  return 'MEDIUM';
}

function eventTypeTag(eventType: EventOccurrenceType): string {
  return `${EVENT_TYPE_TAG_PREFIX}${eventType}`;
}

function conflictEventType(raw: unknown): EventOccurrenceType | null {
  if (typeof raw !== 'string') return null;
  const value = raw.toLowerCase().replace(/[_-]+/g, ' ');
  if (value.includes('battle')) return 'armed-conflict';
  if (value.includes('remote violence')) return 'remote-violence';
  if (value.includes('explosion')) return 'explosion';
  if (value.includes('violence against civilians')) {
    return 'civilian-violence';
  }
  return null;
}

export function conflictEventsToObservations(
  events: readonly ConflictEvent[],
): ObservationEvent[] {
  const observations: ObservationEvent[] = [];
  for (const event of events.slice(0, MAX_STRUCTURED_BATCH)) {
    const id = safeId(event?.id);
    const timestamp = timestampOf(event?.time);
    const eventType = conflictEventType(event?.eventType);
    if (
      !id
      || timestamp === null
      || !eventType
      || !validCoordinate(event?.lat, event?.lon)
    ) {
      continue;
    }
    const entities = entitySlugs(event.country, [
      ...(Array.isArray(event.actors) ? event.actors : []),
    ]);
    const regions = regionTags([
      ...countryEntitySlugs(event.country),
      event.region,
    ]);
    if (entities.length === 0 || regions.length === 0) continue;
    const locationLabel = [event.location, event.region, event.country]
      .find(Boolean) ?? '';
    observations.push({
      id: `acled-${id}`,
      sourceId: 'acled',
      domain: 'conflict',
      timestamp,
      location: { lat: event.lat, lon: event.lon },
      severity: severityForFatalities(event.fatalities),
      title: safeText(
        `${event.eventType} — ${locationLabel}`,
        MAX_TITLE_LENGTH,
      ),
      raw: {
        provider: 'acled',
        providerEventId: id,
        eventType: safeText(event.eventType, 80),
      },
      entityIds: entities,
      tags: [eventTypeTag(eventType), ...regions],
    });
  }
  return observations;
}

function ucdpEventType(raw: unknown): EventOccurrenceType | null {
  switch (raw) {
    case 'state-based': {
      return 'armed-conflict';
    }
    case 'non-state': {
      return 'armed-conflict';
    }
    case 'one-sided': {
      return 'civilian-violence';
    }
    default: {
      return null;
    }
  }
}

export function ucdpEventsToObservations(
  events: readonly UcdpGeoEvent[],
): ObservationEvent[] {
  const observations: ObservationEvent[] = [];
  for (const event of events.slice(0, MAX_STRUCTURED_BATCH)) {
    const id = safeId(event?.id);
    const timestamp = timestampOf(event?.date_start);
    const eventType = ucdpEventType(event?.type_of_violence);
    if (
      !id
      || timestamp === null
      || !eventType
      || !validCoordinate(event?.latitude, event?.longitude)
    ) {
      continue;
    }
    const entities = entitySlugs(event.country, [event.side_a, event.side_b]);
    const regions = regionTags(countryEntitySlugs(event.country));
    if (entities.length === 0 || regions.length === 0) continue;
    observations.push({
      id: `ucdp-${id}`,
      sourceId: 'ucdp',
      domain: 'conflict',
      timestamp,
      location: { lat: event.latitude, lon: event.longitude },
      severity: severityForFatalities(event.deaths_best),
      title: safeText(
        `${event.type_of_violence} violence — ${event.country}`,
        MAX_TITLE_LENGTH,
      ),
      raw: {
        provider: 'ucdp',
        providerEventId: id,
        violenceType: event.type_of_violence,
      },
      entityIds: entities,
      tags: [eventTypeTag(eventType), ...regions],
    });
  }
  return observations;
}

export function airstrikesToObservations(
  events: readonly AirstrikeEvent[],
): ObservationEvent[] {
  const observations: ObservationEvent[] = [];
  for (const event of events.slice(0, MAX_STRUCTURED_BATCH)) {
    const id = safeId(event?.id);
    const timestamp = timestampOf(event?.date);
    if (
      !id
      || timestamp === null
      || !validCoordinate(event?.lat, event?.lon)
    ) {
      continue;
    }
    const entities = entitySlugs(event.country, [
      event.actor,
      event.targetActor,
    ]);
    const regions = regionTags([
      ...countryEntitySlugs(event.country),
      event.region,
    ]);
    if (entities.length === 0 || regions.length === 0) continue;
    observations.push({
      id: `acled-airstrike-${id}`,
      sourceId: 'acled',
      domain: 'military',
      timestamp,
      location: { lat: event.lat, lon: event.lon },
      severity: severityForFatalities(event.fatalities),
      title: safeText(
        `${event.subEventType || 'Airstrike'} — ${event.location || event.country}`,
        MAX_TITLE_LENGTH,
      ),
      raw: {
        provider: 'acled',
        providerEventId: id,
        eventType: safeText(event.eventType, 80),
        subEventType: safeText(event.subEventType, 80),
      },
      entityIds: entities,
      tags: [eventTypeTag('airstrike'), ...regions],
    });
  }
  return observations;
}

export function orefAlertsToObservations(
  alerts: readonly OrefAlert[],
): ObservationEvent[] {
  const observations: ObservationEvent[] = [];
  for (const alert of alerts.slice(0, MAX_STRUCTURED_BATCH)) {
    const id = safeId(alert?.id);
    const timestamp = timestampOf(alert?.alertDate);
    if (!id || timestamp === null || !Array.isArray(alert.data)) continue;
    const locations = alert.data
      .filter((location): location is string => typeof location === 'string')
      .slice(0, MAX_ENTITIES);
    const entities = entitySlugs('Israel', locations);
    observations.push({
      id: `oref-${id}`,
      sourceId: 'oref',
      domain: 'security',
      timestamp,
      severity: 'HIGH',
      title: safeText(
        `${alert.title || 'Security alert'} — ${locations.join(', ')}`,
        MAX_TITLE_LENGTH,
      ),
      raw: {
        provider: 'oref',
        providerEventId: id,
        category: safeText(alert.cat, 40),
      },
      entityIds: entities,
      tags: [
        eventTypeTag('security-alert'),
        `${EVENT_REGION_TAG_PREFIX}israel`,
        `${EVENT_REGION_TAG_PREFIX}isr`,
      ],
    });
  }
  return observations;
}

function severityForUnrest(
  severity: SocialUnrestEvent['severity'],
): ObservationSeverity {
  switch (severity) {
    case 'high': {
      return 'HIGH';
    }
    case 'medium': {
      return 'MEDIUM';
    }
    default: {
      return 'LOW';
    }
  }
}

function sourceIdForUnrest(event: SocialUnrestEvent): string {
  if (event.sourceType === 'acled') return 'acled';
  const namedSource = event.sources
    .map((source) => slugifyEntity(source).slice(0, 64))
    .find(Boolean);
  return namedSource ? `news:${namedSource}` : event.sourceType;
}

const UNREST_SOURCE_TYPES = new Set(['acled', 'gdelt', 'rss']);

export function unrestEventsToObservations(
  events: readonly SocialUnrestEvent[],
): ObservationEvent[] {
  const observations: ObservationEvent[] = [];
  for (const event of events.slice(0, MAX_STRUCTURED_BATCH)) {
    const id = safeId(event?.id);
    const timestamp = timestampOf(event?.time);
    const title = safeText(event?.title, MAX_TITLE_LENGTH);
    if (
      !id
      || timestamp === null
      || !title
      || !UNREST_SOURCE_TYPES.has(event?.sourceType)
      || !validCoordinate(event?.lat, event?.lon)
    ) {
      continue;
    }
    const entities = entitySlugs(event.country, [
      ...(Array.isArray(event.actors) ? event.actors : []),
    ]);
    const regions = regionTags([
      ...countryEntitySlugs(event.country),
      event.region,
    ]);
    if (entities.length === 0 || regions.length === 0) continue;
    observations.push({
      id: `unrest-${event.sourceType}-${id}`,
      sourceId: sourceIdForUnrest(event),
      domain: 'conflict',
      timestamp,
      location: { lat: event.lat, lon: event.lon },
      severity: severityForUnrest(event.severity),
      title,
      raw: {
        provider: event.sourceType,
        providerEventId: id,
        eventType: event.eventType,
      },
      entityIds: entities,
      tags: [eventTypeTag('civil-unrest'), ...regions],
    });
  }
  return observations;
}

function newsEventContract(category: unknown): {
  domain: 'conflict' | 'military' | 'security';
  eventType: EventOccurrenceType;
} | null {
  switch (category) {
    case 'conflict': {
      return { domain: 'conflict', eventType: 'armed-conflict' };
    }
    case 'military': {
      return { domain: 'military', eventType: 'military-activity' };
    }
    case 'protest': {
      return { domain: 'conflict', eventType: 'civil-unrest' };
    }
    case 'terrorism': {
      return { domain: 'security', eventType: 'security-alert' };
    }
    default: {
      return null;
    }
  }
}

function severityForThreatLevel(level: unknown): ObservationSeverity {
  switch (level) {
    case 'critical': {
      return 'CRITICAL';
    }
    case 'high': {
      return 'HIGH';
    }
    case 'medium': {
      return 'MEDIUM';
    }
    case 'low': {
      return 'LOW';
    }
    default: {
      return 'INFO';
    }
  }
}

interface NewsClusterContext {
  id: string;
  contract: {
    domain: 'conflict' | 'military' | 'security';
    eventType: EventOccurrenceType;
  };
  region: string;
  regionSlugs: string[];
  entities: string[];
}

function contextForNewsCluster(
  cluster: ClusteredEvent,
): NewsClusterContext | null {
  const id = safeId(cluster?.id);
  const contract = newsEventContract(cluster?.threat?.category);
  if (
    !id
    || !contract
    || !Array.isArray(cluster.topSources)
    || cluster.topSources.length < 2
    || !Array.isArray(cluster.allItems)
  ) {
    return null;
  }
  const regions = new Set(
    cluster.allItems
      .map((item) => slugifyEntity(item.locationName ?? ''))
      .filter(Boolean),
  );
  if (regions.size !== 1) return null;
  const region = [...regions][0]!;
  const entities = countryEntitySlugs(region);
  return entities.length > 0
    ? { id, contract, region, regionSlugs: entities, entities }
    : null;
}

function observationForNewsSource(
  cluster: ClusteredEvent,
  context: NewsClusterContext,
  source: ClusteredEvent['topSources'][number],
): ObservationEvent | null {
  const sourceSlug = slugifyEntity(source.name).slice(0, 64);
  if (!sourceSlug) return null;
  const item = cluster.allItems.find((candidate) =>
    slugifyEntity(candidate.source) === sourceSlug
    && slugifyEntity(candidate.locationName ?? '') === context.region);
  const timestamp = item ? timestampOf(item.pubDate) : null;
  if (timestamp === null) return null;
  return {
    id: `news-${context.id}-${sourceSlug}`,
    sourceId: `news:${sourceSlug}`,
    domain: context.contract.domain,
    timestamp,
    ...(validCoordinate(cluster.lat, cluster.lon)
      ? { location: { lat: cluster.lat!, lon: cluster.lon! } }
      : {}),
    severity: severityForThreatLevel(cluster.threat?.level),
    title: safeText(cluster.primaryTitle, MAX_TITLE_LENGTH),
    raw: {
      provider: 'news-cluster',
      clusterId: context.id,
      source: safeText(source.name, 80),
    },
    entityIds: context.entities,
    tags: [
      eventTypeTag(context.contract.eventType),
      ...context.regionSlugs.map(
        (region) => `${EVENT_REGION_TAG_PREFIX}${region}`,
      ),
    ],
  };
}

function observationsForNewsCluster(
  cluster: ClusteredEvent,
  limit: number,
): ObservationEvent[] {
  const context = contextForNewsCluster(cluster);
  if (!context || limit <= 0) return [];
  const observations: ObservationEvent[] = [];
  const seenSources = new Set<string>();
  for (const source of cluster.topSources.slice(0, 4)) {
    if (observations.length >= limit) break;
    const sourceSlug = slugifyEntity(source.name).slice(0, 64);
    if (!sourceSlug || seenSources.has(sourceSlug)) continue;
    const observation = observationForNewsSource(cluster, context, source);
    if (!observation) continue;
    seenSources.add(sourceSlug);
    observations.push(observation);
  }
  return observations;
}

export function newsClustersToObservations(
  clusters: readonly ClusteredEvent[],
): ObservationEvent[] {
  const observations: ObservationEvent[] = [];
  for (const cluster of clusters) {
    if (observations.length >= MAX_NEWS_OBSERVATIONS) break;
    observations.push(...observationsForNewsCluster(
      cluster,
      MAX_NEWS_OBSERVATIONS - observations.length,
    ));
  }
  return observations;
}
