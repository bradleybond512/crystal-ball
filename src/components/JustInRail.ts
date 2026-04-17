/**
 * JustInRail — slim strip showing the most recent alerts as they land.
 *
 * Different from TriageBar (which shows hottest). This shows newest:
 * the last few alerts that arrived in the past 60 seconds, slide-in
 * animation, auto-fade after 30s. Builds the "live drumbeat" feel.
 */

 
import { unifiedAlertStore, type UnifiedAlert } from '@/services/unified-alerts';
import { panelForAlert } from '@/services/alert-routing';
import { jumpToPanel, flashPanel, pulseAlertOnMap } from '@/services/alert-reactions';

const MAX_ROWS = 3;
const FRESH_WINDOW_MS = 60_000;

export class JustInRail {
  private element: HTMLElement;
  private seen = new Set<string>();
  private unsubscribe: (() => void) | null = null;
  private timer: number | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'just-in-rail';
    this.element.id = 'justInRail';
    this.element.hidden = true;
    // Pre-seed seen-set with all current alerts so we only react to true new arrivals.
    for (const a of unifiedAlertStore.getAll()) this.seen.add(a.id);
  }

  mount(parent: HTMLElement): void {
    parent.prepend(this.element);
    this.unsubscribe = unifiedAlertStore.subscribe(() => this.onStoreChange());
    this.timer = window.setInterval(() => this.prune(), 5000);
  }

  destroy(): void {
    this.unsubscribe?.();
    if (this.timer != null) window.clearInterval(this.timer);
    this.element.remove();
  }

  getElement(): HTMLElement { return this.element; }

  private onStoreChange(): void {
    const now = Date.now();
    const fresh: UnifiedAlert[] = [];
    for (const a of unifiedAlertStore.getAll()) {
      if (this.seen.has(a.id)) continue;
      this.seen.add(a.id);
      if (now - a.timestamp > FRESH_WINDOW_MS) continue;
      if (a.acknowledged) continue;
      fresh.push(a);
    }
    for (const a of fresh) this.addRow(a);
    this.prune();
  }

  private addRow(a: UnifiedAlert): void {
    const row = document.createElement('div');
    row.className = `just-in-row just-in-sev-${a.severity}`;
    row.dataset.alertId = a.id;
    row.dataset.bornAt = String(Date.now());
    const dot = document.createElement('span'); dot.className = 'just-in-dot';
    const src = document.createElement('span'); src.className = 'just-in-src'; src.textContent = a.source;
    const title = document.createElement('span'); title.className = 'just-in-title'; title.textContent = a.title;
    const ago = document.createElement('span'); ago.className = 'just-in-ago'; ago.textContent = 'now';
    row.append(dot, src, title, ago);
    row.addEventListener('click', () => {
      const pid = panelForAlert(a);
      jumpToPanel(pid); flashPanel(pid);
      if (a.location) {
        document.dispatchEvent(new CustomEvent('cb:focus-map', {
          detail: { lat: a.location.lat, lon: a.location.lon, zoom: 5 },
        }));
        pulseAlertOnMap(a);
      }
    });
    this.element.prepend(row);
    this.element.hidden = false;
    // Cap visible rows.
    while (this.element.children.length > MAX_ROWS) {
      this.element.lastElementChild?.remove();
    }
  }

  private prune(): void {
    const now = Date.now();
    for (const row of this.element.querySelectorAll<HTMLElement>('.just-in-row')) {
      const born = Number(row.dataset.bornAt ?? '0');
      const age = now - born;
      if (age > 30_000) { row.remove(); continue; }
      const ageEl = row.querySelector<HTMLElement>('.just-in-ago');
      if (ageEl) ageEl.textContent = age < 5000 ? 'now' : `${Math.round(age / 1000)}s`;
      if (age > 20_000) row.classList.add('fading');
    }
    if (this.element.children.length === 0) this.element.hidden = true;
  }
}
