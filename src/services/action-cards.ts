 
/**
 * Actionable Response Cards
 *
 * Maps alert categories to concrete action checklists the user can follow.
 * Guidance is drawn from FEMA, NOAA, CDC, and CISA public safety references.
 */

import type { UnifiedAlert } from './unified-alerts';

export type ActionCardCategory =
  | 'earthquake'
  | 'tsunami'
  | 'hurricane'
  | 'tornado'
  | 'wildfire'
  | 'flood'
  | 'winter-storm'
  | 'conflict-escalation'
  | 'cyber-threat'
  | 'financial-trigger'
  | 'disease-outbreak'
  | 'space-weather'
  | 'power-grid'
  | 'generic';

export interface ActionItem {
  order: number;
  text: string;
  urgency: 'immediate' | 'within-hour' | 'within-day';
}

export interface ActionCard {
  category: ActionCardCategory;
  title: string;
  summary: string;
  immediateActions: ActionItem[];
  shortTermActions: ActionItem[];
  resources?: { label: string; url: string }[];
}

// ── Card Library ───────────────────────────────────────────────────────────────

const ACTION_CARDS: Record<ActionCardCategory, ActionCard> = {
  earthquake: {
    category: 'earthquake',
    title: 'Earthquake Response',
    summary: 'Drop, Cover, Hold On. Stay where you are until shaking stops. Expect aftershocks for days.',
    immediateActions: [
      { order: 1, text: 'DROP to hands and knees before the shaking knocks you down.', urgency: 'immediate' },
      { order: 2, text: 'COVER your head and neck under a sturdy desk or table; stay away from windows.', urgency: 'immediate' },
      { order: 3, text: 'HOLD ON until shaking stops — count at least 60 seconds of stillness before moving.', urgency: 'immediate' },
      { order: 4, text: 'If outdoors, move to an open area away from buildings, trees, power lines.', urgency: 'immediate' },
    ],
    shortTermActions: [
      { order: 1, text: 'Check yourself and others for injuries. Administer first aid.', urgency: 'within-hour' },
      { order: 2, text: 'Check for gas leaks — turn off gas at the valve if you smell anything.', urgency: 'within-hour' },
      { order: 3, text: 'Inspect structure for cracks in foundation, chimney, and walls before re-entering.', urgency: 'within-hour' },
      { order: 4, text: 'Tune to local emergency broadcast for tsunami warnings if on the coast.', urgency: 'within-hour' },
      { order: 5, text: 'Expect aftershocks — repeat Drop/Cover/Hold each time. Large aftershocks can occur for weeks.', urgency: 'within-day' },
    ],
    resources: [
      { label: 'FEMA Earthquake Safety', url: 'https://www.ready.gov/earthquakes' },
      { label: 'USGS Shakemap', url: 'https://earthquake.usgs.gov/' },
    ],
  },
  tsunami: {
    category: 'tsunami',
    title: 'Tsunami Response',
    summary: 'Move to high ground immediately. Do not wait for an official warning if you feel a strong coastal earthquake.',
    immediateActions: [
      { order: 1, text: 'Move to high ground (at least 100 ft elevation) or 2 miles inland. Go on foot if possible.', urgency: 'immediate' },
      { order: 2, text: 'If caught in the water, grab a floating object and go with the flow.', urgency: 'immediate' },
      { order: 3, text: 'Do NOT return to the shore to watch the wave — multiple waves can arrive over hours.', urgency: 'immediate' },
    ],
    shortTermActions: [
      { order: 1, text: 'Stay on high ground until officials announce all-clear (usually 8+ hours).', urgency: 'within-hour' },
      { order: 2, text: 'Avoid disaster areas — downed lines, unstable structures, contaminated water.', urgency: 'within-day' },
      { order: 3, text: 'Listen to NOAA Weather Radio or local Emergency Alert System.', urgency: 'within-hour' },
    ],
    resources: [
      { label: 'NOAA Tsunami Warning', url: 'https://www.tsunami.gov/' },
      { label: 'Ready.gov Tsunamis', url: 'https://www.ready.gov/tsunamis' },
    ],
  },
  hurricane: {
    category: 'hurricane',
    title: 'Hurricane / Tropical Storm',
    summary: 'Follow evacuation orders. Secure property. Have 72+ hours of supplies. Shelter in interior room.',
    immediateActions: [
      { order: 1, text: 'If under evacuation order, LEAVE NOW. Do not wait for the storm to arrive.', urgency: 'immediate' },
      { order: 2, text: 'Secure outdoor items, board windows, park vehicle in garage.', urgency: 'immediate' },
      { order: 3, text: 'Fill bathtubs with water for sanitation; fill vehicles with fuel.', urgency: 'immediate' },
    ],
    shortTermActions: [
      { order: 1, text: 'Shelter in interior room (bathroom, closet) on lowest non-flooded level.', urgency: 'within-hour' },
      { order: 2, text: 'Stay inside during the eye — calm is temporary; winds return from opposite direction.', urgency: 'within-hour' },
      { order: 3, text: 'Avoid flood waters — 6 inches can sweep adults off their feet.', urgency: 'within-day' },
      { order: 4, text: 'Do not use candles for light; use flashlights to prevent fire.', urgency: 'within-day' },
    ],
    resources: [
      { label: 'National Hurricane Center', url: 'https://www.nhc.noaa.gov/' },
      { label: 'Ready.gov Hurricanes', url: 'https://www.ready.gov/hurricanes' },
    ],
  },
  tornado: {
    category: 'tornado',
    title: 'Tornado Warning',
    summary: 'Go to a small interior room on the lowest floor. Put as many walls between you and outside as possible.',
    immediateActions: [
      { order: 1, text: 'Go to basement, storm cellar, or interior bathroom/closet on lowest floor.', urgency: 'immediate' },
      { order: 2, text: 'Cover yourself with mattress, blankets, or get under sturdy furniture.', urgency: 'immediate' },
      { order: 3, text: 'Protect your head and neck with your arms.', urgency: 'immediate' },
      { order: 4, text: 'If in a vehicle, drive away from the tornado at right angles to its path. If impossible, abandon car for a ditch below road level.', urgency: 'immediate' },
    ],
    shortTermActions: [
      { order: 1, text: 'Watch for downed power lines and broken gas lines after the tornado passes.', urgency: 'within-hour' },
      { order: 2, text: 'Check on neighbors, especially elderly and those with disabilities.', urgency: 'within-hour' },
      { order: 3, text: 'Stay tuned to local weather — multiple tornadoes can follow in the same system.', urgency: 'within-day' },
    ],
    resources: [
      { label: 'NWS Tornado Safety', url: 'https://www.weather.gov/safety/tornado' },
    ],
  },
  wildfire: {
    category: 'wildfire',
    title: 'Wildfire Response',
    summary: 'Evacuate immediately if ordered. Close windows/doors, remove flammables, monitor air quality.',
    immediateActions: [
      { order: 1, text: 'Evacuate IMMEDIATELY if ordered — wildfires move faster than you expect.', urgency: 'immediate' },
      { order: 2, text: 'Wear N95/KN95 mask outside; close all windows, doors, and vents.', urgency: 'immediate' },
      { order: 3, text: 'Shut off propane tanks and gas lines at the source.', urgency: 'immediate' },
      { order: 4, text: 'Remove flammable items (furniture, curtains) from exterior walls and roof gutters.', urgency: 'immediate' },
    ],
    shortTermActions: [
      { order: 1, text: 'Move indoors and run HVAC on recirculate with MERV 13+ filter.', urgency: 'within-hour' },
      { order: 2, text: 'Monitor AirNow.gov or local AQI — avoid outdoor exertion above AQI 150.', urgency: 'within-day' },
      { order: 3, text: 'Keep a go-bag ready: medications, documents, phone charger, water, pet supplies.', urgency: 'within-day' },
    ],
    resources: [
      { label: 'AirNow AQI', url: 'https://www.airnow.gov/' },
      { label: 'Ready.gov Wildfires', url: 'https://www.ready.gov/wildfires' },
    ],
  },
  flood: {
    category: 'flood',
    title: 'Flood Response',
    summary: 'Move to higher ground. Never drive through flood water. 6 inches of moving water can knock you down.',
    immediateActions: [
      { order: 1, text: 'Move to higher ground immediately. Do not wait for instructions.', urgency: 'immediate' },
      { order: 2, text: 'Turn Around, Don\u2019t Drown \u2014 never drive through flooded roads.', urgency: 'immediate' },
      { order: 3, text: 'Disconnect electrical appliances if safe; stay out of water with electrical contact.', urgency: 'immediate' },
    ],
    shortTermActions: [
      { order: 1, text: 'Avoid flood water \u2014 may contain sewage, chemicals, or live wires.', urgency: 'within-hour' },
      { order: 2, text: 'Document damage with photos before cleanup for insurance claims.', urgency: 'within-day' },
      { order: 3, text: 'Boil tap water until authorities confirm it is safe.', urgency: 'within-day' },
    ],
    resources: [
      { label: 'NWS Flood Safety', url: 'https://www.weather.gov/safety/flood' },
    ],
  },
  'winter-storm': {
    category: 'winter-storm',
    title: 'Winter Storm / Blizzard',
    summary: 'Shelter in place. Conserve heat. Do not run generators indoors. Avoid travel.',
    immediateActions: [
      { order: 1, text: 'Stay indoors. Close off unused rooms to conserve heat.', urgency: 'immediate' },
      { order: 2, text: 'Never run generators, grills, or camp stoves indoors \u2014 carbon monoxide kills.', urgency: 'immediate' },
      { order: 3, text: 'Dress in layers; cover head, hands, and feet to prevent hypothermia.', urgency: 'immediate' },
    ],
    shortTermActions: [
      { order: 1, text: 'Keep faucets dripping to prevent pipe freeze.', urgency: 'within-hour' },
      { order: 2, text: 'If power is out, move to a single room, insulate with blankets, stay together.', urgency: 'within-hour' },
      { order: 3, text: 'Check on elderly neighbors \u2014 hypothermia onset can be silent.', urgency: 'within-day' },
    ],
    resources: [
      { label: 'NWS Winter Safety', url: 'https://www.weather.gov/safety/winter' },
    ],
  },
  'conflict-escalation': {
    category: 'conflict-escalation',
    title: 'Conflict Escalation',
    summary: 'Identify nearest embassy/consulate. Stock essentials. Register with travel advisory. Stay alert to communications.',
    immediateActions: [
      { order: 1, text: 'If traveling, contact your embassy or consulate immediately.', urgency: 'immediate' },
      { order: 2, text: 'Register with your government\u2019s travel advisory program (STEP for US citizens).', urgency: 'immediate' },
      { order: 3, text: 'Avoid government buildings, diplomatic missions, and demonstration sites.', urgency: 'immediate' },
    ],
    shortTermActions: [
      { order: 1, text: 'Maintain 72+ hours of food, water, medications at home.', urgency: 'within-day' },
      { order: 2, text: 'Pre-plan evacuation routes and rendezvous with family members.', urgency: 'within-day' },
      { order: 3, text: 'Limit public movements; vary routines; keep passport/documents accessible.', urgency: 'within-day' },
    ],
    resources: [
      { label: 'US State Dept Travel Advisories', url: 'https://travel.state.gov/' },
      { label: 'UK FCDO Travel Advice', url: 'https://www.gov.uk/foreign-travel-advice' },
    ],
  },
  'cyber-threat': {
    category: 'cyber-threat',
    title: 'Cyber Threat Response',
    summary: 'Verify the threat. Patch systems. Rotate credentials. Isolate affected endpoints.',
    immediateActions: [
      { order: 1, text: 'Verify the threat via CISA or your SOC \u2014 confirm IoCs (hashes, IPs, domains).', urgency: 'immediate' },
      { order: 2, text: 'If compromised, isolate affected endpoints from the network immediately.', urgency: 'immediate' },
      { order: 3, text: 'Preserve forensic evidence \u2014 do not wipe systems until imaged.', urgency: 'immediate' },
    ],
    shortTermActions: [
      { order: 1, text: 'Rotate credentials for all exposed accounts; enforce MFA reset.', urgency: 'within-hour' },
      { order: 2, text: 'Apply vendor patches for any CVEs referenced in the threat advisory.', urgency: 'within-day' },
      { order: 3, text: 'Review SIEM/EDR logs for the last 90 days for matching IoCs.', urgency: 'within-day' },
    ],
    resources: [
      { label: 'CISA Known Exploited Vulnerabilities', url: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog' },
      { label: 'MITRE ATT&CK', url: 'https://attack.mitre.org/' },
    ],
  },
  'financial-trigger': {
    category: 'financial-trigger',
    title: 'Financial Market Trigger',
    summary: 'Verify the news. Check portfolio exposure. Review hedge positions. Avoid panic decisions.',
    immediateActions: [
      { order: 1, text: 'Verify the trigger via multiple Tier-1 sources before acting.', urgency: 'immediate' },
      { order: 2, text: 'Check portfolio for direct exposure to affected sectors / regions.', urgency: 'immediate' },
      { order: 3, text: 'Review existing hedge and stop-loss positions for correct levels.', urgency: 'immediate' },
    ],
    shortTermActions: [
      { order: 1, text: 'Avoid emotional decisions during the first volatile session \u2014 spreads widen.', urgency: 'within-hour' },
      { order: 2, text: 'Reassess risk tolerance against long-term plan; rebalance only with conviction.', urgency: 'within-day' },
    ],
    resources: [
      { label: 'SEC Investor.gov', url: 'https://www.investor.gov/' },
    ],
  },
  'disease-outbreak': {
    category: 'disease-outbreak',
    title: 'Disease Outbreak',
    summary: 'Stay informed via CDC/WHO. Follow public health guidance. Stock essentials. Limit exposure in high-spread zones.',
    immediateActions: [
      { order: 1, text: 'Confirm the outbreak via CDC, WHO, or your national public health authority.', urgency: 'immediate' },
      { order: 2, text: 'Follow masking, distancing, and hand hygiene guidance for the specific pathogen.', urgency: 'immediate' },
      { order: 3, text: 'Avoid travel to active outbreak zones unless essential.', urgency: 'immediate' },
    ],
    shortTermActions: [
      { order: 1, text: 'Stock 14+ days of essentials (food, water, medications).', urgency: 'within-day' },
      { order: 2, text: 'Verify vaccination status for recommended preventative vaccines.', urgency: 'within-day' },
      { order: 3, text: 'Identify nearest testing/treatment location and your healthcare coverage.', urgency: 'within-day' },
    ],
    resources: [
      { label: 'CDC', url: 'https://www.cdc.gov/' },
      { label: 'WHO Disease Outbreaks', url: 'https://www.who.int/emergencies/disease-outbreak-news' },
    ],
  },
  'space-weather': {
    category: 'space-weather',
    title: 'Space Weather / Geomagnetic Storm',
    summary: 'Expect GPS disruption, HF radio blackouts, grid fluctuations. Use offline maps, backup comms.',
    immediateActions: [
      { order: 1, text: 'Switch to offline maps \u2014 GPS accuracy may degrade or fail.', urgency: 'immediate' },
      { order: 2, text: 'Avoid high-latitude aviation routes if flying (polar route diversions likely).', urgency: 'immediate' },
    ],
    shortTermActions: [
      { order: 1, text: 'Expect HF/shortwave radio disruption; have backup VHF/UHF or satellite comms.', urgency: 'within-hour' },
      { order: 2, text: 'Unplug sensitive electronics during G4+ storms if grid is vulnerable.', urgency: 'within-hour' },
      { order: 3, text: 'Monitor NOAA SWPC for geomagnetic K-index and solar flare alerts.', urgency: 'within-day' },
    ],
    resources: [
      { label: 'NOAA Space Weather Prediction Center', url: 'https://www.swpc.noaa.gov/' },
    ],
  },
  'power-grid': {
    category: 'power-grid',
    title: 'Power Grid Disruption',
    summary: 'Unplug sensitive electronics. Conserve phone battery. Check on vulnerable neighbors.',
    immediateActions: [
      { order: 1, text: 'Unplug sensitive electronics to protect from surges when power restores.', urgency: 'immediate' },
      { order: 2, text: 'Turn off appliances that were running to reduce load spike on restoration.', urgency: 'immediate' },
      { order: 3, text: 'Switch phone to low-power mode; avoid non-essential use.', urgency: 'immediate' },
    ],
    shortTermActions: [
      { order: 1, text: 'Keep fridge/freezer closed \u2014 food holds 4h in fridge, 48h in full freezer.', urgency: 'within-hour' },
      { order: 2, text: 'Never run generators indoors or near windows \u2014 CO hazard.', urgency: 'within-hour' },
      { order: 3, text: 'Check on neighbors using medical equipment that requires power.', urgency: 'within-hour' },
    ],
    resources: [
      { label: 'Ready.gov Power Outages', url: 'https://www.ready.gov/power-outages' },
    ],
  },
  generic: {
    category: 'generic',
    title: 'Monitor and Verify',
    summary: 'Confirm the alert with multiple authoritative sources before acting.',
    immediateActions: [
      { order: 1, text: 'Check 2-3 independent Tier-1 sources to confirm the alert.', urgency: 'immediate' },
      { order: 2, text: 'Identify location relevance \u2014 does this affect your area or travel plans?', urgency: 'immediate' },
    ],
    shortTermActions: [
      { order: 1, text: 'Monitor for updates over the next 2-6 hours as details emerge.', urgency: 'within-hour' },
    ],
  },
};

// ── Mapping ────────────────────────────────────────────────────────────────────

function categoryFromNwsTitle(title: string): ActionCardCategory {
  const lower = title.toLowerCase();
  if (lower.includes('tornado')) return 'tornado';
  if (lower.includes('hurricane') || lower.includes('tropical storm')) return 'hurricane';
  if (lower.includes('blizzard') || lower.includes('winter storm') || lower.includes('ice storm')) return 'winter-storm';
  if (lower.includes('flood')) return 'flood';
  if (lower.includes('red flag') || lower.includes('fire weather')) return 'wildfire';
  return 'generic';
}

export function getActionCardForAlert(alert: UnifiedAlert): ActionCard | null {
  const src = alert.source;
  const title = alert.title || '';
  const body = alert.body || '';

  switch (src) {
    case 'earthquake': { return ACTION_CARDS.earthquake;
    }
    case 'tsunami': { return ACTION_CARDS.tsunami;
    }
    case 'cyclone': { return ACTION_CARDS.hurricane;
    }
    case 'fire': { return ACTION_CARDS.wildfire;
    }
    case 'cyber':
    case 'local-ids': {
      return ACTION_CARDS['cyber-threat'];
    }
    case 'oref': { return ACTION_CARDS['conflict-escalation'];
    }
    case 'disease': { return ACTION_CARDS['disease-outbreak'];
    }
    case 'space-weather': { return ACTION_CARDS['space-weather'];
    }
    case 'power-grid': { return ACTION_CARDS['power-grid'];
    }
    case 'nws': { return ACTION_CARDS[categoryFromNwsTitle(title)];
    }
    case 'gdacs': {
      const lower = `${title} ${body}`.toLowerCase();
      if (lower.includes('earthquake')) return ACTION_CARDS.earthquake;
      if (lower.includes('tropical') || lower.includes('cyclone')) return ACTION_CARDS.hurricane;
      if (lower.includes('flood')) return ACTION_CARDS.flood;
      if (lower.includes('fire')) return ACTION_CARDS.wildfire;
      return ACTION_CARDS.generic;
    }
    default: { return ACTION_CARDS.generic;
    }
  }
}

export function getAllActionCards(): ActionCard[] {
  return Object.values(ACTION_CARDS);
}

export function getActionCardByCategory(category: ActionCardCategory): ActionCard | null {
  return ACTION_CARDS[category] ?? null;
}
