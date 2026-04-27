/**
 * Reaction playbooks — per
 * docs/INSIGHTS_NOTIFICATIONS_PRESENTATION_PLAN.md section 15
 * (lines 340-364) and PR 3 (lines 389-397).
 *
 * Static fact sheets per major event category. Each playbook lists
 * user actions, confirming sources, invalidating sources, recommended
 * panels, and time windows. The Action Brief composer
 * (action-briefs.ts) reads from these to assemble per-situation guidance.
 *
 * Pure data. No DOM, no fetch, no globals.
 */

// ── Public types ─────────────────────────────────────────────────────────

export type PlaybookCategory =
  | 'severe_weather'
  | 'wildfire'
  | 'oil_fuel_shortage'
  | 'food_shortage'
  | 'cyber_campaign'
  | 'banking_outage'
  | 'conflict_escalation'
  | 'travel_disruption'
  | 'grid_outage'
  | 'disease_outbreak';

export interface ReactionPlaybook {
  category: PlaybookCategory;
  /** Plain-English summary the UI can render in a card header. */
  description: string;
  /** Imperative actions in execution order (most urgent first). */
  userActions: string[];
  /** Sources the user should monitor for confirmation. */
  confirmingSources: string[];
  /** Sources that, if quiet or contradicting, should weaken the call. */
  invalidatingSources: string[];
  /** Recommended Crystal Ball panels to open for this category. */
  recommendedPanels: string[];
  /** Notification behavior summary for the dispatcher. */
  notificationRule: string;
  /** Time-window guidance (how long the playbook stays relevant). */
  timeWindow: string;
}

// ── Library ──────────────────────────────────────────────────────────────

const PLAYBOOK_LIBRARY: Record<PlaybookCategory, ReactionPlaybook> = {
  severe_weather: {
    category: 'severe_weather',
    description: 'Severe thunderstorm, tornado, flash flood, or destructive wind near you.',
    userActions: [
      'Move to safest indoor location for the hazard',
      'Charge phone + battery packs',
      'Secure or bring in loose outdoor items',
      'Avoid driving — wait for the cell to pass',
      'Confirm shelter location with household',
    ],
    confirmingSources: [
      'NWS warning expansion',
      'Local TV station coverage',
      'Spotter / damage reports',
      'Power outage maps',
    ],
    invalidatingSources: [
      'Storm dissipating on radar',
      'Warning expires without renewal',
      'NWS cancels',
    ],
    recommendedPanels: ['Weather', 'Hazard Alerts', 'Power Grid', 'Family Tracker'],
    notificationRule: 'banner + sound, persistent until acknowledged for tornado / flash flood',
    timeWindow: '0-2 hours from issuance',
  },

  wildfire: {
    category: 'wildfire',
    description: 'Active wildfire near a saved place or anticipated fire-weather conditions.',
    userActions: [
      'Pack a go-bag (documents, meds, chargers, water)',
      'Park vehicle facing out for quick exit',
      'Close windows + outside vents to limit smoke',
      'Identify two evacuation routes',
      'Sign up for local CodeRed / Nixle alerts',
    ],
    confirmingSources: [
      'CAL FIRE / state fire incident map',
      'NIFC perimeter feeds',
      'Local sheriff / OEM evacuation orders',
      'Watch Duty app',
    ],
    invalidatingSources: [
      'Fire containment % rising',
      'Wind shift away from saved place',
      'Humidity recovery',
    ],
    recommendedPanels: ['Hazard Alerts', 'Weather', 'Evacuation Router'],
    notificationRule: 'banner immediate; persistent if evacuation orders cover saved place',
    timeWindow: '0-72 hours; reset on major perimeter expansion',
  },

  oil_fuel_shortage: {
    category: 'oil_fuel_shortage',
    description: 'Diesel, gasoline, or heating-fuel stress in your region.',
    userActions: [
      'Top off vehicle fuel before prices spike',
      'Avoid panic buying — confirm shortage with two sources',
      'Plan for 7-14 day supply if you depend on heating fuel',
      'Check for SPR release or local emergency fuel allocation announcements',
    ],
    confirmingSources: [
      'EIA weekly inventory reports',
      'GasBuddy / station-level price moves',
      'Refinery utilization reports',
      'Pipeline operator status pages',
    ],
    invalidatingSources: [
      'Refinery returns to service',
      'Inventory builds 2 consecutive weeks',
      'Crack spread normalizes',
    ],
    recommendedPanels: ['Markets', 'Shortage Forecasts', 'Supply Chain'],
    notificationRule: 'digest unless local stations report outages',
    timeWindow: '1-4 weeks',
  },

  food_shortage: {
    category: 'food_shortage',
    description: 'Food security stress affecting a region you watch or that drives prices globally.',
    userActions: [
      'Check pantry — keep 7-14 days of staples on hand',
      'Note specific commodities at risk (wheat, corn, rice, …)',
      'Watch for export-ban announcements that compound the squeeze',
      'Confirm with humanitarian sources before broadcasting',
    ],
    confirmingSources: [
      'FEWS NET classification deterioration',
      'WFP situation reports',
      'USDA WASDE / GAINS reports',
      'Local market price observations',
    ],
    invalidatingSources: [
      'Late-season rainfall recovery',
      'Export bans lifted',
      'WASDE upgrade',
    ],
    recommendedPanels: ['Shortage Forecasts', 'Humanitarian', 'Markets'],
    notificationRule: 'digest; banner for direct-impact regions',
    timeWindow: '1-12 weeks',
  },

  cyber_campaign: {
    category: 'cyber_campaign',
    description: 'Active cyber-threat campaign affecting software you use or providers you depend on.',
    userActions: [
      'Patch affected software immediately',
      'Enable MFA on banking + email + work accounts',
      'Check bank + provider status pages',
      'Watch for phishing surge — verify email senders',
      'Run a backup of critical files',
    ],
    confirmingSources: [
      'CISA Known Exploited Vulnerabilities (KEV) catalog',
      'Vendor advisory pages',
      'NVD CVE record',
      'Mandiant / CrowdStrike threat reports',
    ],
    invalidatingSources: [
      'Vendor confirms patch deployed',
      'CISA / vendor downgrade',
      'No active exploitation observed',
    ],
    recommendedPanels: ['Cyber', 'Threat Intel Hub'],
    notificationRule: 'banner for KEV additions affecting installed software; digest otherwise',
    timeWindow: '0-30 days',
  },

  banking_outage: {
    category: 'banking_outage',
    description: 'Card network, bank, or payment processor outage affecting transactions.',
    userActions: [
      'Withdraw small amount of cash if outage extends',
      'Avoid initiating large transfers during the incident',
      'Document any failed transactions with screenshots',
      'Use a backup payment method if available',
    ],
    confirmingSources: [
      'Bank / processor official status page',
      'Downdetector reports',
      'Reuters / Bloomberg outage coverage',
    ],
    invalidatingSources: [
      'Status page reverts to operational',
      'Transactions complete in tests',
    ],
    recommendedPanels: ['Markets', 'Threat Intel Hub'],
    notificationRule: 'banner if user has accounts with affected institution',
    timeWindow: '0-48 hours',
  },

  conflict_escalation: {
    category: 'conflict_escalation',
    description: 'Active conflict or geopolitical escalation affecting watched countries / travel.',
    userActions: [
      'Review flights for the affected airspace',
      'Check State Department / embassy travel advisories',
      'Avoid the impacted region until clarity emerges',
      'Monitor official briefings before reacting to social posts',
    ],
    confirmingSources: [
      'ACLED + GDELT escalation feeds',
      'Reuters / AP wire',
      'National defense briefings',
      'Local-language news translation',
    ],
    invalidatingSources: [
      'Ceasefire announcement',
      'Diplomatic resolution',
      'Forces withdraw',
    ],
    recommendedPanels: ['Conflict', 'Geo Intel', 'Live News'],
    notificationRule: 'banner for direct exposure; digest for monitoring',
    timeWindow: '0-7 days from escalation',
  },

  travel_disruption: {
    category: 'travel_disruption',
    description: 'Major travel disruption (airport ground stop, airspace closure, port closure) affecting a saved trip.',
    userActions: [
      'Check airline app for rebooking options',
      'Don\'t go to the airport until your flight is confirmed',
      'Consider alternative routing — adjacent airports or ground transit',
      'Notify lodging + meeting hosts of likely delay',
    ],
    confirmingSources: [
      'FAA / EUROCONTROL ground-stop notices',
      'Airline status feeds',
      'Airport official Twitter / X',
      'Eurowings / IATA bulletins',
    ],
    invalidatingSources: [
      'Ground stop lifted',
      'Flight rebooked + confirmed',
      'Weather clears',
    ],
    recommendedPanels: ['Aviation', 'Live News'],
    notificationRule: 'banner if affects user travel plan; digest otherwise',
    timeWindow: '0-24 hours',
  },

  grid_outage: {
    category: 'grid_outage',
    description: 'Electric grid disruption affecting your home, work, or a saved place.',
    userActions: [
      'Charge phone + battery packs immediately',
      'Avoid opening refrigerator/freezer',
      'Report outage to utility',
      'Check on at-risk neighbors (elderly, medical equipment)',
      'Use flashlights — never candles',
    ],
    confirmingSources: [
      'Utility outage map',
      'Grid operator status (PJM, ERCOT, MISO, …)',
      'Local TV / radio reports',
    ],
    invalidatingSources: [
      'Service restored on utility map',
      'Power confirmed back online',
    ],
    recommendedPanels: ['Power Grid', 'Hazard Alerts'],
    notificationRule: 'banner if affects saved place; digest for monitoring',
    timeWindow: '0-72 hours',
  },

  disease_outbreak: {
    category: 'disease_outbreak',
    description: 'Disease outbreak affecting a watched region or with respiratory / waterborne risk profile.',
    userActions: [
      'Review WHO / CDC guidance for the specific pathogen',
      'Update household stock of OTC medicines',
      'Postpone travel to active outbreak regions',
      'Confirm vaccination status for the household if applicable',
    ],
    confirmingSources: [
      'WHO Disease Outbreak News',
      'CDC outbreak reports',
      'ProMED-mail',
      'Local ministry of health bulletins',
    ],
    invalidatingSources: [
      'Outbreak confirmed contained',
      'WHO downgrade',
      'No new cases reported',
    ],
    recommendedPanels: ['Humanitarian', 'Hazard Alerts'],
    notificationRule: 'digest; banner for travel-plan-overlap or local outbreak',
    timeWindow: '1-12 weeks',
  },
};

// ── Public API ───────────────────────────────────────────────────────────

export function getPlaybook(category: PlaybookCategory): ReactionPlaybook {
  return PLAYBOOK_LIBRARY[category];
}

export function allPlaybooks(): ReactionPlaybook[] {
  return Object.values(PLAYBOOK_LIBRARY);
}

export function listCategories(): PlaybookCategory[] {
  return Object.keys(PLAYBOOK_LIBRARY) as PlaybookCategory[];
}
