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
    // Delegated click on the STABLE overlay. render() rebuilds the header, rows
    // and Ack buttons via replaceChildren, and it fires in the background from
    // the unifiedAlertStore + activity-log subscriptions (see show()); binding
    // click per-row/button let a re-render between pointerdown and pointerup
    // orphan the node so the click was swallowed (dead click). One listener on
    // this.overlay — created once here and never replaced — survives every
    // teardown; nodes carry data-today-action (+ data-alert-id) re-read here.
    this.overlay.addEventListener('click', e => {
      const target = e.target as HTMLElement;
      const actionEl = target.closest<HTMLElement>('[data-today-action]');
      if (!actionEl || !this.overlay.contains(actionEl)) return;
      const action = actionEl.dataset.todayAction;
      if (action === 'close') { this.hide(); return; }
      if (action === 'ack') {
        e.stopPropagation();
        const id = actionEl.dataset.alertId;
        if (id) unifiedAlertStore.acknowledge(id);
        return;
      }
      if (action === 'jump') {
        const id = actionEl.dataset.alertId;
        const alert = id ? unifiedAlertStore.getAll().find(x => x.id === id) : undefined;
        this.hide();
        if (alert) {
          const pid = panelForAlert(alert);
          jumpToPanel(pid);
          flashPanel(pid);
        }
      }
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
    close.dataset.todayAction = 'close';
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
    ack.dataset.todayAction = 'ack';
    ack.dataset.alertId = a.id;
    row.append(dot, title, ack);
    // The row jumps to the alert's panel; the Ack button (nested inside it)
    // acknowledges. Both carry data-today-action so the single delegated
    // listener on the stable overlay handles them — closest() resolves to the
    // Ack button first when it is the target, preserving the old
    // stopPropagation semantics without a per-node listener that a background
    // render() could tear down mid-click.
    row.dataset.todayAction = 'jump';
    row.dataset.alertId = a.id;
    return row;
  }
}
