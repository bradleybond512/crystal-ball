import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  GOES_PRODUCTS,
  GOES_SATELLITES,
  GOES_SECTORS,
  getProduct,
  type GoesSatelliteId,
  type GoesSectorId,
} from '@/services/imagery/goes-catalog';
import {
  fetchGoesImagery,
  type GoesImageryResponse,
} from '@/services/imagery/goes-imagery-service';

const FRAME_INTERVAL_MS = 350;

export class GoesSatellitePanel extends Panel {
  private satellite: GoesSatelliteId = 'GOES19';
  private sector: GoesSectorId = 'CONUS';
  private product = 'GEOCOLOR';
  private data: GoesImageryResponse | null = null;
  private lastUpdated: Date | null = null;
  private playing = false;
  private frameIndex = 0;
  private animTimer: ReturnType<typeof setInterval> | null = null;
  private fetchAbort: AbortController | null = null;

  constructor() {
    super({
      id: 'goes-satellite',
      title: 'GOES Satellite',
      showCount: false,
      trackActivity: true,
      infoTooltip:
        'NOAA GOES-East (GOES-19) / GOES-West (GOES-18) live imagery. Switch band (GeoColor / IR / water vapor / fire) and sector (CONUS / Full Disk); press Play for a loop. Updated ~every 5 min.',
    });
    this.showLoading('Fetching satellite imagery…');
    // Defer the first fetch out of the constructor call stack.
    setTimeout(() => void this.reload(), 0);
  }

  /** Back-compat entry point still called by data-loader on its tick. */
  public update(): void {
    void this.reload();
  }

  public destroy(): void {
    super.destroy();
    this.stopAnimation();
    this.fetchAbort?.abort();
  }

  private async reload(): Promise<void> {
    this.fetchAbort?.abort();
    const controller = new AbortController();
    this.fetchAbort = controller;
    try {
      const data = await fetchGoesImagery(
        this.satellite,
        this.sector,
        this.product,
        controller.signal,
      );
      this.data = data;
      this.lastUpdated = new Date();
      this.frameIndex = Math.max(0, data.frames.length - 1);
      this.render();
    } catch {
      if (controller.signal.aborted) return;
      if (!this.data) {
        this.setContent('<div class="panel-empty">Satellite imagery unavailable.</div>');
      }
    }
  }

  private stopAnimation(): void {
    if (this.animTimer !== null) {
      clearInterval(this.animTimer);
      this.animTimer = null;
    }
    this.playing = false;
  }

  private toggleAnimation(): void {
    if (this.playing) {
      this.stopAnimation();
      this.render();
      return;
    }
    if (!this.data || this.data.frames.length < 2) return;
    this.playing = true;
    this.animTimer = setInterval(() => {
      if (!this.data || this.data.frames.length === 0) return;
      this.frameIndex = (this.frameIndex + 1) % this.data.frames.length;
      this.updateHeroFrame();
    }, FRAME_INTERVAL_MS);
    this.render();
  }

  private updateHeroFrame(): void {
    const root = this.getContentElement();
    const img = root.querySelector<HTMLImageElement>('.goes-hero-img');
    const stamp = root.querySelector<HTMLElement>('.goes-frame-stamp');
    const frame = this.data?.frames[this.frameIndex];
    if (img && frame) img.src = frame.url;
    if (stamp && frame) stamp.textContent = new Date(frame.epochMs).toUTCString().replace('GMT', 'UTC');
  }

  private render(): void {
    if (!this.data) return;
    const d = this.data;
    const frame = d.frames[this.frameIndex];
    const heroUrl = frame ? frame.url : d.stillUrl;
    const stampText = frame
      ? new Date(frame.epochMs).toUTCString().replace('GMT', 'UTC')
      : '—';
    const updatedStr = this.lastUpdated ? timeAgo(this.lastUpdated) : 'never';
    const canPlay = d.frames.length >= 2;

    this.setContent(`
      <div class="goes-panel-content">
        ${this.renderSwitchers()}
        <div class="goes-hero">
          <a href="${escapeHtml(d.latestUrl)}" target="_blank" rel="noopener noreferrer">
            <img class="goes-hero-img" src="${escapeHtml(heroUrl)}"
                 alt="GOES ${escapeHtml(this.product)} ${escapeHtml(this.sector)}" loading="lazy" />
          </a>
          <div class="goes-hero-bar">
            <button class="goes-play-btn" data-goes-action="toggle" ${canPlay ? '' : 'disabled'}>
              ${this.playing ? '⏸ Pause' : '▶ Play'}
            </button>
            <span class="goes-frame-stamp">${escapeHtml(stampText)}</span>
            <span class="goes-frame-count">${d.frameCount} frames</span>
          </div>
        </div>
        ${d.degraded ? `<div class="goes-degraded">⚠ ${escapeHtml(d.reason ?? 'degraded')}</div>` : ''}
        <div class="fires-footer">
          <span class="fires-source">NOAA NESDIS · No API key</span>
          <span class="fires-updated">Updated ${escapeHtml(updatedStr)}</span>
        </div>
      </div>
    `);
    this.wireControls();
  }

  private renderSwitchers(): string {
    const satBtns = GOES_SATELLITES.map((s) =>
      chip(s.label, s.id === this.satellite, 'sat', s.id),
    ).join('');
    const sectorBtns = GOES_SECTORS.map((s) =>
      chip(s.label, s.id === this.sector, 'sector', s.id),
    ).join('');
    const productBtns = GOES_PRODUCTS.map((p) =>
      chip(p.label, p.id === this.product, 'product', p.id, p.description),
    ).join('');
    return `
      <div class="goes-switchers">
        <div class="goes-switch-row">${satBtns}</div>
        <div class="goes-switch-row">${sectorBtns}</div>
        <div class="goes-switch-row">${productBtns}</div>
      </div>`;
  }

  private wireControls(): void {
    const root = this.getContentElement();
    for (const el of root.querySelectorAll<HTMLElement>('[data-goes-kind]')) {
      el.addEventListener('click', () => {
        const kind = el.dataset.goesKind;
        const value = el.dataset.goesValue;
        if (!kind || !value) return;
        this.applySelection(kind, value);
      });
    }
    const toggle = root.querySelector<HTMLElement>('[data-goes-action="toggle"]');
    toggle?.addEventListener('click', () => this.toggleAnimation());
  }

  private applySelection(kind: string, value: string): void {
    if (kind === 'sat' && (value === 'GOES19' || value === 'GOES18')) {
      this.satellite = value;
    } else if (kind === 'sector' && (value === 'CONUS' || value === 'FD')) {
      this.sector = value;
    } else if (kind === 'product' && getProduct(value)) {
      this.product = value;
    } else {
      return;
    }
    this.stopAnimation();
    void this.reload();
  }
}

function chip(
  label: string,
  active: boolean,
  kind: string,
  value: string,
  title?: string,
): string {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<button class="goes-chip${active ? ' goes-chip-active' : ''}" data-goes-kind="${escapeHtml(kind)}" data-goes-value="${escapeHtml(value)}"${titleAttr}>${escapeHtml(label)}</button>`;
}

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}
