import type { SurvivalGuide } from '../guide-types';

export const CIVIL_UNREST_GUIDE: SurvivalGuide = {
  id: 'civil_unrest',
  kind: 'hazard',
  title: 'Civil Unrest',
  summary:
    'Large-scale protests, demonstrations, or disorder that can turn unpredictable and ' +
    'block roads, disrupt services, or become confrontational with little warning. The ' +
    'goal is distance, not engagement: avoid crowds, know two ways home, and leave early ' +
    'if a gathering starts to feel unsafe. Documents, a go-bag, and a reliable information ' +
    'source do most of the work in advance.',
  signs: [
    'Official alerts, curfews, or road closures announced for your area',
    'A large demonstration or crowd forming near your planned route or location',
    'Local news or official channels reporting escalation, property damage, or clashes nearby',
    'A noticeable increase in police, emergency vehicle, or helicopter activity in your area',
  ],
  prepare: [
    { label: 'Know two exit routes home from work, school, and common destinations', detail: 'A single route can become blocked by a crowd, police cordon, or road closure — always have a backup.' },
    { label: 'Keep a go-bag ready', detail: 'Documents, medication, cash, chargers, and essentials packed so you can move quickly if needed.' },
    { label: 'Copy and secure important documents', detail: 'ID, insurance, and financial documents — physically and digitally backed up in case you need to leave in a hurry.' },
    { label: 'Bookmark a local news and official alert source', detail: 'Verified local reporting and official channels beat social media rumor for real-time accuracy.' },
  ],
  during: [
    { label: 'Avoid crowds and demonstrations, even ones that start peacefully', detail: 'Gatherings can turn unpredictable quickly; the safest move is simply not being there.' },
    { label: 'Leave early if a crowd starts forming or the mood shifts', detail: 'Don\'t wait to see how it develops — move away from the core while exits are still open.' },
    { label: 'Take a route around, not through, an active gathering', detail: 'Use your second route home rather than trying to push through.' },
    { label: 'Don\'t film confrontations up close', detail: 'Getting close for footage puts you inside the risk zone; observe and move away instead.' },
  ],
  after: [
    { label: 'If caught in a crowd, move calmly toward the edge, away from the core', detail: 'Avoid sudden movements or running, which can trigger panic in a dense crowd — walk purposefully to the perimeter.' },
    { label: 'Seek a safe building if you can\'t exit the area', detail: 'A store, lobby, or other accessible building is safer than remaining in an open crowd.' },
    { label: 'Follow official guidance on curfews and closures', detail: 'Confirm current restrictions before heading back out.' },
  ],
  recovery: [
    'Check on family and coworkers to confirm everyone made it home safely.',
    'Report any property damage or personal injury through proper channels.',
  ],
  mistakes: [
    'Walking into a demonstration to see what\'s happening "just to look."',
    'Waiting to see if things escalate instead of leaving while exits are open.',
    'Filming confrontations at close range instead of moving to safety.',
    'Having only one route planned home, with no alternative if it\'s blocked.',
  ],
  checklist: [
    { id: 'civil_unrest.two_routes', label: 'Two exit routes home known', weight: 3 },
    { id: 'civil_unrest.go_bag', label: 'Go-bag ready', weight: 2 },
    { id: 'civil_unrest.documents', label: 'Documents copied/secured', weight: 2 },
    { id: 'civil_unrest.info_source', label: 'Local news + official alert source known', weight: 1 },
  ],
  relatedGuides: ['evacuation_planning', 'go_bag', 'shelter_in_place'],
  sources: ['US State Department — Traveler Guidance', 'Ready.gov', 'ICRC — Civilian Safety Guidance'],
};
