import type { ObservationEvent } from '@/types/intelligence';
import type { SavedPlace } from '@/services/saved-places';
import { haversineKm } from '@/services/proximity-filter';

export interface TravelEntry {
  location: string;
  lat: number;
  lon: number;
  start: number;
  end: number;
}

export interface PersonalProfile {
  savedPlaces: SavedPlace[];
  watchlist: string[];
  interests: string[];
  travelDates: TravelEntry[];
}

export interface PersonalRelevanceComponents {
  proximity: number;
  watchlist: number;
  interests: number;
  travel: number;
}

export interface PersonalRelevanceScore {
  total: number;
  components: PersonalRelevanceComponents;
  matchedPlaces: string[];
  matchedWatchlist: string[];
  inTravelWindow: boolean;
}

export interface ProfileStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'wm-personal-profile';
const TRAVEL_RADIUS_KM = 200;

export function emptyProfile(): PersonalProfile {
  return { savedPlaces: [], watchlist: [], interests: [], travelDates: [] };
}

function proximityScore(
  event: ObservationEvent,
  places: SavedPlace[],
): { score: number; matchedPlaces: string[] } {
  if (!event.location || places.length === 0) return { score: 0, matchedPlaces: [] };
  const { lat, lon } = event.location;
  let best = Number.POSITIVE_INFINITY;
  let bestPlace: SavedPlace | null = null;
  for (const place of places) {
    const d = haversineKm(lat, lon, place.lat, place.lon);
    if (d < best) {
      best = d;
      bestPlace = place;
    }
  }
  if (best <= 100) return { score: 40, matchedPlaces: bestPlace ? [bestPlace.name] : [] };
  if (best <= 500) return { score: 25, matchedPlaces: bestPlace ? [bestPlace.name] : [] };
  return { score: 0, matchedPlaces: [] };
}

function watchlistScore(
  event: ObservationEvent,
  watchlist: string[],
): { score: number; matchedWatchlist: string[] } {
  const matched: string[] = [];
  const title = event.title.toLowerCase();
  const entitySet = new Set(event.entityIds.map((e) => e.toLowerCase()));
  for (const term of watchlist) {
    const trimmed = term.trim();
    if (trimmed.length === 0) continue;
    const lower = trimmed.toLowerCase();
    const hit = title.includes(lower) || entitySet.has(lower);
    if (hit && !matched.includes(trimmed)) matched.push(trimmed);
  }
  return { score: matched.length * 20, matchedWatchlist: matched };
}

function interestScore(event: ObservationEvent, interests: string[]): number {
  return interests.includes(event.domain) ? 15 : 0;
}

function travelScore(
  event: ObservationEvent,
  trips: TravelEntry[],
  nowMs: number,
): { score: number; inTravelWindow: boolean } {
  if (!event.location) return { score: 0, inTravelWindow: false };
  for (const trip of trips) {
    if (nowMs < trip.start || nowMs > trip.end) continue;
    const d = haversineKm(event.location.lat, event.location.lon, trip.lat, trip.lon);
    if (d <= TRAVEL_RADIUS_KM) return { score: 30, inTravelWindow: true };
  }
  return { score: 0, inTravelWindow: false };
}

export function scorePersonalRelevance(
  event: ObservationEvent,
  profile: PersonalProfile,
  nowMs: number = Date.now(),
): PersonalRelevanceScore {
  const prox = proximityScore(event, profile.savedPlaces);
  const watch = watchlistScore(event, profile.watchlist);
  const interest = interestScore(event, profile.interests);
  const travel = travelScore(event, profile.travelDates, nowMs);

  return {
    total: prox.score + watch.score + interest + travel.score,
    components: {
      proximity: prox.score,
      watchlist: watch.score,
      interests: interest,
      travel: travel.score,
    },
    matchedPlaces: prox.matchedPlaces,
    matchedWatchlist: watch.matchedWatchlist,
    inTravelWindow: travel.inTravelWindow,
  };
}

function defaultStorage(): ProfileStorageLike | null {
  if (typeof globalThis === 'undefined') return null;
  const ls = (globalThis as { localStorage?: ProfileStorageLike }).localStorage;
  return ls ?? null;
}

export function loadProfile(storage: ProfileStorageLike | null = defaultStorage()): PersonalProfile {
  if (!storage) return emptyProfile();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyProfile();
    const parsed = JSON.parse(raw) as Partial<PersonalProfile>;
    return {
      savedPlaces: Array.isArray(parsed.savedPlaces) ? parsed.savedPlaces : [],
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      interests: Array.isArray(parsed.interests) ? parsed.interests : [],
      travelDates: Array.isArray(parsed.travelDates) ? parsed.travelDates : [],
    };
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(
  profile: PersonalProfile,
  storage: ProfileStorageLike | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage errors (quota, security) are non-fatal — caller may not have a backing store.
  }
}
