import type { SurvivalGuide } from '../guide-types';

export const WINTER_STORM_GUIDE: SurvivalGuide = {
  id: 'winter_storm',
  kind: 'hazard',
  title: 'Winter Storm',
  summary:
    'Heavy snow, ice, or dangerous cold that can knock out power, strand vehicles, and ' +
    'turn routine tasks lethal. The biggest killers are hypothermia, carbon-monoxide ' +
    'poisoning from indoor heating mistakes, and vehicle crashes — not the cold itself. ' +
    'Never run a generator, grill, or vehicle inside a garage or enclosed space to keep warm.',
  signs: [
    'NWS Winter Storm Watch/Warning, Ice Storm Warning, or Wind Chill Warning for your area',
    'Forecast heavy snow accumulation, freezing rain, or sustained sub-zero wind chill',
    'Roads beginning to ice over or visibility dropping in blowing snow',
    'Utility notices of anticipated outages due to ice loading on power lines',
  ],
  prepare: [
    { label: 'Have a backup heat plan that is not combustion indoors', detail: 'Extra blankets, battery-powered heaters rated for indoor use, or a plan to relocate — never a generator, grill, or car running in an enclosed space.' },
    { label: 'Assemble a car winter kit', detail: 'Blankets, food, water, a shovel, sand/kitty litter for traction, a flashlight, and a phone charger — stranded vehicles are a leading cause of cold-weather death.' },
    { label: 'Install and test carbon-monoxide detectors', detail: 'CO poisoning spikes during winter storms from generators and heaters used unsafely indoors.' },
    { label: 'Insulate pipes and know how to shut off water', detail: 'Frozen and burst pipes are among the most common and costly winter storm damages.' },
  ],
  during: [
    { label: 'Stay off the roads unless travel is necessary', detail: 'Most winter storm deaths involving vehicles happen because people traveled when they didn\'t have to.' },
    { label: 'Dress in layers and keep extremities covered', detail: 'Layering traps warm air; wet clothing accelerates heat loss — stay dry.' },
    { label: 'If stranded in a vehicle, stay with it and run the engine sparingly', detail: 'Run it only briefly for heat with a window cracked and the exhaust pipe clear of snow to avoid CO buildup.' },
    { label: 'Never use a generator, grill, or camp stove indoors or in a garage', detail: 'Carbon monoxide is colorless and odorless and can kill within minutes at high concentrations.' },
  ],
  after: [
    { label: 'Check for signs of hypothermia and frostbite in yourself and others', detail: 'Shivering, confusion, slurred speech, or numb/white skin need warming and medical attention.' },
    { label: 'Clear snow carefully to avoid overexertion', detail: 'Shoveling is a common trigger for heart attacks, especially in cold air — pace yourself.' },
    { label: 'Let faucets drip and check pipes for freezing before full use', detail: 'Thaw pipes slowly; a burst pipe discovered late can flood a home.' },
    { label: 'Inspect the roof for excessive snow/ice load', detail: 'Heavy accumulation can collapse roofs, especially on flat or older structures.' },
  ],
  recovery: [
    'Check food safety after any extended power outage — discard anything above 40°F for more than two hours.',
    'Have a professional inspect any pipe that froze or burst before turning the water back on fully.',
    'Watch for delayed hypothermia/frostbite symptoms in anyone who was outdoors for a long period.',
  ],
  mistakes: [
    'Running a generator or grill in a garage "just for a few minutes" to warm up.',
    'Leaving the vehicle to seek help when stranded, instead of staying with it.',
    'Overexerting while shoveling heavy, wet snow.',
    'Ignoring a wind-chill warning because the air temperature alone "isn\'t that bad."',
  ],
  checklist: [
    { id: 'winter_storm.heat_backup', label: 'Non-combustion indoor backup heat plan', weight: 3 },
    { id: 'winter_storm.car_kit', label: 'Car winter kit packed', weight: 2 },
    { id: 'winter_storm.co_detector', label: 'Working carbon-monoxide detector', weight: 3 },
    { id: 'winter_storm.supplies_3day', label: '3-day water/food supply on hand', weight: 2 },
  ],
  relatedGuides: ['power_grid_outage', 'extreme_heat', 'go_bag'],
  sources: ['Ready.gov — Winter Weather', 'NWS — Winter Weather Safety', 'CDC — Carbon Monoxide & Cold Weather'],
};
