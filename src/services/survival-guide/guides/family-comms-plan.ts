import type { SurvivalGuide } from '../guide-types';

export const FAMILY_COMMS_PLAN_GUIDE: SurvivalGuide = {
  id: 'family_comms_plan',
  kind: 'preparedness',
  title: 'Family Communications Plan',
  summary:
    'A simple, rehearsed plan for how your household finds and reaches each other when ' +
    'local phone lines are jammed and everyone is not together. An out-of-area contact and ' +
    'two agreed meeting places turn a chaotic scramble into a plan everyone already knows, ' +
    'even if cell towers are overloaded or a phone is lost.',
  signs: [
    'A disaster strikes while the household is split across school, work, and home',
    'Local cell networks are congested or down after a major event',
    'An evacuation order requires the household to leave from different locations',
    'You realize you have no agreed way to find each other if separated',
  ],
  prepare: [
    { label: 'Choose an out-of-area contact', detail: 'Local calls often fail to connect during a disaster while a single long-distance call or text to someone outside the area gets through — pick a relative or friend in another region.' },
    { label: 'Make sure everyone has the contact memorized or carries it', detail: 'A card in every wallet, backpack, and go bag, plus saved in every phone under a clearly labeled entry.' },
    { label: 'Agree on two meeting places', detail: 'One right outside the home for a sudden local emergency (fire, gas leak), one outside the neighborhood in case you cannot return home at all.' },
    { label: 'Learn your kids\' school and your workplace\'s reunification plan', detail: 'Know exactly how and where the school or employer will release people to family so you are not working from guesses.' },
  ],
  during: [
    { label: 'Text before you call', detail: 'Text messages use less bandwidth and often get through when voice networks are jammed; they also queue and deliver once a connection opens.' },
    { label: 'Contact the out-of-area person and report status', detail: 'Have every household member check in with the same contact so information funnels to one place instead of everyone trying to reach each other directly.' },
    { label: 'Go to the agreed meeting place if you cannot communicate', detail: 'If phones are down entirely, the pre-agreed meeting place is the fallback plan — go there and wait.' },
    { label: 'Conserve phone battery', detail: 'Lower screen brightness, close unused apps, and limit calls once you\'ve sent your status update.' },
  ],
  after: [
    { label: 'Confirm everyone has been accounted for', detail: 'Do not stand down until every household member has checked in with the out-of-area contact or reached a meeting place.' },
    { label: 'Update the out-of-area contact on your ongoing status', detail: 'They can relay information to other worried relatives so you\'re not fielding repeated calls.' },
  ],
  recovery: [
    'Debrief what worked and what didn\'t — update the contact card if anyone\'s number changed.',
    'Re-confirm the meeting places are still viable (a location may itself be damaged or inaccessible).',
    'Re-share the plan with anyone who joined the household since it was last reviewed.',
  ],
  mistakes: [
    'Assuming everyone will just "figure it out" — without a plan, people default to converging on the last-known location, which may be unsafe or unreachable.',
    'Choosing an in-area contact, defeating the point of routing around jammed local lines.',
    'Never telling kids or older relatives the plan, so only one person in the household actually knows it.',
    'Trying to call repeatedly instead of texting once local networks are saturated.',
  ],
  checklist: [
    { id: 'family_comms_plan.out_of_area_contact', label: 'Out-of-area contact chosen and shared with everyone', weight: 3 },
    { id: 'family_comms_plan.meeting_places', label: 'Two meeting places agreed (near-home + out-of-neighborhood)', weight: 3 },
    { id: 'family_comms_plan.contact_card', label: 'Contact card in every go bag and wallet', weight: 2 },
    { id: 'family_comms_plan.reunification', label: 'School/work reunification plans known', weight: 2 },
  ],
  relatedGuides: ['evacuation_planning', 'go_bag', 'armed_conflict'],
  sources: ['Ready.gov — Make A Plan', 'FEMA', 'American Red Cross'],
};
