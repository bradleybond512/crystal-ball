import type { SurvivalGuide } from '../guide-types';

export const WATER_STORAGE_GUIDE: SurvivalGuide = {
  id: 'water_storage',
  kind: 'preparedness',
  title: 'Water Storage',
  summary:
    'Clean water is the single most time-critical supply — a person can go days without ' +
    'food but only about three days without water, less in heat or if sick. Plan on one ' +
    'gallon per person per day for drinking and basic hygiene, three days minimum and two ' +
    'weeks as the target, plus a known way to disinfect more if the outage runs long.',
  signs: [
    'A boil-water notice or water-main break in your area',
    'Utility outage that could affect water treatment or pumping',
    'A storm, flood, or earthquake warning that could disrupt the water system',
    'Your stored supply is low, expired, or was never actually set aside',
  ],
  prepare: [
    { label: 'Store one gallon per person per day', detail: 'Half for drinking, half for cooking and hygiene; add more for pets, nursing mothers, and hot climates.' },
    { label: 'Build toward a two-week supply', detail: 'Three days covers most short outages, but longer disruptions are common — two weeks is the resilient target.' },
    { label: 'Use food-grade containers only', detail: 'Commercially bottled water, or containers specifically rated food-grade — never reuse milk jugs or containers that held chemicals.' },
    { label: 'Know your disinfection method before you need it', detail: 'Boiling one minute (three at high altitude), or unscented household bleach at the ratio on the label — practice it once so it is not new under stress.' },
  ],
  during: [
    { label: 'Stop using tap water if a boil-water or contamination notice is issued', detail: 'Switch immediately to stored or disinfected water for drinking, cooking, and brushing teeth.' },
    { label: 'Ration to known needs, not guesswork', detail: 'Track how much is left against days remaining before assuming you can be generous with it.' },
    { label: 'Disinfect any water of uncertain quality before drinking', detail: 'Boil, or treat with the correct bleach ratio, and let treated water sit the recommended time before use.' },
    { label: 'Keep containers sealed and off the ground', detail: 'Minimizes contamination risk and makes it easy to track how much remains.' },
  ],
  after: [
    { label: 'Do not resume tap water until officials clear it', detail: 'A boil-water or do-not-drink notice stays in effect until the utility confirms safety, even if service is restored.' },
    { label: 'Flush and inspect fixtures', detail: 'Run cold water briefly through faucets once cleared, and check for discoloration or odor before trusting it.' },
  ],
  recovery: [
    'Restock and rotate: replace store-bought water per its label date, or refill and re-date DIY containers roughly every six months.',
    'Sanitize storage containers before refilling if they were used during the event.',
    'Review whether the two-week target actually covered the outage — expand storage if it fell short.',
  ],
  mistakes: [
    'Assuming tap water is safe just because the power or immediate danger has passed.',
    'Storing water in containers that previously held chemicals or milk (bacterial growth, taste transfer).',
    'Never testing your disinfection method — boiling times and bleach ratios are easy to get wrong under stress.',
    'Only stocking three days when a realistic outage (grid, water-main, or storm) can run well past a week.',
  ],
  checklist: [
    { id: 'water_storage.3day_supply', label: '1 gallon/person/day for 3 days minimum', weight: 3 },
    { id: 'water_storage.2week_goal', label: 'Working toward a 2-week supply', weight: 2 },
    { id: 'water_storage.containers', label: 'Food-grade storage containers', weight: 2 },
    { id: 'water_storage.disinfection', label: 'Disinfection method known and practiced', weight: 3 },
  ],
  relatedGuides: ['food_storage', 'power_grid_outage', 'earthquake'],
  sources: ['Ready.gov — Water', 'CDC — Water Treatment', 'FEMA'],
};
