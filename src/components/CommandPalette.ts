/**
 * CommandPalette — ⌘K fuzzy launcher.
 *
 * Builds a unified palette at open time across five categories:
 *   - actions (open settings, export brief, refresh all, lock vault, …)
 *   - alerts (top-ranked recent)
 *   - panels (from the rendered sidebar)
 *   - places (saved places)
 *   - presets (alerting loud/visual/silent, ack all)
 *
 * Ranking is delegated to `palette-search` so it can be unit-tested without
 * touching the DOM. Keyboard navigation matches macOS palette conventions:
 *   ↑/↓ move, Enter selects, Esc closes, ⌘1…⌘9 jump to the Nth result.
 */

import { unifiedAlertStore } from '@/services/unified-alerts';
import { rankAlerts, panelForAlert } from '@/services/alert-routing';
import { flashPanel, jumpToPanel } from '@/services/alert-reactions';
import { setPreset } from '@/services/alerting-prefs';
import { getSavedPlaces } from '@/services/saved-places';
import {
  rankPalette,
  groupByCategory,
  CATEGORY_LABELS,
  CATEGORY_WEIGHTS,
  type PaletteItem,
  type RankedItem,
} from '@/services/keyboard/palette-search';

const MAX_RESULTS = 12;
const MAX_ALERTS = 10;
const MAX_PLACES = 8;

interface PaletteAction {
  run: () => void;
}

export class CommandPalette {
  private overlay: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private items: PaletteItem<PaletteAction>[] = [];
  private ranked: RankedItem<PaletteAction>[] = [];
  private cursor = 0;
  private visible = false;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'cmdk-overlay';
    this.overlay.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'cmdk-panel';

    this.input = document.createElement('input');
    this.input.className = 'cmdk-input';
    this.input.placeholder = 'Search panels, places, actions…';
    this.input.setAttribute('aria-label', 'Command palette search');
    this.input.addEventListener('input', () => { this.cursor = 0; this.refilter(); });
    this.input.addEventListener('keydown', (e) => this.onKey(e));

    this.list = document.createElement('div');
    this.list.className = 'cmdk-list';
    this.list.setAttribute('role', 'listbox');

    panel.append(this.input, this.list);
    this.overlay.append(panel);
    this.overlay.addEventListener('click', e => {
      if (e.target === this.overlay) this.hide();
    });
  }

  mount(parent: HTMLElement): void { parent.append(this.overlay); }

  toggle(): void { if (this.visible) this.hide(); else this.show(); }

  show(): void {
    this.items = this.buildItems();
    this.cursor = 0;
    this.input.value = '';
    this.visible = true;
    this.overlay.hidden = false;
    this.refilter();
    setTimeout(() => this.input.focus(), 0);
  }

  hide(): void {
    this.visible = false;
    this.overlay.hidden = true;
  }

  /** Exposed for tests / Cmd palette diagnostics — returns the current ranking. */
  currentRanked(): readonly RankedItem<PaletteAction>[] { return this.ranked; }

  private buildItems(): PaletteItem<PaletteAction>[] {
    const out: PaletteItem<PaletteAction>[] = [];

    // ── Common actions ────────────────────────────────────────────────────
    const actions: { id: string; label: string; hint?: string; run: () => void }[] = [
      { id: 'today',      label: 'Open Today view',        hint: '⌘⇧T', run: () => document.dispatchEvent(new CustomEvent('cb:toggle-today')) },
      { id: 'watchlist',  label: 'Open Watchlist editor',  hint: '⌘⇧W', run: () => document.dispatchEvent(new CustomEvent('cb:toggle-watchlist')) },
      { id: 'gv',         label: "Toggle God's Vision",    hint: 'G',   run: () => document.dispatchEvent(new CustomEvent('cb:toggle-gods-vision')) },
      { id: 'settings',   label: 'Open Settings',          hint: '⌘,',  run: () => document.dispatchEvent(new CustomEvent('wm:open-settings')) },
      { id: 'brief',      label: 'Show daily brief',       hint: '⌘⇧H', run: () => document.dispatchEvent(new CustomEvent('cb:show-digest')) },
      { id: 'export',     label: 'Export briefing to clipboard', run: () => document.dispatchEvent(new CustomEvent('cb:export-briefing')) },
      { id: 'refresh',    label: 'Refresh all feeds',      run: () => document.dispatchEvent(new CustomEvent('cb:refresh-all')) },
      { id: 'help',       label: 'Show keyboard shortcuts', hint: '⌘/', run: () => document.dispatchEvent(new CustomEvent('cb:toggle-help')) },
      { id: 'sidebar',    label: 'Toggle sidebar',         hint: '⌘\\', run: () => document.dispatchEvent(new CustomEvent('cb:toggle-sidebar')) },
      { id: 'ack-all',    label: 'Acknowledge ALL alerts', run: () => unifiedAlertStore.acknowledgeAll() },
    ];
    for (const a of actions) {
      out.push({
        id: `action:${a.id}`,
        label: a.label,
        category: 'action',
        hint: a.hint,
        weight: CATEGORY_WEIGHTS.action,
        data: { run: a.run },
      });
    }

    // ── Alerting presets ──────────────────────────────────────────────────
    const presets: { id: 'loud' | 'visual' | 'silent'; label: string }[] = [
      { id: 'loud',   label: 'Alerting preset: Loud' },
      { id: 'visual', label: 'Alerting preset: Visual' },
      { id: 'silent', label: 'Alerting preset: Silent' },
    ];
    for (const p of presets) {
      out.push({
        id: `preset:${p.id}`,
        label: p.label,
        category: 'preset',
        weight: CATEGORY_WEIGHTS.preset,
        data: { run: () => setPreset(p.id) },
      });
    }

    // ── Panels (from rendered sidebar) ────────────────────────────────────
    document.querySelectorAll<HTMLElement>('.mac-sidebar-panel-item[data-panel-key]').forEach((el, i) => {
      const key = el.dataset.panelKey;
      if (!key) return;
      const name = el.textContent?.trim() ?? key;
      const hint = i < 9 ? `⌘${i + 1}` : undefined;
      out.push({
        id: `panel:${key}`,
        label: `Jump to: ${name}`,
        category: 'panel',
        hint,
        weight: CATEGORY_WEIGHTS.panel,
        data: { run: () => { jumpToPanel(key); flashPanel(key); } },
      });
    });

    // ── Saved places ─────────────────────────────────────────────────────
    try {
      const places = getSavedPlaces().slice(0, MAX_PLACES);
      for (const p of places) {
        out.push({
          id: `place:${p.id}`,
          label: `Focus place: ${p.name}`,
          category: 'place',
          hint: p.primary ? 'primary' : undefined,
          weight: CATEGORY_WEIGHTS.place,
          data: {
            run: () => {
              document.dispatchEvent(new CustomEvent('cb:focus-map', { detail: { lat: p.lat, lon: p.lon, zoom: 9 } }));
              jumpToPanel('saved-places');
              flashPanel('saved-places');
            },
          },
        });
      }
    } catch { /* saved-places store may be unavailable in headless test contexts */ }

    // ── Top alerts ───────────────────────────────────────────────────────
    for (const a of rankAlerts(unifiedAlertStore.getAll()).slice(0, MAX_ALERTS)) {
      out.push({
        id: `alert:${a.id}`,
        label: `[${a.severity.toUpperCase()}] ${a.title}`,
        category: 'alert',
        hint: a.source,
        weight: CATEGORY_WEIGHTS.alert,
        data: { run: () => { const pid = panelForAlert(a); jumpToPanel(pid); flashPanel(pid); } },
      });
    }

    return out;
  }

  private refilter(): void {
    this.ranked = rankPalette(this.items, this.input.value, MAX_RESULTS);
    if (this.cursor >= this.ranked.length) this.cursor = Math.max(0, this.ranked.length - 1);
    this.renderList();
  }

  private renderList(): void {
    this.list.replaceChildren();
    const grouped = groupByCategory(this.ranked);
    let row = 0;
    for (const [cat, entries] of grouped) {
      const header = document.createElement('div');
      header.className = 'cmdk-section';
      header.textContent = CATEGORY_LABELS[cat];
      this.list.append(header);
      for (const r of entries) {
        const idx = row;
        const btn = document.createElement('button');
        btn.className = `cmdk-row${idx === this.cursor ? ' is-active' : ''}`;
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', idx === this.cursor ? 'true' : 'false');
        const label = document.createElement('span');
        label.className = 'cmdk-label';
        label.textContent = r.item.label;
        btn.append(label);
        if (r.item.hint) {
          const hint = document.createElement('span');
          hint.className = 'cmdk-hint';
          hint.textContent = r.item.hint;
          btn.append(hint);
        }
        btn.addEventListener('click', () => this.runAt(idx));
        this.list.append(btn);
        row += 1;
      }
    }
  }

  private runAt(idx: number): void {
    const r = this.ranked[idx];
    if (!r) return;
    r.item.data?.run();
    this.hide();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); this.hide(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.cursor = Math.min(this.cursor + 1, Math.max(0, this.ranked.length - 1));
      this.renderList();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.cursor = Math.max(0, this.cursor - 1);
      this.renderList();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this.runAt(this.cursor);
      return;
    }
    // ⌘1…⌘9: jump straight to the Nth visible result.
    if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      this.runAt(Number.parseInt(e.key, 10) - 1);
    }
  }
}
