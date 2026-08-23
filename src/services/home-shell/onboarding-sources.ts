import { RUNTIME_FEATURES } from '@/services/runtime-config';
import type { RuntimeFeatureDefinition, RuntimeFeatureId } from '@/services/runtime-config';

interface OptionalOnboardingSourceDefinition {
  name: 'NewsAPI' | 'OpenWeatherMap';
  featureId: 'newsApiHeadlines' | 'owmWeatherTiles';
  unlocks: string;
}

function requireFeature(
  featureId: RuntimeFeatureId,
  features: readonly RuntimeFeatureDefinition[],
): RuntimeFeatureDefinition {
  const feature = features.find((candidate) => candidate.id === featureId);
  if (!feature) throw new Error(`Missing runtime feature metadata: ${featureId}`);
  return feature;
}

/**
 * The onboarding descriptions intentionally share the runtime feature catalog.
 * This prevents Welcome copy from drifting away from the actual keyed feature.
 */
export function buildOptionalOnboardingSources(
  features: readonly RuntimeFeatureDefinition[] = RUNTIME_FEATURES,
): readonly OptionalOnboardingSourceDefinition[] {
  const news = requireFeature('newsApiHeadlines', features);
  const weatherTiles = requireFeature('owmWeatherTiles', features);
  return [
    { name: 'NewsAPI', featureId: 'newsApiHeadlines', unlocks: news.description },
    { name: 'OpenWeatherMap', featureId: 'owmWeatherTiles', unlocks: weatherTiles.description },
  ];
}

export const OPTIONAL_ONBOARDING_SOURCES = buildOptionalOnboardingSources();
