 
/**
 * Entity heat — extracts country / major actor names from alert titles and
 * bodies, then ranks them by recency-weighted mention count. Powers the
 * "who's mentioned right now" rail.
 *
 * Detection is pattern-based — cheap, deterministic, good enough for the
 * top 80% of intel feeds which explicitly name their subjects.
 */

import { unifiedAlertStore, type UnifiedAlert } from './unified-alerts';

// Canonical → regex variants (case-insensitive, word-bounded)
const ENTITIES: { name: string; pattern: RegExp }[] = [
  { name: 'USA', pattern: /\b(?:USA|U\.S\.A\.|United States|\bUS\b|American)\b/ },
  { name: 'China', pattern: /\b(?:China|Chinese|PRC|Beijing)\b/ },
  { name: 'Russia', pattern: /\b(?:Russia|Russian|Moscow|Kremlin)\b/ },
  { name: 'Ukraine', pattern: /\b(?:Ukraine|Ukrainian|Kyiv|Kiev)\b/ },
  { name: 'Iran', pattern: /\b(?:Iran|Iranian|Tehran|IRGC)\b/ },
  { name: 'Israel', pattern: /\b(?:Israel|Israeli|IDF|Tel Aviv|Jerusalem)\b/ },
  { name: 'Gaza', pattern: /\b(?:Gaza|Hamas)\b/ },
  { name: 'Lebanon', pattern: /\b(?:Lebanon|Lebanese|Hezbollah|Beirut)\b/ },
  { name: 'Syria', pattern: /\b(?:Syria|Syrian|Damascus)\b/ },
  { name: 'Yemen', pattern: /\b(?:Yemen|Yemeni|Houthi|Sanaa)\b/ },
  { name: 'Iraq', pattern: /\b(?:Iraq|Iraqi|Baghdad)\b/ },
  { name: 'Turkey', pattern: /\b(?:Turkey|Turkish|Ankara|Istanbul)\b/ },
  { name: 'UK', pattern: /\b(?:UK|United Kingdom|Britain|British|London)\b/ },
  { name: 'France', pattern: /\b(?:France|French|Paris)\b/ },
  { name: 'Germany', pattern: /\b(?:Germany|German|Berlin)\b/ },
  { name: 'Japan', pattern: /\b(?:Japan|Japanese|Tokyo)\b/ },
  { name: 'Korea', pattern: /\b(?:North Korea|DPRK|Pyongyang|South Korea|Seoul|Korean)\b/ },
  { name: 'Taiwan', pattern: /\b(?:Taiwan|Taiwanese|Taipei|PLA)\b/ },
  { name: 'India', pattern: /\b(?:India|Indian|Delhi|Mumbai)\b/ },
  { name: 'Pakistan', pattern: /\b(?:Pakistan|Pakistani|Islamabad|Karachi)\b/ },
  { name: 'Saudi Arabia', pattern: /\b(?:Saudi|Riyadh)\b/ },
  { name: 'Egypt', pattern: /\b(?:Egypt|Egyptian|Cairo)\b/ },
  { name: 'Venezuela', pattern: /\b(?:Venezuela|Caracas)\b/ },
  { name: 'Mexico', pattern: /\b(?:Mexico|Mexican|CDMX)\b/ },
  { name: 'Brazil', pattern: /\b(?:Brazil|Brazilian|São Paulo|Brasília)\b/ },
  { name: 'Sudan', pattern: /\b(?:Sudan|Sudanese|Khartoum|RSF)\b/ },
  { name: 'Ethiopia', pattern: /\b(?:Ethiopia|Ethiopian|Addis Ababa|Tigray)\b/ },
  { name: 'Philippines', pattern: /\b(?:Philippines|Filipino|Manila)\b/ },
  { name: 'Indonesia', pattern: /\b(?:Indonesia|Jakarta)\b/ },
  { name: 'NATO', pattern: /\bNATO\b/ },
  { name: 'EU', pattern: /\b(?:EU|European Union)\b/ },
  { name: 'UN', pattern: /\b(?:UN|United Nations|UNHCR|WHO)\b/ },
];

export interface EntityMention {
  name: string;
  count: number;
  weighted: number;
  latestTs: number;
  alertIds: string[];
}

export function computeEntityHeat(windowMs = 6 * 60 * 60_000): EntityMention[] {
  const now = Date.now();
  const cutoff = now - windowMs;
  const alerts = unifiedAlertStore.getAll().filter(a => a.timestamp >= cutoff && !a.acknowledged);
  const map = new Map<string, EntityMention>();
  for (const a of alerts) {
    const text = `${a.title} ${a.body}`;
    for (const ent of ENTITIES) {
      if (!ent.pattern.test(text)) continue;
      const cur = map.get(ent.name) ?? { name: ent.name, count: 0, weighted: 0, latestTs: 0, alertIds: [] };
      cur.count += 1;
      // Exponential recency weight: half-life 60min
      const ageMin = (now - a.timestamp) / 60_000;
      cur.weighted += Math.pow(0.5, ageMin / 60);
      if (a.timestamp > cur.latestTs) cur.latestTs = a.timestamp;
      if (cur.alertIds.length < 10) cur.alertIds.push(a.id);
      map.set(ent.name, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.weighted - a.weighted);
}

export function getAlertsForEntity(name: string, windowMs = 6 * 60 * 60_000): UnifiedAlert[] {
  const ent = ENTITIES.find(e => e.name === name);
  if (!ent) return [];
  const cutoff = Date.now() - windowMs;
  return unifiedAlertStore.getAll().filter(a =>
    a.timestamp >= cutoff
    && !a.acknowledged
    && ent.pattern.test(`${a.title} ${a.body}`),
  );
}
