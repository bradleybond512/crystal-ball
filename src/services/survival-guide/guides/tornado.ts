import type { SurvivalGuide } from '../guide-types';

export const TORNADO_GUIDE: SurvivalGuide = {
  id: 'tornado',
  kind: 'hazard',
  title: 'Tornado',
  summary:
    'A violently rotating column of air reaching the ground. Tornadoes can form ' +
    'in minutes with winds over 200 mph, tossing vehicles and leveling buildings. ' +
    'The difference between a Watch (conditions are favorable) and a Warning (one ' +
    'has been spotted or shown on radar) decides how fast you must act.',
  signs: [
    'NWS Tornado Warning for your county or a radar-indicated cell over you',
    'A dark, often greenish sky; large hail; a wall cloud or funnel',
    'A loud continuous roar like a freight train that does not fade',
    'A sudden calm or wind shift after a thunderstorm, or debris falling from the sky',
  ],
  prepare: [
    { label: 'Identify your safe room now', detail: 'Lowest floor, interior room, no windows — a basement, storm cellar, or an interior bathroom/closet.' },
    { label: 'Set up two ways to get warnings', detail: 'A NOAA Weather Radio plus Wireless Emergency Alerts on your phone; do not rely on outdoor sirens indoors.' },
    { label: 'Keep sturdy shoes and a helmet by the safe room', detail: 'Bike or sports helmets sharply cut head-injury risk from flying debris.' },
    { label: 'Practice the drill with everyone in the household', detail: 'Everyone should reach the safe spot in under two minutes.' },
  ],
  during: [
    { label: 'Get to your safe room immediately', detail: 'Do not wait to see it. Put as many walls between you and the outside as possible.' },
    { label: 'Cover your head and neck', detail: 'Get under a sturdy table; cover with a mattress, blankets, or your arms.' },
    { label: 'If in a mobile home, get out', detail: 'Mobile homes offer almost no protection — go to a sturdy building or a designated shelter now.' },
    { label: 'If caught driving, do not shelter under an overpass', detail: 'Overpasses accelerate wind. Either drive at right angles away from the tornado, or leave the car for a low-lying ditch and cover your head.' },
  ],
  after: [
    { label: 'Stay put until the warning is lifted', detail: 'A second tornado can follow the first.' },
    { label: 'Check yourself and others for injuries', detail: 'Give first aid; do not move the seriously injured unless they are in immediate danger.' },
    { label: 'Watch for hazards', detail: 'Downed power lines, gas leaks, broken glass, and unstable structures. Do not enter damaged buildings.' },
    { label: 'Text, do not call', detail: 'Texts get through when networks are congested; conserve phone battery.' },
  ],
  recovery: [
    'Photograph damage before cleanup for insurance claims.',
    'Wear boots and gloves; assume downed lines are live.',
    'Check on neighbors, especially the elderly and those with disabilities.',
    'Only return to a damaged home after officials say it is structurally safe.',
  ],
  mistakes: [
    'Opening windows to "equalize pressure" — it does nothing and wastes life-saving seconds.',
    'Sheltering in a mobile home or vehicle instead of a sturdy structure.',
    'Hiding under a highway overpass, which funnels and speeds up the wind.',
    'Leaving shelter at the first lull — the calm can be the eye or a gap between cells.',
  ],
  checklist: [
    { id: 'tornado.safe_room', label: 'Safe room identified (interior, lowest floor, no windows)', weight: 3 },
    { id: 'tornado.weather_radio', label: 'NOAA Weather Radio or WEA alerts enabled', weight: 3 },
    { id: 'tornado.helmets', label: 'Helmets stored in the safe room', weight: 2 },
    { id: 'tornado.shoes', label: 'Sturdy shoes by the safe room', weight: 1 },
    { id: 'tornado.drill', label: 'Household drill practiced', weight: 2 },
  ],
  relatedGuides: ['severe_thunderstorm', 'shelter_in_place', 'go_bag'],
  sources: ['Ready.gov — Tornadoes', 'NWS — Tornado Safety', 'FEMA P-320 (safe rooms)'],
};
