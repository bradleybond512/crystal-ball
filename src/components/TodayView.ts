/* eslint-disable @typescript-eslint/no-unused-expressions, @typescript-eslint/prefer-nullish-coalescing, sonarjs/no-nested-conditional */
/**
 * TodayView — full-screen overlay summarizing what matters right now.
 *
 * Toggled with ⌘⇧T. Shows top alerts ranked by hotness, grouped by source,
 * with one-click jump-to-panel and bulk acknowledge.
 */

import { unifiedAlertStore, type UnifiedAlert, type AlertSource } from '@/services/unified-alerts';
import { rankAlerts, panelForAlert } from '@/services/alert-routing';
import { flashPanel, jumpToPanel } from '@/services/alert-reactions';
import { getActivity, subscribeActivity, type ActivityEntry } from '@/services/alert-activity-log';

const SOURCE_LABELS: Record<AlertSource, string> = {
  'breaking-news': 'News',
  nws: 'NWS',
  gdacs: 'GDACS',
  tsunami: 'Tsunami',
  volcano: 'Volcano',
  oref: 'OREF',
  hazard: 'Hazard',
  correlation: 'Signal',
  cyber: 'Cyber',
  resource: 'Resource',
  'local-ids': 'IDS',
  earthquake: 'Quake',
  fire: 'Fire',
  cyclone: 'Cyclone',
  'power-grid': 'Grid',
  'comms-health': 'Comms',
  'space-weather': 'Space Wx',
  spc: 'SPC',
  disease: 'Disease',
  maritime: 'Maritime',
  'travel-advisory': 'Travel',
  radiation: 'Radiation',
  'air-quality': 'Air',
  'aviation-hazard': 'Aviation',
};

export class TodayView {
  private overlay: HTMLElement;
  private unsubscribe: (() => void) | null = null;
  private visible = false;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'today-view';
    this.overlay.hidden = true;
    this.overlay.addEventListener('click', e => {
      if (e.target === this.overlay) this.hide();
    });
  }

  mount(parent: HTMLElement): void {
    parent.append(this.overlay);
  }

  toggle(): void { this.visible ? this.hide() : this.show(); }

  private unsubscribeActivity: (() => void) | null = null;

  show(): void {
    this.visible = true;
    this.overlay.hidden = false;
    if (!this.unsubscribe) {
      this.unsubscribe = unifiedAlertStore.subscribe(() => this.render());
    }
    if (!this.unsubscribeActivity) {
      this.unsubscribeActivity = subscribeActivity(() => this.render());
    }
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.overlay.hidden = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeActivity?.();
    this.unsubscribeActivity = null;
  }

  private render(): void {
    const ranked = rankAlerts(unifiedAlertStore.getAll()).slice(0, 30);

    const header = document.createElement('div');
    header.className = 'today-view-header';
    const title = document.createElement('h2');
    title.textContent = 'Today';
    const close = document.createElement('button');
    close.className = 'today-view-close';
    close.textContent = '✕';
    close.addEventListener('click', () => this.hide());
    header.append(title, close);

    const body = document.createElement('div');
    body.className = 'today-view-body';

    if (ranked.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'today-view-empty';
      empty.textContent = 'All quiet. No active alerts.';
      body.append(empty);
    } else {
      // Group by source
      const groups = new Map<AlertSource, UnifiedAlert[]>();
      for (const a of ranked) {
        const arr = groups.get(a.source) ?? [];
        arr.push(a);
        groups.set(a.source, arr);
      }
      for (const [source, items] of groups) {
        const section = document.createElement('section');
        section.className = 'today-view-section';
        const label = document.createElement('h3');
        label.textContent = `${SOURCE_LABELS[source] ?? source} · ${items.length}`;
        section.append(label);
        for (const a of items) section.append(this.makeRow(a));
        body.append(section);
      }
    }

    // Activity log section
    const activity = getActivity().slice(0, 40);
    if (activity.length > 0) {
      const section = document.createElement('section');
      section.className = 'today-view-section';
      const label = document.createElement('h3');
      label.textContent = `Recent activity · ${activity.length}`;
      section.append(label);
      for (const e of activity) section.append(this.makeActivityRow(e));
      body.append(section);
    }

    this.overlay.replaceChildren(header, body);
  }

  private makeActivityRow(e: ActivityEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = `today-activity-row today-activity-${e.kind}`;
    const ago = Math.max(0, Math.round((Date.now() - e.t) / 1000));
    const agoLabel = ago < 60 ? `${ago}s` : (ago < 3600 ? `${Math.round(ago / 60)}m` : `${Math.round(ago / 3600)}h`);
    const KIND_LABEL: Record<ActivityEntry['kind'], string> = {
      new: '+ NEW', ack: '✓ ACK', snooze: '⏸ SNOOZE', correlate: '⚡ CORR', react: '🔔 FIRE',
    };
    const kind = document.createElement('span');
    kind.className = 'today-activity-kind';
    kind.textContent = KIND_LABEL[e.kind];
    const title = document.createElement('span');
    title.className = 'today-activity-title';
    title.textContent = e.title;
    const meta = document.createElement('span');
    meta.className = 'today-activity-meta';
    meta.textContent = `${e.source} · ${agoLabel}`;
    row.append(kind, title, meta);
    return row;
  }

  private makeRow(a: UnifiedAlert): HTMLElement {
    const row = document.createElement('div');
    row.className = `today-view-row today-sev-${a.severity}`;
    const dot = document.createElement('span'); dot.className = 'triage-sev-dot';
    const title = document.createElement('span'); title.className = 'today-row-title'; title.textContent = a.title;
    const ack = document.createElement('button');
    ack.className = 'today-row-ack';
    ack.textContent = 'Ack';
    ack.addEventListener('click', e => {
      e.stopPropagation();
      unifiedAlertStore.acknowledge(a.id);
    });
    row.append(dot, title, ack);
    row.addEventListener('click', () => {
      const pid = panelForAlert(a);
      this.hide();
      jumpToPanel(pid);
      flashPanel(pid);
    });
    return row;
  }
}
