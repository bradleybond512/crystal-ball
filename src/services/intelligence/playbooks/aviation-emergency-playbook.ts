import type { Playbook } from '@/types/intelligence';

export const AVIATION_EMERGENCY_PLAYBOOK: Playbook = {
  id: 'aviation-emergency',
  name: 'Aviation Emergency',
  triggerDomains: ['aviation'],
  triggerTags: ['squawk-7700', 'squawk-7600', 'squawk-7500', 'emergency'],
  triggerSeverity: ['HIGH', 'CRITICAL'],
  steps: [
    {
      order: 1,
      action: 'Track aircraft position, altitude, and ground speed on ADS-B feed',
      category: 'monitor',
      automated: true,
      automationFn: 'trackAircraftAdsbLive',
    },
    {
      order: 2,
      action: 'Check destination and alternate airport operational status (NOTAMs, weather)',
      category: 'monitor',
      automated: true,
      automationFn: 'checkAirportStatus',
    },
    {
      order: 3,
      action: 'Monitor LiveATC / ACARS feeds for distress communications',
      category: 'monitor',
      automated: false,
    },
    {
      order: 4,
      action: 'Verify emergency type from squawk — 7700 general, 7600 radio, 7500 hijack',
      category: 'verify',
      automated: false,
    },
    {
      order: 5,
      action: 'Alert if flight path intersects populated saved places below 3,000 ft AGL',
      category: 'notify',
      automated: true,
      automationFn: 'alertFlightPathSavedPlaces',
    },
  ],
};
