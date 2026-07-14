/* eslint-disable sonarjs/no-nested-conditional, unicorn/no-nested-ternary, unicorn/no-negated-condition */
import { Panel } from './Panel';
import type { DiseaseOutbreak, GlobalDiseaseSnapshot } from '@/services/disease-outbreak';
import type { WastewaterData } from '@/services/wastewater';
import type { WhoDonAlert, WhoProMedCrossReference } from '@/services/disease-intel';
import { renderWastewaterTab, renderCrossReferencedTab } from './disease-outbreak-tabs';
import { renderWastewaterSitesTab } from './wastewater-sites-tab';
import {
  fetchWastewaterSurveillance,
  type WastewaterSurveillance,
} from '@/services/biosurveillance/wastewater-service';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import {
  buildAriSnapshot,
  colorForLevel,
  type AriRowRaw,
  type AriSnapshot,
} from '@/services/biosurveillance/cdc-ari';

type Tab = 'outbreaks' | 'wastewater' | 'wastewater-sites' | 'cross-ref' | 'flu';

const TAB_STORAGE_KEY = 'cb:disease-outbreak-tab';
const TAB_LABELS: Record<Tab, string> = {
  outbreaks: 'Outbreaks',
  wastewater: 'Wastewater',
  'wastewater-sites': 'Wastewater Sites',
  'cross-ref': 'Cross-Referenced',
  flu: 'Flu Surveillance',
};

const ARI_REFRESH_MS = 6 * 60 * 60 * 1000;
const WW_SITES_REFRESH_MS = 24 * 60 * 60 * 1000;

export class DiseaseOutbreakPanel extends Panel {
  private outbreaks: DiseaseOutbreak[] = [];
  private snapshots: GlobalDiseaseSnapshot[] = [];
  private wastewater: WastewaterData | null = null;
  private crossRefs: WhoProMedCrossReference[] = [];
  private whoDonAlerts: WhoDonAlert[] = [];
  private ari: AriSnapshot | null = null;
  private ariError: string | null = null;
  private ariTimer: ReturnType<typeof setInterval> | null = null;
  private wwSites: WastewaterSurveillance | null = null;
  private wwSitesTimer: ReturnType<typeof setInterval> | null = null;
  private lastUpdated: Date | null = null;
  private activeTab: Tab = readStoredTab();

  constructor() {
 super({
 id: 'disease-outbreaks',
 title: t('panels.diseaseOutbreaks'),
 showCount: true,
 trackActivity: true,
 infoTooltip: 'WHO Disease Outbreak News + ReliefWeb + ProMED + CDC NWSS wastewater + CDC ARI by state. Updated every 15 minutes.',
 });
 this.showLoading('Fetching WHO outbreak data...');
 this.startAriPolling();
 this.startWastewaterSitesPolling();
  }

  private startAriPolling(): void {
 if (this.ariTimer !== null) return;
 setTimeout(() => void this.refreshAri(), 0);
 this.ariTimer = setInterval(() => void this.refreshAri(), ARI_REFRESH_MS);
  }

  public destroy(): void {
    super.destroy();
 if (this.ariTimer !== null) {
 clearInterval(this.ariTimer);
 this.ariTimer = null;
 }
 if (this.wwSitesTimer !== null) {
 clearInterval(this.wwSitesTimer);
 this.wwSitesTimer = null;
 }
  }

  private startWastewaterSitesPolling(): void {
 if (this.wwSitesTimer !== null) return;
 setTimeout(() => void this.refreshWastewaterSites(), 0);
 this.wwSitesTimer = setInterval(() => void this.refreshWastewaterSites(), WW_SITES_REFRESH_MS);
  }

  private async refreshWastewaterSites(): Promise<void> {
 try {
 this.wwSites = await fetchWastewaterSurveillance();
 if (this.activeTab === 'wastewater-sites') this.render();
 } catch {
 /* degraded payload returned by service; ignore */
 }
  }

  /** Allow the host to inject the wastewater-surveillance snapshot
   *  instead of (or in addition to) the panel's own poll loop. */
  public setWastewaterSites(snapshot: WastewaterSurveillance | null): void {
 this.wwSites = snapshot;
 this.render();
  }

  /** Allow the host to inject ARI data instead of (or in addition to) the
   *  panel's own /api/cdc-ari fetch loop. */
  public setAri(snapshot: AriSnapshot | null): void {
 this.ari = snapshot;
 this.ariError = null;
 this.render();
  }

  private async refreshAri(): Promise<void> {
 try {
 const resp = await fetch('/api/cdc-ari', { headers: { Accept: 'application/json' } });
 if (!resp.ok) {
 this.ariError = `HTTP ${resp.status}`;
 this.render();
 return;
 }
 const body = (await resp.json()) as { rows?: AriRowRaw[]; error?: string };
 if (body.error) {
 this.ariError = body.error;
 this.render();
 return;
 }
 this.ari = buildAriSnapshot(Array.isArray(body.rows) ? body.rows : []);
 this.ariError = null;
 this.render();
 } catch (error) {
 this.ariError = String((error as Error)?.message ?? error);
 this.render();
 }
  }

  public update(outbreaks: DiseaseOutbreak[], snapshots: GlobalDiseaseSnapshot[] = []): void {
 this.outbreaks = outbreaks;
 this.snapshots = snapshots;
 this.lastUpdated = new Date();
 this.setCount(outbreaks.length);
 this.render();
  }

  public setWastewater(data: WastewaterData | null): void {
 this.wastewater = data;
 this.render();
  }

  public setCrossReferences(crossRefs: WhoProMedCrossReference[], whoDonAlerts: WhoDonAlert[]): void {
 this.crossRefs = crossRefs;
 this.whoDonAlerts = whoDonAlerts;
 this.render();
  }

  /** Surface a clear "upstream sources unavailable" state when the
   *  loader catches a fetch failure. Distinct from update([]) which
   *  legitimately means "no outbreaks reported today." */
  public showUpstreamUnavailable(reason?: string): void {
 const detail = reason ? `: ${reason}` : '';
 this.setContent(
 `<div class="panel-empty">Disease outbreak sources unavailable${escapeHtml(detail)}.<br/>` +
 `Sources: WHO Disease Outbreak News + ReliefWeb + ProMED — will retry on the next 15-min refresh.</div>`,
 );
 this.setCount(0);
  }

  private renderTabStrip(): string {
 const tabs: Tab[] = ['outbreaks', 'wastewater', 'wastewater-sites', 'cross-ref', 'flu'];
 return `<div class="do-tab-strip" role="tablist" style="display:flex;gap:6px;margin-bottom:6px">
${tabs.map(tab => {
 const active = tab === this.activeTab ? 'do-tab-active' : '';
 return `  <button class="do-tab ${active}" data-tab="${tab}" role="tab" aria-selected="${tab === this.activeTab}" type="button">${escapeHtml(TAB_LABELS[tab])}</button>`;
}).join('\n')}
</div>`;
  }

  private renderOutbreaksTab(): string {
 if (this.outbreaks.length === 0) {
 return '<div class="panel-empty">No active outbreaks reported.</div>';
 }

 const snapshotHtml = this.snapshots.map(s => {
 const trend = s.trend === 'rising' ? '↑' : s.trend === 'falling' ? '↓' : '→';
 const todayCases = s.casesToday !== null ? `+${s.casesToday.toLocaleString()} today` : '';
 return `<div class="eq-row" style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
 <span class="sev-badge">${s.disease === 'covid19' ? 'COVID-19' : 'Influenza'}</span>
 <span style="margin-left:8px">${s.cases.toLocaleString()} cases</span>
 <span style="margin-left:8px;opacity:0.7">${todayCases}</span>
 <span style="margin-left:8px">${trend}</span>
 </div>`;
 }).join('');

 const rows = this.outbreaks.slice(0, 50).map(o => {
 const sevClass = sevRowClass(o.severity);
 const safeUrl = o.url ? sanitizeUrl(o.url) : '';
 const link = safeUrl
 ? `<a href="${safeUrl}" target="_blank" rel="noopener" class="do-link">${escapeHtml(o.disease)}</a>`
 : escapeHtml(o.disease);
 return `<tr class="${sevClass}">
 <td class="do-sev">${sevBadge(o.severity)}</td>
 <td class="do-disease">${link}</td>
 <td class="do-country">${escapeHtml(o.country)}</td>
 <td class="do-source">${escapeHtml(o.source)}</td>
 <td class="do-age">${timeAgo(o.date)}</td>
 </tr>`;
 }).join('');

 const updatedStr = this.lastUpdated ? timeAgo(this.lastUpdated) : 'never';

 return `<div class="do-panel-content">
 ${snapshotHtml}
 <table class="eq-table">
 <thead>
 <tr>
 <th>Sev</th>
 <th>Disease</th>
 <th>Country</th>
 <th>Source</th>
 <th>Age</th>
 </tr>
 </thead>
 <tbody>${rows}</tbody>
 </table>
 <div class="fires-footer">
 <span class="fires-source">WHO · ReliefWeb · ProMED · ${this.outbreaks.length} reports</span>
 <span class="fires-updated">Updated ${updatedStr}</span>
 </div>
 </div>`;
  }

  private render(): void {
 let body = '';
 switch (this.activeTab) {
 case 'outbreaks': { body = this.renderOutbreaksTab(); break;
 }
 case 'wastewater': { body = renderWastewaterTab(this.wastewater); break;
 }
 case 'wastewater-sites': { body = renderWastewaterSitesTab(this.wwSites); break;
 }
 case 'cross-ref': { body = renderCrossReferencedTab(this.crossRefs, this.whoDonAlerts); break;
 }
 case 'flu': { body = this.renderFluTab(); break;
 }
 }
 this.setContent(`${this.renderTabStrip()}${body}`);
 this.wireTabHandlers();
  }

  private renderFluTab(): string {
 if (this.ariError) {
 return `<div class="panel-empty" style="padding:14px;">CDC ARI feed unavailable: ${escapeHtml(this.ariError)}.<br/><span style="font-size:11px;color:#aaa;">Source: data.cdc.gov resource f3zz-zga5 — weekly state-level Acute Respiratory Illness activity.</span></div>`;
 }
 if (!this.ari) {
 return `<div class="panel-empty" style="padding:14px;">Loading CDC Acute Respiratory Illness data…</div>`;
 }
 if (this.ari.rows.length === 0) {
 return `<div class="panel-empty" style="padding:14px;">CDC ARI feed returned no rows for the latest week.</div>`;
 }
 const summary = `<div style="display:flex;gap:14px;font-size:11px;padding:6px 10px;border-bottom:1px solid var(--border-subtle,#222);">
 <div><span style="color:#aaa;">Week ending</span> <strong>${escapeHtml(this.ari.weekEnd ?? '—')}</strong></div>
 <div><span style="color:#aaa;">Reporting</span> <strong>${this.ari.reportingStates}</strong></div>
 <div><span style="color:#aaa;">Hot</span> <strong style="color:#ff453a;">${this.ari.hotStates}</strong></div>
 </div>`;
 const rows = this.ari.rows.map((r) => {
 const color = colorForLevel(r.level);
 return `<tr><td style="padding:3px 8px;font-size:11px;">${escapeHtml(r.state)}</td><td style="padding:3px 8px;font-size:11px;color:${color};font-weight:600;">${escapeHtml(r.level)}</td></tr>`;
 }).join('');
 return `<div>${summary}<table style="width:100%;border-collapse:collapse;"><tbody>${rows}</tbody></table></div>`;
  }

  private wireTabHandlers(): void {
 const root = this.getElement();
 if (!root) return;
 const buttons = root.querySelectorAll<HTMLButtonElement>('.do-tab');
 for (const btn of buttons) {
 btn.addEventListener('click', () => {
 const tab = btn.dataset.tab as Tab | undefined;
 if (!tab || tab === this.activeTab) return;
 this.activeTab = tab;
 try { localStorage.setItem(TAB_STORAGE_KEY, tab); } catch { /* noop */ }
 this.render();
 });
 }
  }
}

function readStoredTab(): Tab {
  try {
 const stored = localStorage.getItem(TAB_STORAGE_KEY);
 if (
 stored === 'outbreaks' ||
 stored === 'wastewater' ||
 stored === 'wastewater-sites' ||
 stored === 'cross-ref' ||
 stored === 'flu'
 ) return stored;
  } catch { /* noop */ }
  return 'outbreaks';
}

function sevRowClass(sev: DiseaseOutbreak['severity']): string {
  if (sev === 'critical') return 'eq-row eq-major';
  if (sev === 'high') return 'eq-row eq-strong';
  if (sev === 'medium') return 'eq-row eq-moderate';
  return 'eq-row';
}

function sevBadge(sev: DiseaseOutbreak['severity']): string {
  const labels: Record<string, string> = { critical: 'CRIT', high: 'HIGH', medium: 'MED', low: 'LOW' };
  return labels[sev] ?? sev;
}

function timeAgo(d: Date): string {
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
