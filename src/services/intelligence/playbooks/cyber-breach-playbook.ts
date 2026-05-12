import type { Playbook } from '@/types/intelligence';

export const CYBER_BREACH_PLAYBOOK: Playbook = {
  id: 'cyber-breach',
  name: 'Cyber Breach Response',
  triggerDomains: ['cyber'],
  triggerTags: [],
  triggerSeverity: ['HIGH', 'CRITICAL'],
  steps: [
    {
      order: 1,
      action: 'Check if breach source domain matches any watched domains or entities',
      category: 'monitor',
      automated: true,
      automationFn: 'checkBreachVsWatchedDomains',
    },
    {
      order: 2,
      action: 'Run HIBP credential check for monitored accounts against breach dataset',
      category: 'act',
      automated: true,
      automationFn: 'runHibpCredentialCheck',
    },
    {
      order: 3,
      action: 'Escalate to push notification if any monitored credentials appear in breach',
      category: 'notify',
      automated: true,
      automationFn: 'escalateBreachNotification',
    },
    {
      order: 4,
      action: 'Review affected systems for indicators of compromise (IOCs)',
      category: 'prepare',
      automated: false,
    },
    {
      order: 5,
      action: 'Confirm breach scope — check AbuseIPDB for C2 IPs associated with breach actor',
      category: 'verify',
      automated: false,
    },
  ],
};
