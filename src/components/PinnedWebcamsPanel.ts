/* eslint-disable sonarjs/no-async-constructor */
import { Panel } from './Panel';
import { fetchUnifiedWebcams } from '@/services/webcams/fetcher';
import { getPinnedIds, unpinFeed, onPinnedChange } from '@/services/webcams/pinned-store';
import type { WebcamFeed } from '@/services/webcams/webcam-types';
import { resolveFrameUrl } from '@/services/webcams/frame-resolver';

export class PinnedWebcamsPanel extends Panel {
  private feeds: WebcamFeed[] = [];
  private loaded = false;
  private readonly unsubscribe: () => void;

  constructor() {
    super({ id: 'pinned-webcams', title: 'Pinned Webcams', className: 'panel-wide' });
    this.unsubscribe = onPinnedChange(() => this.render());
    void this.load();
  }

  public destroy(): void {
    this.unsubscribe();
    super.destroy();
  }

  public refresh(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const catalog = await fetchUnifiedWebcams();
      this.feeds = catalog.feeds;
    } catch {
      // fetcher already falls back to an empty catalog; nothing to surface here.
    } finally {
      this.loaded = true;
      this.render();
    }
  }

  private get pinned(): WebcamFeed[] {
    const ids = new Set(getPinnedIds());
    return this.feeds.filter((f) => ids.has(f.id));
  }

  private render(): void {
    const el = this.getContentElement();
    while (el.firstChild) el.firstChild.remove();
    el.className = 'panel-content pinned-webcams-content';

    const pinnedIds = getPinnedIds();
    if (pinnedIds.length === 0) {
      const empty = document.createElement('p');
      empty.style.padding = '12px';
      empty.style.opacity = '0.7';
      empty.style.fontSize = '13px';
      empty.textContent = 'Pin a cam from the Webcams panel (📌) to keep it here.';
      el.append(empty);
      return;
    }

    if (!this.loaded) {
      const loading = document.createElement('p');
      loading.style.padding = '12px';
      loading.textContent = 'Loading pinned cams…';
      el.append(loading);
      return;
    }

    const pinned = this.pinned;
    const grid = document.createElement('div');
    grid.className = 'pinned-webcams-grid';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';
    grid.style.gap = '8px';
    grid.style.padding = '8px';
    for (const f of pinned) grid.append(this.buildCard(f));
    el.append(grid);

    const unresolved = pinnedIds.length - pinned.length;
    if (unresolved > 0) {
      const note = document.createElement('p');
      note.style.padding = '4px 8px';
      note.style.opacity = '0.6';
      note.style.fontSize = '11px';
      note.textContent = `${unresolved} pinned cam${unresolved === 1 ? '' : 's'} currently unavailable.`;
      el.append(note);
    }
  }

  private buildCard(f: WebcamFeed): HTMLElement {
    const card = document.createElement('div');
    card.className = 'pinned-webcam-card';
    card.style.border = '1px solid #333';
    card.style.borderRadius = '4px';
    card.style.overflow = 'hidden';
    card.style.position = 'relative';

    const img = document.createElement('img');
    // FAA feeds carry a /api/ resolver URL that returns JSON, not image bytes —
    // resolve to the real https image before setting src (see frame-resolver).
    void resolveFrameUrl(f.snapshotUrl).then((url) => {
      if (url) img.src = url;
      else { img.style.opacity = '0.3'; img.style.background = '#222'; }
    });
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

    const unpin = document.createElement('button');
    unpin.textContent = '📌✕';
    unpin.title = 'Unpin';
    unpin.style.position = 'absolute';
    unpin.style.top = '4px';
    unpin.style.right = '4px';
    unpin.style.background = 'rgba(0,0,0,0.6)';
    unpin.style.color = '#fff';
    unpin.style.border = 'none';
    unpin.style.borderRadius = '3px';
    unpin.style.padding = '2px 6px';
    unpin.style.cursor = 'pointer';
    unpin.addEventListener('click', () => unpinFeed(f.id));

    const name = document.createElement('div');
    name.textContent = f.name;
    name.style.padding = '6px 8px';
    name.style.fontSize = '12px';
    name.style.fontWeight = '600';
    name.style.overflow = 'hidden';
    name.style.textOverflow = 'ellipsis';
    name.style.whiteSpace = 'nowrap';

    card.append(img);
    card.append(unpin);
    card.append(name);
    return card;
  }
}
