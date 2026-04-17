 
/**
 * RelatedStrip — when clicking an alert or entity anywhere, this thin
 * horizontal strip appears showing related signals from other panels.
 * One-click drill-through to the source panel.
 *
 * Listens to `cb:show-related` events with { alertId, title }.
 * Auto-dismisses after 15s or on click-away.
 */

import { unifiedAlertStore, type UnifiedAlert } from '@/services/unified-alerts';
import { panelForAlert } from '@/services/alert-routing';
import { jumpToPanel, flashPanel } from '@/services/alert-reactions';

const AUTO_DISMISS_MS = 15_000;
const MAX_RELATED = 6;

export class RelatedStrip {
  private element: HTMLElement;
  private dismissTimer: number | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'related-strip';
    this.element.id = 'relatedStrip';
    this.element.hidden = true;
  }

  mount(parent: HTMLElement): void {
    parent.append(this.element);
    document.addEventListener('cb:show-related', (e) => {
      const det = (e as CustomEvent<{ alertId: string; title: string }>).detail;
      if (det) this.show(det.alertId, det.title);
    });
    document.addEventListener('cb:entity-filter', (e) => {
      const det = (e as CustomEvent<{ entity: string; alertIds: string[] }>).detail;
      if (det) this.showForEntity(det.entity, det.alertIds);
    });
  }

  private show(alertId: string, title: string): void {
    const all = unifiedAlertStore.getAll();
    const source = all.find(a => a.id === alertId);
    if (!source) return;

    // Find related: same entity keywords in title, nearby geo, or same source within 2h.
    const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const now = Date.now();
    const related = all.filter(a => {
      if (a.id === alertId) return false;
      if (a.acknowledged) return false;
      if (now - a.timestamp > 6 * 60 * 60_000) return false;
      const aTitle = a.title.toLowerCase();
      if (titleWords.some(w => aTitle.includes(w))) return true;
      return false;
    }).slice(0, MAX_RELATED);

    this.renderStrip(title, related);
  }

  private showForEntity(entity: string, alertIds: string[]): void {
    const all = unifiedAlertStore.getAll();
    const idSet = new Set(alertIds);
    const related = all.filter(a => idSet.has(a.id) && !a.acknowledged).slice(0, MAX_RELATED);
    this.renderStrip(entity, related);
  }

  private renderStrip(label: string, related: UnifiedAlert[]): void {
    if (related.length === 0) {
      this.element.hidden = true;
      return;
    }
    this.element.hidden = false;
    this.element.textContent = '';

    const title = document.createElement('span');
    title.className = 'rs-label';
    title.textContent = `Related to "${label}":`;
    this.element.append(title);

    // Group by panel to show where else this entity appears.
    const panelMap = new Map<string, UnifiedAlert[]>();
    for (const a of related) {
      const pid = panelForAlert(a);
      const arr = panelMap.get(pid) ?? [];
      arr.push(a);
      panelMap.set(pid, arr);
    }

    for (const [pid, alerts] of panelMap) {
      const chip = document.createElement('button');
      chip.className = 'rs-chip';
      chip.textContent = `${pid} (${alerts.length})`;
      chip.title = alerts.map(a => a.title).join('\n');
      chip.addEventListener('click', () => {
        jumpToPanel(pid);
        flashPanel(pid);
        this.dismiss();
      });
      this.element.append(chip);
    }

    const close = document.createElement('button');
    close.className = 'rs-close';
    close.textContent = '\u2715';
    close.addEventListener('click', () => this.dismiss());
    this.element.append(close);

    // Auto-dismiss timer.
    if (this.dismissTimer != null) window.clearTimeout(this.dismissTimer);
    this.dismissTimer = window.setTimeout(() => this.dismiss(), AUTO_DISMISS_MS);
  }

  private dismiss(): void {
    this.element.hidden = true;
    if (this.dismissTimer != null) { window.clearTimeout(this.dismissTimer); this.dismissTimer = null; }
  }
}
