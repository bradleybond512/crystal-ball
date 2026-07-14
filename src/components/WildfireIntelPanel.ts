/**
 * Wildfire Intel — unified panel that joins satellite hotspots, NIFC fire
 * perimeters, InciWeb incidents, and EPA AirNow AQI for the user's saved
 * places. Reads from `fetchFireIntelSnapshot()` in fire-intel-service.ts.
 *
 * Highest-threat fires are sorted by acreage × (1 - containment%).
 */
import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type {
  FireIntelSnapshot,
  ActiveFirePerimeter,
  AirNowAqi,
} from '@/services/wildfires/fire-intel-service';
import type { AqiCategory } from '@/services/wildfires/fire-intel-helpers';
import type { RankedThreat } from '@/services/wildfires/fire-intel-helpers';
import type { ScoredPurpleAirSensor, AqiCategory as PurpleAqiCategory } from '@/services/airquality/purpleair-service';
import { colorForCategory as purpleAirColor } from '@/services/airquality/purpleair-service';

const TOP_THREATS_LIMIT = 10;
const PERIMETER_LIST_LIMIT = 12;

const AQI_LABELS: Record<AqiCategory, string> = {
  good: 'Good',
  moderate: 'Moderate',
  sensitive: 'Sensitive',
  unhealthy: 'Unhealthy',
  very_unhealthy: 'Very Unhealthy',
  hazardous: 'Hazardous',
  unknown: 'Unknown',
};

const AQI_BADGE_COLORS: Record<AqiCategory, string> = {
  good: '#4caf50',
  moderate: '#ffeb3b',
  sensitive: '#ff9800',
  unhealthy: '#ff453a',
  very_unhealthy: '#9c27b0',
  hazardous: '#7e0023',
  unknown: '#616161',
};

export class WildfireIntelPanel extends Panel {
  private snapshot: FireIntelSnapshot | null = null;
  private purpleAir: { sensors: ScoredPurpleAirSensor[]; source: string; fetchedAt: number } | null = null;

  constructor() {
    super({
      id: 'wildfire-intel',
      title: 'Wildfire Intel',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Unified wildfire view: NASA FIRMS hotspots (clustered to 0.1° cells) · NIFC active fire perimeters · InciWeb incidents ranked by threat · EPA AirNow AQI for saved places · PurpleAir hyper-local PM2.5. Refreshes every 15 min.',
    });
    this.showLoading('Joining FIRMS, NIFC, InciWeb, AirNow, and PurpleAir…');
  }

  public update(snapshot: FireIntelSnapshot): void {
    this.snapshot = snapshot;
    this.setCount(snapshot.rankedThreats.length);
    this.render();
  }

  public updatePurpleAir(snapshot: { sensors: ScoredPurpleAirSensor[]; source: string; fetchedAt: number }): void {
    this.purpleAir = snapshot;
    this.render();
  }

  public showUpstreamUnavailable(reason: string): void {
    this.setContent(
      `<div class="panel-empty">Wildfire intel sources unavailable${escapeHtml(reason ? ': ' + reason : '')}.<br/>` +
        `Sources: NASA FIRMS · NIFC · InciWeb · EPA AirNow — will retry on the next 15-min refresh.</div>`,
    );
    this.setCount(0);
  }

  private render(): void {
    if (!this.snapshot) return;
    const snap = this.snapshot;
    const top = snap.rankedThreats.slice(0, TOP_THREATS_LIMIT);
    const totalHotspots = snap.hotspotClusters.reduce((s, c) => s + c.fireCount, 0);
    const highConfClusters = snap.hotspotClusters.filter(c => c.highConfidence).length;

    const aqi = renderAqiSection(snap.aqi);
    const summary = renderSummaryRow({
      totalHotspots,
      hotspotClusters: snap.hotspotClusters.length,
      highConfClusters,
      perimeters: snap.perimeters.length,
      perimeterAcres: snap.perimeters.reduce((s, p) => s + (p.acres ?? 0), 0),
    });
    const topThreats = renderTopThreats(top);
    const perimeterList = renderPerimeterList(snap.perimeters.slice(0, PERIMETER_LIST_LIMIT));
    const purpleAirSection = renderPurpleAirSection(this.purpleAir);
    const updatedAgo = timeAgo(snap.fetchedAt);

    this.setContent(`
<div class="wf-intel-panel">
  ${aqi}
  ${summary}
  ${topThreats}
  ${perimeterList}
  ${purpleAirSection}
  <div class="fires-footer">
    <span class="fires-source">FIRMS · NIFC WFIGS · InciWeb · EPA AirNow · PurpleAir</span>
    <span class="fires-updated">Updated ${escapeHtml(updatedAgo)}</span>
  </div>
</div>`);
  }
}

// ── Sub-renderers ────────────────────────────────────────────────────────

function renderAqiSection(aqi: AirNowAqi[]): string {
  if (aqi.length === 0) {
    return '<div class="wf-aqi-empty" style="opacity:0.7;font-size:12px;margin-bottom:8px">' +
      'Add a saved place + AIRNOW_API_KEY to see local air quality.</div>';
  }
  const rows = aqi.map(r => {
    const color = AQI_BADGE_COLORS[r.category];
    const label = AQI_LABELS[r.category];
    const value = r.aqi === null ? '—' : String(r.aqi);
    const param = r.parameter ? ` (${escapeHtml(r.parameter)})` : '';
    return `<div class="wf-aqi-row" style="display:flex;align-items:center;gap:8px;padding:3px 0">
      <span class="aq-badge" style="display:inline-block;min-width:36px;text-align:center;padding:2px 6px;background:${color};color:#fff;border-radius:4px;font-weight:600">${escapeHtml(value)}</span>
      <span style="flex:1">${escapeHtml(r.placeName)}</span>
      <span style="opacity:0.75">${escapeHtml(label)}${param}</span>
    </div>`;
  }).join('');
  return `<div class="wf-aqi-section" style="margin-bottom:10px">
    <div style="font-weight:600;font-size:12px;margin-bottom:4px;opacity:0.85">Air Quality (saved places)</div>
    ${rows}
  </div>`;
}

function renderSummaryRow(opts: {
  totalHotspots: number;
  hotspotClusters: number;
  highConfClusters: number;
  perimeters: number;
  perimeterAcres: number;
}): string {
  const acresStr = opts.perimeterAcres >= 1000
    ? `${(opts.perimeterAcres / 1000).toFixed(1)}k`
    : Math.round(opts.perimeterAcres).toLocaleString();
  return `<div class="wf-summary" style="display:flex;gap:12px;flex-wrap:wrap;padding:6px 0;border-top:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:8px">
    <span><b>${opts.totalHotspots.toLocaleString()}</b> hotspots</span>
    <span>·</span>
    <span><b>${opts.hotspotClusters}</b> clusters</span>
    <span>(${opts.highConfClusters} high-conf)</span>
    <span>·</span>
    <span><b>${opts.perimeters}</b> NIFC perimeters</span>
    <span>(${acresStr} acres)</span>
  </div>`;
}

function renderTopThreats(top: RankedThreat[]): string {
  if (top.length === 0) {
    return '<div class="panel-empty">No active threat-ranked incidents.</div>';
  }
  const rows = top.map((t, idx) => {
    const inc = t.incident;
    const severityClass = severityClassFor(idx);
    const acres = inc.acresBurned === null ? '—' : inc.acresBurned.toLocaleString();
    const cont = inc.percentContained === null ? '—' : `${inc.percentContained}%`;
    const evac = evacBadgeFor(inc.evacuationOrders, inc.evacuationWarnings);
    return `<tr class="${severityClass}">
      <td>${evac}</td>
      <td>${escapeHtml(inc.name.length > 40 ? inc.name.slice(0, 38) + '…' : inc.name)}</td>
      <td>${escapeHtml(inc.state)}</td>
      <td style="text-align:right">${acres}</td>
      <td>${cont}</td>
      <td style="text-align:right;opacity:0.75">${formatThreat(t.threatScore)}</td>
    </tr>`;
  }).join('');
  return `<div style="margin-bottom:8px">
    <div style="font-weight:600;font-size:12px;margin-bottom:4px;opacity:0.85">Highest-threat incidents (acres × uncontained)</div>
    <table class="eq-table">
      <thead>
        <tr><th></th><th>Incident</th><th>State</th><th style="text-align:right">Acres</th><th>Cont.</th><th style="text-align:right">Threat</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderPerimeterList(perimeters: ActiveFirePerimeter[]): string {
  if (perimeters.length === 0) return '';
  const rows = perimeters.map(p => {
    const acres = p.acres === null ? '—' : p.acres.toLocaleString();
    const cont = p.containmentPct === null ? '—' : `${Math.round(p.containmentPct)}%`;
    const state = p.state ?? '—';
    return `<tr>
      <td>${escapeHtml(p.name.length > 36 ? p.name.slice(0, 34) + '…' : p.name)}</td>
      <td>${escapeHtml(state)}</td>
      <td style="text-align:right">${acres}</td>
      <td>${cont}</td>
    </tr>`;
  }).join('');
  return `<div>
    <div style="font-weight:600;font-size:12px;margin-bottom:4px;opacity:0.85">NIFC active perimeters</div>
    <table class="eq-table">
      <thead><tr><th>Incident</th><th>State</th><th style="text-align:right">Acres</th><th>Cont.</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

const PURPLEAIR_LIST_LIMIT = 8;
const PURPLEAIR_CATEGORY_LABEL: Record<PurpleAqiCategory, string> = {
  good: 'Good',
  moderate: 'Moderate',
  sensitive: 'Sensitive',
  unhealthy: 'Unhealthy',
  very_unhealthy: 'Very Unhealthy',
  hazardous: 'Hazardous',
};

function renderPurpleAirSection(snap: { sensors: ScoredPurpleAirSensor[]; source: string; fetchedAt: number } | null): string {
  if (!snap) {
    return '<div class="wf-purple-empty" style="opacity:0.7;font-size:12px;margin-top:10px">PurpleAir sensors loading…</div>';
  }
  if (snap.sensors.length === 0) {
    return '<div class="wf-purple-empty" style="opacity:0.7;font-size:12px;margin-top:10px">No PurpleAir sensors available right now (public endpoint may be down — set PURPLEAIR_API_KEY in settings to use the v1 API).</div>';
  }
  const total = snap.sensors.length;
  const worst = snap.sensors.slice(0, PURPLEAIR_LIST_LIMIT);
  const counts: Record<PurpleAqiCategory, number> = {
    good: 0, moderate: 0, sensitive: 0, unhealthy: 0, very_unhealthy: 0, hazardous: 0,
  };
  for (const s of snap.sensors) counts[s.category] += 1;

  const histogram = (Object.keys(counts) as PurpleAqiCategory[])
    .filter(k => counts[k] > 0)
    .map(k => `<span style="display:inline-flex;align-items:center;gap:4px"><span style="display:inline-block;width:8px;height:8px;background:${purpleAirColor(k)};border-radius:50%"></span>${counts[k]}</span>`)
    .join(' · ');

  const rows = worst.map(s => {
    const color = purpleAirColor(s.category);
    return `<tr>
      <td><span style="display:inline-block;min-width:28px;text-align:center;padding:1px 4px;background:${color};color:#000;border-radius:3px;font-weight:600">${s.aqi}</span></td>
      <td>${escapeHtml(s.name.length > 30 ? s.name.slice(0, 28) + '…' : s.name)}</td>
      <td style="text-align:right">${s.pm25.toFixed(1)} µg/m³</td>
      <td style="opacity:0.75">${escapeHtml(PURPLEAIR_CATEGORY_LABEL[s.category])}</td>
    </tr>`;
  }).join('');

  return `<div class="wf-purpleair-section" style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08)">
    <div style="font-weight:600;font-size:12px;margin-bottom:4px;opacity:0.85">PurpleAir hyper-local — top ${worst.length} of ${total} (source: ${escapeHtml(snap.source)})</div>
    <div style="font-size:11px;opacity:0.75;margin-bottom:6px">${histogram}</div>
    <table class="eq-table">
      <thead><tr><th>AQI</th><th>Sensor</th><th style="text-align:right">PM2.5</th><th>Category</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function severityClassFor(idx: number): string {
  if (idx === 0) return 'eq-major';
  if (idx <= 2) return 'eq-strong';
  return 'eq-moderate';
}

function evacBadgeFor(orders: boolean, warnings: boolean): string {
  if (orders) return '<span class="sev-badge" style="background:var(--semantic-critical)">EVAC</span>';
  if (warnings) return '<span class="sev-badge" style="background:var(--semantic-high)">WARN</span>';
  return '';
}

function formatThreat(score: number): string {
  if (score === 0) return '—';
  if (score >= 1000) return `${(score / 1000).toFixed(1)}k`;
  return Math.round(score).toLocaleString();
}

function timeAgo(ts: number): string {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}
