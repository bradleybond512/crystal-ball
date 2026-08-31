export interface WeatherPipelineTerminalEvent {
  stage: 'dropped';
  reason: 'below_notification_ladder_severity' | 'big_event_threshold_not_met';
}

const WEATHER_NOTIFICATION_LADDER_SEVERITIES: ReadonlySet<unknown> = new Set([
  'Extreme',
  'Severe',
]);

export function isWeatherNotificationLadderSeverity(severity: unknown): boolean {
  return WEATHER_NOTIFICATION_LADDER_SEVERITIES.has(severity);
}

export function weatherIngestionTerminalEvent(
  severity: unknown,
): WeatherPipelineTerminalEvent | null {
  return isWeatherNotificationLadderSeverity(severity)
    ? null
    : { stage: 'dropped', reason: 'below_notification_ladder_severity' };
}

export function weatherEvaluationTerminalEvent(
  isBigEvent: boolean,
): WeatherPipelineTerminalEvent | null {
  return isBigEvent
    ? null
    : { stage: 'dropped', reason: 'big_event_threshold_not_met' };
}

export function weatherOccurrenceTraceIds(ids: readonly unknown[]): string[] {
  const normalized = ids.map((id) => (
    typeof id === 'string' && id.trim() ? id : 'weather-alert'
  ));
  const totals = new Map<string, number>();
  for (const id of normalized) totals.set(id, (totals.get(id) ?? 0) + 1);

  const reserved = new Set(
    normalized.filter((id) => totals.get(id) === 1),
  );
  const occurrences = new Map<string, number>();
  const used = new Set<string>();

  return normalized.map((id) => {
    if (totals.get(id) === 1) {
      used.add(id);
      return id;
    }

    const occurrence = (occurrences.get(id) ?? 0) + 1;
    occurrences.set(id, occurrence);
    let traceId = `${id}#occurrence-${occurrence}`;
    while (reserved.has(traceId) || used.has(traceId)) traceId += '#duplicate';
    used.add(traceId);
    return traceId;
  });
}
