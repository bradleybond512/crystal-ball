/* eslint-disable sonarjs/no-nested-conditional, unicorn/no-nested-ternary, unicorn/no-negated-condition */
import { Panel } from './Panel';
import type { DiseaseOutbreak, GlobalDiseaseSnapshot } from '@/services/disease-outbreak';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { t } from '@/services/i18n';

export class DiseaseOutbreakPanel extends Panel {
  private outbreaks: DiseaseOutbreak[] = [];
  private snapshots: GlobalDiseaseSnapshot[] = [];
  private lastUpdated: Date | null = null;

  constructor() {
 super({
 id: 'disease-outbreaks',
 title: t('panels.diseaseOutbreaks'),
 showCount: true,
 trackActivity: true,
 infoTooltip: 'WHO Disease Outbreak News + ReliefWeb health situation reports. Updated every 15 minutes.',
 });
 this.showLoading('Fetching WHO outbreak data...');
  }

  public update(outbreaks: DiseaseOutbreak[], snapshots: GlobalDiseaseSnapshot[] = []): void {
 this.outbreaks = outbreaks;
 this.snapshots = snapshots;
 this.lastUpdated = new Date();
 this.setCount(outbreaks.length);
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

  private render(): void {
 if (this.outbreaks.length === 0) {
 this.setContent('<div class="panel-empty">No active outbreaks reported.</div>');
 return;
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
 // sanitizeUrl rejects non-http(s) schemes and private/loopback hosts.
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

 this.setContent(`
 <div class="do-panel-content">
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
 <span class="fires-source">WHO · ReliefWeb · ${this.outbreaks.length} reports</span>
 <span class="fires-updated">Updated ${updatedStr}</span>
 </div>
 </div>
 `);
  }
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
