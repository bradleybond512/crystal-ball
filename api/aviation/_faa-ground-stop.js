const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function utcMs(value) {
  if (typeof value !== 'string' || !UTC_INSTANT.test(value)) return Number.NaN;
  const ms = Date.parse(value);
  // Date.parse rolls February 31 into March; compare the parsed calendar and clock.
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19) ? ms : Number.NaN;
}

export function nestedGroundStop(item) {
  const program = item.groundStop;
  const airport = item.airportId;
  if (typeof airport !== 'string' || !/^[A-Z0-9]{3,4}$/.test(airport)
    || !program || typeof program !== 'object' || program.airportId !== airport) return null;

  const startedAt = utcMs(program.startTime);
  const end = utcMs(program.endTime);
  const expiry = program.programExpirationTime == null ? end : utcMs(program.programExpirationTime);
  const endsAt = Math.min(end, expiry);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endsAt) || endsAt <= startedAt) return null;
  return {
    airport,
    programType: 'ground_stop',
    reason: typeof program.impactingCondition === 'string' ? program.impactingCondition : 'unspecified',
    startedAt,
    endsAt,
    avgDelayMinutes: null,
    maxDelayMinutes: null,
  };
}
