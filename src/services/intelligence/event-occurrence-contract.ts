import type { SituationSignalSnapshot } from '../situation-types';
import { isGenericNewsSignalType } from '../situation-news-domain';

export const EVENT_OCCURRENCE_DOMAINS = [
  'conflict',
  'military',
  'security',
] as const;

export const EVENT_OCCURRENCE_TYPES = [
  'armed-conflict',
  'airstrike',
  'explosion',
  'remote-violence',
  'civilian-violence',
  'military-activity',
  'security-alert',
  'civil-unrest',
] as const;

export type EventOccurrenceDomain =
  typeof EVENT_OCCURRENCE_DOMAINS[number];
export type EventOccurrenceType =
  typeof EVENT_OCCURRENCE_TYPES[number];

export const EVENT_TYPE_TAG_PREFIX = 'event-type:';
export const EVENT_REGION_TAG_PREFIX = 'region:';

const SIGNAL_EVENT_TYPES: Readonly<Record<string, readonly EventOccurrenceType[]>> = {
  hotspot_escalation: ['armed-conflict'],
  military_surge: ['military-activity'],
  geo_convergence: ['armed-conflict', 'military-activity'],
};

export function eventOccurrenceTypesForSignals(
  signalTypes: readonly string[],
): EventOccurrenceType[] {
  const found = new Set<EventOccurrenceType>();
  for (const signalType of signalTypes) {
    for (const eventType of SIGNAL_EVENT_TYPES[signalType] ?? []) {
      found.add(eventType);
    }
  }
  return EVENT_OCCURRENCE_TYPES.filter((eventType) => found.has(eventType));
}

export function qualifiedEventOccurrenceTypes(signals: readonly SituationSignalSnapshot[]): EventOccurrenceType[] {
  const found = new Set<EventOccurrenceType>();
  for (const signal of signals.slice(0, 4096)) {
    if (signal.domain === 'unknown') continue;
    if (isGenericNewsSignalType(signal.type)) {
      if (signal.domain === 'civil_unrest' && signal.domainClassification?.basis === 'article_classification'
        && signal.domainClassification.reason === 'supported') found.add('civil-unrest');
    } else {
      for (const type of eventOccurrenceTypesForSignals([signal.type])) found.add(type);
    }
  }
  return EVENT_OCCURRENCE_TYPES.filter(type => found.has(type));
}

export function allowlistedEventOccurrenceTypes(value: unknown): EventOccurrenceType[] {
  if (!Array.isArray(value) || value.length > EVENT_OCCURRENCE_TYPES.length
    || !value.every((type: unknown) => typeof type === 'string' && (EVENT_OCCURRENCE_TYPES as readonly string[]).includes(type))) return [];
  return EVENT_OCCURRENCE_TYPES.filter(type => value.includes(type));
}
