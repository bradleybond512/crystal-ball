/**
 * FirmsPanel (panel id: `firms-thermal`).
 *
 * NASA FIRMS thermal-anomaly intelligence. Surfaces the global 24h active-fire
 * picture from VIIRS (Suomi-NPP / NOAA-20), broad hotspot regions, and a
 * conflict-zone cross-reference: thermal anomalies inside contested boxes are
 * compared against a baseline so artillery / industrial-fire spikes stand out
 * against the wildfire background (dual-use with ACLED conflict data).
 *
 * Data comes from the sidecar `/api/firms/summary` route (1h cache, demo
 * fallback when NASA_FIRMS_API_KEY is unset). Pure logic lives in
 * `firms-helpers.ts`.
 */
import { Panel } from './Panel';
import { getApiBaseUrl } from '@/services/runtime';
import { h, replaceChildren } from '@/utils/dom-utils';
import {
  buildDemoSummary,
  formatFrp,
  severityColor,
  type FirmsSummary,
  type RegionSummary,
  type ConflictZoneSummary,
} from './firms-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour — matches the sidecar cache TTL.

function sectionHeader(title: string, badge?: HTMLElement): HTMLElement {
  const header = h('div', { className: 'app-section-header' }, title);
  if (badge) header.append(badge);
  return header;
}

function pill(text: string, bg: string): HTMLElement {
  return h('span', {
    style: `margin-left:6px;font-size:10px;background:${bg};color:#fff;border-radius:10px;padding:1px 6px`,
  }, text);
}

function coverageMark(ok: boolean): string {
  return ok ? '✓' : '—';
}

function coverageMarkColor(ok: boolean): string {
  return ok ? '#4ade80' : '#9e9e9e';
}

function timeSince(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export class FirmsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight: AbortController | null = null;

  constructor() {
    super({
      id: 'firms-thermal',
      title: 'Thermal Anomalies (FIRMS/VIIRS)',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'NASA FIRMS near-real-time active-fire / thermal-anomaly detections from VIIRS ' +
        '(Suomi-NPP, NOAA-20). Global 24h counts, hotspot regions, and a conflict-zone ' +
        'cross-reference that compares anomalies inside contested boxes against a baseline — ' +
        'dual-use: wildfires plus artillery / industrial-fire signals. Needs NASA_FIRMS_API_KEY ' +
        'for live data; shows demo data otherwise.',
    });
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.inFlight?.abort();
    super.destroy();
  }

  private start(): void {
    this.showLoading('Scanning thermal anomalies…');
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  private async refresh(): Promise<void> {
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/firms/summary`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const summary = (await res.json()) as FirmsSummary;
      if (controller.signal.aborted) return;
      this.render(summary);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      // Never leave the panel blank — fall back to the static demo summary.
      this.render(buildDemoSummary(new Date().toISOString()));
    }
  }

  private render(summary: FirmsSummary): void {
    this.setCount(summary.global.count);
    replaceChildren(
      this.getContentElement(),
      h('div', { className: 'app-root' },
        this.buildGlobalSection(summary),
        this.buildRegionsSection(summary.regions),
        this.buildConflictSection(summary.conflictZones),
        this.buildCoverageSection(summary),
      ),
    );
  }

  private buildGlobalSection(summary: FirmsSummary): HTMLElement {
    const { count, highConfidenceCount, totalFrp } = summary.global;
    const hiPct = count > 0 ? Math.round((highConfidenceCount / count) * 100) : 0;
    const badge = summary.demo
      ? pill('DEMO', '#6b7280')
      : pill(timeSince(summary.generatedAt), '#374151');

    const stat = (label: string, value: string, color = '#facc15'): HTMLElement =>
      h('div', { style: 'flex:1;min-width:120px' },
        h('div', { style: `font-size:22px;font-weight:700;color:${color}` }, value),
        h('div', { style: 'font-size:10px;color:#9e9e9e;text-transform:uppercase' }, label),
      );

    return h('div', { className: 'app-section' },
      sectionHeader('Global — Last 24h', badge),
      h('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;padding:6px 0' },
        stat('Active anomalies', count.toLocaleString(), '#fb923c'),
        stat('High confidence', `${highConfidenceCount.toLocaleString()} (${hiPct}%)`, '#fbbf24'),
        stat('Total FRP', formatFrp(totalFrp), '#f87171'),
      ),
    );
  }

  private buildRegionsSection(regions: RegionSummary[]): HTMLElement {
    const ranked = regions.filter((r) => r.count > 0);
    const max = ranked.reduce((m, r) => Math.max(m, r.count), 0) || 1;
    const tbody = h('tbody');
    for (const r of ranked) {
      const barW = Math.max(2, Math.round((r.count / max) * 100));
      tbody.append(
        h('tr',
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:600;white-space:nowrap' },
            r.name,
            r.isConflictZone ? h('span', { style: 'color:#f97316;margin-left:4px' }, '⚠') : null,
          ),
          h('td', { style: 'padding:3px 6px;width:55%' },
            h('div', {
              style: `height:10px;border-radius:3px;background:${r.isConflictZone ? '#f97316' : '#3b82f6'};width:${barW}%`,
            }),
          ),
          h('td', { style: 'padding:3px 6px;font-size:12px;font-weight:700;text-align:right' },
            r.count.toLocaleString(),
          ),
        ),
      );
    }
    return h('div', { className: 'app-section' },
      sectionHeader('Hotspot Regions', pill(String(ranked.length), '#1e3a8a')),
      ranked.length === 0
        ? h('div', { style: 'font-size:12px;color:#9e9e9e;padding:4px 0' }, 'No anomalies in tracked regions.')
        : h('table', { style: 'width:100%;border-collapse:collapse' }, tbody),
    );
  }

  private buildConflictSection(zones: ConflictZoneSummary[]): HTMLElement {
    const flagged = zones.filter((z) => z.severity !== 'normal').sort((a, b) => b.count - a.count);
    const body = flagged.length === 0
      ? h('div', { style: 'font-size:12px;color:#9e9e9e;padding:4px 0' },
          'All tracked conflict zones at or near baseline.')
      : (() => {
          const list = h('div', { style: 'display:flex;flex-direction:column;gap:3px' });
          for (const z of flagged) {
            const color = severityColor(z.severity);
            list.append(
              h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:12px' },
                h('span', { style: 'font-weight:600' },
                  z.name,
                  h('span', { style: `color:${color};margin-left:6px;font-size:10px;text-transform:uppercase` }, z.severity),
                ),
                h('span', { style: 'color:#9e9e9e' },
                  h('span', { style: `color:${color};font-weight:700` }, z.count.toLocaleString()),
                  ` anomalies (vs ${z.baseline} baseline)`,
                ),
              ),
            );
          }
          return list;
        })();

    return h('div', { className: 'app-section' },
      sectionHeader('⚠ Conflict-Zone Anomalies',
        flagged.length > 0 ? pill(String(flagged.length), '#b71c1c') : undefined),
      body,
    );
  }

  private buildCoverageSection(summary: FirmsSummary): HTMLElement {
    const { satellites, demo, generatedAt } = summary;
    return h('div', { className: 'app-section' },
      sectionHeader('Satellite Coverage'),
      h('div', { style: 'display:flex;gap:18px;flex-wrap:wrap;font-size:12px;padding:4px 0' },
        h('span', null,
          'VIIRS SNPP ',
          h('span', { style: `color:${coverageMarkColor(satellites.viirsSnpp)};font-weight:700` }, coverageMark(satellites.viirsSnpp)),
        ),
        h('span', null,
          'NOAA-20 ',
          h('span', { style: `color:${coverageMarkColor(satellites.noaa20)};font-weight:700` }, coverageMark(satellites.noaa20)),
        ),
        h('span', { style: 'color:#9e9e9e' }, demo ? 'demo data' : `updated ${timeSince(generatedAt)}`),
      ),
    );
  }
}
