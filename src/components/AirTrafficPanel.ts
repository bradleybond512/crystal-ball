import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { fetchAdsbSnapshot, getAdsbStats } from '@/services/adsb';
import type { AdsbSnapshot } from '@/services/adsb';

function metersToFeet(m: number): number { return Math.round(m * 3.281); }
function msToKnots(ms: number): number { return Math.round(ms * 1.944); }
function squawkLabel(squawk: string): string {
  if (squawk === '7700') return 'EMERGENCY';
  if (squawk === '7600') return 'RADIO FAIL';
  if (squawk === '7500') return 'HIJACK';
  return squawk;
}

export class AirTrafficPanel extends Panel {
  private snapshot: AdsbSnapshot | null = null;
  private loading = true;
  private error: string | null = null;

  constructor() {
 super({
 id: 'air-traffic',
 title: 'Air Traffic',
 showCount: true,
 infoTooltip: 'Live aircraft positions worldwide from OpenSky Network. Updates every 60 seconds. No API key required.',
 });
 void this.fetchData();
  }

  public async fetchData(): Promise<void> {
 this.loading = true;
 this.error = null;
 this.showLoading('Loading air traffic…');
 try {
 this.snapshot = await fetchAdsbSnapshot();
 this.error = null;
 } catch (err) {
 if (this.isAbortError(err)) return;
 this.error = err instanceof Error ? err.message : 'Failed to fetch';
 }
 this.loading = false;
 this.renderPanel();
  }

  public update(snapshot: AdsbSnapshot): void {
 this.snapshot = snapshot;
 this.loading = false;
 this.error = null;
 this.renderPanel();
  }

  private renderPanel(): void {
 if (this.loading) { this.showLoading('Loading air traffic…'); return; }
 if (this.error || !this.snapshot) { this.showError(this.error ?? 'No data'); return; }

 const { flights, totalCount, rateLimited, fetchedAt } = this.snapshot;
 const airborne = flights.length;
 const stats = getAdsbStats(this.snapshot);
 this.setCount(airborne);

 const ageSeconds = Math.round((Date.now() - fetchedAt) / 1000);
 const ageLabel = ageSeconds < 60 ? `${ageSeconds}s ago` : `${Math.round(ageSeconds / 60)}m ago`;

 const rateLimitedBanner = rateLimited
 ? `<div style="padding:6px 12px;background:rgba(255,180,0,0.1);border-left:3px solid #ffb400;margin-bottom:8px;font-size:11px;color:#ffb400;">OpenSky rate limited — data may be incomplete. Add credentials in Settings for higher limits.</div>`
 : '';
 const lowDataBanner = !rateLimited && totalCount < 1000
 ? `<div style="padding:6px 12px;background:rgba(255,180,0,0.1);border-left:3px solid #ffb400;margin-bottom:8px;font-size:11px;color:#ffb400;">Limited data: only ${totalCount.toLocaleString()} states returned.</div>`
 : '';

 const countryRows = stats.topCountries.map(({ country, count }) => {
 const pct = airborne > 0 ? Math.round((count / airborne) * 100) : 0;
 return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
 <span style="flex:1;font-size:12px;color:var(--text-primary);">${escapeHtml(country)}</span>
 <div style="width:80px;height:4px;background:var(--bg-tertiary);border-radius:2px;overflow:hidden;">
 <div style="width:${pct}%;height:100%;background:var(--accent-primary);border-radius:2px;"></div>
 </div>
 <span style="width:36px;text-align:right;font-size:12px;color:var(--text-secondary);">${count.toLocaleString()}</span>
 </div>`;
 }).join('');

 const notableRows = stats.notableFlights.map(f => {
 const altFt = f.altitude != null ? `${metersToFeet(f.altitude).toLocaleString()} ft` : '—';
 const spdKt = f.velocity != null ? `${msToKnots(f.velocity)} kt` : '—';
 const badge = f.squawk && ['7700', '7600', '7500'].includes(f.squawk)
 ? `<span style="background:#ff3333;color:#fff;font-size:9px;padding:1px 4px;border-radius:3px;margin-left:4px;">${squawkLabel(f.squawk)}</span>`
 : '';
 return `<div style="display:flex;align-items:baseline;gap:6px;padding:3px 0;border-bottom:1px solid var(--border-subtle);">
 <span style="font-size:12px;font-weight:600;color:var(--text-primary);min-width:80px;">${escapeHtml(f.callsign ?? f.icao24)}${badge}</span>
 <span style="font-size:11px;color:var(--text-secondary);flex:1;">${escapeHtml(f.originCountry)}</span>
 <span style="font-size:11px;color:var(--text-muted);">${altFt}</span>
 <span style="font-size:11px;color:var(--text-muted);">${spdKt}</span>
 </div>`;
 }).join('');

 this.setContent(`
 ${rateLimitedBanner}${lowDataBanner}
 <div style="padding:12px;">
 <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;">
 <span style="font-size:22px;font-weight:700;color:var(--text-primary);">${airborne.toLocaleString()}</span>
 <span style="font-size:11px;color:var(--text-muted);">airborne · updated ${escapeHtml(ageLabel)}</span>
 </div>
 ${stats.topCountries.length > 0 ? `<div style="margin-bottom:12px;"><div style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Top Countries</div>${countryRows}</div>` : ''}
 ${stats.notableFlights.length > 0 ? `<div><div style="font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Notable Flights</div>${notableRows}</div>` : ''}
 </div>
 `);
  }
}
