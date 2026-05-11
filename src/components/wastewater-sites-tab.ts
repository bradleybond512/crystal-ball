/**
 * Pure render helpers for the Wastewater Sites tab on
 * DiseaseOutbreakPanel. Extracted out of the panel so node:test can
 * import them without pulling in the DOM/Vite-coupled Panel base.
 */

import { escapeHtml } from '@/utils/sanitize';
import {
  WW_LEVEL_COLOR,
  type WastewaterSurveillance,
  type NwssStateRollup,
  type NwssSiteSnapshot,
  type WwTrend,
} from '@/services/biosurveillance/wastewater-service';

const TREND_GLYPH: Record<WwTrend, string> = {
  rising: '▲',
  falling: '▼',
  stable: '─',
};
const TREND_COLOR: Record<WwTrend, string> = {
  rising: '#dc2626',
  falling: '#10b981',
  stable: '#9ca3af',
};

const TOP_STATE_COUNT = 10;

function formatPtc(ptc: number | null): string {
  if (ptc === null) return '—';
  const sign = ptc > 0 ? '+' : '';
  return `${sign}${ptc.toFixed(0)}%`;
}

function sparklineStroke(first: number, last: number): string {
  if (last > first) return '#dc2626';
  if (last < first) return '#10b981';
  return '#9ca3af';
}

/** Render the National summary block. */
export function renderNationalSummary(s: WastewaterSurveillance): string {
  if (s.degraded) {
    const reasonSuffix = s.reason ? `: ${escapeHtml(s.reason)}` : '';
    return `<div class="panel-empty" style="padding:10px 14px;">CDC NWSS unavailable${reasonSuffix}.</div>`;
  }
  if (s.states.length === 0) {
    return `<div class="panel-empty" style="padding:10px 14px;">No wastewater data reported. CDC NWSS dataset 2ew6-ywp6 returned 0 rows.</div>`;
  }
  const trendColor = TREND_COLOR[s.national.trend];
  const trendLabel = s.national.trend.toUpperCase();
  const median = s.national.medianPercentile15d;
  const medianStr = median === null ? '—' : median.toFixed(0);
  const asOfBlock = s.asOfDate
    ? `<div style="font-size:10px;color:var(--text-secondary,#aaa);">As of ${escapeHtml(s.asOfDate)}</div>`
    : '';
  return `<div style="display:flex;flex-direction:column;gap:6px;padding:10px 14px;border-bottom:1px solid var(--border-subtle,#222);">
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.04em;">National wastewater · SARS-CoV-2</div>
    <div style="display:flex;align-items:center;gap:14px;">
      <span style="font-size:14px;font-weight:700;color:${trendColor};">${TREND_GLYPH[s.national.trend]} ${escapeHtml(trendLabel)}</span>
      <span style="font-size:12px;">Median percentile: <strong>${medianStr}</strong></span>
      <span style="font-size:12px;">${s.national.activeStates} states</span>
      <span style="font-size:12px;color:#dc2626;">${s.national.risingStates} rising</span>
    </div>
    ${asOfBlock}
  </div>`;
}

/** Render the top-N states table with sparklines. */
export function renderStateTable(states: readonly NwssStateRollup[]): string {
  const top = states.slice(0, TOP_STATE_COUNT);
  if (top.length === 0) return '';
  const rows = top.map((s) => {
    const color = WW_LEVEL_COLOR[s.level];
    const trendColor = TREND_COLOR[s.trend];
    const sparkSvg = renderSparkline(s.sparkline4w);
    const median = s.medianPercentile15d;
    const medianStr = median === null ? '—' : median.toFixed(0);
    const ptcStr = formatPtc(s.medianPtc15d);
    return `<tr>
      <td style="padding:5px 8px;font-size:11px;font-weight:700;">${escapeHtml(s.stateCode)}</td>
      <td style="padding:5px 8px;font-size:11px;color:${color};font-weight:700;">${escapeHtml(s.level.toUpperCase())}</td>
      <td style="padding:5px 8px;font-size:11px;text-align:right;font-variant-numeric:tabular-nums;">${medianStr}</td>
      <td style="padding:5px 8px;font-size:11px;text-align:right;color:${trendColor};font-variant-numeric:tabular-nums;">${TREND_GLYPH[s.trend]} ${ptcStr}</td>
      <td style="padding:5px 8px;font-size:11px;text-align:right;">${s.siteCount}</td>
      <td style="padding:5px 8px;">${sparkSvg}</td>
    </tr>`;
  }).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:11px;">
    <thead>
      <tr style="border-bottom:1px solid var(--border-subtle,#222);color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.04em;font-size:10px;">
        <th style="padding:6px 8px;text-align:left;">State</th>
        <th style="padding:6px 8px;text-align:left;">Level</th>
        <th style="padding:6px 8px;text-align:right;">%ile</th>
        <th style="padding:6px 8px;text-align:right;">Δ15d</th>
        <th style="padding:6px 8px;text-align:right;">Sites</th>
        <th style="padding:6px 8px;text-align:left;">4-week</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/** Render a tiny inline SVG sparkline for a 4-element series. Returns
 *  a string (no escaping needed — we control all numeric inputs). */
export function renderSparkline(values: readonly number[]): string {
  if (values.length === 0) return '';
  const w = 60;
  const h = 16;
  const max = Math.max(...values, 1);
  const stepX = values.length > 1 ? w / (values.length - 1) : w;
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(' ');
  const last = values[values.length - 1] ?? 0;
  const first = values[0] ?? 0;
  const stroke = sparklineStroke(first, last);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="display:block;">
    <polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round" />
  </svg>`;
}

/** Optional top-sites callout (collapsed by default — small list shown
 *  beneath the state table). */
export function renderTopSites(sites: readonly NwssSiteSnapshot[]): string {
  if (sites.length === 0) return '';
  const rows = sites.slice(0, 10).map((s) => {
    const color = WW_LEVEL_COLOR[s.level];
    const percentile = s.percentile15d === null ? '—' : s.percentile15d.toFixed(0);
    return `<li style="padding:3px 0;font-size:11px;display:flex;justify-content:space-between;gap:8px;">
      <span><strong>${escapeHtml(s.stateCode)}</strong> · ${escapeHtml(s.siteName)}${s.county ? ` · ${escapeHtml(s.county)}` : ''}</span>
      <span style="color:${color};font-weight:700;">${percentile}</span>
    </li>`;
  }).join('');
  return `<div style="padding:10px 14px;border-top:1px solid var(--border-subtle,#222);">
    <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px;">Top sites by percentile</div>
    <ul style="margin:0;padding:0;list-style:none;">${rows}</ul>
  </div>`;
}

/** Top-level renderer for the tab body. */
export function renderWastewaterSitesTab(s: WastewaterSurveillance | null): string {
  if (!s) {
    return `<div class="panel-empty" style="padding:14px;">Loading CDC NWSS wastewater surveillance…</div>`;
  }
  return `<div>
    ${renderNationalSummary(s)}
    ${renderStateTable(s.states)}
    ${renderTopSites(s.topSites)}
  </div>`;
}
