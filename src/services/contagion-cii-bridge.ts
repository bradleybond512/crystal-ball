/**
 * Financial Contagion <-> Country Instability Index Bridge
 *
 * Bidirectional linkage:
 * 1. Sovereign debt stress from contagion model feeds into CII for affected countries
 * 2. High CII in key economies feeds back as a pressure boost in contagion channels
 *
 * This bridge runs periodically and keeps the two systems loosely coupled.
 */

import { getChannelStress } from './financial-contagion';
import { getCountryScore } from './country-instability';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContagionCiiLink {
  direction: 'contagion->cii' | 'cii->contagion';
  source: string;
  target: string;
  stressLevel: number;
  contribution: number;
}

// ── Country mappings ─────────────────────────────────────────────────────────

/** Countries affected by sovereign debt stress channel */
const SOVEREIGN_DEBT_COUNTRIES = ['US', 'GB', 'JP', 'DE', 'FR', 'IT', 'ES', 'GR', 'BR', 'AR', 'TR'];

/** Major economies whose instability feeds back into contagion */
const SYSTEMICALLY_IMPORTANT: Record<string, { channel: string; weight: number }[]> = {
  US: [{ channel: 'bank-stress', weight: 0.3 }, { channel: 'vix-spike', weight: 0.2 }],
  CN: [{ channel: 'supply-chain', weight: 0.3 }, { channel: 'commodity-shock', weight: 0.2 }],
  DE: [{ channel: 'credit-spread', weight: 0.15 }],
  JP: [{ channel: 'currency-crisis', weight: 0.15 }, { channel: 'sovereign-debt', weight: 0.2 }],
  GB: [{ channel: 'credit-spread', weight: 0.1 }],
  RU: [{ channel: 'commodity-shock', weight: 0.25 }],
  SA: [{ channel: 'commodity-shock', weight: 0.2 }],
};

// ── Bridge computation ───────────────────────────────────────────────────────

/**
 * Compute CII contribution from contagion sovereign debt stress.
 * Returns a 0-20 boost value that callers can add to CII scores.
 */
export function contagionToCiiBoost(): { countryCode: string; boost: number }[] {
  const channels = getChannelStress();
  const sovereign = channels.find(c => c.channel === 'Sovereign Debt Stress');
  if (!sovereign || sovereign.stressLevel < 30) return [];

  const normalized = sovereign.stressLevel / 100;
  return SOVEREIGN_DEBT_COUNTRIES.map(code => ({
    countryCode: code,
    boost: Math.round(normalized * 20),
  }));
}

/**
 * Compute contagion pressure boost from high-CII countries.
 * Returns per-channel boost values (0-15) that callers can overlay.
 */
export function ciiToContagionBoost(): { channel: string; boost: number }[] {
  const boosts = new Map<string, number>();

  for (const [code, channels] of Object.entries(SYSTEMICALLY_IMPORTANT)) {
    const cii = getCountryScore(code);
    if (cii === null || cii < 60) continue;

    const ciiNormalized = Math.min(1, (cii - 60) / 40);
    for (const { channel, weight } of channels) {
      const current = boosts.get(channel) ?? 0;
      boosts.set(channel, current + ciiNormalized * weight * 15);
    }
  }

  return [...boosts.entries()]
    .filter(([, boost]) => boost >= 1)
    .map(([channel, boost]) => ({ channel, boost: Math.round(Math.min(15, boost)) }));
}

/**
 * Get all active linkages for debugging/UI.
 */
export function getActiveLinks(): ContagionCiiLink[] {
  const links: ContagionCiiLink[] = [];

  for (const entry of contagionToCiiBoost()) {
    if (entry.boost >= 1) {
      links.push({
        direction: 'contagion->cii',
        source: 'Sovereign Debt Stress',
        target: entry.countryCode,
        stressLevel: entry.boost,
        contribution: entry.boost,
      });
    }
  }

  for (const entry of ciiToContagionBoost()) {
    links.push({
      direction: 'cii->contagion',
      source: 'CII',
      target: entry.channel,
      stressLevel: entry.boost,
      contribution: entry.boost,
    });
  }

  return links;
}
