import type { SurvivalGuide } from '../guide-types';

export const WILDFIRE_GUIDE: SurvivalGuide = {
  id: 'wildfire',
  kind: 'hazard',
  title: 'Wildfire',
  summary:
    'An uncontrolled fire in wildland or the wildland-urban interface that can move faster ' +
    'than people expect, jump roads and firebreaks, and cut off evacuation routes with ' +
    'little warning. Leave early — don\'t wait for an official order if you feel unsafe. ' +
    'Fires that trap people on the road, not fires that reach an empty home, cause the ' +
    'most deaths.',
  signs: [
    'Red Flag Warning (dry, windy, fire-prone conditions) or an active fire reported nearby',
    'Visible smoke plume, ash falling, or a strong smoke smell with no visible source',
    'Local alert system (CodeRed, Nixle, Reverse-911) issuing an evacuation warning or order',
    'Sudden wind shift or a noticeable increase in wind speed near an active fire',
  ],
  prepare: [
    { label: 'Keep a go-bag ready year-round in fire season', detail: 'Documents, medication, chargers, and essentials packed so you can leave in minutes, not hours.' },
    { label: 'Know two evacuation routes out of your area', detail: 'A single route can be blocked by fire, smoke, or traffic — always have a backup.' },
    { label: 'Create defensible space around your home', detail: 'Clear dry brush, leaves, and flammable material within at least 30 feet; keep gutters clear.' },
    { label: 'Sign up for local emergency alerts', detail: 'CodeRed, Nixle, or your county\'s equivalent often issues evacuation orders faster than national alerts.' },
  ],
  during: [
    { label: 'Leave early — don\'t wait for a mandatory order if you feel unsafe', detail: 'Fire behavior can change in minutes with wind shifts; evacuating early avoids being trapped on the road.' },
    { label: 'Park your vehicle facing out and keep it fueled', detail: 'A quick, unobstructed exit can be the difference between escaping and being trapped.' },
    { label: 'Close all windows, vents, and doors before leaving', detail: 'This slows embers and smoke infiltration and can reduce structure loss.' },
    { label: 'If trapped, find a cleared area or body of water and call 911 with your location', detail: 'Do not try to outrun a fast-moving fire on foot through vegetation.' },
  ],
  after: [
    { label: 'Do not return until officials say it is safe', detail: 'Hot spots, unstable trees, and toxic ash can remain dangerous for days.' },
    { label: 'Wear an N95 mask and sturdy shoes when re-entering', detail: 'Ash and smoke residue are respiratory hazards; debris can hide embers and sharp material.' },
    { label: 'Check for smoldering hot spots on your property', detail: 'Fires can reignite from buried embers well after the main front has passed.' },
    { label: 'Have utilities inspected before use', detail: 'Gas lines, electrical systems, and water systems can be damaged even if the structure looks intact.' },
  ],
  recovery: [
    'Photograph all damage before cleanup for insurance claims.',
    'Watch local air quality (AQI) — smoke exposure risk continues well after the fire is out.',
    'Check on neighbors, especially those with respiratory conditions or limited mobility.',
    'Be alert for flash flooding on burn-scarred land in subsequent storms — burned soil sheds water fast.',
  ],
  mistakes: [
    'Waiting for a mandatory evacuation order instead of leaving when you first feel unsafe.',
    'Trying to defend a home against an active, fast-moving fire.',
    'Driving through smoke with near-zero visibility instead of pulling over safely.',
    'Returning home before officials confirm it is safe, risking hot spots and unstable structures.',
  ],
  checklist: [
    { id: 'wildfire.go_bag', label: 'Go-bag packed and ready', weight: 3 },
    { id: 'wildfire.two_routes', label: 'Two evacuation routes known', weight: 3 },
    { id: 'wildfire.defensible_space', label: 'Defensible space maintained around home', weight: 2 },
    { id: 'wildfire.n95', label: 'N95 masks on hand', weight: 1 },
    { id: 'wildfire.local_alerts', label: 'Local emergency alert system (CodeRed/Nixle) enabled', weight: 2 },
  ],
  relatedGuides: ['wildfire_smoke', 'evacuation_planning', 'go_bag'],
  sources: ['Ready.gov — Wildfires', 'CAL FIRE / Ready for Wildfire', 'NIFC — National Interagency Fire Center'],
};
