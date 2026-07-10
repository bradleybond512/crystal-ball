 
/**
 * Operator Mode panel — the dense layout's settings + controls surface.
 *
 * Lets the user:
 *   - toggle Operator mode on/off
 *   - pin lat/lon watch regions (decorate matching alerts with WATCHED)
 *   - mute notification domains for 1h / 4h / 24h
 *   - export a markdown shift-handoff report
 *
 * The feed-health strip is a separate fixed-position element mounted on
 * the body. It's positioned by CSS (`.cb-operator-feed-strip`) and only
 * visible when `body[data-mode=operator]` is set.
 */

import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { setMode, clearManualMode, getCurrentMode } from '@/app/mode-manager';
import {
  createWatchRegionStore,
  type WatchRegion,
  type WatchRegionStore,
} from '@/services/operator/watch-regions';
import {
  createMuteStore,
  formatRemaining,
  type MuteDurationLabel,
  type MuteStore,
} from '@/services/operator/mute-controls';
import {
  renderShiftReportMarkdown,
  type ShiftReportInput,
  type SituationSummary,
  type DegradedFeed,
} from '@/services/operator/shift-report';
import { getHistory, type NotificationHistoryEntry } from '@/services/notifications/notification-history-service';
import {
  type NotificationDomain,
} from '@/services/notifications/notification-settings-service';
import { computeMissionState, classifyFeedHealth, type FeedHealthInput, type Domain, type MissionStateLevel } from '@/services/diagnostics/mission-state-mapper';
import { FEED_CATALOG } from '@/services/diagnostics/feed-catalog';
import { dataFreshness } from '@/services/data-freshness';

const REFRESH_MS = 60 * 1000;

const ALL_NOTIFICATION_DOMAINS: NotificationDomain[] = [
  'earthquakes', 'wildfire', 'aviation', 'maritime', 'biosurveillance',
  'space_weather', 'infrastructure', 'geopolitical', 'weather', 'cyber', 'supply',
];

const DOMAIN_LABEL: Record<NotificationDomain, string> = {
  earthquakes: 'Earthquakes',
  wildfire: 'Wildfire',
  aviation: 'Aviation',
  maritime: 'Maritime',
  biosurveillance: 'Biosurveillance',
  space_weather: 'Space Weather',
  infrastructure: 'Infrastructure',
  geopolitical: 'Geopolitical',
  weather: 'Weather',
  cyber: 'Cyber',
  supply: 'Supply',
};

const FEED_DOMAINS: readonly Domain[] = [
  'natural', 'space', 'fire', 'air', 'energy', 'cyber', 'data', 'aviation', 'maritime',
];

const FEED_DOMAIN_LABEL: Record<Domain, string> = {
  natural: 'Natural',
  space: 'Space',
  fire: 'Fire',
  air: 'Air',
  energy: 'Energy',
  cyber: 'Cyber',
  data: 'Data',
  aviation: 'Aviation',
  maritime: 'Maritime',
};

function levelToHealth(level: MissionStateLevel | undefined): 'nominal' | 'limited' | 'degraded' | 'unknown' {
  if (level === 'NOMINAL' || level === 'ENHANCED') return 'nominal';
  if (level === 'LIMITED') return 'limited';
  if (level === 'DEGRADED') return 'degraded';
  return 'unknown';
}

const FEED_HEALTH_COLOR: Record<'nominal' | 'limited' | 'degraded' | 'unknown', string> = {
  nominal: '#22c55e',
  limited: '#eab308',
  degraded: '#ef4444',
  unknown: 'rgba(255,255,255,0.2)',
};

export class OperatorModePanel extends Panel {
  private regions: WatchRegionStore;
  private mutes: MuteStore;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private boundClickHandler: ((ev: MouseEvent) => void) | null = null;
  private boundSubmitHandler: ((ev: SubmitEvent) => void) | null = null;
  private feedStripEl: HTMLElement | null = null;

  constructor() {
    super({
      id: 'operator-mode',
      title: 'Operator Mode',
      showCount: false,
      trackActivity: true,
      infoTooltip:
        'Operator Mode: dense 3-column layout, pinned watch regions, per-domain mutes, and shift-handoff export. Manually toggled — never auto-triggered.',
    });
    this.regions = createWatchRegionStore();
    this.mutes = createMuteStore();
    this.mountFeedStrip();
    this.start();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.boundClickHandler && typeof document !== 'undefined') {
      document.removeEventListener('click', this.boundClickHandler);
      this.boundClickHandler = null;
    }
    if (this.boundSubmitHandler && typeof document !== 'undefined') {
      document.removeEventListener('submit', this.boundSubmitHandler);
      this.boundSubmitHandler = null;
    }
    this.feedStripEl?.remove();
    this.feedStripEl = null;
    super.destroy();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    if (typeof document !== 'undefined') {
      this.boundClickHandler = (ev) => this.onClick(ev);
      this.boundSubmitHandler = (ev) => this.onSubmit(ev);
      document.addEventListener('click', this.boundClickHandler);
      document.addEventListener('submit', this.boundSubmitHandler);
    }
  }

  private mountFeedStrip(): void {
    if (typeof document === 'undefined') return;
    if (document.querySelector('.cb-operator-feed-strip')) return;
    const strip = document.createElement('div');
    strip.className = 'cb-operator-feed-strip';
    strip.setAttribute('aria-hidden', 'true');
    document.body.append(strip);
    this.feedStripEl = strip;
  }

  private updateFeedStrip(domainLevels: Partial<Record<Domain, MissionStateLevel>>): void {
    if (!this.feedStripEl) return;
    this.feedStripEl.replaceChildren();
    for (const d of FEED_DOMAINS) {
      const seg = document.createElement('div');
      seg.className = 'cb-operator-feed-strip-segment';
      seg.setAttribute('data-domain', d);
      seg.setAttribute('data-health', levelToHealth(domainLevels[d]));
      seg.title = `${FEED_DOMAIN_LABEL[d]}: ${domainLevels[d] ?? 'unknown'}`;
      this.feedStripEl.append(seg);
    }
  }

  // ── Event handlers ────────────────────────────────────────────────────

  private onClick(ev: MouseEvent): void {
    const target = (ev.target as Element | null)?.closest('[data-operator-action]');
    if (!target) return;
    const action = target.getAttribute('data-operator-action');
    switch (action) {
      case 'toggle-mode': { this.toggleMode(); break;
      }
      case 'export-shift': { this.exportShiftReport(); break;
      }
      case 'remove-region': {
        const id = target.getAttribute('data-region-id');
        if (id) { this.regions.remove(id); this.render(); }
        break;
      }
      case 'mute': {
        const domain = target.getAttribute('data-domain') as NotificationDomain | null;
        const duration = target.getAttribute('data-duration') as MuteDurationLabel | null;
        if (domain && duration) { this.mutes.mute(domain, duration); this.render(); }
        break;
      }
      case 'unmute': {
        const domain = target.getAttribute('data-domain') as NotificationDomain | null;
        if (domain) { this.mutes.unmute(domain); this.render(); }
        break;
      }
      default: { break;
      }
    }
  }

  private onSubmit(ev: SubmitEvent): void {
    const form = ev.target as HTMLFormElement | null;
    if (form?.dataset.operatorForm !== 'add-region') return;
    ev.preventDefault();
    const fd = new FormData(form);
    const readStr = (key: string): string => {
      const v = fd.get(key);
      return typeof v === 'string' ? v : '';
    };
    const label = readStr('label').trim();
    const minLat = Number.parseFloat(readStr('minLat'));
    const maxLat = Number.parseFloat(readStr('maxLat'));
    const minLon = Number.parseFloat(readStr('minLon'));
    const maxLon = Number.parseFloat(readStr('maxLon'));
    if (!label) return;
    try {
      this.regions.add({ label, minLat, maxLat, minLon, maxLon });
      form.reset();
      this.render();
    } catch {
      // Invalid input — leave the form as-is so the operator can correct.
    }
  }

  private toggleMode(): void {
    if (getCurrentMode() === 'operator') clearManualMode();
    else setMode('operator');
    this.render();
  }

  private exportShiftReport(): void {
    if (typeof document === 'undefined' || typeof navigator === 'undefined') return;
    const md = this.assembleShiftReport();
    void navigator.clipboard?.writeText?.(md);
    document.dispatchEvent(new CustomEvent('cb:operator-shift-report', { detail: { markdown: md } }));
  }

  private assembleShiftReport(): string {
    const now = Date.now();
    const notifications = safeArray<NotificationHistoryEntry>(() => getHistory());
    const { degradedFeeds } = this.collectFeedHealth(now);
    // No global situation registry to read from in this build; we fall
    // back to deriving situations from recent high/critical notifications
    // so the report is never empty when something has actually happened.
    const situations: SituationSummary[] = notifications
      .filter((n) => n.severity === 'critical' || n.severity === 'high')
      .map((n) => ({ id: n.id, title: n.title, severity: n.severity, timestamp: n.recordedAt, subtitle: n.body }));
    const input: ShiftReportInput = { now, situations, notifications, degradedFeeds };
    return renderShiftReportMarkdown(input);
  }

  private collectFeedHealth(now: number): {
    domainLevels: Partial<Record<Domain, MissionStateLevel>>;
    degradedFeeds: DegradedFeed[];
  } {
    const inputs: FeedHealthInput[] = FEED_CATALOG.map((feed) => {
      const sourceId = feed.sourceId;
      const src = sourceId ? safe(() => dataFreshness.getSource(sourceId)) : undefined;
      const lastUpdateMs = src?.lastUpdate ? src.lastUpdate.getTime() : null;
      const hadError = Boolean(src?.lastError);
      return {
        id: feed.id,
        name: feed.name,
        category: feed.category,
        status: classifyFeedHealth(feed, lastUpdateMs, hadError, now),
      };
    });
    const ms = computeMissionState(inputs, now);
    const REASON: Record<'stale' | 'error' | 'never', string> = {
      error: 'upstream error',
      never: 'no data yet',
      stale: 'stale',
    };
    const degradedFeeds: DegradedFeed[] = inputs
      .filter((i) => i.status !== 'fresh')
      .map((i) => ({
        id: i.id,
        name: i.name,
        reason: REASON[i.status as 'stale' | 'error' | 'never'] ?? 'stale',
      }));
    return { domainLevels: ms.domains, degradedFeeds };
  }

  // ── Render ────────────────────────────────────────────────────────────

  private render(): void {
    const now = Date.now();
    const isOperator = getCurrentMode() === 'operator';
    const regions = this.regions.list();
    const mutes = this.mutes.list();
    const { domainLevels } = this.collectFeedHealth(now);
    this.updateFeedStrip(domainLevels);
    this.setContent(`
      ${this.renderToggle(isOperator)}
      ${this.renderWatchRegions(regions)}
      ${this.renderMutes(mutes, now)}
      ${this.renderExportSection()}
      ${this.renderFeedDomains(domainLevels)}
    `);
  }

  private renderToggle(isOperator: boolean): string {
    const label = isOperator ? 'Exit Operator Mode' : 'Enter Operator Mode';
    const color = isOperator ? '#06b6d4' : 'var(--accent,#2196f3)';
    const bg = isOperator ? color : 'transparent';
    const fg = isOperator ? '#0a0a0a' : color;
    const detail = isOperator ? 'Dense layout active' : 'Standard layout';
    return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#222);">
      <button type="button" data-operator-action="toggle-mode" style="font-size:12px;font-weight:600;padding:6px 12px;border:1px solid ${color};border-radius:3px;background:${bg};color:${fg};cursor:pointer;">${escapeHtml(label)}</button>
      <span style="margin-left:10px;font-size:11px;color:var(--text-secondary,#888);">${detail}</span>
    </div>`;
  }

  private renderWatchRegions(regions: readonly WatchRegion[]): string {
    const list = regions.length === 0
      ? '<div style="font-size:11px;color:var(--text-secondary,#888);padding:6px 0;">No pinned regions.</div>'
      : `<ul style="list-style:none;padding:0;margin:6px 0;display:flex;flex-direction:column;gap:4px;">
          ${regions.map((r) => `<li style="display:flex;align-items:center;gap:8px;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:3px;font-size:11px;">
            <strong style="flex:0 0 auto;">${escapeHtml(r.label)}</strong>
            <span style="flex:1;color:var(--text-secondary,#888);font-family:ui-monospace,monospace;">${r.minLat.toFixed(2)},${r.minLon.toFixed(2)} → ${r.maxLat.toFixed(2)},${r.maxLon.toFixed(2)}</span>
            <button type="button" data-operator-action="remove-region" data-region-id="${escapeHtml(r.id)}" style="font-size:10px;padding:2px 6px;border:1px solid var(--border-subtle,#444);border-radius:2px;background:transparent;color:var(--text-secondary,#aaa);cursor:pointer;">Remove</button>
          </li>`).join('')}
        </ul>`;
    return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#222);">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary,#888);margin-bottom:4px;">Watch regions</div>
      ${list}
      <form data-operator-form="add-region" style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr auto;gap:4px;margin-top:8px;">
        <input name="label"  type="text"   placeholder="Label" required style="font-size:11px;padding:3px 6px;background:rgba(0,0,0,0.2);border:1px solid var(--border-subtle,#333);color:inherit;border-radius:2px;" />
        <input name="minLat" type="number" step="any" placeholder="minLat" required style="font-size:11px;padding:3px 6px;background:rgba(0,0,0,0.2);border:1px solid var(--border-subtle,#333);color:inherit;border-radius:2px;" />
        <input name="maxLat" type="number" step="any" placeholder="maxLat" required style="font-size:11px;padding:3px 6px;background:rgba(0,0,0,0.2);border:1px solid var(--border-subtle,#333);color:inherit;border-radius:2px;" />
        <input name="minLon" type="number" step="any" placeholder="minLon" required style="font-size:11px;padding:3px 6px;background:rgba(0,0,0,0.2);border:1px solid var(--border-subtle,#333);color:inherit;border-radius:2px;" />
        <input name="maxLon" type="number" step="any" placeholder="maxLon" required style="font-size:11px;padding:3px 6px;background:rgba(0,0,0,0.2);border:1px solid var(--border-subtle,#333);color:inherit;border-radius:2px;" />
        <button type="submit" style="font-size:11px;font-weight:600;padding:3px 10px;border:1px solid var(--accent,#2196f3);border-radius:2px;background:transparent;color:var(--accent,#2196f3);cursor:pointer;">Add</button>
      </form>
    </div>`;
  }

  private renderMutes(mutes: ReturnType<MuteStore['list']>, now: number): string {
    const rows = ALL_NOTIFICATION_DOMAINS.map((d) => {
      const until = mutes[d];
      const muted = typeof until === 'number' && until > now;
      const remaining = muted ? formatRemaining(until - now) : '';
      const buttons = muted
        ? `<button type="button" data-operator-action="unmute" data-domain="${d}" style="font-size:10px;padding:2px 6px;border:1px solid #06b6d4;border-radius:2px;background:rgba(6,182,212,0.12);color:#06b6d4;cursor:pointer;">Unmute (${escapeHtml(remaining)})</button>`
        : `<button type="button" data-operator-action="mute" data-domain="${d}" data-duration="1h"  style="font-size:10px;padding:2px 6px;border:1px solid var(--border-subtle,#444);border-radius:2px;background:transparent;color:var(--text-secondary,#aaa);cursor:pointer;">1h</button>
           <button type="button" data-operator-action="mute" data-domain="${d}" data-duration="4h"  style="font-size:10px;padding:2px 6px;border:1px solid var(--border-subtle,#444);border-radius:2px;background:transparent;color:var(--text-secondary,#aaa);cursor:pointer;">4h</button>
           <button type="button" data-operator-action="mute" data-domain="${d}" data-duration="24h" style="font-size:10px;padding:2px 6px;border:1px solid var(--border-subtle,#444);border-radius:2px;background:transparent;color:var(--text-secondary,#aaa);cursor:pointer;">24h</button>`;
      return `<li style="display:flex;align-items:center;gap:8px;padding:3px 6px;font-size:11px;">
        <span style="flex:1;">${escapeHtml(DOMAIN_LABEL[d])}</span>
        <span style="display:flex;gap:3px;">${buttons}</span>
      </li>`;
    }).join('');
    return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#222);">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary,#888);margin-bottom:4px;">Mute by domain</div>
      <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:0;">${rows}</ul>
    </div>`;
  }

  private renderExportSection(): string {
    return `<div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#222);">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary,#888);margin-bottom:4px;">Shift handoff</div>
      <button type="button" data-operator-action="export-shift" style="font-size:11px;font-weight:600;padding:5px 10px;border:1px solid var(--accent,#2196f3);border-radius:3px;background:transparent;color:var(--accent,#2196f3);cursor:pointer;">Export Shift Report</button>
      <span style="margin-left:10px;font-size:11px;color:var(--text-secondary,#888);">8h window. Copies markdown to clipboard.</span>
    </div>`;
  }

  private renderFeedDomains(levels: Partial<Record<Domain, MissionStateLevel>>): string {
    const pills = FEED_DOMAINS.map((d) => {
      const color = FEED_HEALTH_COLOR[levelToHealth(levels[d])];
      return `<span style="font-size:10px;font-weight:600;color:${color};border:1px solid ${color};padding:2px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(FEED_DOMAIN_LABEL[d])}</span>`;
    }).join('');
    return `<div style="padding:10px 12px;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-secondary,#888);margin-bottom:4px;">Feed health</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">${pills}</div>
    </div>`;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function safe<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function safeArray<T>(fn: () => readonly T[]): T[] {
  try { return [...fn()]; } catch { return []; }
}
