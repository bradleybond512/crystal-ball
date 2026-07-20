import type { SurvivalGuide } from '../guide-types';

export const NUCLEAR_RADIOLOGICAL_GUIDE: SurvivalGuide = {
  id: 'nuclear_radiological',
  kind: 'hazard',
  title: 'Nuclear / Radiological Incident',
  summary:
    'A nuclear detonation or radiological release requires a specific, counterintuitive ' +
    'response: "Get Inside, Stay Inside, Stay Tuned." Put as much mass and distance between ' +
    'yourself and fallout as possible — a basement or the center of a large building is far ' +
    'safer than a car or the open. Removing and bagging outer clothing, then washing, removes ' +
    'most surface contamination. Shelter for at least 24 hours, longer if officials direct, ' +
    'and do not take potassium iodide unless public-health officials specifically instruct you to.',
  signs: [
    'Official alert of a nuclear detonation, radiological release, or attack warning for your area',
    'A visible flash or blast in the distance — if outside, take cover immediately rather than watching',
    'Emergency alert instructing you to shelter in place due to radiological hazard',
    'Elevated radiation readings reported by official monitoring sources',
  ],
  prepare: [
    { label: 'Identify your nearest sturdy or below-grade shelter now', detail: 'A basement or the center of a large multi-story building offers far more shielding than a house\'s ground floor or a vehicle.' },
    { label: 'Store sealed water and food in or near that shelter', detail: 'You may need to remain sheltered for 24 hours or longer — enough sealed supplies removes the need to go back outside.' },
    { label: 'Keep a battery or hand-crank radio available', detail: 'Official instructions will come via broadcast — cell networks may be degraded or overloaded.' },
    { label: 'Plan to shelter for 24 hours or more', detail: 'Fallout radiation decays rapidly at first but remains dangerous — plan for an extended stay, not a quick check.' },
  ],
  during: [
    { label: 'Get inside the sturdiest, most below-grade shelter available immediately', detail: 'If caught outside, take cover in the nearest solid building right away rather than trying to get somewhere better.' },
    { label: 'Remove outer clothing and bag it, then wash exposed skin', detail: 'This single step removes the large majority of surface contamination — do it as soon as you\'re inside.' },
    { label: 'Stay inside and stay tuned to official broadcasts', detail: 'Do not leave shelter based on guesswork — wait for official instructions on when it\'s safe.' },
    { label: 'Do not take potassium iodide unless told to by public-health officials', detail: 'It protects only the thyroid from a specific isotope and can cause harm if taken unnecessarily or at the wrong time.' },
  ],
  after: [
    { label: 'Remain sheltered until officials say it is safe to leave', detail: 'Fallout intensity drops significantly in the first 24-48 hours but can still be hazardous — don\'t leave early.' },
    { label: 'Follow official guidance on food and water safety', detail: 'Officials will direct which local supplies are safe versus contaminated.' },
    { label: 'Continue monitoring official broadcasts for updated instructions', detail: 'Guidance will evolve as the situation is assessed — don\'t rely on early information alone.' },
  ],
  recovery: [
    'Follow official decontamination and medical guidance before resuming normal activity.',
    'Seek medical evaluation if you were outside during or shortly after the event.',
    'Restock shelter supplies for any future incident.',
  ],
  mistakes: [
    'Going outside to look at a flash or blast instead of taking cover immediately.',
    'Trying to evacuate by car through fallout instead of sheltering in the nearest sturdy building.',
    'Taking potassium iodide without official direction.',
    'Leaving shelter early because conditions "seem calm."',
  ],
  checklist: [
    { id: 'nuclear_radiological.shelter_identified', label: 'Nearest sturdy/below-grade shelter known', weight: 3 },
    { id: 'nuclear_radiological.sealed_supplies', label: 'Sealed water and food in the shelter', weight: 3 },
    { id: 'nuclear_radiological.radio', label: 'Battery or hand-crank radio available', weight: 2 },
    { id: 'nuclear_radiological.shelter_duration_plan', label: 'Plan to shelter 24h+ understood', weight: 2 },
    { id: 'nuclear_radiological.sealing_supplies', label: 'Shelter-in-place sealing supplies ready', weight: 1 },
  ],
  relatedGuides: ['shelter_in_place', 'armed_conflict', 'water_storage'],
  sources: ['Ready.gov — Nuclear Explosion', 'CDC — Radiation Emergencies', 'FEMA'],
};
