/**
 * Aviation Intelligence Panel — PR 2 of the aviation stack.
 *
 * Five tabs surface the feeds normalized in PR 1:
 *   - NOTAMs    : TFR list (location, radius, altitude, reason, time range)
 *   - SIGMETs   : active SIGMETs by hazard with color coding
 *   - PIREPs    : pilot turbulence/icing reports
 *   - Military  : live military aircraft
 *   - Delays    : airport ground delay programs
 *
 * Auto-refreshes every 5 min. Pure composition over the
 * `aviation-intel-service` fetchers; no business logic here.
 */

import { Panel } from './Panel';
import {
  fetchAirportDelays,
  fetchMilitaryAircraft,
  fetchNotams,
  fetchPireps,
  fetchSigmets,
  selectTfrs,
  type AirportGroundDelay,
  type AviationFetchEnvelope,
  type AviationNotam,
  type AviationPirep,
  type AviationSigmet,
  type MilitaryAircraft,
} from '@/services/aviation/aviation-intel-service';
import {
  fetchLiveFlights,
  type LiveFlightsEnvelope,
} from '@/services/aviation/commercial-flights-service';
import {
  emergencyLabel,
  flightsInsideHazardZones,
  type FlightCategory,
  type LiveFlight,
} from '@/services/aviation/commercial-flights-classify';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 5 * 60 * 1000;

type Tab = 'notams' | 'sigmets' | 'pireps' | 'military' | 'delays' | 'flights';

const FLIGHT_CATEGORY_LABEL: Record<FlightCategory, string> = {
  military: 'Military',
  commercial: 'Commercial',
  cargo: 'Cargo',
  helicopter: 'Helicopter',
  general_aviation: 'General Aviation',
};

const FLIGHT_CATEGORY_HEX: Record<FlightCategory, string> = {
  military: '#ffeb3b',
  commercial: '#4a9eff',
  cargo: '#9c27b0',
  helicopter: '#8bc34a',
  general_aviation: '#9e9e9e',
};

const HAZARD_COLOR: Record<AviationSigmet['hazard'], string> = {
  volcanic_ash: '#ff9800',
  turbulence: '#ffeb3b',
  icing: '#4a9eff',
  thunderstorm: '#ef4444',
  mountain_obscuration: '#9e9e9e',
  ifr: '#9c27b0',
  other: '#607d8b',
};

const SEVERITY_COLOR: Record<AviationSigmet['severity'], string> = {
  light: '#4caf50',
  moderate: '#ffeb3b',
  severe: '#ff9800',
  extreme: '#ef4444',
};

const MILITARY_TYPE_LABEL: Record<MilitaryAircraft['type'], string> = {
  transport: 'Transport',
  tanker: 'Tanker',
  recon: 'Recon / ISR',
  fighter: 'Fighter',
  bomber: 'Bomber',
  helo: 'Helicopter',
  unknown: 'Other',
};

interface TabState {
  notams: AviationFetchEnvelope<AviationNotam> | null;
  sigmets: AviationFetchEnvelope<AviationSigmet> | null;
  pireps: AviationFetchEnvelope<AviationPirep> | null;
  military: AviationFetchEnvelope<MilitaryAircraft> | null;
  delays: AviationFetchEnvelope<AirportGroundDelay> | null;
  flights: LiveFlightsEnvelope | null;
}

export class AviationIntelPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private activeTab: Tab = 'notams';
  private state: TabState = {
    notams: null,
    sigmets: null,
    pireps: null,
    military: null,
    delays: null,
    flights: null,
  };
  private loading = false;

  constructor() {
    super({
      id: 'aviation-intel',
      title: 'Aviation Intel',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'TFRs, SIGMETs, PIREPs, military aircraft, airport delays, and live commercial/cargo/GA flights with emergency squawk and TFR/SIGMET cross-reference. Refreshes every 5 min (live flights every 10 min — OpenSky rate limit).',
    });
    this.start();
  }

  private start(): void {
    this.render();
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async refresh(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const [notams, sigmets, pireps, military, delays, flights] = await Promise.all([
        fetchNotams(),
        fetchSigmets(),
        fetchPireps(),
        fetchMilitaryAircraft(),
        fetchAirportDelays(),
        fetchLiveFlights(),
      ]);
      this.state = { notams, sigmets, pireps, military, delays, flights };
    } catch {
      // Errors are surfaced as `degraded: true` in the envelopes — nothing
      // to do here beyond letting the previous snapshot stay visible.
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render(): void {
    const counts: Record<Tab, number> = {
      notams: selectTfrs(this.state.notams?.data ?? []).length,
      sigmets: this.state.sigmets?.data.length ?? 0,
      pireps: this.state.pireps?.data.length ?? 0,
      military: this.state.military?.data.length ?? 0,
      delays: this.state.delays?.data.length ?? 0,
      flights: this.state.flights?.counts.total ?? 0,
    };
    const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);
    this.setCount(totalCount);

    const html = `
      <div style="padding:8px;font-size:12px;line-height:1.45;">
        ${this.renderTabBar(counts)}
        <div style="margin-top:8px;">
          ${this.renderActiveTab()}
        </div>
      </div>
    `;
    this.setContent(html, () => this.wireHandlers());
  }

  private renderTabBar(counts: Record<Tab, number>): string {
    const tabs: { id: Tab; label: string }[] = [
      { id: 'notams', label: 'NOTAMs' },
      { id: 'sigmets', label: 'SIGMETs' },
      { id: 'pireps', label: 'PIREPs' },
      { id: 'military', label: 'Military' },
      { id: 'delays', label: 'Delays' },
      { id: 'flights', label: 'Live Flights' },
    ];
    return `
      <div style="display:flex;gap:4px;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:6px;">
        ${tabs
          .map(
            (t) => `
              <button
                class="avi-tab"
                data-tab="${escapeHtml(t.id)}"
                style="
                  background:${this.activeTab === t.id ? 'rgba(74,158,255,0.15)' : 'transparent'};
                  border:none;
                  border-bottom:2px solid ${this.activeTab === t.id ? '#4a9eff' : 'transparent'};
                  color:inherit;
                  padding:4px 10px;
                  font-size:12px;
                  cursor:pointer;
                "
              >${escapeHtml(t.label)} <span style="opacity:0.7;">(${counts[t.id]})</span></button>
            `,
          )
          .join('')}
      </div>
    `;
  }

  private renderActiveTab(): string {
    if (this.loading && this.envelopeFor(this.activeTab) === null) {
      return `<div style="opacity:0.6;">Loading…</div>`;
    }
    const envelope = this.envelopeFor(this.activeTab);
    if (envelope === null) return `<div style="opacity:0.6;">No data yet.</div>`;
    const banner = envelope.degraded
      ? `<div style="padding:4px 6px;background:rgba(239, 68, 68, 0.10);border-left:3px solid #ef4444;margin-bottom:6px;font-size:11px;">
           Degraded: ${escapeHtml(envelope.reason ?? 'unknown')} (source: ${escapeHtml(envelope.source)})
         </div>`
      : '';
    switch (this.activeTab) {
      case 'notams': {
        return banner + this.renderNotams(envelope as AviationFetchEnvelope<AviationNotam>);
      }
      case 'sigmets': {
        return banner + this.renderSigmets(envelope as AviationFetchEnvelope<AviationSigmet>);
      }
      case 'pireps': {
        return banner + this.renderPireps(envelope as AviationFetchEnvelope<AviationPirep>);
      }
      case 'military': {
        return banner + this.renderMilitary(envelope as AviationFetchEnvelope<MilitaryAircraft>);
      }
      case 'delays': {
        return banner + this.renderDelays(envelope as AviationFetchEnvelope<AirportGroundDelay>);
      }
      case 'flights': {
        return banner + this.renderFlights(envelope as LiveFlightsEnvelope);
      }
    }
  }

  private envelopeFor(tab: Tab): { degraded: boolean; reason?: string; source: string } | null {
    if (tab === 'flights') return this.state.flights;
    return this.state[tab];
  }

  private renderNotams(env: AviationFetchEnvelope<AviationNotam>): string {
    const tfrs = selectTfrs(env.data);
    const others = env.data.filter((n) => !tfrs.some((t) => t.id === n.id));
    if (env.data.length === 0) return `<div style="opacity:0.6;">No active NOTAMs.</div>`;
    return `
      ${tfrs.length > 0 ? `<h4 style="margin:4px 0;">TFRs (${tfrs.length})</h4>` : ''}
      ${tfrs.map((n) => this.renderNotamCard(n, true)).join('')}
      ${others.length > 0 ? `<h4 style="margin:10px 0 4px 0;">Other (${others.length})</h4>` : ''}
      ${others.slice(0, 30).map((n) => this.renderNotamCard(n, false)).join('')}
    `;
  }

  private renderNotamCard(n: AviationNotam, isTfr: boolean): string {
    const tfrAccent = isTfr ? '#ef4444' : '#4a9eff';
    const accent = n.presidential ? '#ff453a' : tfrAccent;
    const altLabel = n.altitudeFt
      ? `${n.altitudeFt.min ?? 'SFC'}–${n.altitudeFt.max ?? 'unlimited'} ft`
      : '';
    const centerLabel = n.center
      ? `${n.center.lat.toFixed(2)}°, ${n.center.lon.toFixed(2)}° / ${n.center.radiusNm} NM`
      : '';
    const window = formatWindow(n.effectiveStart, n.effectiveEnd);
    const altSuffix = altLabel ? ` • ${escapeHtml(altLabel)}` : '';
    const centerLine = centerLabel
      ? `<div style="opacity:0.8;">${escapeHtml(centerLabel)}${altSuffix}</div>`
      : '';
    const windowLine = window
      ? `<div style="opacity:0.7;font-size:11px;">${escapeHtml(window)}</div>`
      : '';
    return `
      <div style="margin:4px 0;padding:6px;border-left:3px solid ${accent};background:rgba(255,255,255,0.03);">
        <div style="display:flex;justify-content:space-between;font-weight:600;">
          <span>${escapeHtml(n.notamNumber || n.id)}${n.presidential ? ' • <span style="color:#ff453a;">PRESIDENTIAL</span>' : ''}</span>
          <span style="opacity:0.7;font-size:11px;">${escapeHtml(n.icaoId ?? n.affectedFir ?? '')}</span>
        </div>
        ${centerLine}
        ${windowLine}
        <div style="font-size:11px;opacity:0.85;margin-top:2px;">${escapeHtml(n.text.slice(0, 240))}${n.text.length > 240 ? '…' : ''}</div>
      </div>
    `;
  }

  private renderSigmets(env: AviationFetchEnvelope<AviationSigmet>): string {
    if (env.data.length === 0) return `<div style="opacity:0.6;">No active SIGMETs / AIRMETs.</div>`;
    const groups = new Map<AviationSigmet['hazard'], AviationSigmet[]>();
    for (const s of env.data) {
      const g = groups.get(s.hazard) ?? [];
      g.push(s);
      groups.set(s.hazard, g);
    }
    const order: AviationSigmet['hazard'][] = [
      'volcanic_ash',
      'turbulence',
      'icing',
      'thunderstorm',
      'mountain_obscuration',
      'ifr',
      'other',
    ];
    return order
      .filter((h) => (groups.get(h)?.length ?? 0) > 0)
      .map((h) => {
        const items = groups.get(h)!;
        const color = HAZARD_COLOR[h];
        return `
          <h4 style="margin:6px 0 4px 0;color:${color};">
            ${escapeHtml(h.replace(/_/g, ' ').toUpperCase())} (${items.length})
          </h4>
          ${items.map((s) => this.renderSigmetCard(s, color)).join('')}
        `;
      })
      .join('');
  }

  private renderSigmetCard(s: AviationSigmet, hazardColor: string): string {
    const sevColor = SEVERITY_COLOR[s.severity];
    const altLabel = s.altitudeFt ? `FL${(s.altitudeFt.min / 100).toFixed(0)}–FL${(s.altitudeFt.max / 100).toFixed(0)}` : '';
    return `
      <div style="margin:4px 0;padding:6px;border-left:3px solid ${hazardColor};background:rgba(255,255,255,0.03);">
        <div style="display:flex;justify-content:space-between;">
          <span style="font-weight:600;">${escapeHtml(s.id)}${s.isAirmet ? ' (AIRMET)' : ''}</span>
          <span style="color:${sevColor};font-size:11px;text-transform:uppercase;">${escapeHtml(s.severity)}</span>
        </div>
        ${altLabel ? `<div style="opacity:0.8;">${escapeHtml(altLabel)}</div>` : ''}
        <div style="font-size:11px;opacity:0.85;margin-top:2px;">${escapeHtml(s.text.slice(0, 200))}${s.text.length > 200 ? '…' : ''}</div>
      </div>
    `;
  }

  private renderPireps(env: AviationFetchEnvelope<AviationPirep>): string {
    if (env.data.length === 0) return `<div style="opacity:0.6;">No recent PIREPs.</div>`;
    return env.data
      .slice(0, 50)
      .map((p) => {
        const color = pirepColor(p.hazard);
        return `
          <div style="margin:4px 0;padding:6px;border-left:3px solid ${color};background:rgba(255,255,255,0.03);">
            <div style="display:flex;justify-content:space-between;font-weight:600;">
              <span>${escapeHtml(p.hazard.toUpperCase())} • ${escapeHtml(p.intensity)}</span>
              <span style="opacity:0.7;font-size:11px;">${p.altitudeFt === null ? '—' : `FL${Math.round(p.altitudeFt / 100)}`}</span>
            </div>
            ${p.aircraftType ? `<div style="opacity:0.8;font-size:11px;">${escapeHtml(p.aircraftType)}</div>` : ''}
            <div style="font-size:11px;opacity:0.85;margin-top:2px;font-family:monospace;">${escapeHtml(p.rawText.slice(0, 160))}</div>
          </div>
        `;
      })
      .join('');
  }

  private renderMilitary(env: AviationFetchEnvelope<MilitaryAircraft>): string {
    if (env.data.length === 0) return `<div style="opacity:0.6;">No military aircraft tracked.</div>`;
    const byType = new Map<MilitaryAircraft['type'], MilitaryAircraft[]>();
    for (const ac of env.data) {
      const list = byType.get(ac.type) ?? [];
      list.push(ac);
      byType.set(ac.type, list);
    }
    const sorted = [...byType.entries()].sort((a, b) => b[1].length - a[1].length);
    const summary = sorted
      .map(([type, list]) => `<span style="margin-right:10px;">${escapeHtml(MILITARY_TYPE_LABEL[type])}: <strong>${list.length}</strong></span>`)
      .join('');
    const notable = env.data
      .filter((ac) => ac.emergency || ac.type === 'bomber' || ac.type === 'recon')
      .slice(0, 20);
    const heading =
      notable.length > 0
        ? `<h4 style="margin:6px 0 4px 0;">Notable (${notable.length})</h4>`
        : '';
    return `
      <div style="margin-bottom:6px;">${summary}</div>
      ${heading}
      ${notable.map((ac) => this.renderAircraftCard(ac)).join('')}
    `;
  }

  private renderAircraftCard(ac: MilitaryAircraft): string {
    const color = aircraftColor(ac);
    return `
      <div style="margin:4px 0;padding:6px;border-left:3px solid ${color};background:rgba(255,255,255,0.03);">
        <div style="display:flex;justify-content:space-between;font-weight:600;">
          <span>${escapeHtml(ac.callsign ?? ac.icao24)} • ${escapeHtml(MILITARY_TYPE_LABEL[ac.type])}</span>
          <span style="opacity:0.7;font-size:11px;">${ac.altitudeFt === null ? '—' : `${ac.altitudeFt} ft`} • ${ac.velocityKts === null ? '—' : `${Math.round(ac.velocityKts)} kt`}</span>
        </div>
        ${ac.emergency ? `<div style="color:#ff453a;font-weight:700;">EMERGENCY squawk ${escapeHtml(ac.squawk ?? '')}</div>` : ''}
        ${ac.country ? `<div style="opacity:0.7;font-size:11px;">${escapeHtml(ac.country)}</div>` : ''}
      </div>
    `;
  }

  private renderDelays(env: AviationFetchEnvelope<AirportGroundDelay>): string {
    if (env.data.length === 0) return `<div style="opacity:0.6;">No active delay programs.</div>`;
    return env.data
      .map((d) => {
        const programColor = delayProgramColor(d.programType);
        return `
          <div style="margin:4px 0;padding:6px;border-left:3px solid ${programColor};background:rgba(255,255,255,0.03);">
            <div style="display:flex;justify-content:space-between;font-weight:600;">
              <span>${escapeHtml(d.airport)} • ${escapeHtml(d.programType.replace(/_/g, ' '))}</span>
              <span style="opacity:0.7;font-size:11px;">${d.avgDelayMinutes === null ? '' : `${d.avgDelayMinutes} min avg`}${d.maxDelayMinutes === null ? '' : ` (max ${d.maxDelayMinutes})`}</span>
            </div>
            <div style="opacity:0.85;">${escapeHtml(d.reason)}</div>
          </div>
        `;
      })
      .join('');
  }

  private renderFlights(env: LiveFlightsEnvelope): string {
    const c = env.counts;
    if (env.flights.length === 0) {
      return `<div style="opacity:0.6;">No flights tracked. ${escapeHtml(env.reason ?? '')}</div>`;
    }
    const categoryRow = (Object.keys(FLIGHT_CATEGORY_LABEL) as FlightCategory[])
      .filter((cat) => c[cat] > 0)
      .map((cat) => {
        const hex = FLIGHT_CATEGORY_HEX[cat];
        return `<span style="display:inline-block;padding:2px 8px;border:1px solid ${hex};border-radius:8px;font-size:11px;color:${hex};margin:0 4px 4px 0;">${escapeHtml(
          FLIGHT_CATEGORY_LABEL[cat],
        )} <strong>${c[cat]}</strong></span>`;
      })
      .join('');

    const emergencyBlock = c.emergency > 0
      ? this.renderEmergencyBlock(env.flights)
      : '';

    const tfrs = (this.state.notams?.data ?? []).filter(
      (n) => (n.classification === 'TFR' || /TFR/i.test(n.text)) && n.center !== undefined,
    );
    const sigmets = this.state.sigmets?.data ?? [];
    const inHazard = flightsInsideHazardZones(env.flights, tfrs, sigmets);
    const hazardBlock = inHazard.length > 0
      ? this.renderHazardBlock(inHazard)
      : '';

    const summaryLine = `<div style="font-size:11px;opacity:0.8;margin-bottom:6px;">
        Total: <strong>${c.total}</strong> · Emergency: <strong style="color:${
      c.emergency > 0 ? '#ff453a' : 'inherit'
    };">${c.emergency}</strong> · In TFR/SIGMET: <strong style="color:${
      inHazard.length > 0 ? '#ff9800' : 'inherit'
    };">${inHazard.length}</strong>
      </div>`;

    return `
      ${summaryLine}
      <div style="margin-bottom:6px;">${categoryRow}</div>
      ${emergencyBlock}
      ${hazardBlock}
    `;
  }

  private renderEmergencyBlock(flights: readonly LiveFlight[]): string {
    const emergencies = flights.filter((f) => f.emergency);
    if (emergencies.length === 0) return '';
    const rows = emergencies
      .slice(0, 20)
      .map((f) => {
        const labelText = f.emergencySquawk ? emergencyLabel(f.emergencySquawk) : 'Emergency';
        const where = `${f.lat.toFixed(2)}°, ${f.lon.toFixed(2)}°`;
        const callsign = f.callsign ?? `ICAO ${f.icao24}`;
        return `<div style="margin:4px 0;padding:6px;border-left:3px solid #ff453a;background:rgba(255, 69, 58,0.10);">
          <div style="display:flex;justify-content:space-between;font-weight:700;color:#ff453a;">
            <span>${escapeHtml(callsign)} • SQ ${escapeHtml(f.squawk ?? '')} • ${escapeHtml(labelText)}</span>
            <span style="font-size:11px;">${escapeHtml(where)}</span>
          </div>
          <div style="font-size:11px;opacity:0.85;">
            ${escapeHtml(FLIGHT_CATEGORY_LABEL[f.category])}${f.operatorName ? ` · ${escapeHtml(f.operatorName)}` : ''}${
              f.altitudeFt === null ? '' : ` · ${f.altitudeFt} ft`
            }${f.velocityKts === null ? '' : ` · ${f.velocityKts} kt`}
          </div>
        </div>`;
      })
      .join('');
    return `<h4 style="margin:8px 0 4px 0;color:#ff453a;">⚠ Unusual squawks (${emergencies.length})</h4>${rows}`;
  }

  private renderHazardBlock(
    flights: readonly (LiveFlight & { hazards: { tfrIds: string[]; sigmetIds: string[] } })[],
  ): string {
    const rows = flights
      .slice(0, 20)
      .map((f) => {
        const callsign = f.callsign ?? `ICAO ${f.icao24}`;
        const tfrTag = f.hazards.tfrIds.length > 0
          ? `<span style="color:#ff453a;">TFR ${escapeHtml(f.hazards.tfrIds.join(', '))}</span>`
          : '';
        const sigmetTag = f.hazards.sigmetIds.length > 0
          ? `<span style="color:#ffeb3b;">${escapeHtml(f.hazards.sigmetIds.join(', '))}</span>`
          : '';
        const sep = tfrTag && sigmetTag ? ' · ' : '';
        return `<div style="margin:4px 0;padding:6px;border-left:3px solid #ff9800;background:rgba(255,152,0,0.08);">
          <div style="display:flex;justify-content:space-between;font-weight:600;">
            <span>${escapeHtml(callsign)} • ${escapeHtml(FLIGHT_CATEGORY_LABEL[f.category])}</span>
            <span style="font-size:11px;opacity:0.8;">${f.lat.toFixed(2)}°, ${f.lon.toFixed(2)}°</span>
          </div>
          <div style="font-size:11px;">${tfrTag}${sep}${sigmetTag}</div>
        </div>`;
      })
      .join('');
    return `<h4 style="margin:8px 0 4px 0;color:#ff9800;">In TFR / SIGMET zones (${flights.length})</h4>${rows}`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();
    for (const tabBtn of root.querySelectorAll<HTMLButtonElement>('.avi-tab')) {
      tabBtn.addEventListener('click', () => {
        const next = tabBtn.dataset.tab as Tab | undefined;
        if (next && next !== this.activeTab) {
          this.activeTab = next;
          this.render();
        }
      });
    }
  }
}

function formatWindowTimestamp(t: number | null): string {
  if (!t) return '?';
  try {
    return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    return '?';
  }
}

function formatWindow(start: number | null, end: number | null): string {
  if (!start && !end) return '';
  return `${formatWindowTimestamp(start)} → ${formatWindowTimestamp(end)}`;
}

function pirepColor(hazard: AviationPirep['hazard']): string {
  if (hazard === 'icing') return '#4a9eff';
  if (hazard === 'turbulence') return '#ffeb3b';
  return '#9e9e9e';
}

function aircraftColor(ac: MilitaryAircraft): string {
  if (ac.emergency) return '#ff453a';
  if (ac.type === 'bomber') return '#ff9800';
  return '#4a9eff';
}

function delayProgramColor(t: AirportGroundDelay['programType']): string {
  if (t === 'ground_stop') return '#ff453a';
  if (t === 'ground_delay') return '#ff9800';
  return '#4a9eff';
}
