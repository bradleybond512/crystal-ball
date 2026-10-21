const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const version = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const meets = (actual, minimum) => {
  const parts = actual.split('.').map(Number);
  const required = minimum.split('.').map(Number);
  for (let i = 0; i < parts.length; i++) if (parts[i] !== required[i]) return parts[i] > required[i];
  return true;
};

export function resolveAvailability({ release, manifest, catalog, counts }) {
  const definitions = catalog.features;
  const features = Object.fromEntries(definitions.map(feature => [feature.id, {
    available: false, component: feature.component, separateInstallation: feature.component === 'companion', variants: feature.variants ?? [],
  }]));
  const labels = Object.fromEntries(Object.entries(catalog.marketingLabels).map(([id, definition]) => [id, definition.label]));
  const unavailable = { verified: false, catalogMatches: false, sourceCommit: null, features, labels, companionToolCounts: null };
  if (!release?.available || !version(release.version) || release.tag !== `v${release.version}`
    || typeof release.publishedAt !== 'string' || !Number.isFinite(Date.parse(release.publishedAt))
    || !object(manifest) || manifest.tag !== release.tag || manifest.version !== release.version || !sha(manifest.commitSha)) return unavailable;
  const capabilities = manifest.capabilities;
  if (!object(capabilities) || capabilities.schemaVersion !== 1 || catalog.schemaVersion !== 1
    || capabilities.sourceCommit !== manifest.commitSha || !object(capabilities.components)) return unavailable;
  const { desktop, companion } = capabilities.components;
  if (!object(desktop) || !object(companion) || desktop.version !== release.version || desktop.bundled !== true
    || !['full', 'tech', 'finance', 'happy'].includes(desktop.variant) || manifest.variant !== desktop.variant
    || !version(companion.version) || companion.bundled !== false || companion.requiresSeparateInstallation !== true
    || companion.sourceCommit !== manifest.commitSha) return unavailable;
  for (const [component, metadata] of Object.entries({ desktop, companion })) {
    if (!Array.isArray(metadata.features) || new Set(metadata.features.map(feature => feature?.id)).size !== metadata.features.length) return unavailable;
    for (const feature of metadata.features) {
      const definition = definitions.find(entry => entry.id === feature?.id);
      if (!definition || definition.component !== component || !equal(feature, definition)
        || component === 'desktop' && (!version(definition.minimumVersion) || !meets(release.version, definition.minimumVersion)
          || definition.variants && !definition.variants.includes(desktop.variant))) return unavailable;
    }
  }
  const toolCounts = companion.toolCounts;
  const panels = capabilities.sourceCatalogs?.panels;
  if (!object(toolCounts) || !object(panels)
    || !['total', 'read', 'analystAdditional'].every(key => Number.isSafeInteger(toolCounts[key]) && toolCounts[key] >= 0)
    || toolCounts.total !== toolCounts.read + toolCounts.analystAdditional
    || !Object.keys(counts.panels).every(key => Number.isSafeInteger(panels[key]) && panels[key] > 0)) return unavailable;
  for (const metadata of [desktop, companion]) for (const feature of metadata.features) features[feature.id].available = true;
  const complete = definitions.every(feature => feature.component === 'desktop' && !meets(release.version, feature.minimumVersion) || feature.variants && !feature.variants.includes(desktop.variant)
    || features[feature.id].available);
  if (!complete) return { ...unavailable, features: Object.fromEntries(Object.entries(features).map(([id, feature]) => [id, { ...feature, available: false }])) };
  return {
    verified: true,
    catalogMatches: complete && Object.keys(panels).length === Object.keys(counts.panels).length
      && Object.entries(counts.panels).every(([key, count]) => panels[key] === count)
      && toolCounts.total === counts.mcp.total && toolCounts.read === counts.mcp.read && toolCounts.analystAdditional === counts.mcp.analyst,
    sourceCommit: manifest.commitSha, features,
    labels: Object.fromEntries(Object.entries(catalog.marketingLabels).map(([id, definition]) => [id, features[id]?.available && version(definition.minimumReleaseVersion) && meets(release.version, definition.minimumReleaseVersion) ? null : definition.label])),
    companionToolCounts: toolCounts,
  };
}
