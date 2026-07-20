import type { SurvivalGuide } from '../guide-types';

export const SHELTER_IN_PLACE_GUIDE: SurvivalGuide = {
  id: 'shelter_in_place',
  kind: 'preparedness',
  title: 'Shelter in Place',
  summary:
    'When the danger is outside — contaminated air, a chemical release, or an active threat ' +
    '— the right move is often to get in, seal up, and tune in rather than evacuate into the ' +
    'hazard. Pick an interior room in advance, know how to seal it quickly, and keep the ' +
    'basics to wait it out staged inside. Shelter-in-place is temporary, lasting until ' +
    'officials say it is safe to leave.',
  signs: [
    'An official shelter-in-place order for your area',
    'A chemical spill, industrial release, or hazardous plume reported nearby',
    'Wildfire smoke or poor air quality making outdoor air more dangerous than staying inside',
    'An active-threat situation where movement outside is more dangerous than staying put',
  ],
  prepare: [
    { label: 'Choose your interior shelter room now', detail: 'An above-ground interior room with the fewest windows and doors — easier to seal and defend than a room with lots of openings.' },
    { label: 'Keep sealing supplies with the room', detail: 'Plastic sheeting and duct tape pre-cut or staged nearby so you\'re not searching for them under pressure.' },
    { label: 'Stage water, food, and sanitation supplies in or near the room', detail: 'Enough for several hours to a day — you may not be able to leave the room once sealed.' },
    { label: 'Keep a battery or hand-crank radio in the room', detail: 'Cell networks can be unreliable during major events — a radio keeps you connected to official updates without draining your phone.' },
  ],
  during: [
    { label: 'Get inside immediately and bring pets with you', detail: 'Do not go outside to search for anyone or anything once an order is given — get everyone already home inside now.' },
    { label: 'Go to your interior room and close all doors and windows', detail: 'Turn off any air intake — HVAC systems, exhaust fans, and window units — that could pull outside air in.' },
    { label: 'Seal gaps with plastic sheeting and tape', detail: 'Cover windows, door seams, and vents in the shelter room to minimize outside air infiltration.' },
    { label: 'Monitor official channels, do not rely on rumors', detail: 'Use your radio or phone alerts for the "all clear" — do not leave based on guesswork or what neighbors are doing.' },
  ],
  after: [
    { label: 'Wait for the official all-clear before unsealing or leaving', detail: 'Leaving early can expose you to a hazard that hasn\'t actually dissipated yet.' },
    { label: 'Ventilate the space once cleared', detail: 'Open windows and run fans briefly to clear any residual air before resuming normal use of the room.' },
  ],
  recovery: [
    'Restock any water, food, or sanitation supplies used during the sheltering period.',
    'Replace sealing materials (tape loses adhesion, plastic sheeting tears) so the room is ready again.',
    'Review whether the room and supplies actually covered the duration — adjust if it fell short.',
  ],
  mistakes: [
    'Evacuating into an outdoor hazard instead of sheltering when officials have said to stay in place.',
    'Choosing a room with many windows or an exterior wall shared with a garage that vents outside air.',
    'Leaving the HVAC system running, which continues pulling outside air into the home.',
    'Leaving shelter early because it "seems fine" instead of waiting for an official all-clear.',
  ],
  checklist: [
    { id: 'shelter_in_place.room_chosen', label: 'Interior shelter room identified', weight: 3 },
    { id: 'shelter_in_place.sealing_supplies', label: 'Plastic sheeting + tape staged', weight: 2 },
    { id: 'shelter_in_place.radio', label: 'Battery / hand-crank radio in the room', weight: 2 },
    { id: 'shelter_in_place.supplies_staged', label: 'Water, food, and sanitation staged in room', weight: 2 },
    { id: 'shelter_in_place.alert_source', label: 'Official alert source known (WEA, NOAA radio)', weight: 1 },
  ],
  relatedGuides: ['nuclear_radiological', 'wildfire_smoke', 'disease_outbreak'],
  sources: ['Ready.gov — Shelter', 'CDC', 'FEMA'],
};
