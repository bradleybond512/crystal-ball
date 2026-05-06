/* eslint-disable sonarjs/no-async-constructor */
import { Panel } from './Panel';
import { fetchUnifiedWebcams, getFavoriteIds, toggleFavorite } from '@/services/webcams/fetcher';
import type { WebcamCategory, WebcamFeed, WebcamSource } from '@/services/webcams/webcam-types';

type ViewMode = 'grid' | 'list';

const SOURCE_LABELS: Record<WebcamSource, string> = {
  FAA: 'FAA',
  DOT511: 'Traffic',
  USGS_VOLCANO: 'Volcano',
  NPS: 'Parks',
  ALERTWILDFIRE: 'Fire',
  WINDY: 'Windy',
  USFS: 'USFS',
  USGS_STREAM: 'Stream',
  NOAA_COASTAL: 'Coastal',
};

const CATEGORY_COLORS: Record<WebcamCategory, string> = {
  fire: '#f85149',
  volcano: '#bc8cff',
  weather: '#58a6ff',
  coastal: '#3fb950',
  stream: '#56d4dd',
  traffic: '#d29922',
  nature: '#7ee787',
};

export class UnifiedWebcamPanel extends Panel {
  private feeds: WebcamFeed[] = [];
  private viewMode: ViewMode = 'grid';
  private sourceFilter: WebcamSource | 'ALL' | 'FAVORITES' = 'ALL';
  private categoryFilter: WebcamCategory | 'ALL' = 'ALL';
  private searchQuery = '';
  private selectedFeed: WebcamFeed | null = null;
  private favorites = new Set<string>(getFavoriteIds());
  private loading = false;
  private lastError: string | null = null;

  constructor() {
    super({ id: 'unified-webcams', title: 'Webcams', className: 'panel-wide' });
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.lastError = null;
    this.render();
    try {
      const catalog = await fetchUnifiedWebcams();
      this.feeds = catalog.feeds;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  public refresh(): void {
    void this.load();
  }

  private get displayed(): WebcamFeed[] {
    let list = this.feeds;
    if (this.sourceFilter === 'FAVORITES') {
      list = list.filter((f) => this.favorites.has(f.id));
    } else if (this.sourceFilter !== 'ALL') {
      list = list.filter((f) => f.source === this.sourceFilter);
    }
    if (this.categoryFilter !== 'ALL') {
      list = list.filter((f) => f.category === this.categoryFilter);
    }
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          Object.values(f.metadata).some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return list;
  }

  private render(): void {
    const el = this.getContentElement();
    while (el.firstChild) el.firstChild.remove();
    el.className = 'panel-content unified-webcams-content';

    el.append(this.buildToolbar());
    el.append(this.buildSourceChips());
    el.append(this.buildCategoryChips());

    if (this.loading) {
      const loading = document.createElement('p');
      loading.className = 'webcam-loading';
      loading.textContent = 'Loading webcams…';
      el.append(loading);
      return;
    }

    if (this.lastError) {
      const err = document.createElement('p');
      err.className = 'webcam-error';
      err.style.color = '#f85149';
      err.textContent = `Error: ${this.lastError}`;
      el.append(err);
      return;
    }

    if (this.selectedFeed) el.append(this.buildViewer(this.selectedFeed));

    const list = this.displayed;
    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'webcam-empty';
      empty.textContent = this.feeds.length === 0
        ? 'No webcams loaded.'
        : 'No webcams match the current filter.';
      el.append(empty);
      return;
    }

    el.append(this.viewMode === 'grid' ? this.buildGrid(list) : this.buildList(list));
  }

  private buildToolbar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'webcams-toolbar';
    bar.style.display = 'flex';
    bar.style.gap = '8px';
    bar.style.alignItems = 'center';
    bar.style.flexWrap = 'wrap';
    bar.style.padding = '8px';

    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search…';
    search.value = this.searchQuery;
    search.style.flex = '1';
    search.style.minWidth = '120px';
    search.addEventListener('input', () => {
      this.searchQuery = search.value;
      this.render();
    });
    bar.append(search);

    const viewWrap = document.createElement('div');
    viewWrap.className = 'webcams-view-toggle';
    for (const mode of ['grid', 'list'] as ViewMode[]) {
      const b = document.createElement('button');
      b.textContent = mode === 'grid' ? '▦ Grid' : '☰ List';
      b.style.background = this.viewMode === mode ? '#1f6feb' : 'transparent';
      b.style.color = this.viewMode === mode ? '#fff' : 'inherit';
      b.style.border = '1px solid #444';
      b.style.padding = '4px 8px';
      b.style.borderRadius = '3px';
      b.style.cursor = 'pointer';
      b.addEventListener('click', () => {
        this.viewMode = mode;
        this.render();
      });
      viewWrap.append(b);
    }
    bar.append(viewWrap);

    const count = document.createElement('span');
    count.className = 'webcams-count';
    count.style.opacity = '0.7';
    count.style.fontSize = '12px';
    count.textContent = `${this.displayed.length} of ${this.feeds.length} cams`;
    bar.append(count);

    return bar;
  }

  private buildSourceChips(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'webcams-chips webcams-source-chips';
    wrap.style.display = 'flex';
    wrap.style.gap = '6px';
    wrap.style.flexWrap = 'wrap';
    wrap.style.padding = '4px 8px';
    const options: (WebcamSource | 'ALL' | 'FAVORITES')[] = [
      'ALL',
      'FAVORITES',
      'FAA',
      'DOT511',
      'ALERTWILDFIRE',
      'USGS_VOLCANO',
      'NPS',
      'NOAA_COASTAL',
      'USGS_STREAM',
      'WINDY',
    ];
    for (const opt of options) {
      const chip = document.createElement('button');
      let label: string;
      if (opt === 'ALL') {
        label = `All (${this.feeds.length})`;
      } else if (opt === 'FAVORITES') {
        label = `★ Favorites (${this.favorites.size})`;
      } else {
        const sourceCount = this.feeds.filter((f) => f.source === opt).length;
        label = `${SOURCE_LABELS[opt]} (${sourceCount})`;
      }
      chip.textContent = label;
      chip.style.fontSize = '11px';
      chip.style.padding = '3px 8px';
      chip.style.border = '1px solid #444';
      chip.style.borderRadius = '12px';
      chip.style.cursor = 'pointer';
      chip.style.background = this.sourceFilter === opt ? '#1f6feb' : 'transparent';
      chip.style.color = this.sourceFilter === opt ? '#fff' : 'inherit';
      chip.addEventListener('click', () => {
        this.sourceFilter = opt;
        this.render();
      });
      wrap.append(chip);
    }
    return wrap;
  }

  private buildCategoryChips(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'webcams-chips webcams-category-chips';
    wrap.style.display = 'flex';
    wrap.style.gap = '6px';
    wrap.style.flexWrap = 'wrap';
    wrap.style.padding = '4px 8px';
    const cats: (WebcamCategory | 'ALL')[] = ['ALL', 'fire', 'volcano', 'weather', 'coastal', 'stream', 'traffic', 'nature'];
    for (const c of cats) {
      const chip = document.createElement('button');
      chip.textContent = c === 'ALL' ? 'All categories' : c;
      chip.style.fontSize = '11px';
      chip.style.padding = '3px 8px';
      chip.style.border = '1px solid #444';
      chip.style.borderRadius = '12px';
      chip.style.cursor = 'pointer';
      chip.style.textTransform = 'capitalize';
      const active = this.categoryFilter === c;
      let bg = 'transparent';
      if (active && c !== 'ALL') bg = CATEGORY_COLORS[c as WebcamCategory];
      else if (active) bg = '#1f6feb';
      chip.style.background = bg;
      chip.style.color = active ? '#fff' : 'inherit';
      chip.addEventListener('click', () => {
        this.categoryFilter = c;
        this.render();
      });
      wrap.append(chip);
    }
    return wrap;
  }

  private buildGrid(feeds: WebcamFeed[]): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'webcams-grid';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';
    grid.style.gap = '8px';
    grid.style.padding = '8px';
    for (const f of feeds.slice(0, 200)) grid.append(this.buildCard(f));
    if (feeds.length > 200) {
      const more = document.createElement('p');
      more.style.gridColumn = '1 / -1';
      more.style.opacity = '0.6';
      more.style.fontSize = '12px';
      more.textContent = `+${feeds.length - 200} more (refine filter)`;
      grid.append(more);
    }
    return grid;
  }

  private buildCard(f: WebcamFeed): HTMLElement {
    const card = document.createElement('div');
    card.className = 'webcam-card';
    card.style.border = '1px solid #333';
    card.style.borderRadius = '4px';
    card.style.overflow = 'hidden';
    card.style.cursor = 'pointer';
    card.style.position = 'relative';

    const img = document.createElement('img');
    img.src = f.snapshotUrl;
    img.alt = f.name;
    img.loading = 'lazy';
    img.style.width = '100%';
    img.style.aspectRatio = '16 / 9';
    img.style.objectFit = 'cover';
    img.style.background = '#111';
    img.addEventListener('error', () => {
      img.style.opacity = '0.3';
      img.style.background = '#222';
    });

    const star = document.createElement('button');
    star.textContent = this.favorites.has(f.id) ? '★' : '☆';
    star.style.position = 'absolute';
    star.style.top = '4px';
    star.style.right = '4px';
    star.style.background = 'rgba(0,0,0,0.6)';
    star.style.color = this.favorites.has(f.id) ? '#f7c948' : '#ccc';
    star.style.border = 'none';
    star.style.borderRadius = '50%';
    star.style.width = '24px';
    star.style.height = '24px';
    star.style.cursor = 'pointer';
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      const isFav = toggleFavorite(f.id);
      if (isFav) this.favorites.add(f.id);
      else this.favorites.delete(f.id);
      this.render();
    });

    const info = document.createElement('div');
    info.style.padding = '6px 8px';
    info.style.fontSize = '12px';

    const name = document.createElement('div');
    name.textContent = f.name;
    name.style.fontWeight = '600';
    name.style.marginBottom = '2px';
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.whiteSpace = 'nowrap';
    info.append(name);

    const meta = document.createElement('div');
    meta.style.opacity = '0.7';
    meta.style.fontSize = '10px';
    meta.style.display = 'flex';
    meta.style.gap = '4px';
    meta.style.alignItems = 'center';

    const sourceBadge = document.createElement('span');
    sourceBadge.textContent = SOURCE_LABELS[f.source];
    sourceBadge.style.background = CATEGORY_COLORS[f.category];
    sourceBadge.style.color = '#fff';
    sourceBadge.style.padding = '1px 5px';
    sourceBadge.style.borderRadius = '3px';
    meta.append(sourceBadge);

    if (f.metadata.state) {
      const state = document.createElement('span');
      state.textContent = f.metadata.state;
      meta.append(state);
    }

    info.append(meta);

    card.append(img);
    card.append(star);
    card.append(info);

    card.addEventListener('click', () => {
      this.selectedFeed = this.selectedFeed?.id === f.id ? null : f;
      this.render();
    });

    return card;
  }

  private buildList(feeds: WebcamFeed[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.padding = '8px';
    const table = document.createElement('table');
    table.className = 'webcams-list-table eq-table';
    table.style.width = '100%';
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const col of ['', 'Name', 'Source', 'Category', 'Location']) {
      const th = document.createElement('th');
      th.textContent = col;
      tr.append(th);
    }
    thead.append(tr);
    table.append(thead);
    const tbody = document.createElement('tbody');
    for (const f of feeds.slice(0, 500)) {
      const row = document.createElement('tr');
      row.style.cursor = 'pointer';

      const tdStar = document.createElement('td');
      const star = document.createElement('span');
      star.textContent = this.favorites.has(f.id) ? '★' : '☆';
      star.style.color = this.favorites.has(f.id) ? '#f7c948' : '#888';
      star.style.cursor = 'pointer';
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        const isFav = toggleFavorite(f.id);
        if (isFav) this.favorites.add(f.id);
        else this.favorites.delete(f.id);
        this.render();
      });
      tdStar.append(star);
      row.append(tdStar);

      const tdName = document.createElement('td');
      tdName.textContent = f.name;
      row.append(tdName);

      const tdSource = document.createElement('td');
      const badge = document.createElement('span');
      badge.textContent = SOURCE_LABELS[f.source];
      badge.style.background = CATEGORY_COLORS[f.category];
      badge.style.color = '#fff';
      badge.style.padding = '1px 5px';
      badge.style.borderRadius = '3px';
      badge.style.fontSize = '10px';
      tdSource.append(badge);
      row.append(tdSource);

      const tdCat = document.createElement('td');
      tdCat.textContent = f.category;
      tdCat.style.textTransform = 'capitalize';
      row.append(tdCat);

      const tdLoc = document.createElement('td');
      tdLoc.textContent =
        f.metadata.state ?? f.metadata.region ?? f.metadata.country ?? `${f.lat.toFixed(2)},${f.lon.toFixed(2)}`;
      row.append(tdLoc);

      row.addEventListener('click', () => {
        this.selectedFeed = this.selectedFeed?.id === f.id ? null : f;
        this.render();
      });
      tbody.append(row);
    }
    table.append(tbody);
    wrap.append(table);
    return wrap;
  }

  private buildViewer(f: WebcamFeed): HTMLElement {
    const div = document.createElement('div');
    div.className = 'webcam-viewer';
    div.style.border = '2px solid #1f6feb';
    div.style.borderRadius = '4px';
    div.style.margin = '8px';
    div.style.padding = '8px';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '8px';

    const title = document.createElement('strong');
    title.textContent = f.name;
    header.append(title);

    const close = document.createElement('button');
    close.textContent = '✕';
    close.style.background = 'transparent';
    close.style.border = 'none';
    close.style.color = 'inherit';
    close.style.fontSize = '16px';
    close.style.cursor = 'pointer';
    close.addEventListener('click', () => {
      this.selectedFeed = null;
      this.render();
    });
    header.append(close);
    div.append(header);

    const img = document.createElement('img');
    img.src = `${f.snapshotUrl}${f.snapshotUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
    img.alt = f.name;
    img.style.width = '100%';
    img.style.maxWidth = '900px';
    img.style.borderRadius = '4px';
    img.style.background = '#111';
    div.append(img);

    const meta = document.createElement('div');
    meta.style.fontSize = '12px';
    meta.style.marginTop = '8px';
    meta.style.opacity = '0.8';
    const lines: string[] = [
      `Source: ${SOURCE_LABELS[f.source]} · Category: ${f.category}`,
      `Coords: ${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}`,
    ];
    for (const [k, v] of Object.entries(f.metadata)) lines.push(`${k}: ${v}`);
    if (f.streamUrl) lines.push(`Stream: ${f.streamUrl}`);
    for (const line of lines) {
      const p = document.createElement('div');
      p.textContent = line;
      meta.append(p);
    }
    div.append(meta);

    return div;
  }
}
