import type { SurvivalGuide } from '../guide-types';

export const SEVERE_THUNDERSTORM_GUIDE: SurvivalGuide = {
  id: 'severe_thunderstorm',
  kind: 'hazard',
  title: 'Severe Thunderstorm',
  summary:
    'A thunderstorm producing damaging straight-line winds (58+ mph), large hail (1"+), ' +
    'and/or the potential to spawn a tornado. Lightning accompanies every thunderstorm and ' +
    'is deadly on its own. "When thunder roars, go indoors" — you don\'t need a warning to ' +
    'act on lightning risk.',
  signs: [
    'NWS Severe Thunderstorm Watch (conditions favorable) or Warning (storm confirmed) for your area',
    'Darkening skies, a sudden drop in temperature, and a shift or gust of wind ahead of the storm',
    'Frequent lightning and thunder, or hail beginning to fall',
    'A rapidly building, tall dark cloud (anvil-topped) approaching',
  ],
  prepare: [
    { label: 'Enable WEA/NWS severe weather alerts', detail: 'Severe thunderstorm warnings can precede a tornado warning — treat them seriously.' },
    { label: 'Secure or bring in outdoor furniture and loose items', detail: 'Straight-line winds and hail turn unsecured objects into projectiles and damage vehicles/roofs.' },
    { label: 'Protect electronics with surge protection', detail: 'Lightning-induced power surges are a common cause of equipment damage.' },
    { label: 'Know your tornado safe spot', detail: 'Severe storms can escalate quickly; know where you\'d go if a warning is issued.' },
  ],
  during: [
    { label: 'Go indoors and stay away from windows', detail: 'Hail and wind-driven debris can shatter glass; move to an interior room if the storm is intense.' },
    { label: 'Avoid corded phones, plumbing, and metal objects during lightning', detail: 'Lightning can travel through wiring and pipes — avoid showers, sinks, and wired electronics.' },
    { label: 'If caught outside, avoid open fields, tall isolated trees, and water', detail: 'Get to a hard-topped vehicle or building; crouch low with feet together only as a last resort.' },
    { label: 'If driving, pull over away from trees and power lines', detail: 'High wind can drop branches and lines onto the road; wait out the worst of it parked safely.' },
  ],
  after: [
    { label: 'Wait 30 minutes after the last thunder before going back outside', detail: 'Lightning can strike from miles away from the storm\'s visible edge.' },
    { label: 'Check for downed power lines and tree damage', detail: 'Treat all downed lines as live; keep clear and report them.' },
    { label: 'Inspect for hail and wind damage to roof and vehicles', detail: 'Damage may not be visible from the ground — have a professional check the roof.' },
    { label: 'Watch for follow-on warnings', detail: 'Severe storm clusters can produce multiple rounds of wind, hail, or a spun-up tornado.' },
  ],
  recovery: [
    'Photograph hail and wind damage promptly for insurance claims.',
    'Clear storm debris carefully and watch for hidden hazards like broken glass or splintered wood.',
    'Check on neighbors and anyone who may have been outdoors when the storm hit.',
  ],
  mistakes: [
    'Continuing outdoor activity because "it\'s just rain," ignoring approaching thunder.',
    'Sheltering under a tall isolated tree during lightning.',
    'Touching wired electronics, phones, or plumbing during a lightning storm.',
    'Going back outside immediately after the rain stops without waiting out the lightning risk.',
  ],
  checklist: [
    { id: 'severe_thunderstorm.alerts', label: 'WEA/NWS severe weather alerts enabled', weight: 3 },
    { id: 'severe_thunderstorm.outdoor_items', label: 'Outdoor items secured/storage plan known', weight: 1 },
    { id: 'severe_thunderstorm.surge_protection', label: 'Surge protection on key electronics', weight: 1 },
    { id: 'severe_thunderstorm.safe_spot', label: 'Tornado safe spot identified as backup', weight: 2 },
  ],
  relatedGuides: ['tornado', 'flood', 'shelter_in_place'],
  sources: ['Ready.gov — Thunderstorms & Lightning', 'NWS — Severe Weather Safety'],
};
