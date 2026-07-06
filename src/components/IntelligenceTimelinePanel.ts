import { Panel } from './Panel';
import {
  attachDisclosureClickDelegation,
  renderDisclosureSwitcherHtml,
} from './DisclosureContainer';
import { disclosureService } from '@/services/ui/progressive-disclosure';
import { mountLensBanner, filterForLens } from '@/services/intelligence/panel-lens-adapter';
import { getLensContextService } from '@/services/intelligence/lens-context';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { unifiedAlertStore } from '@/services/unified-alerts';
import { getActive as getActiveSituations } from '@/services/intelligence/situation-store';
import { getHistory as getNotificationHistory } from '@/services/notifications/notification-history-service';
import {
  buildTimeline,
  filterTimeline,
  uniqueDomains,
  type TimelineEvent,
  type TimelineEventType,
  type TimelineSeverity,
} from '@/services/intelligence/intelligence-timeline';

type TypeFilter = TimelineEventType | 'all';
type RangeKey = '1h' | '6h' | '24h' | '7d';

const REFRESH_MS = 30_000;
const STORAGE_KEY = 'cb:intelligence-timeline-state';

const TYPE_LABELS: Record<TypeFilter, string> = {
  all: 'All',
  alert: 'Alert',
  situation: 'Situation',
  'what-changed': 'Changed',
  notification: 'Notification',
  diagnostic: 'Diagnostic',
  acknowledgment: 'Ack',
};

const RANGE_MS: Record<RangeKey, number> = {
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
};

interface StoredState {
  typeFilter?: TypeFilter;
  domain?: string | null;
  range?: RangeKey;
}

export class IntelligenceTimelinePanel extends Panel {
  private timer: ReturnType<typeof setInterval> | null = null;
  private typeFilter: TypeFilter = 'all';
  private domainFilter: string | null = null;
  private range: RangeKey = '24h';
  private expandedIds = new Set<string>();
  private detachDisclosure: (() => void) | null = null;
  private unsubscribeDisclosure: (() => void) | null = null;
  private detachLensBanner: (() => void) | null = null;
  private unsubscribeLens: (() => void) | null = null;

  constructor() {
    super({
      id: 'intelligence-timeline',
      title: 'Intelligence Timeline',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Unified timeline of alerts, situations, What Changed deltas, notifications, and diagnostics. Filter by type / domain / time range. 30-second refresh.',
    });
    this.loadState();
    this.render();
    this.timer = setInterval(() => this.render(), REFRESH_MS);
    this.detachDisclosure = attachDisclosureClickDelegation(this.content, 'intelligence-timeline');
    this.unsubscribeDisclosure = disclosureService.subscribe('intelligence-timeline', () => this.render());
    this.detachLensBanner = mountLensBanner(this.content, 'intelligence-timeline');
    this.unsubscribeLens = getLensContextService().subscribe(() => this.render());
  }

  public destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.detachDisclosure?.();
    this.detachDisclosure = null;
    this.unsubscribeDisclosure?.();
    this.unsubscribeDisclosure = null;
    this.detachLensBanner?.();
    this.detachLensBanner = null;
    this.unsubscribeLens?.();
    this.unsubscribeLens = null;
  }

  // ─── State persistence ────────────────────────────────────────────

  private loadState(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredState;
      if (parsed.typeFilter && (parsed.typeFilter === 'all' || TYPE_LABELS[parsed.typeFilter])) {
        this.typeFilter = parsed.typeFilter;
      }
      if (parsed.domain) this.domainFilter = parsed.domain;
      if (parsed.range && RANGE_MS[parsed.range]) this.range = parsed.range;
    } catch { /* ignore */ }
  }

  private saveState(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        typeFilter: this.typeFilter,
        domain: this.domainFilter,
        range: this.range,
      } as StoredState));
    } catch { /* ignore */ }
  }

  // ─── Compose ───────────────────────────────────────────────────────

  private compose(): TimelineEvent[] {
    const now = Date.now();
    const all = buildTimeline({
      alerts: unifiedAlertStore.getAll(),
      situations: getActiveSituations(),
      notifications: getNotificationHistory(),
      whatChanged: null, // What-Changed isn't observable from the renderer without a snapshot store; can be fed via state injection later
      diagnostics: [],
      now,
      limit: 500,
    });
    const filtered = filterTimeline(all, {
      type: this.typeFilter === 'all' ? undefined : this.typeFilter,
      domain: this.domainFilter ?? undefined,
      since: now - RANGE_MS[this.range],
    });
    const lensCtx = getLensContextService().getContext();
    return filterForLens(filtered, lensCtx, now);
  }

  // ─── Rendering ─────────────────────────────────────────────────────

  private renderFilterBar(domains: string[]): string {
    const types: TypeFilter[] = ['all', 'alert', 'situation', 'what-changed', 'notification', 'diagnostic'];
    const typeChips = types.map((t) => {
      const active = t === this.typeFilter;
      return `<button class="itl-type" data-type="${t}" type="button" style="padding:3px 8px;font-size:11px;border:1px solid rgba(255,255,255,0.12);background:${active ? 'rgba(96,165,250,0.18)' : 'transparent'};color:inherit;border-radius:14px;cursor:pointer;">${escapeHtml(TYPE_LABELS[t])}</button>`;
    }).join('');
    const ranges: RangeKey[] = ['1h', '6h', '24h', '7d'];
    const rangeChips = ranges.map((r) => {
      const active = r === this.range;
      return `<button class="itl-range" data-range="${r}" type="button" style="padding:3px 8px;font-size:11px;border:1px solid rgba(255,255,255,0.12);background:${active ? 'rgba(96,165,250,0.18)' : 'transparent'};color:inherit;border-radius:4px;cursor:pointer;">${escapeHtml(r)}</button>`;
    }).join('');
    const allChip = `<button class="itl-domain" data-domain="" type="button" style="padding:3px 8px;font-size:11px;border:1px solid rgba(255,255,255,0.12);background:${this.domainFilter === null ? 'rgba(96,165,250,0.18)' : 'transparent'};color:inherit;border-radius:14px;cursor:pointer;">all domains</button>`;
    const domainChips = domains.map((d) => {
      const active = d === this.domainFilter;
      return `<button class="itl-domain" data-domain="${escapeHtml(d)}" type="button" style="padding:3px 8px;font-size:11px;border:1px solid rgba(255,255,255,0.12);background:${active ? 'rgba(96,165,250,0.18)' : 'transparent'};color:inherit;border-radius:14px;cursor:pointer;">${escapeHtml(d)}</button>`;
    }).join('');
    return `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;">
      <div style="display:flex;gap:4px;flex-wrap:wrap;">${typeChips}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;"><span style="font-size:10px;opacity:0.65;margin-right:4px;">Domain:</span>${allChip}${domainChips}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;"><span style="font-size:10px;opacity:0.65;margin-right:4px;">Range:</span>${rangeChips}</div>
    </div>`;
  }

  private renderEventRow(e: TimelineEvent): string {
    const expanded = this.expandedIds.has(e.id);
    const icon = typeIcon(e.type);
    const sevColor = severityColor(e.severity);
    const sources = e.sourceIds.slice(0, 4).map((id) => `<span style="font-size:10px;padding:1px 4px;border-radius:3px;background:rgba(255,255,255,0.06);margin-right:2px;">${escapeHtml(id)}</span>`).join('');
    const expandedBlock = expanded ? this.renderExpansion(e) : '';
    return `<div class="itl-row" data-id="${escapeHtml(e.id)}" style="padding:8px;border-radius:4px;background:rgba(255,255,255,0.03);border-left:3px solid ${sevColor};cursor:pointer;">
      <div style="display:flex;align-items:baseline;gap:8px;">
        <span style="font-size:13px;">${icon}</span>
        <span style="font-size:10px;padding:1px 5px;border-radius:3px;background:${sevColor};color:#000;font-weight:600;text-transform:uppercase;">${escapeHtml(e.severity)}</span>
        <span style="font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(255,255,255,0.06);text-transform:lowercase;">${escapeHtml(e.domain)}</span>
        <strong style="font-size:13px;">${escapeHtml(e.title)}</strong>
        <span style="margin-left:auto;font-size:10px;opacity:0.65;">${timeAgo(e.timestamp)}</span>
      </div>
      <div style="font-size:11px;opacity:0.8;margin-top:3px;">${escapeHtml(e.summary)}</div>
      ${sources ? `<div style="margin-top:4px;">${sources}</div>` : ''}
      ${expandedBlock}
    </div>`;
  }

  private renderExpansion(e: TimelineEvent): string {
    const linkRows = e.linkedPanelIds.length === 0
      ? '<div style="font-size:11px;opacity:0.6;">No linked panels</div>'
      : e.linkedPanelIds.map((id) => `<a href="#panel-${escapeHtml(id)}" class="itl-link" data-panel="${escapeHtml(id)}" style="font-size:11px;color:#60a5fa;text-decoration:none;margin-right:8px;">→ ${escapeHtml(id)}</a>`).join('');
    let rawJson = '{}';
    try { rawJson = JSON.stringify(e.raw, null, 2); } catch { rawJson = String(e.raw); }
    if (rawJson.length > 2000) rawJson = `${rawJson.slice(0, 2000)}…`;
    return `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);">
      <div style="margin-bottom:4px;">${linkRows}</div>
      <pre style="font-size:10px;background:rgba(0,0,0,0.25);padding:6px;border-radius:3px;overflow-x:auto;margin:0;max-height:200px;">${escapeHtml(rawJson)}</pre>
    </div>`;
  }

  private render(): void {
    const events = this.compose();
    this.setCount(events.length);
    const all = buildTimeline({
      alerts: unifiedAlertStore.getAll(),
      situations: getActiveSituations(),
      notifications: getNotificationHistory(),
      now: Date.now(),
      limit: 500,
    });
    const domains = uniqueDomains(all);
    const switcher = renderDisclosureSwitcherHtml('intelligence-timeline', { showRaw: true });
    const switcherRow = `<div style="display:flex;justify-content:flex-end;margin-bottom:4px;">${switcher}</div>`;
    const level = disclosureService.getLevel('intelligence-timeline');

    if (level === 'raw') {
      let raw = '[]';
      try { raw = JSON.stringify(events.slice(0, 50), null, 2); } catch { raw = '[]'; }
      this.setContent(`<div style="padding:8px;">${switcherRow}<pre style="margin:0;padding:8px;font-size:11px;background:rgba(0,0,0,0.25);border:1px solid var(--border-subtle,#333);border-radius:4px;overflow:auto;max-height:520px;">${escapeHtml(raw)}</pre></div>`, () => this.wireHandlers());
      return;
    }

    if (level === 'summary') {
      const recent = events.slice(0, 5);
      const list = recent.length === 0
        ? '<div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.7;">No events.</div>'
        : `<div style="display:flex;flex-direction:column;gap:4px;">${recent.map((e) => this.renderEventRow(e)).join('')}</div>`;
      const counter = this.buildSummaryCounterHtml(events.length, recent.length);
      this.setContent(`<div style="padding:8px;">${switcherRow}${list}${counter}</div>`, () => this.wireHandlers());
      return;
    }

    const list = events.length === 0
      ? '<div class="panel-empty" style="padding:16px 0;text-align:center;opacity:0.7;">No events in this time range. Adjust filters or wait for new data.</div>'
      : `<div style="display:flex;flex-direction:column;gap:4px;max-height:520px;overflow-y:auto;">${events.map((e) => this.renderEventRow(e)).join('')}</div>`;
    this.setContent(`<div style="padding:8px;">${switcherRow}${this.renderFilterBar(domains)}${list}</div>`, () => this.wireHandlers());
  }

  /**
   * Counter line under the summary list. Never claims "5 most recent of 1":
   * when everything is already visible it says "All N events"; when the
   * list is empty the "No events." state carries the message alone.
   */
  private buildSummaryCounterHtml(total: number, shown: number): string {
    if (total === 0) return '';
    if (total > 5) {
      return `<div style="opacity:0.5;font-size:11px;margin-top:6px;">${shown} most recent of ${total} · switch to Detail for filters</div>`;
    }
    const noun = total === 1 ? 'event' : 'events';
    return `<div style="opacity:0.5;font-size:11px;margin-top:6px;">All ${total} ${noun} · switch to Detail for filters</div>`;
  }

  private wireHandlers(): void {
    const root = this.getElement();
    if (!root) return;
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.itl-type')) {
      btn.addEventListener('click', () => {
        const t = btn.dataset.type as TypeFilter | undefined;
        if (!t || t === this.typeFilter) return;
        this.typeFilter = t;
        this.saveState();
        this.render();
      });
    }
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.itl-range')) {
      btn.addEventListener('click', () => {
        const r = btn.dataset.range as RangeKey | undefined;
        if (!r || r === this.range) return;
        this.range = r;
        this.saveState();
        this.render();
      });
    }
    for (const btn of root.querySelectorAll<HTMLButtonElement>('.itl-domain')) {
      btn.addEventListener('click', () => {
        const d = btn.dataset.domain ?? '';
        const next = d === '' ? null : d;
        if (next === this.domainFilter) return;
        this.domainFilter = next;
        this.saveState();
        this.render();
      });
    }
    for (const row of root.querySelectorAll<HTMLDivElement>('.itl-row')) {
      row.addEventListener('click', (ev) => {
        const target = ev.target as HTMLElement;
        if (target.classList.contains('itl-link')) return;
        const id = row.dataset.id ?? '';
        if (!id) return;
        if (this.expandedIds.has(id)) this.expandedIds.delete(id);
        else this.expandedIds.add(id);
        this.render();
      });
    }
    for (const link of root.querySelectorAll<HTMLAnchorElement>('.itl-link')) {
      link.addEventListener('click', (ev) => {
        ev.preventDefault();
        const panelId = link.dataset.panel ?? '';
        if (!panelId) return;
        const safeHash = sanitizeUrl(`#panel-${panelId}`);
        if (safeHash) {
          window.location.hash = safeHash;
        }
      });
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function typeIcon(t: TimelineEventType): string {
  switch (t) {
    case 'alert': { return '🚨';
    }
    case 'situation': { return '🛰';
    }
    case 'what-changed': { return '↻';
    }
    case 'notification': { return '🔔';
    }
    case 'diagnostic': { return '🩺';
    }
    case 'acknowledgment': { return '✓';
    }
  }
}

function severityColor(s: TimelineSeverity): string {
  switch (s) {
    case 'critical': { return '#dc2626';
    }
    case 'high': { return '#f87171';
    }
    case 'medium': { return '#fb923c';
    }
    case 'low': { return '#facc15';
    }
    case 'info': { return '#22c55e';
    }
  }
}

function timeAgo(epoch: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - epoch) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}
