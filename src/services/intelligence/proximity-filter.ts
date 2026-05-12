import type { ObservationEvent } from '@/types/intelligence';
import type { SavedPlace } from '@/services/saved-places';
import { haversineKm } from '@/services/proximity-filter';

export function filterByProximity(
  events: ObservationEvent[],
  savedPlaces: SavedPlace[],
  radiusKm = 500,
): ObservationEvent[] {
  if (savedPlaces.length === 0) return events;
  return events.filter((event) => {
    if (!event.location) return false;
    const { lat, lon } = event.location;
    return savedPlaces.some(
      (place) => haversineKm(lat, lon, place.lat, place.lon) <= radiusKm,
    );
  });
}
