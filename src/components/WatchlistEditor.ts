/**
 * WatchlistEditor — modal overlay for editing watchlist entries.
 *
 * Toggled via ⌘⇧W. Each entry has a label, keywords, optional lat/lon/radius.
 * Matching alerts get a relevance boost (WATCHLIST_MULT) in the score function.
 */

import { getWatchlist, saveWatchlist, type WatchlistEntry } from '@/services/watchlist';

export class WatchlistEditor {
  private overlay: HTMLElement;
  private entries: WatchlistEntry[] = [];
  private visible = false;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'watchlist-editor';
    this.overlay.hidden = true;
    this.overlay.addEventListener('click', e => {
      if (e.target === this.overlay) this.hide();
    });
  }

  mount(parent: HTMLElement): void { parent.appendChild(this.overlay); }

  toggle(): void { this.visible ? this.hide() : this.show(); }

  show(): void {
    this.entries = [...getWatchlist()];
    this.visible = true;
    this.overlay.hidden = false;
    this.render();
  }

  hide(): void {
    this.visible = false;
    this.overlay.hidden = true;
  }

  private addEntry(): void {
    this.entries.push({
      id: `wl-${Date.now()}`,
      label: 'New entry',
      keywords: [],
    });
    this.render();
  }

  private removeEntry(id: string): void {
    this.entries = this.entries.filter(e => e.id !== id);
    this.render();
  }

  private save(): void {
    saveWatchlist(this.entries);
    this.hide();
  }

  private render(): void {
    const header = document.createElement('div');
    header.className = 'watchlist-header';
    const title = document.createElement('h2');
    title.textContent = 'Watchlist';
    const close = document.createElement('button');
    close.className = 'watchlist-close';
    close.textContent = '✕';
    close.addEventListener('click', () => this.hide());
    header.append(title, close);

    const help = document.createElement('p');
    help.className = 'watchlist-help';
    help.textContent = 'Alerts matching any keyword or within radius of a location get boosted to the top of triage.';

    const list = document.createElement('div');
    list.className = 'watchlist-list';

    if (this.entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'watchlist-empty';
      empty.textContent = 'No entries yet. Click "Add entry" below.';
      list.appendChild(empty);
    }

    for (const entry of this.entries) {
      list.appendChild(this.makeRow(entry));
    }

    const actions = document.createElement('div');
    actions.className = 'watchlist-actions';
    const add = document.createElement('button');
    add.className = 'watchlist-add-btn';
    add.textContent = '+ Add entry';
    add.addEventListener('click', () => this.addEntry());
    const save = document.createElement('button');
    save.className = 'watchlist-save-btn';
    save.textContent = 'Save';
    save.addEventListener('click', () => this.save());
    actions.append(add, save);

    this.overlay.replaceChildren(header, help, list, actions);
  }

  private makeRow(entry: WatchlistEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'watchlist-row';

    const labelInput = this.input('Label', entry.label, v => { entry.label = v; });
    const kwInput = this.input('Keywords (comma-separated)',
      entry.keywords.join(', '),
      v => { entry.keywords = v.split(',').map(s => s.trim()).filter(Boolean); });
    const latInput = this.input('Latitude',
      entry.lat?.toString() ?? '',
      v => { entry.lat = v ? parseFloat(v) : undefined; });
    const lonInput = this.input('Longitude',
      entry.lon?.toString() ?? '',
      v => { entry.lon = v ? parseFloat(v) : undefined; });
    const radiusInput = this.input('Radius (km)',
      entry.radiusKm?.toString() ?? '',
      v => { entry.radiusKm = v ? parseFloat(v) : undefined; });

    const remove = document.createElement('button');
    remove.className = 'watchlist-remove-btn';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => this.removeEntry(entry.id));

    row.append(labelInput, kwInput, latInput, lonInput, radiusInput, remove);
    return row;
  }

  private input(label: string, value: string, onChange: (v: string) => void): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'watchlist-field';
    const lbl = document.createElement('span');
    lbl.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value;
    inp.addEventListener('input', () => onChange(inp.value));
    wrap.append(lbl, inp);
    return wrap;
  }
}
