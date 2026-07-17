import type { SurvivalGuide } from '../guide-types';

export const GO_BAG_GUIDE: SurvivalGuide = {
  id: 'go_bag',
  kind: 'preparedness',
  title: 'Go Bag',
  summary:
    'A pre-packed bag per household member, ready to grab in about sixty seconds when you ' +
    'have to leave immediately. The go bag is not your full emergency kit — it is the ' +
    'minimum to survive the first 72 hours away from home: water, food, medications, light, ' +
    'first aid, and the documents you cannot replace on the way out the door.',
  signs: [
    'An evacuation order or "leave now" alert for your area',
    'A fire, flood, gas leak, or structural threat that makes staying unsafe',
    'A sudden, fast-moving disaster with no time to pack (tornado aftermath, chemical spill, wildfire)',
    'Any moment your family communications or evacuation plan calls for leaving on short notice',
  ],
  prepare: [
    { label: 'Pack one bag per person, sized for them', detail: 'A backpack or rolling bag that the person carrying it can actually manage for a distance, including kids and older adults.' },
    { label: 'Stage bags somewhere you can reach in the dark', detail: 'By the door, in a front closet, or in the car — not in a basement or attic that could be blocked.' },
    { label: 'Rotate perishables on a schedule', detail: 'Check food, water, medications, and batteries every six months; put a reminder on the calendar.' },
    { label: 'Pack for your actual household', detail: 'Infant formula and diapers, pet food and a leash, extra eyeglasses, and any medical equipment specific to your family.' },
  ],
  during: [
    { label: 'Grab the bag, do not stop to pack', detail: 'The whole point of the go bag is that the decision was already made — do not waste evacuation time repacking.' },
    { label: 'Grab people, pets, and the bag, in that order', detail: 'The bag is the last thing you pick up on the way out, never the reason you delay leaving.' },
    { label: 'Put on sturdy shoes before you go', detail: 'Debris, glass, and rough terrain are common in evacuation routes — do not leave in sandals.' },
    { label: 'Take the bag with you, not to a neighbor\'s or a different vehicle', detail: 'Keep it in reach for the entire trip in case you have to move again.' },
  ],
  after: [
    { label: 'Replenish anything used or opened', detail: 'Water, snacks, and first-aid supplies used during the event need replacing before the bag goes back into storage.' },
    { label: 'Check expiration dates before restaging', detail: 'Food, water, medications, and batteries degrade — do not restage a bag with expired contents.' },
    { label: 'Debrief what was missing', detail: 'Note anything you wished you had and add it before the next event.' },
  ],
  recovery: [
    'Restock consumables and replace anything damaged in transit.',
    'Update copies of documents if anything changed (new insurance policy, new prescriptions).',
    'Re-verify every household member still knows where their bag is staged.',
  ],
  mistakes: [
    'Packing the bag once and never checking it again — food spoils, batteries die, meds expire.',
    'Making the bag too heavy to actually carry for a mile.',
    'Storing it somewhere that could itself become inaccessible (locked car, blocked basement).',
    'Forgetting copies of ID, insurance, and medical documents — originals should stay secured elsewhere, but copies belong in the bag.',
    'No plan for pets, infants, or household members with specific medical needs.',
  ],
  checklist: [
    { id: 'go_bag.water_3day', label: '3-day supply of water (1 gal/person/day)', weight: 3 },
    { id: 'go_bag.food', label: 'Non-perishable, no-prep food for 3 days', weight: 3 },
    { id: 'go_bag.medications', label: 'Prescription medications + list of dosages', weight: 3 },
    { id: 'go_bag.flashlight', label: 'Flashlight + spare batteries', weight: 2 },
    { id: 'go_bag.first_aid', label: 'First-aid kit', weight: 2 },
    { id: 'go_bag.phone_charger', label: 'Phone charger / portable battery pack', weight: 2 },
    { id: 'go_bag.cash', label: 'Cash in small bills', weight: 2 },
    { id: 'go_bag.documents', label: 'Copies of ID, insurance, and medical documents', weight: 2 },
    { id: 'go_bag.masks', label: 'N95 masks', weight: 1 },
    { id: 'go_bag.whistle', label: 'Whistle to signal for help', weight: 1 },
    { id: 'go_bag.radio', label: 'Battery or hand-crank weather radio', weight: 2 },
    { id: 'go_bag.shoes', label: 'Sturdy shoes and a change of clothes', weight: 1 },
    { id: 'go_bag.blanket', label: 'Emergency blanket', weight: 1 },
  ],
  relatedGuides: ['evacuation_planning', 'water_storage', 'first_aid_basics'],
  sources: ['Ready.gov — Build A Kit', 'FEMA', 'American Red Cross'],
};
