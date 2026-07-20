import type { SurvivalGuide } from '../guide-types';

export const FOOD_STORAGE_GUIDE: SurvivalGuide = {
  id: 'food_storage',
  kind: 'preparedness',
  title: 'Food Storage',
  summary:
    'A two-week supply of shelf-stable, calorie-dense food that needs little or no water, ' +
    'power, or cooking. The goal is food you can actually eat during an outage — not a ' +
    'pantry of goods that all need a working stove, refrigeration, or water you may not ' +
    'have to spare.',
  signs: [
    'A utility, water, or supply-chain disruption warning for your area',
    'A storm, winter-storm, or evacuation-adjacent alert that could keep you home-bound',
    'Grocery shortages or panic-buying reports for staples in your region',
    'Your pantry has less than two weeks of food that needs no power or extra water',
  ],
  prepare: [
    { label: 'Build to a two-week supply of shelf-stable food', detail: 'Canned goods, dried staples, nut butters, crackers, and ready-to-eat items that store at room temperature.' },
    { label: 'Favor low-prep, low-water foods', detail: 'You may not have power to cook or water to spare — pick items that are edible straight from the container if needed.' },
    { label: 'Keep a manual can opener with the food, not just the drawer', detail: 'An electric opener is useless without power; store a manual one directly with the stockpile.' },
    { label: 'Plan for every diet in the household', detail: 'Infant formula, pet food, and anyone\'s medical or allergy-driven diet needs its own dedicated stock — it will not appear in a generic kit.' },
  ],
  during: [
    { label: 'Eat perishable and refrigerated food first', detail: 'Once power is out, use what will spoil soonest before opening the shelf-stable reserve.' },
    { label: 'Ration by days remaining, not appetite', detail: 'Estimate how long the outage might run and pace consumption against it.' },
    { label: 'Skip foods that make you thirstier if water is limited', detail: 'Very salty or dry foods increase water needs — weigh that against your water supply.' },
    { label: 'Keep the manual can opener and utensils with the stock', detail: 'Confirm you can actually access and open everything you packed.' },
  ],
  after: [
    { label: 'Check for spoilage before eating anything that lost refrigeration', detail: 'When in doubt, throw it out — food-borne illness is a real risk after an outage.' },
    { label: 'Restock what you consumed', detail: 'Replace opened and eaten items before considering the kit ready again.' },
  ],
  recovery: [
    'Rotate stock on a FIFO (first-in, first-out) basis so nothing quietly expires unused.',
    'Re-check expiration dates every six months and swap anything approaching its date into regular meals.',
    'Adjust the mix based on what you actually reached for during the event.',
  ],
  mistakes: [
    'Stocking food that requires cooking or water you won\'t have during a power or water outage.',
    'Forgetting the manual can opener — a cabinet full of cans is useless without one.',
    'No plan for infants, pets, or medically restricted diets in the household.',
    'Letting the stockpile sit untouched for years until it\'s all expired at once.',
  ],
  checklist: [
    { id: 'food_storage.2week_supply', label: '2-week shelf-stable food supply', weight: 3 },
    { id: 'food_storage.can_opener', label: 'Manual can opener stored with the food', weight: 3 },
    { id: 'food_storage.fifo_rotation', label: 'FIFO rotation labels / dates tracked', weight: 2 },
    { id: 'food_storage.special_diet', label: 'Infant, pet, and special-diet food covered', weight: 2 },
  ],
  relatedGuides: ['water_storage', 'food_shortage'],
  sources: ['Ready.gov — Food', 'USDA', 'FEMA'],
};
