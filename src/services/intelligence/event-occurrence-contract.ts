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
  velocity_spike: ['civil-unrest'],
  keyword_spike: ['civil-unrest'],
  convergence: ['civil-unrest'],
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
