/**
 * Disease + humanitarian loaders — pulled out of data-loader.ts so epidemic
 * surveillance and humanitarian-crisis feeds live next to each other and are
 * easier to modify independently.
 */
import type { AppContext } from '@/app/app-context';
import {
  fetchDiseaseOutbreaks,
  fetchGlobalDiseaseSnapshots,
  fetchCdcSurveillance,
} from '@/services/disease-outbreak';
import { fetchDiseaseIntel } from '@/services/disease-intel';
import { fetchHdxCrises } from '@/services/hdx-crisis';
import type { DiseaseOutbreakPanel } from '@/components/DiseaseOutbreakPanel';
import type { DiseaseIntelPanel } from '@/components/DiseaseIntelPanel';
import type { HumanitarianCrisisPanel } from '@/components/HumanitarianCrisisPanel';

export async function loadDiseaseOutbreaks(ctx: AppContext): Promise<void> {
  try {
 const [outbreaks, snapshots, cdcSignals] = await Promise.all([
 fetchDiseaseOutbreaks(),
 fetchGlobalDiseaseSnapshots(),
 fetchCdcSurveillance(),
 ]);
 const cdcOutbreaks = cdcSignals.map((s, i) => {
 const suffix = s.value === null ? '' : ` (${s.value})`;
 return {
 id: `cdc-${i}-${s.date}`,
 title: `${s.disease}: ${s.metric}${suffix}`,
 country: s.region,
 disease: s.disease,
 date: new Date(s.date),
 url: s.url,
 source: (s.source === 'WHO' ? 'WHO' : 'ReliefWeb') as 'WHO' | 'ReliefWeb' | 'ProMED',
 severity: (s.severity === 'alert' ? 'high' : 'medium') as 'critical' | 'high' | 'medium' | 'low',
 };
 });
 (ctx.panels['disease-outbreaks'] as DiseaseOutbreakPanel | undefined)?.update(
 [...outbreaks, ...cdcOutbreaks],
 snapshots,
 );
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[disease-outbreaks] fetch failed', error);
 // Surface an actionable degraded state instead of an empty list
 // (which used to render identically to "no outbreaks today" — the
 // user couldn't tell whether the world was quiet or the upstream
 // sources were down).
 const reason = error instanceof Error ? error.message : 'all sources failed';
 (ctx.panels['disease-outbreaks'] as DiseaseOutbreakPanel | undefined)?.showUpstreamUnavailable(reason);
  }
}

export async function loadDiseaseIntel(ctx: AppContext): Promise<void> {
  try {
 const data = await fetchDiseaseIntel();
 (ctx.panels['disease-intel'] as DiseaseIntelPanel | undefined)?.update(data);
 if (ctx.mapLayers.diseaseIntel) {
 ctx.map?.setDiseaseIntel(data);
 }
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[disease-intel] fetch failed', error);
 (ctx.panels['disease-intel'] as DiseaseIntelPanel | undefined)?.update(null);
  }
}

export async function loadHumanitarianCrises(ctx: AppContext): Promise<void> {
  try {
 const crises = await fetchHdxCrises();
 (ctx.panels['humanitarian-crisis'] as HumanitarianCrisisPanel | undefined)?.update(crises);
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[humanitarian-crisis] fetch failed', error);
 (ctx.panels['humanitarian-crisis'] as HumanitarianCrisisPanel | undefined)?.update([]);
  }
}
