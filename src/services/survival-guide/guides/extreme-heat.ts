import type { SurvivalGuide } from '../guide-types';

export const EXTREME_HEAT_GUIDE: SurvivalGuide = {
  id: 'extreme_heat',
  kind: 'hazard',
  title: 'Extreme Heat',
  summary:
    'Prolonged dangerously high temperature and heat index. Extreme heat kills more ' +
    'Americans in an average year than any other weather hazard, and it disproportionately ' +
    'kills the elderly, infants, outdoor workers, and people without reliable air ' +
    'conditioning. Heat stroke is a life-threatening emergency — know the difference from ' +
    'heat exhaustion and act fast. Never leave a person or pet in a parked car.',
  signs: [
    'NWS Excessive Heat Watch/Warning or a high HeatRisk rating for your area',
    'Heat index (temperature + humidity) forecast well above 100°F',
    'Overnight lows staying high, giving the body no chance to recover',
    'Heat-exhaustion symptoms in yourself or others: heavy sweating, weakness, nausea, cool clammy skin',
  ],
  prepare: [
    { label: 'Identify your nearest cooling center', detail: 'Know the location and hours before you need it — many cities open public cooling centers during heat emergencies.' },
    { label: 'Have a working AC or fan plan', detail: 'Fans alone stop helping above roughly 95°F — plan for AC access or another cool space on the worst days.' },
    { label: 'Stock water and electrolytes', detail: 'Dehydration compounds heat risk quickly, especially for outdoor workers and older adults.' },
    { label: 'Set up a check-in plan for elderly or at-risk household/neighbors', detail: 'Heat deaths concentrate among people who are isolated and without AC — a daily check-in saves lives.' },
  ],
  during: [
    { label: 'Recognize heat stroke and call 911 immediately', detail: 'Hot, dry or damp skin, confusion, slurred speech, or loss of consciousness is heat stroke — a medical emergency. Cool the person immediately (cold water/ice) while waiting for help.' },
    { label: 'Never leave anyone — especially children or pets — in a parked car', detail: 'Car interiors can exceed 120°F within minutes even with windows cracked.' },
    { label: 'Move to air conditioning or a cooling center', detail: 'If your home isn\'t cool, go somewhere that is — a mall, library, or cooling center all count.' },
    { label: 'Limit outdoor exertion to early morning or evening', detail: 'Avoid strenuous activity during peak heat hours (typically 11am-6pm); hydrate before you feel thirsty.' },
  ],
  after: [
    { label: 'Continue hydrating and monitoring anyone who showed heat-illness symptoms', detail: 'Heat exhaustion can progress to heat stroke even after initial cooling — watch for worsening symptoms.' },
    { label: 'Check on vulnerable neighbors', detail: 'Confirm elderly, disabled, or isolated neighbors made it through safely, especially after multi-day heat events.' },
    { label: 'Inspect for heat-stressed pets, plants, and food spoilage', detail: 'Extended heat and any related power strain can spoil refrigerated food faster than usual.' },
  ],
  recovery: [
    'Ease back into normal outdoor activity gradually — heat acclimation takes days.',
    'Check on anyone who works or lives outdoors regularly for lingering symptoms.',
    'Review what worked and didn\'t in your cooling plan before the next heat event.',
  ],
  mistakes: [
    '"Running in for just a minute" and leaving a child or pet in the car.',
    'Treating heat exhaustion symptoms as minor and continuing strenuous activity.',
    'Relying on a fan alone once heat index passes the point fans stop helping.',
    'Waiting until symptoms are severe before seeking a cool space or medical help.',
  ],
  checklist: [
    { id: 'extreme_heat.cooling_center', label: 'Nearest cooling center location known', weight: 3 },
    { id: 'extreme_heat.ac_plan', label: 'AC or fan plan for worst-case days', weight: 2 },
    { id: 'extreme_heat.water', label: 'Water and electrolytes stocked', weight: 2 },
    { id: 'extreme_heat.checkin_plan', label: 'Check-in plan for elderly/at-risk people', weight: 3 },
  ],
  relatedGuides: ['power_grid_outage', 'water_storage'],
  sources: ['Ready.gov — Extreme Heat', 'CDC — Heat Stress', 'NWS — HeatRisk'],
};
