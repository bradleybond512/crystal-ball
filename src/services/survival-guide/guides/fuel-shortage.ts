import type { SurvivalGuide } from '../guide-types';

export const FUEL_SHORTAGE_GUIDE: SurvivalGuide = {
  id: 'fuel_shortage',
  kind: 'hazard',
  title: 'Fuel Shortage',
  summary:
    'A regional or national disruption to gasoline, diesel, or heating fuel supply from a ' +
    'refinery outage, pipeline disruption, or demand spike. The biggest risk isn\'t the ' +
    'shortage itself — it\'s panic buying, which turns a manageable disruption into empty ' +
    'stations within hours, and unsafe fuel storage, which is a fire hazard.',
  signs: [
    'News or official reports of a pipeline outage, refinery disruption, or regional supply constraint',
    'Rapidly climbing local fuel prices or stations posting limits per customer',
    'Visible lines forming at stations or stations running dry in your area',
    'Confirmation from at least two independent sources before treating rumors as real',
  ],
  prepare: [
    { label: 'Make a habit of refueling above half a tank', detail: 'Keeping the tank above half gives you a built-in buffer before any shortage becomes a personal emergency.' },
    { label: 'Store any reserve fuel only in approved containers', detail: 'Use UL/DOT-approved gas cans, stored outside living spaces, away from ignition sources.' },
    { label: 'Build a heating-fuel reserve plan if you rely on propane/heating oil', detail: 'Schedule refills before the season\'s tightest months rather than waiting for a shortage warning.' },
    { label: 'Plan to consolidate and reduce non-essential trips', detail: 'A trip-reduction plan (combining errands, carpooling, remote work) stretches a limited tank further.' },
  ],
  during: [
    { label: 'Do not panic-buy or top off far more than you need', detail: 'Panic buying is what empties stations during a manageable shortage — buy what you actually need.' },
    { label: 'Confirm shortage reports with two independent sources before acting', detail: 'Rumors spread faster than facts and can themselves trigger the panic-buying they warn about.' },
    { label: 'Prioritize essential trips only', detail: 'Combine errands, use public transit or carpool where possible, and defer non-essential driving.' },
    { label: 'Never store gasoline in unapproved containers or indoors', detail: 'Improperly stored fuel is a serious fire and vapor-inhalation hazard.' },
  ],
  after: [
    { label: 'Refill your reserve gradually once supply normalizes', detail: 'Avoid a second wave of panic buying by restocking calmly over several trips.' },
    { label: 'Review what stretched or strained your fuel plan', detail: 'Note which errands could have been consolidated or deferred for next time.' },
  ],
  recovery: [
    'Rotate any stored fuel — gasoline degrades in a few months without a stabilizer.',
    'Reassess your above-half-tank habit and heating-fuel reserve timing for the next season.',
  ],
  mistakes: [
    'Topping off the tank the moment shortage rumors appear, contributing to the panic that empties stations.',
    'Storing gasoline in unapproved containers or bringing it indoors.',
    'Acting on unverified shortage rumors without checking an official or second source.',
    'Letting the tank run low as routine practice, leaving no buffer when a real disruption hits.',
  ],
  checklist: [
    { id: 'fuel_shortage.half_tank_habit', label: 'Keep-tank-above-half habit established', weight: 2 },
    { id: 'fuel_shortage.approved_containers', label: 'Approved fuel containers if storing reserve', weight: 1 },
    { id: 'fuel_shortage.heating_reserve', label: 'Heating-fuel reserve plan for the season', weight: 2 },
    { id: 'fuel_shortage.trip_reduction', label: 'Trip-consolidation plan ready', weight: 1 },
  ],
  relatedGuides: ['power_grid_outage', 'evacuation_planning'],
  sources: ['Ready.gov', 'US Energy Information Administration (EIA)', 'US Fire Administration — Fuel Storage Safety'],
};
