 
/**
 * AlertTimeline — 6h bar-chart strip showing unified alert arrival density.
 * Each bar is a 5min bucket; height = count, color tinted by max severity
 * in the bucket. Clicking a bar pops a dropdown of that bucket's alerts.
 */

import { unifiedAlertStore, type UnifiedAlert } from '@/services/unified-alerts';
import { panelForAlert } from '@/services/alert-routing';
import { jumpToPanel, flashPanel, pulseAlertOnMap } from '@/services/alert-reactions';

const WINDOW_MS = 6 * 60 * 60_000;
const BUCKET_MS = 5 * 60_000;
const BUCKETS = Math.floor(WINDOW_MS / BUCKET_MS); // 72
const REFRESH_MS = 30_000;
const SEV_RANK: Record<UnifiedAlert['severity'], number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export class AlertTimeline {
  private element: HTMLElement;
  private timer: number | null = null;
  private unsub: (() => void) | null = null;
  private openDropdown: HTMLElement | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'alert-timeline';
    this.element.id = 'alertTimeline';
  }

  mount(parent: HTMLElement): void {
    parent.append(this.element);
    this.render();
    this.timer = window.setInterval(() => this.render(), REFRESH_MS);
    this.unsub = unifiedAlertStore.subscribe(() => this.render());
  }

  destroy(): void {
    if (this.timer != null) window.clearInterval(this.timer);
    this.unsub?.();
    this.element.remove();
  }

  getElement(): HTMLElement { return this.element; }

  private render(): void {
    const now = Date.now();
    const cutoff = now - WINDOW_MS;
    const alerts = unifiedAlertStore.getAll().filter(a => a.timestamp >= cutoff);
    const buckets: { count: number; maxSev: number; items: UnifiedAlert[] }[] =
      Array.from({ length: BUCKETS }, () => ({ count: 0, maxSev: 0, items: [] }));
    for (const a of alerts) {
      const idx = Math.min(BUCKETS - 1, Math.floor((a.timestamp - cutoff) / BUCKET_MS));
      const b = buckets[idx]!;
      b.count += 1;
      const r = SEV_RANK[a.severity] ?? 0;
      if (r > b.maxSev) b.maxSev = r;
      if (b.items.length < 20) b.items.push(a);
    }
    const maxCount = Math.max(1, ...buckets.map(b => b.count));

    this.element.textContent = '';
    const label = document.createElement('span');
    label.className = 'at-label';
    label.textContent = '6h';
    this.element.append(label);
    const strip = document.createElement('div');
    strip.className = 'at-strip';
    for (let i = 0; i < BUCKETS; i++) {
      const b = buckets[i]!;
      const bar = document.createElement('div');
      bar.className = `at-bar at-sev-${b.maxSev}`;
      const h = b.count === 0 ? 2 : Math.round((b.count / maxCount) * 100);
      bar.style.height = `${h}%`;
      const bucketStart = cutoff + (i * BUCKET_MS);
      const agoMin = Math.round((now - bucketStart) / 60_000);
      bar.title = b.count === 0 ? `${agoMin}m ago: quiet` : `${agoMin}m ago: ${b.count} alerts`;
      if (b.count > 0) {
        bar.addEventListener('click', (ev) => { ev.stopPropagation(); this.showDropdown(bar, b.items); });
      }
      strip.append(bar);
    }
    this.element.append(strip);
  }

  private showDropdown(anchor: HTMLElement, items: UnifiedAlert[]): void {
    this.openDropdown?.remove();
    const dd = document.createElement('div');
    dd.className = 'at-dropdown';
    const rect = anchor.getBoundingClientRect();
    dd.style.left = `${Math.max(8, rect.left - 100)}px`;
    dd.style.top = `${rect.bottom + 4}px`;
    for (const a of items) {
      const row = document.createElement('div');
      row.className = `at-row at-row-${a.severity}`;
      const src = document.createElement('span'); src.className = 'at-row-src'; src.textContent = a.source;
      const t = document.createElement('span'); t.className = 'at-row-title'; t.textContent = a.title;
      row.append(src, t);
      row.addEventListener('click', () => {
        const pid = panelForAlert(a);
        jumpToPanel(pid); flashPanel(pid);
        if (a.location) {
          document.dispatchEvent(new CustomEvent('cb:focus-map', {
            detail: { lat: a.location.lat, lon: a.location.lon, zoom: 5 },
          }));
          pulseAlertOnMap(a);
        }
        dd.remove();
        this.openDropdown = null;
      });
      dd.append(row);
    }
    document.body.append(dd);
    this.openDropdown = dd;
    const dismiss = (ev: MouseEvent): void => {
      if (!dd.contains(ev.target as Node)) {
        dd.remove();
        this.openDropdown = null;
        document.removeEventListener('mousedown', dismiss);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  }
}
