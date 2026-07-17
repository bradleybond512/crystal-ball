import type { SurvivalGuide } from '../guide-types';

export const POWER_GRID_OUTAGE_GUIDE: SurvivalGuide = {
  id: 'power_grid_outage',
  kind: 'hazard',
  title: 'Power Grid Outage',
  summary:
    'Loss of electric utility service, from a short local outage to a multi-day regional ' +
    'grid failure. The two biggest killers in an outage are carbon monoxide from generators ' +
    'run indoors or in a garage, and lack of backup for people who depend on powered medical ' +
    'equipment. Food safety and staying warm/cool without utility power are the next-biggest ' +
    'concerns.',
  signs: [
    'Utility outage alert or an unusually widespread loss of power in your area',
    'Grid-operator conservation appeal or rolling-blackout notice during extreme demand',
    'Downed lines, a transformer explosion/flash, or storm damage to nearby infrastructure',
    'No estimated restoration time from the utility after several hours',
  ],
  prepare: [
    { label: 'Plan generator placement before you need one', detail: 'Outdoors only, well away from windows, doors, and vents — never in a garage even with the door open.' },
    { label: 'Install and test carbon-monoxide detectors', detail: 'Battery-backed CO detectors are essential wherever a generator or alternate heat source might be used.' },
    { label: 'Build a backup plan for powered medical devices', detail: 'Anyone on a CPAP, oxygen concentrator, or similar equipment needs a battery backup or a plan to relocate.' },
    { label: 'Keep coolers, ice, and a food-safety plan ready', detail: 'A full freezer holds temperature about 48 hours; a fridge about 4 hours — plan to consolidate or use ice.' },
  ],
  during: [
    { label: 'Never run a generator indoors, in a garage, or near windows/vents', detail: 'Carbon monoxide from generators is the leading cause of death in prolonged outages — it is colorless and odorless.' },
    { label: 'Keep refrigerator and freezer doors closed', detail: 'Every opening lets cold air escape and shortens the safe window before food spoils.' },
    { label: 'Use flashlights, not candles, for light', detail: 'Candles are a common cause of house fires during outages.' },
    { label: 'Unplug sensitive electronics to avoid surge damage on restoration', detail: 'Power can spike when service is restored — protect equipment you can\'t afford to lose.' },
  ],
  after: [
    { label: 'Follow food-safety rules: when in doubt, throw it out', detail: 'Discard perishable food that has been above 40°F for more than two hours.' },
    { label: 'Check on neighbors who depend on power for medical needs', detail: 'People on refrigerated medication or powered equipment are at highest risk during extended outages.' },
    { label: 'Inspect for damage before restoring full power use', detail: 'Have an electrician check anything that showed signs of damage before the outage or during restoration.' },
    { label: 'Reset clocks, alarms, and smart-home devices', detail: 'Confirm security systems and medical alert devices came back online correctly.' },
  ],
  recovery: [
    'Restock any generator fuel, batteries, and ice used during the outage.',
    'Review what worked and what didn\'t — add capacity where your plan fell short.',
    'Check refrigerated medications for anyone in the household who takes them.',
  ],
  mistakes: [
    'Running a generator in a garage, even with the door open.',
    'Repeatedly opening the fridge/freezer "to check" during the outage.',
    'Using a gas stove or oven for supplemental heating — a carbon-monoxide risk.',
    'Assuming powered medical equipment will be fine without a tested battery backup.',
  ],
  checklist: [
    { id: 'power_grid_outage.generator_plan', label: 'Generator + outdoor-only placement plan', weight: 3 },
    { id: 'power_grid_outage.co_detector', label: 'Working carbon-monoxide detector', weight: 3 },
    { id: 'power_grid_outage.medical_backup', label: 'Powered medical device backup plan', weight: 3 },
    { id: 'power_grid_outage.coolers_ice', label: 'Coolers and ice plan ready', weight: 1 },
    { id: 'power_grid_outage.cash', label: 'Cash on hand (card readers may be down)', weight: 1 },
  ],
  relatedGuides: ['cyber_banking_outage', 'water_storage', 'food_storage'],
  sources: ['Ready.gov — Power Outages', 'CDC — Carbon Monoxide Poisoning Prevention', 'FoodSafety.gov'],
};
