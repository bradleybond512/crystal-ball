export function scoreConflicts(events) {
  const n = events?.length ?? 0;
  if (n === 0) return 1;
  const hasFatalities = events.some(e => (e.fatalities ?? 0) > 0);
  if (n >= 30) return hasFatalities ? 5 : 4;
  if (n >= 15 && hasFatalities) return 3;
  if (n >= 5) return 2;
  return 1;
}

export function scoreMarkets(quotes) {
  if (!quotes?.length) return 1;
  const thresholds = { SPY: 2.5, 'BTC-USD': 5, 'CL=F': 4, 'GC=F': 2 };
  let triggers = 0;
  for (const q of quotes) {
    const thresh = thresholds[q.symbol];
    if (thresh && Math.abs(q.changePercent ?? 0) >= thresh) triggers++;
  }
  return Math.min(1 + triggers, 5);
}

export function scoreCyber(iocs, kevs) {
  const iocCount = iocs?.length ?? 0;
  const today = new Date().toISOString().slice(0, 10);
  const newKevs = (kevs ?? []).filter(k => k.firstSeen === today).length;
  if (iocCount >= 50 || newKevs >= 5) return 4;
  if (iocCount >= 20 || newKevs >= 1) return 3;
  if (iocCount >= 5) return 2;
  return 1;
}

export function scoreMilitary({ aircraft = [], vessels = [], posture = {} } = {}) {
  const theaters = Object.values(posture?.theaters ?? posture ?? {});
  const elevated = theaters.filter(t => t.status && t.status !== 'normal').length;
  if (elevated >= 2) return 5;
  if (elevated >= 1) return 4;
  const acCount = aircraft.length;
  const vesCount = vessels.length;
  if (acCount > 50 || vesCount > 20) return 3;
  if (acCount > 20 || vesCount > 5) return 2;
  return 1;
}

export function scoreWeather(alerts) {
  if (!alerts?.length) return 1;
  const hasExtreme = alerts.some(a => a.severity === 'Extreme');
  if (hasExtreme) return 5;
  const severeCount = alerts.filter(a => a.severity === 'Severe').length;
  if (severeCount >= 5) return 4;
  if (severeCount >= 1) return 3;
  const modCount = alerts.filter(a => a.severity === 'Moderate').length;
  if (modCount >= 5) return 2;
  return 1;
}

export function scoreInfrastructure(gridAlerts) {
  const n = gridAlerts?.length ?? 0;
  if (n === 0) return 1;
  if (n >= 10) return 4;
  if (n >= 5) return 3;
  if (n >= 1) return 2;
  return 1;
}

export function scoreSeismic(quakes) {
  if (!quakes?.length) return 1;
  const maxMag = Math.max(...quakes.map(q => q.magnitude ?? q.mag ?? 0));
  if (maxMag >= 7.5) return 5;
  if (maxMag >= 6.5) return 4;
  if (maxMag >= 5.5) return 3;
  if (maxMag >= 4) return 2;
  return 1;
}

export function scoreHealth(outbreaks) {
  const n = outbreaks?.length ?? 0;
  if (n === 0) return 1;
  if (n >= 5) return 4;
  if (n >= 3) return 3;
  if (n >= 1) return 2;
  return 1;
}

export function scoreEconomic(data) {
  if (!data || data.error) return 1;
  const series = data.series ?? [];
  if (series.length === 0) return 1;
  const yieldCurve = series.find(s => s.id === 'T10Y2Y');
  if (yieldCurve?.observations?.length) {
    const latest = yieldCurve.observations[yieldCurve.observations.length - 1];
    if (Number.parseFloat(latest?.value) < 0) return 3;
  }
  return 1;
}

export function scoreSanctions(entries) {
  const n = entries?.length ?? 0;
  if (n === 0) return 1;
  if (n >= 10) return 3;
  if (n >= 1) return 2;
  return 1;
}

export function scoreAllDomains(raw) {
  return {
    conflicts: scoreConflicts(raw.conflicts),
    markets: scoreMarkets(raw.markets),
    cyber: scoreCyber(raw.cyber?.iocs, raw.cyber?.kevs),
    military: scoreMilitary(raw.military),
    weather: scoreWeather(raw.weather),
    infrastructure: scoreInfrastructure(raw.infrastructure?.gridAlerts),
    seismic: scoreSeismic(raw.seismic),
    health: scoreHealth(raw.health),
    economic: scoreEconomic(raw.economic),
    sanctions: scoreSanctions(raw.sanctions),
  };
}
