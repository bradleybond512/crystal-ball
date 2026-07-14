/**
 * TravelSafetyPanel - country travel advisories ranked by risk level.
 *
 * Gives civilians a clear, actionable view of where is safe or unsafe to
 * travel: State Dept-style 1-4 advisory levels, evacuation status, entry
 * restrictions, and recent safety alerts.
 *
 * Refresh: every 60 minutes.
 */
import { Panel } from './Panel';
import {
  buildRenderData,
  advisoryLabel,
  advisoryColor,
  type CountryAdvisory,
  type SafetyAlert,
} from './travel-safety-helpers';

const REFRESH_MS = 60 * 60_000;

const TOOLTIP =
  'Country travel advisories on a 1-4 scale mirroring US State Dept and UK FCDO standards. ' +
  'Level 4 = Do Not Travel. Shows evacuation orders, entry restrictions, and recent safety alerts. ' +
  'Refreshes every 60 minutes.';

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn() ?? fallback; } catch { return fallback; }
}

function safeText(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderAdvisoryRow(a: CountryAdvisory): string {
  const color = advisoryColor(a.advisoryLevel);
  const label = advisoryLabel(a.advisoryLevel);
  let evacuBadge = '';
  if (a.evacuationStatus !== 'none') {
    const evacuText = a.evacuationStatus === 'ordered' ? 'EVAC' : 'vol. evac';
    evacuBadge = `<span style="margin-left:4px;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:800;background:rgba(255, 69, 58,0.2);color:#ff453a;">${evacuText}</span>`;
  }
  const restrBadge = a.entryRestrictions
    ? `<span style="margin-left:4px;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;background:rgba(255,152,0,0.2);color:#ff9800;">Entry restricted</span>`
    : '';
  return `<div style="display:flex;align-items:center;gap:6px;padding:5px 12px;border-bottom:1px solid var(--border-subtle,#1a1a1a);">
    <span style="width:8px;height:8px;border-radius:50%;background:${color};flex:0 0 auto;"></span>
    <span style="flex:1;font-size:12px;color:#e5e5e5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${safeText(a.country)}</span>
    <span style="font-size:10px;font-weight:700;color:${color};">${safeText(label)}</span>
    ${evacuBadge}${restrBadge}
  </div>`;
}

function renderAlert(al: SafetyAlert): string {
  const severityColor = al.severity === 'critical' ? '#ff453a' : '#ff9800';
  return `<div style="padding:5px 12px;border-bottom:1px solid var(--border-subtle,#1a1a1a);border-left:3px solid ${severityColor};">
    <span style="font-size:10px;font-weight:700;color:${severityColor};margin-right:6px;">${safeText(al.country)}</span>
    <span style="font-size:11px;color:#bbb;">${safeText(al.title)}</span>
  </div>`;
}

function renderHtml(params: ReturnType<typeof buildRenderData>): string {
  const levelBar = ([4, 3, 2, 1] as const)
    .map((l) => {
      const count = params.levelCounts[l];
      const color = advisoryColor(l);
      return `<span style="display:inline-block;padding:3px 8px;border:1px solid ${color};border-radius:4px;font-size:11px;color:${color};margin-right:4px;">
        <strong>${String(count)}</strong> L${String(l)}
      </span>`;
    })
    .join('');

  const rowHtml = params.advisories.map((a) => renderAdvisoryRow(a)).join('');
  const alertHtml = params.criticalAlerts.map((al) => renderAlert(al)).join('');
  const evacList = params.evacuationCountries
    .map((c) => safeText(c.country))
    .join(', ');

  const evacBanner = params.evacuationCountries.length > 0
    ? `<div style="padding:5px 12px;background:rgba(255, 69, 58,0.12);border-bottom:1px solid rgba(255, 69, 58,0.3);font-size:11px;font-weight:700;color:#ff453a;">
        &#9888; Evacuation advisories: ${safeText(evacList)}
      </div>`
    : '';

  const alertsSection = alertHtml
    ? `<div style="padding:4px 12px 2px;font-size:10px;font-weight:700;color:#666;letter-spacing:0.06em;border-top:1px solid var(--border-subtle,#222);">
        CRITICAL ALERTS
      </div>
      <div>${alertHtml}</div>`
    : '';

  return `<div style="display:flex;flex-direction:column;">
    <div style="padding:8px 12px;border-bottom:1px solid var(--border-subtle,#222);">
      ${levelBar}
    </div>
    ${evacBanner}
    <div>${rowHtml}</div>
    ${alertsSection}
  </div>`;
}

export class TravelSafetyPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'travel-safety',
      title: 'Travel Safety',
      showCount: true,
      trackActivity: true,
      infoTooltip: TOOLTIP,
    });
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private refresh(): void {
    const data = safe(() => buildRenderData(), null);
    if (!data) { this.showError('Travel advisory data unavailable'); return; }
    this.setCount(data.levelCounts[4]);
    this.setContent(renderHtml(data));
  }
}
