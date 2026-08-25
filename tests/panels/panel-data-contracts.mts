/**
 * Panel data contracts — per
 * docs/CLAUDE_REVIEW_FINDINGS_AND_PANEL_DATA_ROADMAP_2026-04-29.md
 * Priority 4.
 *
 * Many smoke "degraded" rows are not proof of broken data — they're
 * proof that the panel is mounted in isolation without its data
 * pipeline. The real app uses `DataLoader.loadAllData()` to push data
 * into panels via `update()` / `setData()` / etc. This registry
 * classifies each panel by HOW it gets data, so smoke counts are
 * meaningful instead of misleading.
 *
 * Each panel falls into one of seven categories:
 *
 *   - self-fetches:                       constructor calls fetch()
 *   - updated-by-data-loader:             waits for DataLoader.update()
 *   - requires-user-config:               needs saved place / location click
 *   - requires-api-key:                   shows degraded until key is set
 *   - static-local:                       no remote data; renders from
 *                                         local-only state
 *   - fixture-only-testable:              has no real backend yet (scaffold)
 *   - intentionally-degraded-in-isolated-smoke:
 *                                         alone-in-harness state is degraded
 *                                         by design; live mounting is fine
 *
 * The accompanying test (panel-data-contracts.test.mts) reports
 * panels missing from this registry as a TODO list. Newly-added panels
 * must be classified here.
 */

export type PanelDataContract =
  | 'self-fetches'
  | 'updated-by-data-loader'
  | 'requires-user-config'
  | 'requires-api-key'
  | 'static-local'
  | 'fixture-only-testable'
  | 'intentionally-degraded-in-isolated-smoke';

export interface PanelContractEntry {
  contract: PanelDataContract;
  /** Update method name when contract === 'updated-by-data-loader'. */
  updateMethod?: string;
  /** Loader file when contract === 'updated-by-data-loader'. */
  loaderFile?: string;
  /** Free-text reason for the classification. */
  reason?: string;
}

/**
 * Initial classification covers the high-value panels (those the
 * fixture smoke covers) + clear self-fetchers + clear data-loader
 * receivers. Panels not yet classified will surface as TODOs in the
 * gate test.
 */
export const PANEL_DATA_CONTRACTS: Record<string, PanelContractEntry> = {
  // ── self-fetches (constructor → void this.fetchData()) ──────────────
  'national-debt': { contract: 'self-fetches' },
  'fear-greed': { contract: 'self-fetches' },
  'fuel-prices': { contract: 'self-fetches' },
  'faa-weather-cams': { contract: 'self-fetches' },
  'gdelt-intel': { contract: 'self-fetches' },
  'live-news': { contract: 'self-fetches' },
  'service-status': { contract: 'self-fetches' },
  'internet-disruptions': { contract: 'self-fetches' },
  'amtrak-alerts': { contract: 'self-fetches' },
  'pollen': { contract: 'self-fetches' },
  'weather-radar': { contract: 'self-fetches' },
  'space-weather': { contract: 'self-fetches' },
  'air-quality': { contract: 'self-fetches' },

  // ── updated-by-data-loader (DataLoader pushes data via update()) ────
  'nws-alerts': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
    reason: 'NWS alerts pushed via DataLoader.loadWeatherAlerts() → setWeatherAlerts on map + update() on panel',
  },
  'gdacs-alerts': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
  },
  'earthquakes': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
  },
  'tsunami-alerts': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
  },
  'volcano-alerts': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
  },
  'satellite-fires': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
  },
  'disease-outbreaks': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/loaders/disease.ts',
  },
  'disease-intel': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/loaders/disease.ts',
  },
  'humanitarian-crisis': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/loaders/disease.ts',
  },
  'extended-forecast': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
  },
  'tide-predictions': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
  },
  'tropical-cyclones': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
  },
  'wildfire-smoke': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
  },
  'wildfire-incidents': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
  },
  'cyber-threats': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
  },
  'markets': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
  },
  'commodities': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
  },
  'crypto': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
  },
  'economic': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
  },
  'forex': {
    contract: 'updated-by-data-loader',
    updateMethod: 'update',
    loaderFile: 'src/app/data-loader.ts',
  },

  // ── intentionally-degraded-in-isolated-smoke ─────────────────────────
  // Panels fed via direct method calls (setRequests, setData with no
  // initial fetch). Empty-state in isolation is by design.
  'shortage-radar': {
    contract: 'intentionally-degraded-in-isolated-smoke',
    reason: 'Fed via panel.setRequests([...]) by host, not fetch.',
  },
  'command-center': {
    contract: 'intentionally-degraded-in-isolated-smoke',
    reason: 'Fed via setActiveSituation() + setSavedPlaces() by host bridge.',
  },
  'system-diagnostic': {
    contract: 'self-fetches',
    reason: 'Reads diagnostic registries on a 5s tick.',
  },
  'algorithm-diagnostic': {
    contract: 'self-fetches',
    reason: 'Reads algorithm health registry on a 15s tick.',
  },

  // ── requires-api-key (degrades visibly until user sets key) ──────────
  'breakthroughs': {
    contract: 'requires-api-key',
    reason: 'Optional ANTHROPIC_API_KEY for breakthroughs synthesis.',
  },
  'ask-crystal-ball': {
    contract: 'requires-api-key',
    reason: 'Requires ANTHROPIC/GROQ/OPENROUTER for inference.',
  },
  'survival-advisor': { contract: 'requires-api-key' },

  // ── static-local (no remote data, renders from saved/static state) ──
  'saved-places': { contract: 'static-local' },
  'watchlist': { contract: 'static-local' },
  'watchlist-locations': { contract: 'static-local' },
  'family-tracker': { contract: 'requires-user-config' },
  'evacuation': { contract: 'requires-user-config' },
  'comms-plan': { contract: 'static-local' },
  'emergency-readiness': { contract: 'static-local', reason: 'Read-only projection over the hydrated survival snapshot and verified Lifelines receipt.' },
  'resource-inventory': { contract: 'static-local' },
  'after-action-review': { contract: 'static-local' },
  'alert-rules': { contract: 'static-local' },
  'offline-maps': { contract: 'static-local' },

};

/** Returns true when the panel id has a recorded contract. */
export function hasPanelContract(panelId: string): boolean {
  return panelId in PANEL_DATA_CONTRACTS;
}

/** Look up a panel's contract entry, or undefined. */
export function getPanelContract(panelId: string): PanelContractEntry | undefined {
  return PANEL_DATA_CONTRACTS[panelId];
}

/** All panel ids classified into a specific contract. */
export function panelsByContract(contract: PanelDataContract): string[] {
  return Object.entries(PANEL_DATA_CONTRACTS)
    .filter(([, e]) => e.contract === contract)
    .map(([id]) => id)
    .sort();
}
