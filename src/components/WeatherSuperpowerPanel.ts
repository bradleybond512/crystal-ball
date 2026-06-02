/**
 * WeatherSuperpowerPanel — deep-intelligence weather domain panel.
 *
 * Five sections — Severe Weather Tracker, Flash Flood Monitor, Extreme
 * Heat/Cold Index, Atmospheric Hazards, 7-Day Risk Outlook. All the
 * pure logic lives in `src/services/weather/weather-superpower-helpers.ts`
 * so unit tests can exercise the helpers without dragging in Panel's
 * Vite-worker transitive imports.
 *
 * Data flow: `load()` fetches `/api/weather-super` and feeds the
 * response through `parseApiResponse()` from the helpers module. Bridge
 * classes from `mission-bridges/weather-bridges` are imported so the
 * section "source" labels read the canonical `feedId` of each bridge.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  NWSAlertsBridge,
  NHCHurricaneBridge,
  NIFCWildfireBridge,
} from '@/services/intelligence/mission-bridges/weather-bridges';
import {
  compositeNowRisk,
  defaultWeatherSuperState,
  renderAtmospheric,
  renderExtremeIndex,
  renderFloodMonitor,
  renderSevereTracker,
  renderWeeklyOutlook,
  timeAgo,
  type WeatherSuperState,
} from '@/services/weather/weather-superpower-helpers';

// Re-export public types + helpers so external consumers can keep
// importing from the panel file (backwards compatibility).
export type {
  AtmHazardKind,
  AtmosphericHazard,
  DailyRiskOutlook,
  ExtremeKind,
  ExtremeTempEvent,
  FloodWatch,
  RiskTrend,
  RiverGaugeLevel,
  SevereWeatherEvent,
  WeatherEventKind,
  WeatherSeverity,
  WeatherSuperState,
} from '@/services/weather/weather-superpower-helpers';
export {
  compositeNowRisk,
  defaultWeatherSuperState,
  parseApiResponse,
  renderAtmospheric,
  renderExtremeIndex,
  renderFloodMonitor,
  renderSevereTracker,
  renderWeeklyOutlook,
  severityFromAqi,
  severityFromEFRating,
  severityFromGauge,
  severityFromHeatIndex,
  severityFromHurricaneCategory,
  severityFromWindChill,
} from '@/services/weather/weather-superpower-helpers';

export class WeatherSuperpowerPanel extends Panel {
  private state: WeatherSuperState = defaultWeatherSuperState();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'weather-superpower',
      title: 'Weather Intelligence',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Deep weather intelligence: severe storm tracker, flash-flood monitor, extreme heat/cold index, atmospheric hazards (smoke / ash / dust), 7-day composite risk outlook. 5-min refresh.',
    });
    this.render();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  public setData(next: Partial<WeatherSuperState>): void {
    this.state = { ...this.state, ...next, generatedAt: Date.now() };
    this.updateCount();
    this.render();
  }

  public getState(): WeatherSuperState {
    return this.state;
  }

  private updateCount(): void {
    const count = this.state.severeEvents.length
      + this.state.floodWatches.length
      + this.state.extremeEvents.length
      + this.state.atmHazards.length;
    this.setCount(count);
  }

  private render(): void {
    const s = this.state;
    const stamp = s.generatedAt > 0
      ? `<div style="opacity:0.55;font-size:10px;margin-top:12px;">Generated ${escapeHtml(timeAgo(s.generatedAt))} · Composite risk SEV ${compositeNowRisk(s)}</div>`
      : '';
    // Source labels are pulled from the canonical mission-bridge ids
    // — same feed identifiers the ObservationEvent pipeline uses.
    const severeSource = `NWS / NHC (${new NHCHurricaneBridge().feedId})`;
    const floodSource = `NWS / USGS gauges (${new NWSAlertsBridge().feedId})`;
    const atmSource = `NIFC / VAAC / NOAA (${new NIFCWildfireBridge().feedId})`;
    this.setContent(
      renderSevereTracker(s, severeSource)
      + renderFloodMonitor(s, floodSource)
      + renderExtremeIndex(s)
      + renderAtmospheric(s, atmSource)
      + renderWeeklyOutlook(s)
      + stamp,
    );
  }
}
