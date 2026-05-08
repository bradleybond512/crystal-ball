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
import type { WildfireIntelPanel } from '@/components/WildfireIntelPanel';
import { fetchFireIntelSnapshot } from '@/services/wildfires/fire-intel-service';
import { fetchPurpleAirSnapshot } from '@/services/airquality/purpleair-service';
import { getSavedPlaces } from '@/services/saved-places';

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

export async function loadWildfireIntel(ctx: AppContext): Promise<void> {
  const panel = ctx.panels['wildfire-intel'] as WildfireIntelPanel | undefined;
  if (!panel) return;
  try {
 const places = getSavedPlaces();
 const snapshot = await fetchFireIntelSnapshot(places);
 panel.update(snapshot);
 emitFireTriggerEvent(snapshot);
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[wildfire-intel] fetch failed', error);
 panel.showUpstreamUnavailable(error instanceof Error ? error.message : String(error));
  }
}

export async function loadPurpleAir(ctx: AppContext): Promise<void> {
  const panel = ctx.panels['wildfire-intel'] as WildfireIntelPanel | undefined;
  if (!panel) return;
  try {
 const snapshot = await fetchPurpleAirSnapshot();
 panel.updatePurpleAir(snapshot);
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[purpleair] fetch failed', error);
  }
}

/**
 * Emit a `wildfire:fire-trigger` CustomEvent for the top-3 threat-ranked
 * incidents that have lat/lon. Webcam aggregators (or other consumers)
 * can listen and call evaluateFireTrigger() against their spatial index.
 * Skipped silently when nothing has coordinates.
 */
function emitFireTriggerEvent(snapshot: { rankedThreats: { incident: { id: string; lat: number | null; lon: number | null; name: string; updatedAt: Date } }[] }): void {
  if (typeof globalThis === 'undefined' || typeof CustomEvent === 'undefined') return;
  const inputs = snapshot.rankedThreats
 .slice(0, 3)
 .map(t => t.incident)
 .filter(inc => inc.lat !== null && inc.lon !== null)
 .map(inc => ({
 id: inc.id,
 lat: inc.lat as number,
 lon: inc.lon as number,
 name: inc.name,
 detectedAt: inc.updatedAt.getTime(),
 }));
  if (inputs.length === 0) return;
  globalThis.dispatchEvent(new CustomEvent('wildfire:fire-trigger', { detail: { incidents: inputs } }));
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
