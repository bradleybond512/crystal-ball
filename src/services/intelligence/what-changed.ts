import type { ObservationEvent, Correlation } from './observation-types.ts';

export interface WorldStateSnapshot {
  takenAt: number;
  eventIds: string[];
  eventDomains: Record<string, string>;
  correlationIds: string[];
  domainCounts: Record<string, number>;
  severityByDomain: Record<string, number>;
}

export interface WhatChangedReport {
  since: number;
  until: number;
  newEventsByDomain: Record<string, string[]>;
  resolvedEventIds: string[];
  severityEscalations: {
    domain: string;
    from: number;
    to: number;
  }[];
  newCorrelationIds: string[];
  totalNewEvents: number;
  totalResolved: number;
}

export function snapshot(events: ObservationEvent[], correlations: Correlation[]): WorldStateSnapshot {
  const active = events.filter(e => e.active);

  const eventIds: string[] = [];
  const eventDomains: Record<string, string> = {};
  const domainCounts: Record<string, number> = {};
  const severityByDomain: Record<string, number> = {};

  for (const e of active) {
    eventIds.push(e.id);
    eventDomains[e.id] = e.domain;
    domainCounts[e.domain] = (domainCounts[e.domain] ?? 0) + 1;
    const cur = severityByDomain[e.domain];
    if (cur === undefined || e.severity > cur) {
      severityByDomain[e.domain] = e.severity;
    }
  }

  return {
    takenAt: Date.now(),
    eventIds,
    eventDomains,
    correlationIds: correlations.map(c => c.id),
    domainCounts,
    severityByDomain,
  };
}

export function diff(prev: WorldStateSnapshot, curr: WorldStateSnapshot): WhatChangedReport {
  const prevSet = new Set(prev.eventIds);
  const currSet = new Set(curr.eventIds);

  const newEventsByDomain: Record<string, string[]> = {};
  for (const id of curr.eventIds) {
    if (!prevSet.has(id)) {
      const domain = curr.eventDomains[id] ?? 'unknown';
      newEventsByDomain[domain] ??= [];
      newEventsByDomain[domain].push(id);
    }
  }

  const resolvedEventIds = prev.eventIds.filter(id => !currSet.has(id));

  const severityEscalations: WhatChangedReport['severityEscalations'] = [];
  for (const domain of Object.keys(curr.severityByDomain)) {
    const prevSev = prev.severityByDomain[domain] ?? 0;
    const currSev = curr.severityByDomain[domain] ?? 0;
    if (currSev > prevSev) {
      severityEscalations.push({ domain, from: prevSev, to: currSev });
    }
  }

  const prevCorrSet = new Set(prev.correlationIds);
  const newCorrelationIds = curr.correlationIds.filter(id => !prevCorrSet.has(id));

  const totalNewEvents = Object.values(newEventsByDomain).reduce((sum, ids) => sum + ids.length, 0);

  return {
    since: prev.takenAt,
    until: curr.takenAt,
    newEventsByDomain,
    resolvedEventIds,
    severityEscalations,
    newCorrelationIds,
    totalNewEvents,
    totalResolved: resolvedEventIds.length,
  };
}

// ── Backward-compat re-export ────────────────────────────────────────
// PR #X — what-changed v2 is the new world-state diff engine. Existing
// panels imported `WhatChangedService` from this module; expose the v2
// class under that legacy name so callers don't break during the
// migration.
export { WhatChangedV2 as WhatChangedService } from './what-changed-v2.ts';
