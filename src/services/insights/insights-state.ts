/**
 * Insights state singleton — gap #12 wiring.
 *
 * Holds the current "active situation" (if any) so Command Center
 * + downstream panels can render the matching Action Brief without
 * each panel rebuilding the situation pipeline.
 *
 * Also exposes a per-event Personal Impact assessment + provider
 * redundancy snapshot so the host can pipe data in once and have
 * every consumer see the same view.
 *
 * Pure deterministic. No DOM, no fetch, no globals at import time.
 */

import type { SituationDescriptor, ActionBrief } from './action-briefs';
import { buildActionBrief } from './action-briefs';
import type { PersonalImpactReport, PersonalProfile, IncomingEvent } from '../personal/personal-impact';
import { mapEventsToPersonalImpact } from '../personal/personal-impact';
import type { ProviderRedundancyReport, ProviderSnapshot } from '../diagnostics/provider-redundancy';
import { assessProviderRedundancy } from '../diagnostics/provider-redundancy';

let activeSituation: SituationDescriptor | undefined;
let personalProfile: PersonalProfile = {
  savedPlaces: [],
  watchedEntities: [],
  portfolio: [],
  travelRoutes: [],
  utilities: [],
};
let recentEvents: IncomingEvent[] = [];
let providerSnapshots: ProviderSnapshot[] = [];

// ── Active situation + Action Brief ────────────────────────────────────

export function setActiveSituation(situation: SituationDescriptor | undefined): void {
  activeSituation = situation;
}

export function getActiveSituation(): SituationDescriptor | undefined {
  return activeSituation;
}

export function getActiveActionBrief(): ActionBrief | undefined {
  if (!activeSituation) return undefined;
  return buildActionBrief(activeSituation);
}

// ── Personal profile + impact ──────────────────────────────────────────

export function setPersonalProfile(profile: PersonalProfile): void {
  personalProfile = profile;
}

export function getPersonalProfile(): PersonalProfile {
  return personalProfile;
}

export function setRecentEvents(events: readonly IncomingEvent[]): void {
  recentEvents = [...events];
}

export function getRecentEvents(): readonly IncomingEvent[] {
  return recentEvents;
}

export function getPersonalImpactReport(): PersonalImpactReport {
  return mapEventsToPersonalImpact(personalProfile, recentEvents);
}

// ── Provider redundancy ────────────────────────────────────────────────

export function setProviderSnapshots(snapshots: readonly ProviderSnapshot[]): void {
  providerSnapshots = [...snapshots];
}

export function getProviderSnapshots(): readonly ProviderSnapshot[] {
  return providerSnapshots;
}

export function getProviderRedundancyReport(): ProviderRedundancyReport {
  return assessProviderRedundancy({ snapshots: providerSnapshots });
}

// ── Reset (tests + storybook only) ─────────────────────────────────────

export function resetInsightsState(): void {
  activeSituation = undefined;
  personalProfile = {
    savedPlaces: [],
    watchedEntities: [],
    portfolio: [],
    travelRoutes: [],
    utilities: [],
  };
  recentEvents = [];
  providerSnapshots = [];
}
