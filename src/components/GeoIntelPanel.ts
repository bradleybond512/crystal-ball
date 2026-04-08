import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { isFeatureAvailable } from '@/services/runtime-config';
import { showApiKeyGate } from '@/components/api-key-gate';
import type { AcledEvent, AdsbMilitaryFlight } from '@/services/osint/geo-intel';

const SECTION_HEADING_STYLE = 'font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em;margin:10px 0 6px;';

function metersToFeet(m: number): number { return Math.round(m * 3.281); }
function msToKnots(ms: number): number { return Math.round(ms * 1.944); }

function eventTypeColor(eventType: string): string {
  const t = eventType.toLowerCase();
  if (t.includes('battle')) return '#ef4444';
  if (t.includes('explosion')) return '#f97316';
  if (t.includes('violence')) return '#991b1b';
  if (t.includes('protest')) return '#eab308';
  return '#6b7280';
}

export class GeoIntelPanel extends Panel {
  constructor() {
 super({
 id: 'geo-intel',
 title: 'Geo Intel',
 showCount: true,
 infoTooltip: 'ACLED conflict events and military aircraft tracking from OpenSky.',
 });
 this.showLoading('Loading geo intelligence...');
  }

  public update(data: { acled: AcledEvent[]; military: AdsbMilitaryFlight[] }): void {
 const { acled, military } = data;

 // If ACLED not configured and no data, show key gate
 if (!isFeatureAvailable('acledConflicts') && acled.length === 0) {
 showApiKeyGate(this, 'ACLED_ACCESS_TOKEN', () => { window.location.reload(); });
 return;
 }

 this.setCount(acled.length + military.length);

 this.setContent(`<div style="padding:12px;">
 ${this.renderAcled(acled)}
 ${this.renderMilitary(military)}
 </div>`);
  }

  private renderAcled(events: AcledEvent[]): string {
 const heading = `<h4 style="${SECTION_HEADING_STYLE}">ACLED Conflict Events</h4>`;

 if (!isFeatureAvailable('acledConflicts')) {
 return heading + `<div style="padding:8px;font-size:11px;color:var(--text-muted);border:1px dashed var(--border-subtle);border-radius:4px;margin-bottom:8px;">ACLED: configure ACLED_ACCESS_TOKEN and ACLED_EMAIL in Settings → API Keys</div>`;
 }

 const top = [...events].sort((a, b) => b.fatalities - a.fatalities).slice(0, 15);
 if (top.length === 0) {
 return heading + `<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">No conflict events available</div>`;
 }

 const rows = top.map(evt => {
 const color = eventTypeColor(evt.event_type);
 return `<tr>
 <td style="padding:2px 4px;color:${color};font-size:11px;">${escapeHtml(evt.event_type)}</td>
 <td style="padding:2px 4px;color:var(--text-primary);font-size:11px;">${escapeHtml(evt.actor1)}</td>
 <td style="padding:2px 4px;color:var(--text-primary);font-size:11px;text-align:right;">${evt.fatalities}</td>
 <td style="padding:2px 4px;color:var(--text-secondary);font-size:11px;">${escapeHtml(evt.country)}</td>
 <td style="padding:2px 4px;color:var(--text-muted);font-size:11px;">${escapeHtml(evt.event_date)}</td>
 </tr>`;
 }).join('');

 return `${heading}<table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
 <thead><tr>
 <th style="text-align:left;color:var(--text-muted);font-weight:500;padding:2px 4px;font-size:11px;">Type</th>
 <th style="text-align:left;color:var(--text-muted);font-weight:500;padding:2px 4px;font-size:11px;">Actor</th>
 <th style="text-align:right;color:var(--text-muted);font-weight:500;padding:2px 4px;font-size:11px;">Fatal.</th>
 <th style="text-align:left;color:var(--text-muted);font-weight:500;padding:2px 4px;font-size:11px;">Country</th>
 <th style="text-align:left;color:var(--text-muted);font-weight:500;padding:2px 4px;font-size:11px;">Date</th>
 </tr></thead>
 <tbody>${rows}</tbody>
 </table>`;
  }

  private renderMilitary(flights: AdsbMilitaryFlight[]): string {
 const heading = `<h4 style="${SECTION_HEADING_STYLE}">Military ADSB</h4>`;

 const badge = `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">${flights.length} military aircraft tracked</div>`;

 if (flights.length === 0) {
 return heading + badge + `<p style="font-size:11px;color:var(--text-muted);">No military flights currently tracked</p>`;
 }

 const top = flights.slice(0, 10);
 const items = top.map(f => {
 const altFt = f.baro_altitude != null ? `${metersToFeet(f.baro_altitude).toLocaleString()} ft` : '—';
 const spdKt = f.velocity != null ? `${msToKnots(f.velocity)} kts` : '—';
 const emergencySquawks = new Set(['7700', '7600', '7500']);
 const squawkBadge = f.squawk && emergencySquawks.has(f.squawk)
 ? `<span style="background:#ef4444;color:#fff;font-size:9px;padding:1px 4px;border-radius:3px;margin-left:4px;">${escapeHtml(f.squawk)}</span>`
 : (f.squawk ? `<span style="font-size:10px;color:var(--text-muted);margin-left:4px;">${escapeHtml(f.squawk)}</span>` : '');
 return `<div style="display:flex;align-items:baseline;gap:6px;padding:3px 0;border-bottom:1px solid var(--border-subtle);">
 <span style="font-size:12px;font-weight:600;color:var(--text-primary);min-width:90px;">${escapeHtml(f.callsign || f.icao24)}${squawkBadge}</span>
 <span style="font-size:11px;color:var(--text-muted);flex:1;">${altFt}</span>
 <span style="font-size:11px;color:var(--text-muted);">${spdKt}</span>
 </div>`;
 }).join('');

 return `${heading}${badge}<div>${items}</div>`;
  }
}
