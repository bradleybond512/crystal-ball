/* eslint-disable sonarjs/no-nested-template-literals */
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
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 5 * 60 * 1000;

type Tab = 'notams' | 'sigmets' | 'pireps' | 'military' | 'delays';

const HAZARD_COLOR: Record<AviationSigmet['hazard'], string> = {
  volcanic_ash: '#ff9800',
  turbulence: '#ffeb3b',
  icing: '#4a9eff',
  thunderstorm: '#f44336',
  mountain_obscuration: '#9e9e9e',
  ifr: '#9c27b0',
  other: '#607d8b',
};

const SEVERITY_COLOR: Record<AviationSigmet['severity'], string> = {
  light: '#4caf50',
  moderate: '#ffeb3b',
  severe: '#ff9800',
  extreme: '#f44336',
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
  };
  private loading = false;

  constructor() {
    super({
      id: 'aviation-intel',
      title: 'Aviation Intel',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'TFRs, SIGMETs, PIREPs, military aircraft, airport delays. Refreshes every 5 min.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  public dispose(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async refresh(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const [notams, sigmets, pireps, military, delays] = await Promise.all([
        fetchNotams(),
        fetchSigmets(),
        fetchPireps(),
        fetchMilitaryAircraft(),
        fetchAirportDelays(),
      ]);
      this.state = { notams, sigmets, pireps, military, delays };
    } catch {
      // Errors are surfaced as `degraded: true` in the envelopes — nothing
      // to do here beyond letting the previous snapshot stay visible.
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render(): void {
    const counts = {
      notams: selectTfrs(this.state.notams?.data ?? []).length,
      sigmets: this.state.sigmets?.data.length ?? 0,
      pireps: this.state.pireps?.data.length ?? 0,
      military: this.state.military?.data.length ?? 0,
      delays: this.state.delays?.data.length ?? 0,
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
    this.setContent(html);
    this.wireHandlers();
  }

  private renderTabBar(counts: Record<Tab, number>): string {
    const tabs: { id: Tab; label: string }[] = [
      { id: 'notams', label: 'NOTAMs' },
      { id: 'sigmets', label: 'SIGMETs' },
      { id: 'pireps', label: 'PIREPs' },
      { id: 'military', label: 'Military' },
      { id: 'delays', label: 'Delays' },
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
      ? `<div style="padding:4px 6px;background:rgba(244,67,54,0.10);border-left:3px solid #f44336;margin-bottom:6px;font-size:11px;">
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
    }
  }

  private envelopeFor(tab: Tab): AviationFetchEnvelope<unknown> | null {
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
    const tfrAccent = isTfr ? '#f44336' : '#4a9eff';
    const accent = n.presidential ? '#d50000' : tfrAccent;
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
          <span>${escapeHtml(n.notamNumber || n.id)}${n.presidential ? ' • <span style="color:#d50000;">PRESIDENTIAL</span>' : ''}</span>
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
        ${ac.emergency ? `<div style="color:#d50000;font-weight:700;">EMERGENCY squawk ${escapeHtml(ac.squawk ?? '')}</div>` : ''}
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
  if (ac.emergency) return '#d50000';
  if (ac.type === 'bomber') return '#ff9800';
  return '#4a9eff';
}

function delayProgramColor(t: AirportGroundDelay['programType']): string {
  if (t === 'ground_stop') return '#f44336';
  if (t === 'ground_delay') return '#ff9800';
  return '#4a9eff';
}
