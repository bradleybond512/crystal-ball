import type { EventType } from '../types/correlation-engine.ts';

const SOURCE_DEFAULT_MAP: Record<string, EventType> = {
  nws: 'weather_disaster',
  gdacs: 'earthquake',
  tsunami: 'earthquake',
  acled: 'conflict',
  cyber: 'cyber_incident',
  'ripe-atlas': 'internet_disruption',
  cloudflare: 'internet_disruption',
  ais: 'shipping_disruption',
  aviation: 'aviation_anomaly',
  'power-grid': 'energy_disruption',
  reliefweb: 'humanitarian_update',
  fewsnet: 'food_insecurity',
  'world-bank': 'economic_shock',
  sanctions: 'sanctions_action',
  military: 'military_activity',
};

const KEYWORD_RULES: { pattern: RegExp; type: EventType }[] = [
  { pattern: /protest|demonstrat|march|rally/i, type: 'protest' },
  { pattern: /riot|looting|mob/i, type: 'riot' },
  { pattern: /wildfire|bush ?fire|forest fire/i, type: 'wildfire' },
  { pattern: /flood|inundat/i, type: 'flooding' },
  { pattern: /earthquake|seismic|quake/i, type: 'earthquake' },
  { pattern: /outbreak|epidemic|pandemic|disease/i, type: 'outbreak' },
  { pattern: /displac|refugee|migrat|evacuati/i, type: 'displacement' },
  { pattern: /sanction|embargo/i, type: 'sanctions_action' },
  { pattern: /oil|currency|inflation|GDP|recession|stock|price surge/i, type: 'economic_shock' },
  { pattern: /cyber|DDoS|hack|breach|ransomware/i, type: 'cyber_incident' },
  { pattern: /internet|outage|connectivity|BGP/i, type: 'internet_disruption' },
  { pattern: /military|troops|airstrike|missile|drone strike/i, type: 'military_activity' },
  { pattern: /conflict|clash|fighting|combat|\bwar\b/i, type: 'conflict' },
  { pattern: /tornado|hurricane|cyclone|typhoon|storm/i, type: 'weather_disaster' },
  { pattern: /famine|food|hunger|crop/i, type: 'food_insecurity' },
  { pattern: /power|grid|blackout|energy/i, type: 'energy_disruption' },
  { pattern: /ship|port|vessel|maritime/i, type: 'shipping_disruption' },
  { pattern: /flight|aviation|aircraft|airspace/i, type: 'aviation_anomaly' },
];

export function mapSourceToEventType(source: string, title: string): EventType {
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(title)) return rule.type;
  }
  return SOURCE_DEFAULT_MAP[source] ?? 'conflict';
}

export function mapRawTagsToEventType(tags: string[]): EventType | null {
  const joined = tags.join(' ');
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(joined)) return rule.type;
  }
  return null;
}
