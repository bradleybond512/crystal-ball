import type { SurvivalGuide } from '../guide-types';

export const FLOOD_GUIDE: SurvivalGuide = {
  id: 'flood',
  kind: 'hazard',
  title: 'Flood',
  summary:
    'Rising or fast-moving water from heavy rain, storm surge, snowmelt, or a dam or ' +
    'levee failure. Floods are the deadliest weather hazard in the US, and most flood ' +
    'deaths happen in vehicles. Just 6 inches of moving water can knock an adult down; ' +
    '12 inches can float and carry away a car. "Turn Around, Don\'t Drown."',
  signs: [
    'NWS Flood Watch (possible) or Flood/Flash Flood Warning (happening or imminent) for your area',
    'Rapidly rising water in a creek, storm drain, or normally dry wash after heavy rain',
    'Steady, heavy rain for hours or days, or a rain rate the ground cannot absorb',
    'Upstream dam or levee release notice, or visible water pooling where it never has before',
  ],
  prepare: [
    { label: 'Know your flood zone and evacuation route', detail: 'Check FEMA flood maps for your address; pick a route to higher ground that avoids low bridges and underpasses.' },
    { label: 'Enable NWS/WEA flash-flood alerts', detail: 'Flash floods can develop in minutes — do not rely on checking the weather app manually.' },
    { label: 'Elevate critical items and consider flood insurance', detail: 'Standard homeowners insurance does not cover flood damage; move irreplaceables and utilities above expected flood levels.' },
    { label: 'Keep a full tank of gas and a go-bag ready', detail: 'Stations may lose power or run out during a regional flood event.' },
  ],
  during: [
    { label: 'Never drive or walk through floodwater', detail: 'You cannot judge depth or road integrity by looking. Turn around and find another way.' },
    { label: 'Move to higher ground immediately if told to evacuate', detail: 'Do not wait to see how bad it gets — roads out can flood behind you.' },
    { label: 'If trapped by rising water in a building, go up, not into a closed attic', detail: 'Bring a way to signal or break through the roof if water keeps rising — do not trap yourself under it.' },
    { label: 'If your vehicle stalls in water, abandon it and climb to higher ground', detail: 'Cars can be swept away in seconds even in what looks like shallow water.' },
  ],
  after: [
    { label: 'Stay out of floodwater', detail: 'It can be electrically charged, contaminated with sewage or chemicals, or hide washed-out road and debris hazards.' },
    { label: 'Avoid weakened roads, bridges, and buildings', detail: 'Floodwater can undermine foundations and pavement that look fine on the surface.' },
    { label: 'Document damage before cleanup', detail: 'Photograph everything for insurance before you move or discard anything.' },
    { label: 'Watch for reissued warnings', detail: 'A second surge or levee failure can follow the first crest.' },
  ],
  recovery: [
    'Throw out food and medicine that contacted floodwater, including canned goods with damaged seals.',
    'Have an electrician check wiring and appliances that got wet before using them again.',
    'Wear boots and gloves during cleanup; floodwater carries sewage, chemicals, and debris.',
    'Watch for mold — dry out and disinfect within 24-48 hours to limit growth.',
  ],
  mistakes: [
    'Driving around a barricade or through a flooded road "because it looks shallow."',
    'Waiting until water is at the door to evacuate instead of leaving on the watch.',
    'Walking through moving water to check on property or pets.',
    'Sheltering in a closed attic with no way out as water keeps rising.',
  ],
  checklist: [
    { id: 'flood.evac_route', label: 'Flood-safe evacuation route to higher ground known', weight: 3 },
    { id: 'flood.alerts', label: 'NWS/WEA flood alerts enabled', weight: 3 },
    { id: 'flood.flood_zone', label: 'FEMA flood zone for home checked', weight: 2 },
    { id: 'flood.insurance', label: 'Flood insurance considered/obtained', weight: 1 },
    { id: 'flood.elevated_items', label: 'Critical items and utilities elevated', weight: 2 },
  ],
  relatedGuides: ['evacuation_planning', 'go_bag', 'shelter_in_place'],
  sources: ['Ready.gov — Floods', 'NWS — Flood Safety (Turn Around, Don\'t Drown)', 'FEMA'],
};
