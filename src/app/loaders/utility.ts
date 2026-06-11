/**
 * Utility / infrastructure loaders — small, single-source fetch→update flows.
 *
 * These all follow the same shape: pull one or two upstream sources, push the
 * result into a named panel, fall back to `update(null | [])` on error. Broken
 * out of data-loader.ts so each domain owns its own file.
 */
import type { AppContext } from '@/app/app-context';
import { fetchSavedPlaceWeather, getSavedPlaces } from '@/services';
import { fetchGlobalWeather } from '@/services/global-weather';
import { fetchSanctionsCoverage } from '@/services/opensanctions';
import { fetchRecentEdgarFilings } from '@/services/sec-edgar';
import { fetchCommsHealth } from '@/services/comms-health';
import { fetchGridStatus } from '@/services/power-grid';
import { fetchEconomicStress } from '@/services/economic-stress';
import { fetchWsbSentiment } from '@/services/wsb-sentiment';
import { fetchFederalRegister } from '@/services/federal-register';
import type { CommsHealthPanel } from '@/components/CommsHealthPanel';
import type { PowerGridPanel } from '@/components/PowerGridPanel';
import type { EconomicStressPanel } from '@/components/EconomicStressPanel';
import type { FederalRegisterPanel } from '@/components/FederalRegisterPanel';
import type { GlobalWeatherPanel } from '@/components/GlobalWeatherPanel';
import type { OpenSanctionsPanel } from '@/components/OpenSanctionsPanel';
import type { EdgarFilingsPanel } from '@/components/EdgarFilingsPanel';

export async function loadCommsHealth(ctx: AppContext): Promise<void> {
  try {
 const data = await fetchCommsHealth();
 (ctx.panels['comms-health'] as CommsHealthPanel | undefined)?.update(data);
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[comms-health] fetch failed', error);
 (ctx.panels['comms-health'] as CommsHealthPanel | undefined)?.update(null);
  }
}

export async function loadPowerGrid(ctx: AppContext): Promise<void> {
  try {
 const data = await fetchGridStatus();
 (ctx.panels['power-grid'] as PowerGridPanel | undefined)?.update(data);
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[power-grid] fetch failed', error);
 (ctx.panels['power-grid'] as PowerGridPanel | undefined)?.update(null);
  }
}

export async function loadEconomicStress(ctx: AppContext): Promise<void> {
  try {
 const [data, snapshots] = await Promise.all([fetchEconomicStress(), fetchWsbSentiment()]);
 (ctx.panels['economic-stress'] as EconomicStressPanel | undefined)?.update(data, snapshots);
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[economic-stress] fetch failed', error);
 (ctx.panels['economic-stress'] as EconomicStressPanel | undefined)?.update(null);
  }
}

export async function loadFederalRegister(ctx: AppContext): Promise<void> {
  const panel = ctx.panels['federal-register'] as FederalRegisterPanel | undefined;
  if (!panel) return;
  const docs = await fetchFederalRegister();
  panel.update(docs);
}

export async function loadGlobalWeather(ctx: AppContext): Promise<void> {
  try {
 const cities = await fetchGlobalWeather();
 (ctx.panels['global-weather'] as GlobalWeatherPanel | undefined)?.update(cities);
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[global-weather] fetch failed', error);
 (ctx.panels['global-weather'] as GlobalWeatherPanel | undefined)?.update([]);
  }
}

export async function loadOpenSanctions(ctx: AppContext): Promise<void> {
  try {
 const datasets = await fetchSanctionsCoverage();
 (ctx.panels.opensanctions as OpenSanctionsPanel | undefined)?.update(datasets);
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[opensanctions] fetch failed', error);
 (ctx.panels.opensanctions as OpenSanctionsPanel | undefined)?.update([]);
  }
}

export async function loadEdgarFilings(ctx: AppContext): Promise<void> {
  try {
 const filings = await fetchRecentEdgarFilings();
 (ctx.panels['edgar-filings'] as EdgarFilingsPanel | undefined)?.update(filings);
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[edgar-filings] fetch failed', error);
 (ctx.panels['edgar-filings'] as EdgarFilingsPanel | undefined)?.update([]);
  }
}

export async function loadSavedPlaceWeather(): Promise<void> {
  const places = getSavedPlaces().slice(0, 6);
  if (places.length === 0) return;

  const results = await Promise.allSettled(
 places.map((place) => fetchSavedPlaceWeather(place)),
  );

  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length === results.length) {
 throw new Error('saved-place weather refresh failed');
  }
}
