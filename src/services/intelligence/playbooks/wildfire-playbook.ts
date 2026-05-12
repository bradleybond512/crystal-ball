import type { Playbook } from '@/types/intelligence';

export const WILDFIRE_PLAYBOOK: Playbook = {
  id: 'wildfire',
  name: 'Wildfire Response',
  triggerDomains: ['*'],
  triggerTags: ['wildfire', 'fire'],
  triggerSeverity: ['HIGH', 'CRITICAL'],
  steps: [
    {
      order: 1,
      action: 'Check wind direction and speed relative to saved places — flag downwind locations',
      category: 'monitor',
      automated: true,
      automationFn: 'checkWindVsSavedPlaces',
    },
    {
      order: 2,
      action: 'Monitor NIFC InciWeb containment percentage and perimeter growth rate',
      category: 'monitor',
      automated: true,
      automationFn: 'fetchNifcContainment',
    },
    {
      order: 3,
      action: 'Check county evacuation zone overlaps with saved places',
      category: 'monitor',
      automated: true,
      automationFn: 'checkEvacuationZones',
    },
    {
      order: 4,
      action: 'Identify primary and alternate evacuation routes from affected saved places',
      category: 'prepare',
      automated: false,
    },
    {
      order: 5,
      action: 'Alert contacts at saved places if evacuation zones intersect or AQI > 150',
      category: 'notify',
      automated: false,
    },
  ],
};
