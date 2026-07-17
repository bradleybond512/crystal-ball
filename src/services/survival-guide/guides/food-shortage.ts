import type { SurvivalGuide } from '../guide-types';

export const FOOD_SHORTAGE_GUIDE: SurvivalGuide = {
  id: 'food_shortage',
  kind: 'hazard',
  title: 'Food Shortage',
  summary:
    'A disruption to the food supply chain — from a weather event, transport chokepoint, ' +
    'or broader shortage — that thins grocery shelves for days to weeks. The fix is a ' +
    'gradually built, non-perishable pantry, not a panic-buying trip when shelves are ' +
    'already thin. Build it calmly, rotate it, and account for anyone in the household ' +
    'with special dietary needs.',
  signs: [
    'News reports or official guidance about supply chain disruption affecting food distribution',
    'Visibly thinning shelves or purchase limits appearing at local grocery stores',
    'A regional event (storm, transport disruption, commodity shortage) known to affect your supply chain',
    'Rising prices on staple goods over a short period',
  ],
  prepare: [
    { label: 'Build a 2-week non-perishable food supply gradually', detail: 'Add a little extra to each regular grocery trip rather than panic-buying all at once — canned goods, rice, pasta, shelf-stable proteins.' },
    { label: 'Keep a manual can opener with the supply', detail: 'A powered can opener is useless in a combined power/food disruption.' },
    { label: 'Set up FIFO rotation', detail: 'First in, first out — label dates and use older stock first so nothing silently expires.' },
    { label: 'Account for special diets, allergies, infants, and pets', detail: 'Formula, allergy-safe alternatives, and pet food are easy to forget until you actually need them.' },
  ],
  during: [
    { label: 'Buy only what you need, not everything you can find', detail: 'Panic buying is what turns a manageable shortage into empty shelves for everyone, including people who need specific items most.' },
    { label: 'Draw down your stored pantry before making shortage-driven trips', detail: 'This is exactly what the 2-week supply is for — use it to avoid competing for scarce shelf stock.' },
    { label: 'Prioritize perishables you can still get locally', detail: 'Fresh food availability often recovers before packaged-goods supply chains catch up — don\'t stockpile what you can buy fresh.' },
  ],
  after: [
    { label: 'Restock gradually as supply normalizes', detail: 'Avoid contributing to a second wave of shortage by buying calmly over several trips.' },
    { label: 'Rotate and replace anything used from the emergency supply', detail: 'Keep the 2-week pantry topped off for the next disruption.' },
  ],
  recovery: [
    'Check expiration dates across the pantry and rotate stock that\'s nearing its date.',
    'Reassess quantities for household changes — a new child, pet, or dietary need.',
  ],
  mistakes: [
    'Waiting until shelves are already thin to start building a supply.',
    'Buying far more than needed, worsening the shortage for others.',
    'Forgetting a manual can opener, infant formula, or pet food in the emergency stock.',
    'Letting stored food sit unrotated until it expires unnoticed.',
  ],
  checklist: [
    { id: 'food_shortage.two_week_supply', label: '2-week non-perishable supply on hand', weight: 3 },
    { id: 'food_shortage.can_opener', label: 'Manual can opener with the supply', weight: 1 },
    { id: 'food_shortage.fifo', label: 'FIFO rotation system in place', weight: 1 },
    { id: 'food_shortage.special_needs', label: 'Special-diet/infant/pet food stocked', weight: 2 },
  ],
  relatedGuides: ['water_storage', 'food_storage'],
  sources: ['Ready.gov — Food', 'USDA', 'FEMA'],
};
