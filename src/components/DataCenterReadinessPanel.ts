import { Panel } from './Panel';
import { h, replaceChildren } from '../utils/dom-utils';
import {
  getDatacenterPosture, getDatacenterSite, subscribeDatacenterPosture,
} from '../services/datacenter/datacenter-state';
import { levelLabel, levelColor } from '../services/datacenter/datacenter-view';
import { describeGridReadiness } from '../services/infrastructure/osm-power';
import type { PowerContext } from '../services/infrastructure/osm-power';
import type {
  DataCenterPosture,
  DcLevel,
  ForecastSlot,
  NearbySeismicEvent,
  ReadinessAction,
  SiteAirQuality,
  SiteConditions,
  ConnectivitySignal,
} from '../services/datacenter/datacenter-types';
import { wmoCodeEmoji, degreesToCompass, cToF, aqiLabel } from '../services/weather';

const URGENCY_LABEL: Record<ReadinessAction['urgency'], string> = {
  now: 'NOW', soon: 'SOON', be_ready: 'BE READY', monitor: 'MONITOR',
};
const AUDIENCE_LABEL: Record<ReadinessAction['audience'], string> = {
  onsite_safety: 'On-site safety', commute_staffing: 'Commute & staffing',
  facility_ops: 'Facility ops', escalation: 'Escalation',
};

function seismicLevel(events: NearbySeismicEvent[]): DcLevel {
  if (events.length === 0) return 'normal';
  const max = Math.max(...events.map((e) => e.magnitudeM));
  if (max >= 6) return 'critical';
  if (max >= 5) return 'warning';
  if (max >= 4) return 'advisory';
  return 'watch';
}

export class DataCenterReadinessPanel extends Panel {
  private unsub: (() => void) | null = null;

  constructor() {
    super({ id: 'datacenter-readiness', title: 'Data Center Readiness', showCount: true });
    this.unsub = subscribeDatacenterPosture((p) => this.render(p));
    this.render(getDatacenterPosture());
  }

  private render(posture: DataCenterPosture | null): void {
    if (!posture) {
      const message = getDatacenterSite()
        ? 'Data center configured — awaiting the first grid + weather refresh.'
        : 'Set your data center location (tag a saved place "data_center") to activate this panel.';
      replaceChildren(this.content, h('div', { className: 'dc-empty' }, message));
      this.setCount(0);
      return;
    }

    this.setCount(posture.actions.filter((a) => a.urgency === 'now').length);

    const nodes: (HTMLElement | null)[] = [];

    if (posture.conditions) {
      nodes.push(this.conditionsRow(posture.conditions, posture.airQuality));
    }

    if (posture.forecast24h.length > 0) {
      nodes.push(this.forecastStrip(posture.forecast24h));
    }

    nodes.push(this.gaugesRow(posture));

    if (posture.connectivity) {
      nodes.push(this.connectivityLine(posture.connectivity));
    }

    if (posture.seismicNearby.length > 0) {
      nodes.push(this.seismicLine(posture.seismicNearby));
    }

    if (posture.gridInfrastructure) {
      nodes.push(this.gridInfrastructureLine(posture.gridInfrastructure));
    }

    const actionList = posture.actions.length === 0
      ? h('div', { className: 'dc-allclear' }, 'No active threats — monitoring.')
      : h('div', { className: 'dc-actions' }, ...posture.actions.map((a) => this.actionRow(a)));
    nodes.push(actionList);

    const footerParts: string[] = [];
    if (posture.staleInputs.length > 0) footerParts.push(`Stale/missing: ${posture.staleInputs.join(', ')}`);
    nodes.push(h('div', { className: 'dc-footer' }, footerParts.join(' · ') || 'All feeds current'));

    replaceChildren(this.content, ...(nodes.filter(Boolean) as HTMLElement[]));
    this.invalidateContentCache();
    this.markFresh();
  }

  private conditionsRow(c: SiteConditions, aq: SiteAirQuality | null): HTMLElement {
    const chips: string[] = [
      `${cToF(c.tempC)}°F / feels ${cToF(c.feelsLikeC)}°F`,
      `💧${Math.round(c.humidityPct)}%`,
      `💨${Math.round(c.windSpeedKmh * 0.621)} mph ${degreesToCompass(c.windDirectionDeg)}`,
      `${wmoCodeEmoji(c.weatherCode)}${c.precipMm.toFixed(1)}"`,
    ];
    if (aq?.usAqi !== null && aq?.usAqi !== undefined) {
      chips.push(`AQI ${aq.usAqi} ${aqiLabel(aq.usAqi)}`);
    }
    if (c.uvIndex !== null) {
      chips.push(`UV ${Math.round(c.uvIndex)}`);
    }
    return h('div', { className: 'dc-conditions' },
      ...chips.map((txt) => h('span', { className: 'dc-conditions-chip' }, txt)),
    );
  }

  private forecastStrip(slots: ForecastSlot[]): HTMLElement {
    const items = slots.map((s) => {
      const label = s.offsetHours === 0 ? 'Now' : `+${s.offsetHours}h`;
      return h('span', { className: 'dc-forecast-slot' },
        `${label} ${cToF(s.tempC)}°F ${wmoCodeEmoji(s.weatherCode)}`,
      );
    });
    return h('div', { className: 'dc-forecast-strip' }, ...items);
  }

  private gaugesRow(posture: DataCenterPosture): HTMLElement {
    const seisLevel = seismicLevel(posture.seismicNearby);
    const seisDetail = posture.seismicNearby.length === 0
      ? 'No M3.5+ / 200 km / 24 h'
      : `M${posture.seismicNearby[0]!.magnitudeM.toFixed(1)} ${posture.seismicNearby[0]!.distanceKm} km`;

    return h('div', { className: 'dc-gauges-row' },
      this.gauge('Power', posture.power.level, posture.power.drivers[0] ?? '—'),
      this.gauge(
        'Weather',
        posture.weather.level,
        posture.weather.arrivalWindowMins === null
          ? (posture.weather.drivers[0] ?? '—')
          : `ETA ${posture.weather.arrivalWindowMins} min`,
      ),
      this.gauge('Seismic', seisLevel, seisDetail),
    );
  }

  private connMark(val: boolean | null): string {
    if (val === null) return '?';
    return val ? '✓' : '✗';
  }

  private connectivityLine(conn: ConnectivitySignal): HTMLElement {
    const cfMark = this.connMark(conn.cloudflare);
    const fastlyMark = this.connMark(conn.fastly);
    const statusClass = `dc-conn--${conn.status}`;
    return h('div', { className: `dc-connectivity ${statusClass}` },
      h('span', { className: 'dc-conn-label' }, 'Connectivity'),
      h('span', { className: 'dc-conn-status' }, conn.status.charAt(0).toUpperCase() + conn.status.slice(1)),
      h('span', { className: 'dc-conn-detail' }, `CF ${cfMark} · Fastly ${fastlyMark}`),
    );
  }

  private gridInfrastructureLine(ctx: PowerContext): HTMLElement {
    const { summary, weakGridTie } = describeGridReadiness(ctx);
    const statusClass = weakGridTie ? 'dc-grid--weak' : 'dc-grid--ok';
    return h('div', { className: `dc-grid-line ${statusClass}` },
      h('span', { className: 'dc-grid-icon' }, '⚡'),
      h('span', { className: 'dc-grid-detail' }, summary),
    );
  }

  private seismicLine(events: NearbySeismicEvent[]): HTMLElement {
    const top = events[0]!;
    const ago = Math.round((Date.now() - top.occurredAt) / (60 * 60 * 1000));
    const text = `M${top.magnitudeM.toFixed(1)} · ${top.distanceKm} km · ${top.place} · ${ago}h ago`;
    return h('div', { className: 'dc-seismic-line' },
      h('span', { className: 'dc-seismic-icon' }, '🌍'),
      h('span', { className: 'dc-seismic-text' }, text),
    );
  }

  private gauge(label: string, level: DcLevel, detail: string): HTMLElement {
    const dot = h('span', { className: 'dc-gauge-dot' });
    dot.style.background = levelColor(level);
    return h('div', { className: 'dc-gauge' },
      h('div', { className: 'dc-gauge-top' },
        dot,
        h('span', { className: 'dc-gauge-label' }, label),
        h('span', { className: 'dc-gauge-level' }, levelLabel(level)),
      ),
      h('div', { className: 'dc-gauge-detail' }, detail),
    );
  }

  private actionRow(a: ReadinessAction): HTMLElement {
    const badge = h('span', { className: `dc-urgency dc-urgency--${a.urgency}` }, URGENCY_LABEL[a.urgency]);
    return h('div', { className: `dc-action dc-action--${a.audience}` },
      h('div', { className: 'dc-action-head' }, badge, h('span', { className: 'dc-action-aud' }, AUDIENCE_LABEL[a.audience])),
      h('div', { className: 'dc-action-title' }, a.title),
      a.detail ? h('div', { className: 'dc-action-detail' }, a.detail) : null,
      a.trigger ? h('div', { className: 'dc-action-trigger' }, a.trigger) : null,
    );
  }

  public override destroy(): void {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    super.destroy();
  }
}
