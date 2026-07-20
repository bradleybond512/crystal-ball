/**
 * Air & Smoke panel — the Smoke & Air program's main surface (PR 2 of 4).
 * Spec: docs/superpowers/specs/2026-07-16-smoke-air-program-design.md
 *
 * Thin renderer over the smoke engine's SmokeSnapshot (keyless Open-Meteo
 * backbone): hero AQI + trend, 48h curve with safe/avoid windows, cleaner-air
 * compass, per-activity guidance, clean-room checklist, active smoke alerts,
 * honest per-source footer. All rendering is safe-DOM (no HTML-string sinks).
 */
import { Panel } from './Panel';
import type { SmokeSnapshot, SmokeArrivalEstimate, AqiCategory, CompassSample } from '@/services/smoke/smoke-types';
import { AQI_CATEGORY_LABEL, categorizeUsAqi } from '@/services/smoke/aqi-category';
import { describeCompass } from '@/services/smoke/clean-air-compass';
import {
  getSmokeSnapshots,
  refreshSmokeConditions,
  subscribeSmoke,
  getDoneChecklistIds,
  setChecklistDone,
  getSensitiveGroup,
  setSensitiveGroup,
} from '@/services/smoke/smoke-state';
import { fetchWeatherAlerts, type WeatherAlert } from '@/services/weather';
import { setActiveSmokeAlertCount } from '@/services/smoke/smoke-callout-bridge';
import { classifyHazard } from '@/services/weather/weather-threat-types';

const REFRESH_MS = 30 * 60 * 1000;

/** EPA's standard category colors — universally recognized on AQI maps. */
const CATEGORY_COLOR: Record<AqiCategory, string> = {
  good: '#3fb950',
  moderate: '#d4a72c',
  usg: '#f0883e',
  unhealthy: '#ff453a',
  very_unhealthy: '#8f3f97',
  hazardous: '#7e0023',
  unknown: '#8b949e',
};

const VERDICT_GLYPH: Record<'ok' | 'caution' | 'avoid', string> = {
  ok: '✅',
  caution: '⚠️',
  avoid: '🚫',
};

function el(tag: string, style?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (style) node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class AirSmokePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  private unsubscribe: (() => void) | null = null;
  private smokeAlerts: WeatherAlert[] = [];

  constructor() {
    super({
      id: 'air-smoke',
      title: 'Air & Smoke',
      className: 'panel-wide',
      infoTooltip:
        'Wildfire smoke & air quality for your saved place: current AQI, 48-hour forecast with safe windows, cleaner-air compass, activity guidance, and a clean-room readiness checklist. Keyless Open-Meteo backbone; AirNow/PurpleAir corroborate when API keys are loaded.',
    });
    this.unsubscribe = subscribeSmoke(() => this.render());
    this.start();
  }

  private start(): void {
    void this.load();
    this.refreshTimer = setInterval(() => {
      void this.load();
    }, REFRESH_MS);
  }

  public override destroy(): void {
    this.destroyed = true;
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }

  private async load(): Promise<void> {
    // Alerts first (cached/circuit-broken upstream); classify to smoke-family.
    try {
      const alerts = await fetchWeatherAlerts();
      this.smokeAlerts = alerts.filter((a) => classifyHazard(a.event) === 'wildfire_smoke');
    } catch {
      this.smokeAlerts = [];
    }
    setActiveSmokeAlertCount(this.smokeAlerts.length);
    // refreshSmokeConditions() notifies our smoke subscription, which
    // renders — no second explicit render (Codex P3: double work). The
    // alerts-only case is covered because the subscriber fires every refresh.
    await refreshSmokeConditions();
  }

  private render(): void {
    if (this.destroyed) return; // late async resolutions must not touch the DOM
    const root = this.getContentElement();
    root.textContent = '';
    root.style.cssText = 'display:flex;flex-direction:column;gap:14px;padding:12px;';

    const snap = getSmokeSnapshots()[0];
    if (!snap) {
      root.append(el('p', 'opacity:0.7;', 'Loading air conditions… (requires a saved place — add one under Saved Places)'));
      return;
    }
    root.append(this.buildHero(snap));
    if (this.smokeAlerts.length > 0) root.append(this.buildAlerts());
    root.append(this.buildDays(snap));
    root.append(this.buildHourlyStrip(snap));
    root.append(this.buildWindows(snap));
    if (snap.arrivals && snap.arrivals.length > 0) root.append(this.buildArrivals(snap.arrivals));
    root.append(this.buildCompass(snap));
    root.append(this.buildActivities(snap));
    root.append(this.buildChecklist(snap));
    root.append(this.buildSources(snap));
  }

  // ── Sections ──────────────────────────────────────────────────────────

  private buildHero(snap: SmokeSnapshot): HTMLElement {
    const wrap = el('div', 'display:flex;align-items:center;gap:16px;');
    const color = CATEGORY_COLOR[snap.current.category];

    const aqiBox = el('div', `min-width:92px;text-align:center;padding:10px;border-radius:10px;background:${color}22;border:1px solid ${color};`);
    aqiBox.append(
      el('div', `font-size:34px;font-weight:700;color:${color};line-height:1;`, snap.current.usAqi === null ? '—' : String(Math.round(snap.current.usAqi))),
      el('div', 'font-size:10px;opacity:0.75;margin-top:4px;', 'US AQI'),
    );

    const info = el('div', 'display:flex;flex-direction:column;gap:3px;');
    info.append(
      el('div', 'font-size:14px;font-weight:600;', `${snap.placeName} — ${AQI_CATEGORY_LABEL[snap.current.category]}`),
      el('div', 'font-size:12px;opacity:0.8;', snap.current.pm25 === null ? 'PM2.5 unavailable' : `PM2.5 ${snap.current.pm25.toFixed(1)} µg/m³`),
      el('div', 'font-size:12px;opacity:0.8;', this.trendLine(snap)),
    );
    wrap.append(aqiBox, info);
    return wrap;
  }

  private trendLine(snap: SmokeSnapshot): string {
    const now = snap.current.usAqi;
    const soon = snap.hourly48.slice(2, 5).map((s) => s.usAqi).filter((v): v is number => v !== null);
    if (now === null || soon.length === 0) return 'Trend unavailable';
    const avg = soon.reduce((a, b) => a + b, 0) / soon.length;
    if (avg < now - 10) {
      const firstSafe = snap.safeWindows[0];
      return firstSafe ? `Improving — cleaner air ${firstSafe.label}` : 'Improving over the next few hours';
    }
    if (avg > now + 10) return 'Worsening over the next few hours';
    return 'Steady over the next few hours';
  }

  private buildAlerts(): HTMLElement {
    const wrap = el('div', 'display:flex;flex-direction:column;gap:6px;');
    wrap.append(el('div', 'font-size:11px;font-weight:600;opacity:0.7;', 'Active smoke / air quality alerts'));
    for (const a of this.smokeAlerts.slice(0, 4)) {
      const row = el('div', 'padding:8px 10px;border-radius:8px;background:rgba(240,136,62,0.12);border-left:3px solid #f0883e;');
      row.append(
        el('div', 'font-size:12px;font-weight:600;', a.event),
        el('div', 'font-size:11px;opacity:0.8;', a.areaDesc),
      );
      wrap.append(row);
    }
    if (this.smokeAlerts.length > 4) {
      wrap.append(el('div', 'font-size:11px;opacity:0.6;', `+${this.smokeAlerts.length - 4} more`));
    }
    return wrap;
  }

  private buildDays(snap: SmokeSnapshot): HTMLElement {
    const wrap = el('div', 'display:flex;gap:8px;flex-wrap:wrap;');
    for (const d of snap.days.slice(0, 3)) {
      const color = CATEGORY_COLOR[d.category];
      const chip = el('div', `padding:6px 10px;border-radius:8px;background:${color}1a;border:1px solid ${color}55;font-size:12px;`);
      chip.textContent = d.headline;
      wrap.append(chip);
    }
    return wrap;
  }

  private buildHourlyStrip(snap: SmokeSnapshot): HTMLElement {
    const wrap = el('div', 'display:flex;flex-direction:column;gap:4px;');
    wrap.append(el('div', 'font-size:11px;font-weight:600;opacity:0.7;', 'Next 48 hours'));
    const strip = el('div', 'display:flex;gap:1px;align-items:flex-end;height:44px;');
    for (const s of snap.hourly48) {
      const aqi = s.usAqi;
      const h = aqi === null ? 4 : Math.max(4, Math.min(44, (aqi / 300) * 44));
      const color = CATEGORY_COLOR[categorizeUsAqi(aqi)];
      const bar = el('div', `flex:1;height:${h}px;background:${color};border-radius:1px;min-width:3px;`);
      const dt = new Date(s.time);
      bar.title = `${dt.toLocaleString([], { weekday: 'short', hour: 'numeric' })} — AQI ${aqi ?? 'n/a'}`;
      strip.append(bar);
    }
    wrap.append(strip);
    return wrap;
  }

  private buildWindows(snap: SmokeSnapshot): HTMLElement {
    const wrap = el('div', 'display:flex;flex-direction:column;gap:4px;font-size:12px;');
    wrap.append(el('div', 'font-size:11px;font-weight:600;opacity:0.7;', 'Outdoor windows'));
    if (snap.safeWindows.length === 0) {
      wrap.append(el('div', 'color:#ff453a;', 'No safe outdoor windows in the next 48 h — stay with filtered indoor air.'));
    } else {
      for (const w of snap.safeWindows.slice(0, 3)) {
        wrap.append(el('div', 'color:#3fb950;', `✓ ${w.label} (peaks at AQI ${w.peakAqi})`));
      }
    }
    if (snap.worstWindow) {
      wrap.append(el('div', 'color:#ff453a;', `✗ Avoid ${snap.worstWindow.label} (peaks at AQI ${snap.worstWindow.peakAqi})`));
    }
    return wrap;
  }

  private buildArrivals(arrivals: SmokeArrivalEstimate[]): HTMLElement {
    const wrap = el('div', 'display:flex;flex-direction:column;gap:4px;font-size:12px;');
    wrap.append(el('div', 'font-size:11px;font-weight:600;opacity:0.7;', 'Incoming smoke (wind-based estimate)'));
    const GLYPH: Record<SmokeArrivalEstimate['status'], string> = {
      overhead: '🌫️',
      incoming: '⏱',
      not_expected: '↗',
    };
    const STATUS_COLOR: Record<SmokeArrivalEstimate['status'], string> = {
      overhead: '#ff453a',
      incoming: '#f0883e',
      not_expected: '#8b949e',
    };
    for (const a of arrivals) {
      const row = el('div', 'display:flex;align-items:baseline;gap:8px;');
      row.append(
        el('span', undefined, GLYPH[a.status]),
        el('span', `color:${STATUS_COLOR[a.status]};`, a.summary),
      );
      if (a.status === 'incoming') {
        row.append(el('span', 'font-size:10px;opacity:0.6;', `${a.confidence} confidence`));
      }
      wrap.append(row);
    }
    wrap.append(el('div', 'font-size:10px;opacity:0.55;', 'Straight-line wind advection from satellite plumes and active fires — a possibility window, not a dispersion model.'));
    return wrap;
  }

  private buildCompass(snap: SmokeSnapshot): HTMLElement {
    const wrap = el('div', 'display:flex;flex-direction:column;gap:4px;');
    wrap.append(el('div', 'font-size:11px;font-weight:600;opacity:0.7;', 'Cleaner air nearby'));
    wrap.append(el('div', 'font-size:12px;', describeCompass(snap.compass, snap.current.usAqi)));
    const best = snap.compass.filter((c: CompassSample) => c.avgAqi6h !== null).slice(0, 3);
    if (best.length > 0) {
      const list = el('div', 'display:flex;gap:8px;flex-wrap:wrap;');
      for (const c of best) {
        const delta = c.deltaPctVsHome;
        const better = delta !== null && delta < 0;
        const bg = better ? 'rgba(63,185,80,0.12)' : 'rgba(139,148,158,0.12)';
        let deltaTxt = '';
        if (delta !== null) {
          const sign = delta > 0 ? '+' : '';
          deltaTxt = ` (${sign}${delta}%)`;
        }
        const chip = el(
          'div',
          `padding:4px 8px;border-radius:6px;font-size:11px;background:${bg};`,
          `${c.direction} ${c.radiusMi} mi · AQI ~${Math.round(c.avgAqi6h!)}${deltaTxt}`,
        );
        list.append(chip);
      }
      wrap.append(list);
    }
    return wrap;
  }

  private buildActivities(snap: SmokeSnapshot): HTMLElement {
    const wrap = el('div', 'display:flex;flex-direction:column;gap:6px;');
    const head = el('div', 'display:flex;align-items:center;gap:10px;');
    head.append(el('div', 'font-size:11px;font-weight:600;opacity:0.7;', 'What you can do'));

    const label = el('label', 'display:flex;align-items:center;gap:5px;font-size:11px;opacity:0.85;cursor:pointer;');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = getSensitiveGroup();
    toggle.addEventListener('change', () => setSensitiveGroup(toggle.checked));
    label.append(toggle, document.createTextNode('Sensitive group (kids, older adults, heart/lung)'));
    head.append(label);
    wrap.append(head);

    for (const a of snap.activities) {
      const row = el('div', 'display:flex;align-items:baseline;gap:8px;font-size:12px;');
      row.append(
        el('span', undefined, VERDICT_GLYPH[a.verdict]),
        el('span', 'min-width:170px;font-weight:500;', a.label),
        el('span', 'opacity:0.75;font-size:11px;', a.reason),
      );
      wrap.append(row);
    }
    return wrap;
  }

  private buildChecklist(snap: SmokeSnapshot): HTMLElement {
    const wrap = el('div', 'display:flex;flex-direction:column;gap:6px;');
    const head = el('div', 'display:flex;align-items:center;gap:10px;');
    head.append(el('div', 'font-size:11px;font-weight:600;opacity:0.7;', 'Clean-room readiness'));
    let scoreColor = '#ff453a';
    if (snap.cleanRoomScore.tier === 'ready') scoreColor = '#3fb950';
    else if (snap.cleanRoomScore.tier === 'partial') scoreColor = '#d4a72c';
    head.append(el('span', `font-size:12px;font-weight:700;color:${scoreColor};`, `${snap.cleanRoomScore.score0to100}% ${snap.cleanRoomScore.tier}`));
    wrap.append(head);

    for (const item of snap.checklist) {
      const label = el('label', 'display:flex;align-items:baseline;gap:8px;font-size:12px;cursor:pointer;');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = item.done;
      box.addEventListener('change', () => {
        const done = new Set(getDoneChecklistIds());
        if (box.checked) done.add(item.id);
        else done.delete(item.id);
        setChecklistDone([...done]);
      });
      label.append(box, el('span', item.done ? 'opacity:0.6;text-decoration:line-through;' : '', item.label));
      label.title = item.rationale;
      wrap.append(label);
    }
    return wrap;
  }

  private buildSources(snap: SmokeSnapshot): HTMLElement {
    const wrap = el('div', 'display:flex;flex-direction:column;gap:2px;font-size:10px;opacity:0.65;border-top:1px solid rgba(255,255,255,0.08);padding-top:8px;');
    for (const src of snap.sources) {
      const parts = [src.ok ? '●' : '○', ' ', src.label];
      if (src.updatedAt) parts.push(' — ', String(Math.round((Date.now() - src.updatedAt) / 60_000)), ' min ago');
      if (src.detail) parts.push(' — ', src.detail);
      wrap.append(el('div', undefined, parts.join('')));
    }
    wrap.append(el('div', undefined, 'AirNow + PurpleAir corroboration joins automatically when their API keys are loaded.'));
    return wrap;
  }
}
