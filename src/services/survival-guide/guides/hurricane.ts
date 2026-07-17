import type { SurvivalGuide } from '../guide-types';

export const HURRICANE_GUIDE: SurvivalGuide = {
  id: 'hurricane',
  kind: 'hazard',
  title: 'Hurricane',
  summary:
    'A large rotating storm system bringing damaging wind, torrential rain, and — for ' +
    'coastal areas — life-threatening storm surge. Water, not wind, causes most hurricane ' +
    'deaths: storm surge and inland flooding combined kill far more people than collapsing ' +
    'structures. Landfall timing is knowable days in advance, so most hurricane deaths are ' +
    'preventable with early action.',
  signs: [
    'NHC/NWS Hurricane Watch (possible within 48h) or Warning (expected within 36h)',
    'Your county under a storm-surge or evacuation-zone advisory',
    'A tropical system tracking toward your area on the official cone of uncertainty',
    'Unusually high tides, rapid barometric pressure drop, or a sudden calm before landfall',
  ],
  prepare: [
    { label: 'Know your evacuation zone and storm-surge risk', detail: 'Look up your address on your county\'s hurricane evacuation zone map before hurricane season, not during it.' },
    { label: 'Build a 7-day supply of water, food, and medication', detail: 'Power and water utilities can be out for a week or more after a major landfall.' },
    { label: 'Protect windows and secure the exterior', detail: 'Install shutters or pre-cut plywood; bring in or tie down anything that can become a projectile.' },
    { label: 'Keep the vehicle fueled and finish prep before the storm arrives', detail: 'Fuel lines and evacuation traffic both worsen fast as landfall nears — don\'t wait.' },
  ],
  during: [
    { label: 'Evacuate immediately if ordered, especially in a surge zone', detail: 'Storm surge can be more lethal than the wind and arrives before the worst wind does.' },
    { label: 'If not evacuating, shelter in an interior room away from windows', detail: 'Lowest level not prone to flooding; keep a mattress or blankets to shield against debris.' },
    { label: 'Stay inside during the eye', detail: 'The calm is temporary — the back half of the storm returns with wind from the opposite direction.' },
    { label: 'Do not go outside to check on anything until officials say it is safe', detail: 'Downed lines, flying debris, and flooding remain hazards during and immediately after.' },
  ],
  after: [
    { label: 'Avoid floodwater and downed power lines', detail: 'Treat every downed line as live and every flooded road as impassable.' },
    { label: 'Check on neighbors, especially elderly or medically dependent residents', detail: 'Power and cooling loss is dangerous for anyone on refrigerated medication or powered equipment.' },
    { label: 'Use generators outdoors only, far from windows and doors', detail: 'Carbon monoxide from a generator is a leading cause of post-hurricane death.' },
    { label: 'Conserve phone battery and text instead of calling', detail: 'Cell networks are congested after a major storm; texts get through more reliably.' },
  ],
  recovery: [
    'Photograph all damage before cleanup for insurance claims.',
    'Boil or use bottled water until officials confirm the water supply is safe.',
    'Throw out refrigerated/frozen food after extended power loss — when in doubt, throw it out.',
    'Watch for structural damage that is not obvious at first, and get roofs/foundations inspected.',
  ],
  mistakes: [
    'Riding out a mandatory evacuation order in a surge zone.',
    'Going outside during the eye of the storm, thinking it is over.',
    'Running a generator in a garage or near windows.',
    'Waiting until the storm is imminent to fuel up, buy supplies, or evacuate.',
  ],
  checklist: [
    { id: 'hurricane.evac_zone', label: 'Evacuation zone and storm-surge risk known', weight: 3 },
    { id: 'hurricane.supplies_7day', label: '7-day water/food/medication supply', weight: 3 },
    { id: 'hurricane.window_protection', label: 'Window protection/shutters ready', weight: 2 },
    { id: 'hurricane.full_tank', label: 'Vehicle fuel tank kept full in season', weight: 2 },
  ],
  relatedGuides: ['flood', 'evacuation_planning', 'go_bag'],
  sources: ['Ready.gov — Hurricanes', 'NWS / National Hurricane Center', 'FEMA'],
};
