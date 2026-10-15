import type { FeatureRef, MapFeature } from './map-clarity-model';

interface MapFeatureListOptions {
  onSelect: (feature: FeatureRef) => void;
  onShowOnMap?: (feature: FeatureRef) => void;
  onOpenFeature?: (feature: FeatureRef) => void;
  onClose?: () => void;
}

const PAGE_SIZE = 50;
let instanceCount = 0;

const FAMILY_LABEL: Record<MapFeature['family'], string> = {
  forecast: 'Forecast',
  camera: 'Camera',
  datacenter: 'Data center',
};

/** Local, nonmodal access to every source member, independent of map labels. */
export class MapFeatureList {
  private readonly entry: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly summary: HTMLElement;
  private readonly allItems: HTMLButtonElement;
  private readonly list: HTMLUListElement;
  private readonly empty: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly detailTitle: HTMLElement;
  private readonly detailState: HTMLElement;
  private readonly detailMetrics: HTMLDListElement;
  private readonly showOnMap: HTMLButtonElement;
  private readonly openFeature: HTMLButtonElement;
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly pageLabel: HTMLElement;
  private readonly rows = new Map<string, HTMLLIElement>();
  private features = new Map<string, MapFeature>();
  private memberSubset: Set<string> | null = null;
  private selectedId: string | null = null;
  private selectedSnapshot: MapFeature | null = null;
  private page = 0;
  private opened = false;
  private destroyed = false;
  private invoker: HTMLElement | null = null;

  constructor(container: HTMLElement, private readonly options: MapFeatureListOptions) {
    const id = `map-feature-list-${++instanceCount}`;
    const titleId = `${id}-title`;

    this.entry = document.createElement('button');
    this.entry.type = 'button';
    this.entry.className = 'map-feature-list-entry';
    this.entry.textContent = 'Map features';
    this.entry.setAttribute('aria-controls', id);
    this.entry.setAttribute('aria-expanded', 'false');
    this.entry.addEventListener('click', () => this.open());
    // Home hides the classic .map-controls, so this has its own entry point.
    container.append(this.entry);

    this.panel = document.createElement('section');
    this.panel.id = id;
    this.panel.className = 'map-feature-list-panel';
    this.panel.setAttribute('role', 'region');
    this.panel.setAttribute('aria-labelledby', titleId);
    this.panel.hidden = true;

    const header = document.createElement('header');
    header.className = 'map-feature-list-header';
    const title = document.createElement('h2');
    title.id = titleId;
    title.textContent = 'Map features';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'map-feature-list-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close map features');
    close.addEventListener('click', () => this.close());
    header.append(title, close);

    const filters = document.createElement('div');
    filters.className = 'map-feature-list-filters';
    const searchLabel = document.createElement('label');
    searchLabel.htmlFor = `${id}-search`;
    searchLabel.textContent = 'Search map features';
    this.search = document.createElement('input');
    this.search.id = searchLabel.htmlFor;
    this.search.type = 'search';
    this.search.placeholder = 'Name, type or source ID';
    this.search.autocomplete = 'off';
    this.search.addEventListener('input', () => {
      this.page = 0;
      this.renderList();
    });
    this.allItems = document.createElement('button');
    this.allItems.type = 'button';
    this.allItems.className = 'map-feature-list-all';
    this.allItems.textContent = 'Show all map features';
    this.allItems.hidden = true;
    this.allItems.addEventListener('click', () => {
      this.memberSubset = null;
      this.search.value = '';
      this.page = 0;
      this.renderList();
      this.search.focus();
    });
    this.summary = document.createElement('p');
    this.summary.className = 'map-feature-list-summary';
    this.summary.setAttribute('role', 'status');
    this.summary.setAttribute('aria-live', 'polite');
    this.summary.setAttribute('aria-atomic', 'true');
    filters.append(searchLabel, this.search, this.allItems, this.summary);

    const content = document.createElement('div');
    content.className = 'map-feature-list-content';
    this.detail = document.createElement('section');
    this.detail.className = 'map-feature-list-detail';
    this.detail.setAttribute('aria-label', 'Selected feature details');
    this.detail.hidden = true;
    this.detailTitle = document.createElement('h3');
    this.detailState = document.createElement('p');
    this.detailState.className = 'map-feature-list-detail-state';
    this.detailMetrics = document.createElement('dl');
    this.showOnMap = document.createElement('button');
    this.showOnMap.type = 'button';
    this.showOnMap.className = 'map-feature-list-show';
    this.showOnMap.textContent = 'Show on map';
    this.showOnMap.addEventListener('click', () => {
      const selected = this.selectedId ? this.features.get(this.selectedId) : null;
      if (selected?.visible) this.options.onShowOnMap?.({ id: selected.id, family: selected.family });
    });
    this.openFeature = document.createElement('button');
    this.openFeature.type = 'button';
    this.openFeature.className = 'map-feature-list-open';
    this.openFeature.hidden = true;
    this.openFeature.addEventListener('click', () => {
      const id = this.selectedId;
      const selected = id ? this.features.get(id) : null;
      if (!selected || selected.family === 'forecast' || !this.options.onOpenFeature) return;
      this.close();
      // Closing may synchronously refresh or destroy the map. Only dispatch a
      // source that is still present; the renderer resolves its original data.
      const current = this.features.get(selected.id);
      if (current?.family === selected.family) {
        // The existing viewer restores its opening focus when closed. Give it
        // the reachable list entry, even when a map canvas opened the drawer.
        if (this.entry.isConnected) this.entry.focus();
        this.options.onOpenFeature({ id: current.id, family: current.family });
      }
    });
    const actions = document.createElement('div');
    actions.className = 'map-feature-list-detail-actions';
    actions.append(this.showOnMap, this.openFeature);
    this.detail.append(this.detailTitle, this.detailState, this.detailMetrics, actions);
    this.empty = document.createElement('p');
    this.empty.className = 'map-feature-list-empty';
    this.list = document.createElement('ul');
    this.list.className = 'map-feature-list-items';
    this.list.setAttribute('aria-label', 'Map feature results');
    content.append(this.detail, this.empty, this.list);

    const footer = document.createElement('footer');
    footer.className = 'map-feature-list-pagination';
    this.previous = document.createElement('button');
    this.previous.type = 'button';
    this.previous.textContent = 'Previous';
    this.previous.setAttribute('aria-label', 'Previous map features page');
    this.previous.addEventListener('click', () => {
      this.page--;
      this.renderList();
    });
    this.pageLabel = document.createElement('span');
    this.next = document.createElement('button');
    this.next.type = 'button';
    this.next.textContent = 'Next';
    this.next.setAttribute('aria-label', 'Next map features page');
    this.next.addEventListener('click', () => {
      this.page++;
      this.renderList();
    });
    footer.append(this.previous, this.pageLabel, this.next);

    this.panel.append(header, filters, content, footer);
    this.panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });
    document.body.append(this.panel);
    this.renderList();
  }

  update(features: readonly MapFeature[], selectedId?: string | null): void {
    if (this.destroyed) return;
    this.features = new Map(features.map((feature) => [feature.id, feature]));
    if (selectedId !== undefined) this.selectedId = selectedId;
    const selected = this.selectedId ? this.features.get(this.selectedId) : undefined;
    if (selected) this.selectedSnapshot = selected;
    else if (!this.selectedId || (this.selectedSnapshot && this.selectedSnapshot.id !== this.selectedId)) {
      this.selectedSnapshot = null;
    }
    this.renderList();
  }

  open(featureId?: string, memberIds?: readonly string[]): void {
    if (this.destroyed) return;
    if (!this.opened) {
      const active = document.activeElement;
      this.invoker = active instanceof HTMLElement && active !== document.body && !this.panel.contains(active)
        ? active : this.entry;
    }
    this.memberSubset = memberIds ? new Set(memberIds) : null;
    this.search.value = '';
    this.page = 0;
    if (featureId) {
      this.selectedId = featureId;
      this.selectedSnapshot = this.features.get(featureId) ?? null;
    }
    const wasOpened = this.opened;
    this.opened = true;
    this.panel.hidden = false;
    this.entry.setAttribute('aria-expanded', 'true');
    this.renderList();
    if (!wasOpened) this.search.focus();
  }

  close(): void {
    if (!this.opened) return;
    const restoreFocus = this.panel.contains(document.activeElement);
    this.opened = false;
    this.panel.hidden = true;
    this.entry.setAttribute('aria-expanded', 'false');
    if (restoreFocus) {
      const target = this.invoker?.isConnected ? this.invoker : this.entry;
      target.focus();
    }
    this.options.onClose?.();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.close();
    this.destroyed = true;
    this.entry.remove();
    this.panel.remove();
    this.features.clear();
    this.rows.clear();
  }

  private renderList(): void {
    const query = this.search.value.trim().toLocaleLowerCase();
    const filtered = [...this.features.values()].filter((feature) => {
      if (this.memberSubset && !this.memberSubset.has(feature.id)
        && !feature.memberIds.some((id) => this.memberSubset!.has(id))) return false;
      const text = `${feature.title} ${FAMILY_LABEL[feature.family]} ${feature.id}`.toLocaleLowerCase();
      return !query || text.includes(query);
    });
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    const pageFeatures = filtered.slice(this.page * PAGE_SIZE, (this.page + 1) * PAGE_SIZE);
    const first = filtered.length ? this.page * PAGE_SIZE + 1 : 0;
    const last = Math.min((this.page + 1) * PAGE_SIZE, filtered.length);
    const scope = this.memberSubset ? 'cluster members' : 'features';
    this.summary.textContent = `${first}–${last} of ${filtered.length} ${query ? 'matching ' : ''}${scope}`;
    this.allItems.hidden = !this.memberSubset;
    this.previous.disabled = this.page === 0;
    this.next.disabled = this.page >= pages - 1;
    this.pageLabel.textContent = `Page ${this.page + 1} of ${pages}`;
    this.empty.hidden = filtered.length > 0;
    this.empty.textContent = query ? 'No matching map features.' : 'No map features available in this view.';

    // Keep existing controls in place on data refresh; rebuilding the list would
    // discard keyboard focus, even when the selected source had not changed.
    const wanted = new Set(pageFeatures.map((feature) => feature.id));
    for (const [id, row] of this.rows) {
      if (!wanted.has(id)) {
        row.remove();
        this.rows.delete(id);
      }
    }
    pageFeatures.forEach((feature, index) => {
      let row = this.rows.get(feature.id);
      if (!row) {
        row = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'map-feature-list-item';
        button.dataset.featureId = feature.id;
        const name = document.createElement('span');
        name.className = 'map-feature-list-item-name';
        const type = document.createElement('span');
        type.className = 'map-feature-list-item-type';
        button.append(name, type);
        button.addEventListener('click', () => {
          const current = this.features.get(feature.id);
          if (!current) return;
          this.selectedId = current.id;
          this.selectedSnapshot = current;
          this.renderList();
          this.options.onSelect({ id: current.id, family: current.family });
        });
        row.append(button);
        this.rows.set(feature.id, row);
      }
      const button = row.firstElementChild as HTMLButtonElement;
      button.children[0]!.textContent = feature.title || 'Unnamed map feature';
      button.children[1]!.textContent = `${FAMILY_LABEL[feature.family]}${feature.visible ? '' : ' · Layer hidden'}`;
      button.setAttribute('aria-pressed', String(feature.id === this.selectedId));
      const existing = this.list.children[index] ?? null;
      if (existing !== row) this.list.insertBefore(row, existing);
    });
    this.renderDetail();
  }

  private renderDetail(): void {
    this.detail.hidden = !this.selectedId;
    if (!this.selectedId) return;
    const current = this.features.get(this.selectedId);
    const feature = current ?? this.selectedSnapshot;
    const title = feature?.title.trim() ?? '';
    this.detailTitle.textContent = title.length > 0 ? title : 'Selected map feature';
    if (current) {
      this.detailState.textContent = current.visible
        ? FAMILY_LABEL[current.family] : `${FAMILY_LABEL[current.family]} · Layer hidden`;
    } else {
      this.detailState.textContent = 'No longer available in the latest map data.';
    }
    this.showOnMap.disabled = !current?.visible || !this.options.onShowOnMap;
    this.openFeature.hidden = !feature || feature.family === 'forecast';
    this.openFeature.textContent = feature?.family === 'camera' ? 'View camera' : 'More data center details';
    this.openFeature.disabled = !current || !this.options.onOpenFeature;
    // Only text nodes are constructed from provider-derived data. No images,
    // remote links, markup parsing or network requests are created here.
    this.detailMetrics.replaceChildren();
    if (feature) {
      const metrics = [
        ...feature.metrics,
        { label: 'Coordinates', value: `${feature.center[1].toFixed(3)}, ${feature.center[0].toFixed(3)}` },
        { label: 'Source ID', value: feature.id },
      ];
      for (const metric of metrics) {
        const term = document.createElement('dt');
        term.textContent = metric.label;
        const value = document.createElement('dd');
        value.textContent = metric.value;
        this.detailMetrics.append(term, value);
      }
    }
  }
}
