/**
 * CorrelationAlertBanner — persistent app-header banner that surfaces
 * cross-domain correlations from /api/synthesis/correlations.
 *
 * Mirrors EEWStatusBar's lifecycle (mount on document.body, poll on
 * an interval, color-coded by severity). Hidden when no correlations
 * are active. Click to expand the active list.
 *
 * Polls every 15 s — matches the engine's run cadence.
 */

import type {
  CorrelationEvent,
  Severity,
} from '../services/synthesis/correlation-engine';
import { highestSeverity, rankSeverity } from '../services/synthesis/correlation-engine';

const ENDPOINT = '/api/synthesis/correlations';
const POLL_INTERVAL_MS = 15_000;

const SEVERITY_CLASSES: Record<Severity, string> = {
  low: 'cb-correlation-banner-low',
  medium: 'cb-correlation-banner-medium',
  high: 'cb-correlation-banner-high',
  critical: 'cb-correlation-banner-critical',
};

const SEVERITY_LABELS: Record<Severity, string> = {
  low: 'CORRELATION',
  medium: 'CORRELATION',
  high: 'CORRELATION',
  critical: 'CRITICAL CORRELATION',
};

interface CorrelationsResponse {
  events?: (Omit<CorrelationEvent, 'triggeredAt'> & { triggeredAt: string })[];
  highestSeverity?: Severity | null;
  asOf?: number;
  available?: boolean;
}

export class CorrelationAlertBanner {
  private root: HTMLElement | null = null;
  private summaryEl: HTMLElement | null = null;
  private detailEl: HTMLElement | null = null;
  private mounted = false;
  private expanded = false;
  private events: CorrelationEvent[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  mount(parent: HTMLElement): void {
    if (this.mounted) return;
    this.mounted = true;

    this.root = document.createElement('div');
    this.root.className = 'cb-correlation-banner';
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    this.root.style.display = 'none';

    this.summaryEl = document.createElement('div');
    this.summaryEl.className = 'cb-correlation-banner-summary';
    this.summaryEl.addEventListener('click', () => this.toggleExpanded());

    this.detailEl = document.createElement('div');
    this.detailEl.className = 'cb-correlation-banner-detail';
    this.detailEl.style.display = 'none';

    this.root.append(this.summaryEl, this.detailEl);
    parent.prepend(this.root);

    this.startPolling();
  }

  destroy(): void {
    if (!this.mounted) return;
    this.mounted = false;
    this.stopPolling();
    this.root?.remove();
    this.root = null;
    this.summaryEl = null;
    this.detailEl = null;
    this.events = [];
  }

  /** Public for tests / fixtures: render an explicit event list without
   *  hitting the network. */
  setEvents(events: readonly CorrelationEvent[]): void {
    // Sort newest-first within each severity tier; severity high → low.
    const sorted = [...events].sort((a, b) => {
      const sev = rankSeverity(b.severity) - rankSeverity(a.severity);
      if (sev !== 0) return sev;
      return b.triggeredAt.getTime() - a.triggeredAt.getTime();
    });
    this.events = sorted;
    this.render();
  }

  getActiveCount(): number {
    return this.events.length;
  }

  // ── Polling ───────────────────────────────────────────────────────────

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    void this.fetchAndApply();
    this.pollTimer = setInterval(() => void this.fetchAndApply(), POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async fetchAndApply(): Promise<void> {
    try {
      const r = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const body = (await r.json()) as CorrelationsResponse;
      const raw = Array.isArray(body.events) ? body.events : [];
      const events: CorrelationEvent[] = raw.map((e) => ({
        ...e,
        triggeredAt: new Date(e.triggeredAt),
      }));
      this.setEvents(events);
    } catch { /* silent — best-effort */ }
  }

  // ── Render ────────────────────────────────────────────────────────────

  private render(): void {
    if (!this.root || !this.summaryEl || !this.detailEl) return;
    if (this.events.length === 0) {
      this.root.style.display = 'none';
      this.expanded = false;
      this.detailEl.style.display = 'none';
      return;
    }
    const top = highestSeverity(this.events) ?? 'low';
    const cls = SEVERITY_CLASSES[top];
    this.root.className = `cb-correlation-banner ${cls}`;
    this.root.style.display = '';

    const headline = SEVERITY_LABELS[top];
    const types = [...new Set(this.events.map((e) => e.type))].join(' · ');
    this.summaryEl.textContent = `${headline} — ${this.events.length} active: ${types}`;

    if (this.expanded) {
      this.detailEl.replaceChildren();
      for (const e of this.events.slice(0, 8)) {
        const row = document.createElement('div');
        row.className = `cb-correlation-banner-row cb-correlation-banner-row-${e.severity}`;
        const title = document.createElement('span');
        title.className = 'cb-correlation-banner-row-title';
        title.textContent = `[${e.severity.toUpperCase()}] ${e.type}`;
        const desc = document.createElement('span');
        desc.className = 'cb-correlation-banner-row-desc';
        desc.textContent = e.description;
        row.append(title, desc);
        this.detailEl.append(row);
      }
      this.detailEl.style.display = '';
    } else {
      this.detailEl.style.display = 'none';
    }
  }

  private toggleExpanded(): void {
    this.expanded = !this.expanded;
    this.render();
  }
}
