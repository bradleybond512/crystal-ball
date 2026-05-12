import type { Playbook } from '@/types/intelligence';

export const HURRICANE_PLAYBOOK: Playbook = {
  id: 'hurricane',
  name: 'Hurricane / Tropical Cyclone Response',
  triggerDomains: ['weather'],
  triggerTags: ['hurricane', 'tropical-storm', 'nhc', 'cyclone'],
  triggerSeverity: ['MEDIUM', 'HIGH', 'CRITICAL'],
  steps: [
    {
      order: 1,
      action: 'Pull latest NHC advisory — track cone of uncertainty vs saved coastal places',
      category: 'monitor',
      automated: true,
      automationFn: 'fetchNhcAdvisory',
    },
    {
      order: 2,
      action: 'Check coastal saved places against projected storm surge inundation zones',
      category: 'monitor',
      automated: true,
      automationFn: 'checkCoastalSavedPlaces',
    },
    {
      order: 3,
      action: 'Monitor NWS storm surge watches/warnings — refresh every 6 hours at minimum',
      category: 'monitor',
      automated: false,
    },
    {
      order: 4,
      action: 'Review mandatory vs voluntary evacuation zones for affected saved places',
      category: 'prepare',
      automated: false,
    },
    {
      order: 5,
      action: 'Alert contacts at saved places within projected track cone 72 hours out',
      category: 'notify',
      automated: false,
    },
  ],
};
