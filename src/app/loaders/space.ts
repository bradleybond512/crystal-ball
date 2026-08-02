/**
 * Space-domain loaders — space weather, spaceflight news, launches.
 *
 * Extracted from the data-loader god class. Each function takes the live
 * AppContext and updates the appropriate panel. Errors are caught and surfaced
 * via a console.warn (log-bridge forwards to the desktop log + breadcrumb
 * buffer).
 */
import type { AppContext } from '@/app/app-context';
import { fetchSpaceWeather, fetchDonkiEvents } from '@/services/space-weather';
import { fetchSpaceflightNews } from '@/services/spaceflight-news';
import { fetchSpaceLaunches } from '@/services/space-launches';
import type { SpaceWeatherPanel } from '@/components/SpaceWeatherPanel';
import type { SpaceflightNewsPanel } from '@/components/SpaceflightNewsPanel';
import type { SpaceLaunchesPanel } from '@/components/SpaceLaunchesPanel';

export async function loadSpaceWeather(ctx: AppContext): Promise<void> {
  try {
 const [data, donkiEvents] = await Promise.all([fetchSpaceWeather(), fetchDonkiEvents()]);
 (ctx.panels['space-weather'] as SpaceWeatherPanel | undefined)?.update({ ...data, donkiEvents });
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[space-weather] fetch failed', error);
 (ctx.panels['space-weather'] as SpaceWeatherPanel | undefined)?.update({
 kpIndex: null, kpClass: 'quiet', solarWindSpeed: null, solarWindDensity: null,
 bz: null, windObservedAt: null, xrayClass: null, alertMessages: [],
 fetchedAt: new Date(), donkiEvents: [],
 });
  }
}

export async function loadSpaceflightNews(ctx: AppContext): Promise<void> {
  try {
 const articles = await fetchSpaceflightNews();
 (ctx.panels['spaceflight-news'] as SpaceflightNewsPanel | undefined)?.update(articles);
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[spaceflight-news] fetch failed', error);
 (ctx.panels['spaceflight-news'] as SpaceflightNewsPanel | undefined)?.update([]);
  }
}

export async function loadSpaceLaunches(ctx: AppContext): Promise<void> {
  try {
 const launches = await fetchSpaceLaunches();
 (ctx.panels['space-launches'] as SpaceLaunchesPanel | undefined)?.update(launches);
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[space-launches] fetch failed', error);
 (ctx.panels['space-launches'] as SpaceLaunchesPanel | undefined)?.update([]);
  }
}
