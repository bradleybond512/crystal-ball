import type { SurvivalGuide } from '../guide-types';

export const EVACUATION_PLANNING_GUIDE: SurvivalGuide = {
  id: 'evacuation_planning',
  kind: 'preparedness',
  title: 'Evacuation Planning',
  summary:
    'A pre-decided plan for leaving quickly and safely when officials or conditions demand ' +
    'it. The single biggest failure mode is having only one route in mind — highways jam or ' +
    'close during real evacuations, so a workable plan always has a second way out, a full ' +
    'enough tank to use it, and an agreed destination so the household doesn\'t scatter.',
  signs: [
    'An evacuation order, warning, or recommendation for your zone',
    'A wildfire, hurricane, flood, or hazardous-materials event bearing down on your area',
    'Your primary route shows as blocked, jammed, or already closed',
    'You have never actually mapped a second way out of your area',
  ],
  prepare: [
    { label: 'Know your evacuation zone', detail: 'Many hazard-prone areas are pre-mapped into zones (coastal, wildfire, flood) — know which one you\'re in and what triggers an order for it.' },
    { label: 'Map two routes out, not one', detail: 'Primary routes jam or close during real evacuations — identify a genuinely different second route in advance.' },
    { label: 'Keep the fuel tank above half', detail: 'Gas stations lose power or run out during evacuations — never plan to fill up on the way out.' },
    { label: 'Plan for pets and anyone with mobility needs', detail: 'Confirm carriers, ramps, or transport arrangements ahead of time — this cannot be improvised at the last minute.' },
    { label: 'Agree on a destination and check-in plan with your household', detail: 'Coordinate with the family communications plan so everyone converges on the same place.' },
  ],
  during: [
    { label: 'Leave as early as conditions and orders allow', detail: 'Waiting until the last minute puts you in the worst traffic and the highest-risk window.' },
    { label: 'Grab your go bag and key documents on the way out', detail: 'These should already be staged and ready — don\'t stop to search for them.' },
    { label: 'Take the route officials recommend, or your pre-planned alternate if it\'s blocked', detail: 'Don\'t improvise a new route under stress — use the one you already mapped.' },
    { label: 'Bring pets and anyone with mobility needs with you', detail: 'Do not leave them behind expecting to return — re-entry may not be allowed.' },
    { label: 'Tell your out-of-area contact you\'re leaving and where you\'re headed', detail: 'Keeps the household communications plan working even while you\'re en route.' },
  ],
  after: [
    { label: 'Do not return until officials confirm it\'s safe', detail: 'Re-entry too early risks downed lines, gas leaks, unstable structures, or a resurgence of the hazard.' },
    { label: 'Check in with your out-of-area contact and household', detail: 'Confirm everyone made it to the agreed destination safely.' },
  ],
  recovery: [
    'Debrief the route: was it actually clear, or did you need the alternate?',
    'Refuel and restock the go bag before the next event.',
    'Update the plan if your zone, household, or vehicle situation has changed.',
  ],
  mistakes: [
    'Only knowing one route out — the exact route most likely to be jammed or closed during a real event.',
    'Waiting to see how bad it gets before leaving, and evacuating into the worst of the traffic.',
    'Letting the gas tank run low as routine and hoping to fill up during the evacuation.',
    'No plan for pets or mobility-limited family members, forcing an impossible choice at the door.',
  ],
  checklist: [
    { id: 'evacuation_planning.two_routes', label: 'Two evacuation routes identified', weight: 3 },
    { id: 'evacuation_planning.go_bag_ready', label: 'Go bag + documents staged and ready', weight: 3 },
    { id: 'evacuation_planning.pet_mobility_plan', label: 'Pet / mobility-needs transport plan', weight: 2 },
    { id: 'evacuation_planning.half_tank', label: 'Keep-tank-above-half habit', weight: 1 },
    { id: 'evacuation_planning.destination_agreed', label: 'Destination + contact plan agreed', weight: 2 },
  ],
  relatedGuides: ['go_bag', 'family_comms_plan', 'wildfire', 'hurricane'],
  sources: ['Ready.gov — Evacuation', 'FEMA'],
};
