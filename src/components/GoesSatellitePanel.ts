import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

interface GoesImageInfo {
  label: string;
  region: string;
  product: string;
  url: string;
  available: boolean;
  lastModified: string | null;
  contentLength: number | null;
}

interface GoesSatelliteData {
  goesEast: GoesImageInfo;
  goesWest: GoesImageInfo;
  generatedAt: string;
  cacheTtlSeconds: number;
}

export class GoesSatellitePanel extends Panel {
  private data: GoesSatelliteData | null = null;
  private lastUpdated: Date | null = null;

  constructor() {
    super({
      id: 'goes-satellite',
      title: 'GOES Satellite',
      showCount: false,
      trackActivity: true,
      infoTooltip: 'NOAA GOES-East (GOES-16) and GOES-West (GOES-18) GeoColor imagery — updated every 5 minutes.',
    });
    this.showLoading('Fetching satellite imagery...');
  }

  public update(data: GoesSatelliteData): void {
    this.data = data;
    this.lastUpdated = new Date();
    this.render();
  }

  private render(): void {
    if (!this.data) {
      this.setContent('<div class="panel-empty">No satellite data available.</div>');
      return;
    }

    const { goesEast, goesWest } = this.data;
    const updatedStr = this.lastUpdated ? timeAgo(this.lastUpdated) : 'never';

    this.setContent(`
      <div class="goes-panel-content">
        <div class="goes-images-row">
          ${renderGoesImage(goesEast)}
          ${renderGoesImage(goesWest)}
        </div>
        <div class="fires-footer">
          <span class="fires-source">NOAA NESDIS · No API key</span>
          <span class="fires-updated">Updated ${updatedStr}</span>
        </div>
      </div>
    `);
  }
}

function renderGoesImage(info: GoesImageInfo): string {
  const label = escapeHtml(info.label);
  const region = escapeHtml(info.region);
  const product = escapeHtml(info.product);
  const modifiedStr = info.lastModified ? new Date(info.lastModified).toLocaleTimeString() : '—';

  if (!info.available) {
    return `
      <div class="goes-image-card goes-unavailable">
        <div class="goes-image-label">${label}</div>
        <div class="goes-image-placeholder">Imagery unavailable</div>
        <div class="goes-image-meta">${region} · ${product}</div>
      </div>`;
  }

  return `
    <div class="goes-image-card">
      <div class="goes-image-label">${label}</div>
      <a href="${escapeHtml(info.url)}" target="_blank" rel="noopener noreferrer" class="goes-image-link">
        <img
          class="goes-image"
          src="${escapeHtml(info.url)}"
          alt="${label} GeoColor"
          loading="lazy"
          onerror="this.parentElement.parentElement.classList.add('goes-unavailable'); this.style.display='none'"
        />
      </a>
      <div class="goes-image-meta">${region} · ${product} · ${modifiedStr}</div>
    </div>`;
}

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}
