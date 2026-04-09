/* eslint-disable sonarjs/void-use, sonarjs/no-nested-template-literals */
/**
 * StatusOverlay — single card with three sections:
 *   1. Source Health (from source-health tracker)
 *   2. Watchlist management (add / remove / view)
 *   3. Daily Rollup (latest cb:daily-rollup text)
 *
 * Toggled with ⌘⇧S or the cb:toggle-status event.
 */

import { getSourceHealth, type SourceHealth } from '@/services/source-health';
import { getWatchlist, saveWatchlist, type WatchlistEntry } from '@/services/watchlist';
import { getForecastAccuracy } from '@/services/forecast-accuracy';

export class StatusOverlay {
  private overlay: HTMLElement;
  private visible = false;
  private latestRollup = '';
  private refreshTimer: number | null = null;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'status-overlay';
    this.overlay.hidden = true;
    this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.hide(); });
    document.addEventListener('cb:daily-rollup', (e) => {
      const det = (e as CustomEvent<{ text: string }>).detail;
      this.latestRollup = det?.text ?? '';
      if (this.visible) this.render();
    });
  }

  mount(parent: HTMLElement): void {
    parent.append(this.overlay);
  }

  toggle(): void { if (this.visible) this.hide(); else this.show(); }

  show(): void {
    this.visible = true;
    this.overlay.hidden = false;
    this.render();
    this.refreshTimer = window.setInterval(() => this.render(), 15_000);
  }

  hide(): void {
    this.visible = false;
    this.overlay.hidden = true;
    if (this.refreshTimer != null) { window.clearInterval(this.refreshTimer); this.refreshTimer = null; }
  }

  private render(): void {
    this.overlay.textContent = '';
    const card = document.createElement('div');
    card.className = 'status-card';

    // Header
    const header = document.createElement('div');
    header.className = 'status-header';
    const title = document.createElement('h2'); title.textContent = 'System Status';
    const close = document.createElement('button'); close.className = 'status-close'; close.textContent = '✕';
    close.addEventListener('click', () => this.hide());
    header.append(title, close);
    card.append(header);

    // Daily rollup section
    const rollupSec = document.createElement('section');
    rollupSec.className = 'status-section';
    const rh = document.createElement('h3'); rh.textContent = 'Daily Rollup';
    rollupSec.append(rh);
    const rb = document.createElement('pre'); rb.className = 'status-rollup';
    rb.textContent = this.latestRollup || '(waiting for first rollup — updates every 15 min)';
    rollupSec.append(rb);
    card.append(rollupSec);

    // Forecast accuracy section
    card.append(this.renderForecastSection());

    // Source health section
    card.append(this.renderHealthSection());

    // Watchlist section
    card.append(this.renderWatchlistSection());

    this.overlay.append(card);
  }

  private renderForecastSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'status-section';
    const h = document.createElement('h3'); h.textContent = 'Forecast Accuracy';
    sec.append(h);
    const acc = getForecastAccuracy();
    if (acc.totalPredictions === 0) {
      const empty = document.createElement('p'); empty.className = 'status-empty';
      empty.textContent = '(no predictions logged yet)';
      sec.append(empty);
      return sec;
    }
    const bar = document.createElement('div'); bar.className = 'status-forecast-bar';
    const fill = document.createElement('div'); fill.className = 'status-forecast-fill';
    fill.style.width = `${acc.accuracy}%`;
    bar.append(fill);
    const label = document.createElement('div'); label.className = 'status-forecast-label';
    label.textContent = `${acc.accuracy}% accuracy (${acc.hits} hits / ${acc.hits + acc.misses} resolved, ${acc.pending} pending)`;
    sec.append(bar, label);
    return sec;
  }

  private renderHealthSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'status-section';
    const h = document.createElement('h3'); h.textContent = 'Source Health';
    sec.append(h);
    const items = getSourceHealth();
    if (items.length === 0) {
      const empty = document.createElement('p'); empty.className = 'status-empty';
      empty.textContent = '(no sources polled yet)';
      sec.append(empty);
      return sec;
    }
    const grid = document.createElement('div'); grid.className = 'status-health-grid';
    for (const h of items) grid.append(this.buildHealthRow(h));
    sec.append(grid);
    return sec;
  }

  private buildHealthRow(h: SourceHealth): HTMLElement {
    const row = document.createElement('div');
    row.className = `status-health-row status-health-${h.status}`;
    const dot = document.createElement('span'); dot.className = 'status-dot';
    const name = document.createElement('span'); name.className = 'status-name'; name.textContent = h.name;
    const stat = document.createElement('span'); stat.className = 'status-stat';
    const total = h.successCount + h.errorCount;
    const lastOkAgo = h.lastOk ? `${Math.round((Date.now() - h.lastOk) / 60_000)}m ago` : 'never';
    stat.textContent = `${h.successCount}/${total} · ${lastOkAgo}`;
    const badge = document.createElement('span'); badge.className = 'status-badge'; badge.textContent = h.status.toUpperCase();
    row.append(dot, name, stat, badge);
    return row;
  }

  private renderWatchlistSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'status-section';
    const h = document.createElement('h3'); h.textContent = 'Watchlist';
    sec.append(h);
    const list = getWatchlist();
    if (list.length === 0) {
      const empty = document.createElement('p'); empty.className = 'status-empty';
      empty.textContent = '(empty — right-click an alert in Triage to add)';
      sec.append(empty);
    } else {
      const items = document.createElement('div'); items.className = 'status-wl-list';
      for (const e of list) items.append(this.buildWatchlistRow(e));
      sec.append(items);
    }
    // Add form
    const form = document.createElement('div'); form.className = 'status-wl-form';
    const input = document.createElement('input');
    input.placeholder = 'Add keyword (e.g. "Taiwan", "SCADA")';
    const btn = document.createElement('button'); btn.textContent = '+ Add';
    btn.addEventListener('click', () => {
      const val = input.value.trim();
      if (!val) return;
      const cur = getWatchlist();
      cur.push({ id: `wl-${Date.now()}`, label: val, keywords: [val] });
      saveWatchlist(cur);
      input.value = '';
      this.render();
    });
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') btn.click(); });
    form.append(input, btn);
    sec.append(form);
    return sec;
  }

  private buildWatchlistRow(e: WatchlistEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'status-wl-row';
    const label = document.createElement('span'); label.className = 'status-wl-label'; label.textContent = e.label;
    const kw = document.createElement('span'); kw.className = 'status-wl-kw';
    kw.textContent = e.keywords.join(', ');
    const del = document.createElement('button'); del.className = 'status-wl-del'; del.textContent = '✕';
    del.addEventListener('click', () => {
      const cur = getWatchlist().filter(x => x.id !== e.id);
      saveWatchlist(cur);
      this.render();
    });
    row.append(label, kw, del);
    return row;
  }
}
