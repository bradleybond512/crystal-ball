import type { Playbook } from '@/types/intelligence';

export const EARTHQUAKE_PLAYBOOK: Playbook = {
  id: 'earthquake',
  name: 'Earthquake Response',
  triggerDomains: ['*'],
  triggerTags: ['earthquake', 'seismic'],
  triggerSeverity: ['HIGH', 'CRITICAL'],
  steps: [
    {
      order: 1,
      action: 'Check saved places for proximity to epicenter and structural damage risk',
      category: 'monitor',
      automated: true,
      automationFn: 'checkSavedPlacesProximity',
    },
    {
      order: 2,
      action: 'Scan AIS vessel traffic near affected ports for disruption or dark activity',
      category: 'monitor',
      automated: true,
      automationFn: 'scanAisPortDisruption',
    },
    {
      order: 3,
      action: 'Monitor USGS aftershock feed for M4+ follow-on events in next 24 hours',
      category: 'monitor',
      automated: true,
      automationFn: 'fetchAftershocks',
    },
    {
      order: 4,
      action: 'Check DART buoy network and PTWC for tsunami warning status',
      category: 'verify',
      automated: true,
      automationFn: 'checkTsunamiWarning',
    },
    {
      order: 5,
      action: 'Alert contacts at saved places within 100 km of epicenter',
      category: 'notify',
      automated: false,
    },
  ],
};
