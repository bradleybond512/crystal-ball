import type { SurvivalGuide } from '../guide-types';

export const ARMED_CONFLICT_GUIDE: SurvivalGuide = {
  id: 'armed_conflict',
  kind: 'hazard',
  title: 'Armed Conflict',
  summary:
    'Military action, cross-border conflict, or armed violence affecting your area. The ' +
    'central decision is shelter-in-place versus evacuate, and it should follow official ' +
    'guidance and your read of your own safety — not guesswork made under pressure. ' +
    'Prepare both paths in advance: a strong interior shelter and a ready go-bag with an ' +
    'evacuation route, plus a family reunification plan in case you\'re separated.',
  signs: [
    'Official warnings, sirens, or alerts indicating military activity or attack risk in your area',
    'Sustained sounds of explosions, gunfire, or aircraft activity nearby',
    'Government or embassy guidance advising shelter-in-place or evacuation',
    'Sudden disruption to communications, power, or transportation tied to conflict activity',
  ],
  prepare: [
    { label: 'Keep a go-bag, documents, cash, and medication ready', detail: 'Pack for both scenarios — a quick evacuation or an extended shelter period — and keep it current.' },
    { label: 'Identify the strongest interior shelter available to you', detail: 'Below grade if possible, away from windows and exterior walls, with the most mass between you and the outside.' },
    { label: 'Build a family reunification plan and an out-of-area contact', detail: 'Agree on meeting points and a single out-of-area contact everyone can reach if local communications fail.' },
    { label: 'Prepare both an evacuation route and a shelter-in-place plan', detail: 'Which one you use depends on official guidance and real-time conditions — don\'t commit to only one in advance.' },
  ],
  during: [
    { label: 'Follow official guidance on shelter-in-place versus evacuate', detail: 'This decision should come from authorities and your direct read of the situation, not assumption.' },
    { label: 'If sheltering, move to your strongest interior space immediately', detail: 'Away from windows and exterior walls; stay low and keep the go-bag and documents with you.' },
    { label: 'If evacuating, leave early on official routes', detail: 'Move before roads become congested or blocked; avoid areas of active or reported fighting.' },
    { label: 'Stay off the phone except for brief, essential communication', detail: 'Preserve battery and network capacity for emergency use; use text over calls where possible.' },
  ],
  after: [
    { label: 'Wait for official confirmation before leaving shelter', detail: 'A pause in activity does not mean it\'s over — confirm with authorities before moving.' },
    { label: 'Execute your family reunification plan if separated', detail: 'Go to the agreed meeting point or contact the designated out-of-area contact.' },
    { label: 'Avoid unexploded ordnance, damaged structures, and unfamiliar debris', detail: 'Do not touch or approach anything that could be unexploded ordnance — report it and stay clear.' },
  ],
  recovery: [
    'Follow official guidance on when and how it is safe to resume normal activity.',
    'Seek support for anyone affected — conflict exposure carries a significant psychological toll.',
    'Restock go-bag supplies and documents in case conditions deteriorate again.',
  ],
  mistakes: [
    'Delaying a decision between sheltering and evacuating until conditions force a worse choice.',
    'Choosing a shelter spot near windows or exterior walls.',
    'Having no agreed reunification point if the household gets separated.',
    'Approaching or touching unfamiliar debris that could be unexploded ordnance.',
  ],
  checklist: [
    { id: 'armed_conflict.go_bag_docs_cash', label: 'Go-bag, documents, and cash ready', weight: 3 },
    { id: 'armed_conflict.shelter_identified', label: 'Strongest interior shelter identified', weight: 3 },
    { id: 'armed_conflict.reunification_plan', label: 'Family reunification plan set', weight: 2 },
    { id: 'armed_conflict.out_of_area_contact', label: 'Out-of-area contact designated', weight: 2 },
    { id: 'armed_conflict.dual_plan', label: 'Both evacuation and shelter-in-place plans prepared', weight: 3 },
  ],
  relatedGuides: ['shelter_in_place', 'evacuation_planning', 'go_bag', 'nuclear_radiological', 'family_comms_plan'],
  sources: ['ICRC — Civilian Protection Guidance', 'Ready.gov', 'FEMA'],
};
