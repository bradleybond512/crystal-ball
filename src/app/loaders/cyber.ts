/**
 * Cyber-domain loaders — local IDS + volcano (which is really a single-source
 * natural-hazard fetch but lives adjacent to cyber/sigint in terms of the
 * light alert-ingest pattern they share).
 *
 * Kept small on purpose: heavier cyber-threat aggregation (ThreatFox, OTX,
 * CISA KEV, etc.) still lives in data-loader.ts because its compound-IOC
 * pipeline touches too many intel services to extract cleanly in one pass.
 */
import type { AppContext } from '@/app/app-context';
import { fetchLocalIDSAlerts } from '@/services/local-ids';
import { fetchVolcanoAlerts } from '@/services/volcano-alerts';
import { unifiedAlertStore } from '@/services/unified-alerts';
import type { LocalIDSPanel } from '@/components/LocalIDSPanel';
import type { VolcanoAlertsPanel } from '@/components/VolcanoAlertsPanel';

export async function loadLocalIDS(ctx: AppContext): Promise<void> {
  try {
 const alerts = await fetchLocalIDSAlerts();
 (ctx.panels['local-ids'] as LocalIDSPanel | undefined)?.update(alerts);
 // Mirror high/critical IDS alerts into the unified store so triage bar,
 // notifications, and reactions pick them up.
 const unified = alerts
 .filter(a => a.severity === 'high' || a.severity === 'critical')
 .map(a => ({
 id: `localids-${a.id}`,
 source: 'local-ids' as const,
 severity: a.severity,
 title: a.signature || a.category || 'IDS alert',
 body: `${a.source} · ${a.srcIp} → ${a.destIp} (${a.proto}) ${a.action}`,
 timestamp: Date.parse(a.ts) || Date.now(),
 relevanceScore: 50,
 acknowledged: false,
 pinned: false,
 }));
 if (unified.length > 0) unifiedAlertStore.ingest(unified);
  } catch {
 (ctx.panels['local-ids'] as LocalIDSPanel | undefined)?.update([]);
  }
}

export async function loadVolcanoAlerts(ctx: AppContext): Promise<void> {
  try {
 const alerts = await fetchVolcanoAlerts();
 (ctx.panels['volcano-alerts'] as VolcanoAlertsPanel | undefined)?.update(alerts);
  } catch (error) {
 // eslint-disable-next-line no-console
 console.warn('[volcano-alerts] fetch failed', error);
 (ctx.panels['volcano-alerts'] as VolcanoAlertsPanel | undefined)?.update([]);
  }
}
