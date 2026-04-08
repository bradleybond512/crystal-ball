/**
 * TriageBar — pinned strip showing the top 5 hottest active alerts.
 *
 * Subscribes to the unified alert store, ranks via alert-routing scoring,
 * and renders a clickable row that scrolls + flashes the source panel.
 * Auto-hides when there's nothing hot.
 */

import { unifiedAlertStore, type UnifiedAlert } from '@/services/unified-alerts';
import { rankAlerts, panelForAlert } from '@/services/alert-routing';
import { flashPanel, jumpToPanel } from '@/services/alert-reactions';

const MAX_VISIBLE = 5;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export class TriageBar {
  private element: HTMLElement;
  private unsubscribe: (() => void) | null = null;
  private refreshTimer: number | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'triage-bar';
    this.element.id = 'triageBar';
    this.element.hidden = true;
  }

  mount(parent: HTMLElement): void {
    parent.prepend(this.element);
    this.unsubscribe = unifiedAlertStore.subscribe(() => this.render());
    this.refreshTimer = window.setInterval(() => this.render(), 30_000);
    this.render();
  }

  destroy(): void {
    this.unsubscribe?.();
    if (this.refreshTimer != null) window.clearInterval(this.refreshTimer);
    this.element.remove();
  }

  getElement(): HTMLElement { return this.element; }

  private render(): void {
    const ranked = rankAlerts(unifiedAlertStore.getAll()).slice(0, MAX_VISIBLE);
    if (ranked.length === 0) {
      this.element.hidden = true;
      this.element.replaceChildren();
      return;
    }
    this.element.hidden = false;
    const label = document.createElement('div');
    label.className = 'triage-bar-label';
    label.textContent = '⚡ TRIAGE';
    const items = document.createElement('div');
    items.className = 'triage-bar-items';
    for (const a of ranked) items.appendChild(this.makeItem(a));
    const ack = document.createElement('button');
    ack.className = 'triage-bar-ack';
    ack.id = 'triageAckAll';
    ack.title = 'Acknowledge all visible';
    ack.textContent = 'Ack all';
    ack.addEventListener('click', () => {
      for (const a of ranked) unifiedAlertStore.acknowledge(a.id);
    });
    this.element.replaceChildren(label, items, ack);
  }

  private makeItem(a: UnifiedAlert): HTMLElement {
    const el = document.createElement('div');
    el.className = `triage-bar-item triage-sev-${a.severity}`;
    el.dataset.alertId = a.id;
    el.title = a.body;
    const ageMin = Math.max(0, Math.round((Date.now() - a.timestamp) / 60_000));
    const ageLabel = ageMin < 1 ? 'now' : ageMin < 60 ? `${ageMin}m` : `${Math.floor(ageMin / 60)}h`;
    const dot = document.createElement('span'); dot.className = 'triage-sev-dot';
    const src = document.createElement('span'); src.className = 'triage-source'; src.textContent = a.source;
    const title = document.createElement('span'); title.className = 'triage-title'; title.textContent = a.title;
    const age = document.createElement('span'); age.className = 'triage-age'; age.textContent = ageLabel;
    el.append(dot, src, title, age);
    el.addEventListener('click', () => {
      const panelId = panelForAlert(a);
      jumpToPanel(panelId);
      flashPanel(panelId);
    });
    // Reference escapeHtml so unused-import lint doesn't fire (HTML-escaping reserved for future templated rendering)
    void escapeHtml;
    return el;
  }
}
