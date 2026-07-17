import type { SurvivalGuide } from '../guide-types';

export const EARTHQUAKE_GUIDE: SurvivalGuide = {
  id: 'earthquake',
  kind: 'hazard',
  title: 'Earthquake',
  summary:
    'Sudden, often violent ground shaking with no advance warning. Most earthquake ' +
    'injuries come from falling and flying objects, not collapsing buildings — "Drop, ' +
    'Cover, and Hold On" protects against both. Aftershocks can follow for hours or days, ' +
    'and near a coastline, strong or long shaking is itself the tsunami warning.',
  signs: [
    'Sudden, unexpected ground shaking — earthquakes give no advance warning',
    'A ShakeAlert or similar early-warning notification (seconds of lead time where available)',
    'Rolling or jolting motion, rattling windows/dishes, or a rumbling sound',
    'Near the coast: strong or long-lasting shaking is itself the signal to move to high ground for tsunami risk',
  ],
  prepare: [
    { label: 'Anchor heavy furniture, shelving, and water heaters', detail: 'Tip-overs and falling objects cause most earthquake injuries — secure bookcases, TVs, and cabinets to wall studs.' },
    { label: 'Identify Drop-Cover-Hold spots in every room you spend time in', detail: 'Under a sturdy table or against an interior wall, away from windows and tall furniture.' },
    { label: 'Store water and supplies for at least a week', detail: 'Water and gas lines can be disrupted for days; municipal water may be unsafe to drink.' },
    { label: 'Keep sturdy shoes and a flashlight by the bed', detail: 'Broken glass on the floor is common after shaking — you\'ll need to move safely in the dark.' },
  ],
  during: [
    { label: 'Drop, Cover, and Hold On', detail: 'Drop to hands and knees, take cover under a sturdy table, and hold on until shaking stops. Do this immediately — do not wait to assess.' },
    { label: 'Do not run outside during shaking', detail: 'Most injuries happen from falling objects and debris encountered while moving; stay put and protect your head and neck.' },
    { label: 'If in bed, stay there and cover your head with a pillow', detail: 'Getting up and moving in the dark during shaking raises injury risk more than staying put.' },
    { label: 'If driving, pull over away from overpasses, bridges, and power lines and stop', detail: 'Stay in the vehicle with your seatbelt on until shaking stops.' },
  ],
  after: [
    { label: 'Expect aftershocks and be ready to Drop, Cover, Hold On again', detail: 'Aftershocks can be strong enough to cause additional damage or injury.' },
    { label: 'Near the coast, move to high ground immediately if shaking was strong or long', detail: 'Do not wait for an official tsunami warning if the shaking itself was severe — get inland/uphill.' },
    { label: 'Check for gas leaks, damage, and injuries before using electricity or open flame', detail: 'If you smell gas, shut off the supply and leave the building; do not use a lighter or switch to check.' },
    { label: 'Stay out of damaged buildings', detail: 'Structural damage may not be visible from a quick look — treat any building with visible cracking as unsafe until inspected.' },
  ],
  recovery: [
    'Have a professional inspect your home\'s structure, gas, and utility lines before resuming normal use.',
    'Check on neighbors, especially elderly or disabled residents who may need help.',
    'Document damage with photos before cleanup for insurance claims.',
    'Restock any supplies used and reassess furniture anchoring after the event.',
  ],
  mistakes: [
    'Running outside during shaking instead of dropping and taking cover immediately.',
    'Standing in a doorway — modern doorways are not stronger than the rest of the structure.',
    'Using a lighter, match, or electrical switch to check for a gas leak.',
    'Assuming it\'s over after the first jolt and not preparing for aftershocks.',
  ],
  checklist: [
    { id: 'earthquake.anchored_furniture', label: 'Heavy furniture and water heater anchored', weight: 3 },
    { id: 'earthquake.safe_spots', label: 'Drop-Cover-Hold spots known in each room', weight: 2 },
    { id: 'earthquake.water_stored', label: 'Water stored for 7+ days', weight: 2 },
    { id: 'earthquake.bedside_kit', label: 'Sturdy shoes and flashlight by the bed', weight: 1 },
  ],
  relatedGuides: ['shelter_in_place', 'water_storage', 'go_bag'],
  sources: ['Ready.gov — Earthquakes', 'USGS — Earthquake Safety', 'FEMA / Great ShakeOut'],
};
