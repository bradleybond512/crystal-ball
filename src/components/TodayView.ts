/**
 * TodayView — full-screen overlay summarizing what matters right now.
 *
 * Toggled with ⌘⇧T. Shows top alerts ranked by hotness, grouped by source,
 * with one-click jump-to-panel and bulk acknowledge.
 */

import { unifiedAlertStore, type UnifiedAlert, type AlertSource } from '@/services/unified-alerts';
import { rankAlerts, panelForAlert } from '@/services/alert-routing';
import { flashPanel, jumpToPanel } from '@/services/alert-reactions';

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
    parent.appendChild(this.overlay);
  }

  toggle(): void { this.visible ? this.hide() : this.show(); }

  show(): void {
    this.visible = true;
    this.overlay.hidden = false;
    if (!this.unsubscribe) {
      this.unsubscribe = unifiedAlertStore.subscribe(() => this.render());
    }
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.overlay.hidden = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
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
      body.appendChild(empty);
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
        section.appendChild(label);
        for (const a of items) section.appendChild(this.makeRow(a));
        body.appendChild(section);
      }
    }

    this.overlay.replaceChildren(header, body);
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
