/**
 * Hazard loaders — fetch sources that feed both a dedicated panel and the
 * unified hazard-alerts proximity/compound-threat pipeline.
 *
 * Each loader accepts the live AppContext plus a `triggerCompoundEval`
 * callback. The callback is the only cross-module dependency — the compound
 * threat engine is still owned by the DataLoader class because it composes
 * data from many domains.
 */
import type { AppContext } from '@/app/app-context';
import { fetchGlobalAirQuality } from '@/services/air-quality';
import { fetchInciwebIncidents } from '@/services/inciweb';
import { fetchHazmatIncidents } from '@/services/hazmat-incidents';
import { fetchOilSpills } from '@/services/oil-spill-tracker';
import { proximityAlertService } from '@/services/proximity-alerts';
import type { AirQualityPanel } from '@/components/AirQualityPanel';
import type { WildfireIncidentsPanel } from '@/components/WildfireIncidentsPanel';
import type { HazmatIncidentsPanel } from '@/components/HazmatIncidentsPanel';
import type { OilSpillPanel } from '@/components/OilSpillPanel';
import type { HazardAlertsPanel } from '@/components/HazardAlertsPanel';

export async function loadAirQuality(ctx: AppContext, triggerCompoundEval: () => void): Promise<void> {
  try {
 const readings = await fetchGlobalAirQuality();
 (ctx.panels['air-quality'] as AirQualityPanel | undefined)?.update(readings);
 void proximityAlertService.checkAirQuality(readings);
 (ctx.panels['hazard-alerts'] as HazardAlertsPanel | undefined)?.refresh();
 triggerCompoundEval();
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[air-quality] fetch failed', error);
 (ctx.panels['air-quality'] as AirQualityPanel | undefined)?.update([]);
  }
}

export async function loadWildfireIncidents(ctx: AppContext, triggerCompoundEval: () => void): Promise<void> {
  try {
 const incidents = await fetchInciwebIncidents();
 (ctx.panels['wildfire-incidents'] as WildfireIncidentsPanel | undefined)?.update(incidents);
 void proximityAlertService.checkWildfires(incidents);
 (ctx.panels['hazard-alerts'] as HazardAlertsPanel | undefined)?.refresh();
 triggerCompoundEval();
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[wildfire-incidents] fetch failed', error);
 (ctx.panels['wildfire-incidents'] as WildfireIncidentsPanel | undefined)?.update([]);
  }
}

export async function loadHazmatIncidents(ctx: AppContext, triggerCompoundEval: () => void): Promise<void> {
  try {
 const incidents = await fetchHazmatIncidents();
 (ctx.panels['hazmat-incidents'] as HazmatIncidentsPanel | undefined)?.update(incidents);
 void proximityAlertService.checkHazmat(incidents);
 (ctx.panels['hazard-alerts'] as HazardAlertsPanel | undefined)?.refresh();
 triggerCompoundEval();
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[hazmat-incidents] fetch failed', error);
 (ctx.panels['hazmat-incidents'] as HazmatIncidentsPanel | undefined)?.update([]);
  }
}

export async function loadOilSpills(ctx: AppContext): Promise<void> {
  try {
 const incidents = await fetchOilSpills();
 (ctx.panels['oil-spill'] as OilSpillPanel | undefined)?.update(incidents);
 void proximityAlertService.checkOilSpills(incidents);
 (ctx.panels['hazard-alerts'] as HazardAlertsPanel | undefined)?.refresh();
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[oil-spills] fetch failed', error);
 (ctx.panels['oil-spill'] as OilSpillPanel | undefined)?.update([]);
  }
}
