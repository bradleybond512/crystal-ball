/**
 * Weather-Threat Situation Seeder
 *
 * When compound weather-threat convergences are detected (e.g., hurricane +
 * power grid stress), auto-seeds corresponding situations in the situation
 * engine so they appear alongside other OODA-loop situations.
 *
 * This bridges weather-threat-convergence.ts (which detects compound weather
 * risks) with situation-engine.ts (which manages OODA-loop situations).
 */

import { getActiveConvergences, type WeatherThreatConvergence } from './weather-threat-convergence';
import { situationEngine } from './situation-engine';
import type { SignalType } from './analysis-core';

// ── Dedup ────────────────────────────────────────────────────────────────────

const seededIds = new Set<string>();
const SEEDED_TTL_MS = 30 * 60 * 1000;
const MIN_CONVERGENCE_SCORE = 60;

function pruneSeeded(): void {
  if (seededIds.size > 200) seededIds.clear();
}

// ── Seeding ──────────────────────────────────────────────────────────────────

function convergenceToSignal(conv: WeatherThreatConvergence) {
  let severity: 'critical' | 'high' | 'medium' = 'medium';
  if (conv.convergenceScore >= 80) severity = 'critical';
  else if (conv.convergenceScore >= 60) severity = 'high';

  return {
    id: `wtc-seed-${conv.id}`,
    type: 'compound_weather' as SignalType,
    source: 'Weather-Threat Convergence',
    title: conv.description,
    description: `Weather convergence: ${conv.weatherAlert.event} (${conv.weatherAlert.severity}) with ${conv.collocatedThreats.length} collocated threat(s). Score: ${conv.convergenceScore}/100`,
    severity: severity as 'critical' | 'high' | 'medium' | 'low',
    confidence: Math.min(0.95, conv.convergenceScore / 100),
    category: 'natural_hazard',
    timestamp: new Date(conv.detectedAt),
    location: { lat: conv.lat, lon: conv.lon, name: conv.region ?? 'Unknown' },
    data: {
      weatherEvent: conv.weatherAlert.event,
      collocatedCount: conv.collocatedThreats.length,
      riskMultiplier: conv.riskMultiplier,
      convergenceScore: conv.convergenceScore,
    },
    metadata: {
      weatherAlertId: conv.weatherAlert.id,
      collocatedSources: conv.collocatedThreats.map(t => t.source),
    },
  };
}

/**
 * Check for high-scoring weather-threat convergences and seed them
 * into the situation engine as pseudo-signals.
 */
export function seedWeatherSituations(): number {
  pruneSeeded();
  const convergences = getActiveConvergences();
  let seeded = 0;

  const signals = [];
  for (const conv of convergences) {
    if (conv.convergenceScore < MIN_CONVERGENCE_SCORE) continue;
    if (seededIds.has(conv.id)) continue;
    seededIds.add(conv.id);
    setTimeout(() => seededIds.delete(conv.id), SEEDED_TTL_MS);
    signals.push(convergenceToSignal(conv));
    seeded++;
  }

  if (signals.length > 0) {
    situationEngine.observeSignals(signals);
  }

  return seeded;
}

export function getSeededCount(): number {
  return seededIds.size;
}
