/* eslint-disable sonarjs/no-nested-conditional */
import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  buildRenderData,
  categoryCssClass,
  incidentSeverityClass,
  trendIcon,
  type CountryCensorship,
  type CensorshipIncident,
  type FreedomCategory,
} from './digital-autocracy-helpers';

const REFRESH_MS = 60 * 60 * 1000; // 1 hour

const FREEDOM_COLOR: Record<FreedomCategory, string> = {
  Free: '#4caf50',
  'Partly Free': '#ffeb3b',
  'Not Free': '#ff453a',
};

const SEV_COLOR: Record<string, string> = {
  'sev-critical': '#ff453a',
  'sev-high': '#ff9800',
  'sev-medium': '#ffeb3b',
  'sev-low': '#4caf50',
};

export class DigitalAutocracyPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'digital-autocracy',
      title: 'Digital Autocracy',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Digital freedom index across 15+ countries. Tracks freedom scores, platform blocks, VPN usage, social credit systems, and recent censorship incidents including network shutdowns, content removal, and account purges.',
    });
    this.start();
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  private render(): void {
    let data;
    try {
      data = buildRenderData();
    } catch {
      this.setContent('<div style="padding:12px;color:#ff9800;">Data unavailable</div>');
      return;
    }

    const notFreeCount = data.countries.filter(c => c.category === 'Not Free').length;
    this.setCount(notFreeCount);
    this.setContent(this.buildHtml(data));
  }

  private buildHtml(data: ReturnType<typeof buildRenderData>): string {
    const headerBlock = this.renderHeader(data);
    const countriesBlock = this.renderCountries(data.countries);
    const incidentsBlock = this.renderIncidents(data.incidents);
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${headerBlock}
      ${countriesBlock}
      ${incidentsBlock}
    </div>`;
  }

  private renderHeader(data: ReturnType<typeof buildRenderData>): string {
    const idx = data.globalFreedomIndex;
    let idxColor: string;
    if (idx < 40) { idxColor = '#ff453a'; }
    else if (idx < 60) { idxColor = '#ff9800'; }
    else { idxColor = '#4caf50'; }
    const popM = data.populationUnderRepression;
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px;">
      <div style="border:1px solid var(--border-subtle,#333);border-radius:3px;padding:8px 10px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Global Freedom</div>
        <div style="font-size:16px;font-weight:700;color:${idxColor};">${idx}/100</div>
      </div>
      <div style="border:1px solid var(--border-subtle,#333);border-radius:3px;padding:8px 10px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Not Free</div>
        <div style="font-size:16px;font-weight:700;color:#ff453a;">${data.notFreeCount}</div>
      </div>
      <div style="border:1px solid var(--border-subtle,#333);border-radius:3px;padding:8px 10px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Partly Free</div>
        <div style="font-size:16px;font-weight:700;color:#ffeb3b;">${data.partlyFreeCount}</div>
      </div>
      <div style="border:1px solid var(--border-subtle,#333);border-radius:3px;padding:8px 10px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Blocked Platforms</div>
        <div style="font-size:16px;font-weight:700;color:#ff9800;">${data.totalBlockedPlatforms}</div>
      </div>
      <div style="border:1px solid var(--border-subtle,#333);border-radius:3px;padding:8px 10px;">
        <div style="font-size:10px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:4px;">Pop. Repressed</div>
        <div style="font-size:16px;font-weight:700;color:#ff453a;">${popM.toLocaleString()}M</div>
      </div>
    </div>`;
  }

  private renderCountries(countries: CountryCensorship[]): string {
    const sorted = [...countries].sort((a, b) => a.freedomScore - b.freedomScore);
    const rows = sorted.map(c => this.renderCountryRow(c)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Countries (by freedom score)</div>
      <div style="display:flex;flex-direction:column;gap:3px;">${rows}</div>
    </div>`;
  }

  private renderCountryRow(c: CountryCensorship): string {
    const catClass = categoryCssClass(c.category);
    const catColor = FREEDOM_COLOR[c.category];
    const trendArrow = trendIcon(c.trend);
    let trendColor: string;
    if (c.trend === 'worsening') { trendColor = '#ff453a'; }
    else if (c.trend === 'improving') { trendColor = '#4caf50'; }
    else { trendColor = '#aaa'; }
    const scBadge = c.socialCredit
      ? `<span style="margin-left:6px;padding:1px 5px;border:1px solid #ff9800;border-radius:8px;font-size:9px;color:#ff9800;">Social Credit</span>`
      : '';
    const blockedCount = c.blockedPlatforms.length;
    const blockedText = blockedCount > 0
      ? `<span style="color:var(--text-secondary,#aaa);font-size:10px;">${blockedCount} platform${blockedCount === 1 ? '' : 's'} blocked</span>`
      : '';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border:1px solid var(--border-subtle,#333);border-left:3px solid ${catColor};border-radius:3px;font-size:11px;gap:8px;">
      <div style="min-width:0;flex:1;">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(c.country)}${scBadge}
        </div>
        <div style="color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(c.vpnUsage)} VPN · ${blockedText}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:10px;font-weight:700;color:${trendColor};">${trendArrow}</span>
        <span style="font-size:11px;font-family:ui-monospace,monospace;">${c.freedomScore}/100</span>
        <span style="font-size:9px;font-weight:700;color:${catColor};text-transform:uppercase;">${escapeHtml(catClass.replace('cat-', ''))}</span>
      </div>
    </div>`;
  }

  private renderIncidents(incidents: CensorshipIncident[]): string {
    if (incidents.length === 0) {
      return `<div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Censorship Incidents</div>
        <div style="font-size:11px;color:var(--text-secondary,#aaa);">No recent incidents.</div>
      </div>`;
    }
    const rows = incidents.map(inc => this.renderIncidentRow(inc)).join('');
    return `<div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary,#aaa);margin-bottom:6px;">Recent Censorship Incidents (${incidents.length})</div>
      <div style="display:flex;flex-direction:column;gap:4px;">${rows}</div>
    </div>`;
  }

  private renderIncidentRow(inc: CensorshipIncident): string {
    const sevClass = incidentSeverityClass(inc.severity);
    const sevColor = SEV_COLOR[sevClass] ?? '#9e9e9e';
    return `<div style="border:1px solid var(--border-subtle,#333);border-left:3px solid ${sevColor};border-radius:3px;padding:6px 8px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:2px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-weight:600;">${escapeHtml(inc.country)}</span>
          <span style="color:var(--text-secondary,#aaa);">${escapeHtml(inc.type)}</span>
          <span style="font-size:9px;font-weight:700;color:${sevColor};text-transform:uppercase;">${escapeHtml(inc.severity)}</span>
        </div>
        <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(inc.date)}</span>
      </div>
      <div style="color:var(--text-secondary,#aaa);font-size:10px;">${escapeHtml(inc.description)}</div>
    </div>`;
  }
}
