import { Panel } from './Panel';
import { escapeHtml } from '@/utils';
import type { WikidataBase, WikidataBasesSnapshot } from '@/services/wikidata-bases';

const TOP_COUNTRIES = 12;
const PER_COUNTRY_PREVIEW = 5;

export class WikidataBasesPanel extends Panel {
  private snapshot: WikidataBasesSnapshot | null = null;
  private clickHandler: ((lat: number, lon: number) => void) | null = null;

  constructor() {
 super({
 id: 'wikidata-bases',
 title: 'Military Bases (WikiData)',
 showCount: true,
 trackActivity: true,
 infoTooltip: 'Military installations from WikiData SPARQL — instances/subclasses of "military base" with coordinates. Free, no key, ~10k entries globally.',
 });
 this.showLoading('Querying WikiData…');
  }

  setEventClickHandler(handler: (lat: number, lon: number) => void): void {
 this.clickHandler = handler;
  }

  update(snapshot: WikidataBasesSnapshot): void {
 this.snapshot = snapshot;
 this.setCount(snapshot.bases.length);
 this.render();
 this.attachClickHandlers();
  }

  private render(): void {
 const snap = this.snapshot;
 if (!snap || snap.bases.length === 0) {
 this.setContent('<div class="panel-empty">No bases returned. WikiData query may have failed or be cached empty.</div>');
 return;
 }

 // Group by country, sort by count descending.
 const byCountry = new Map<string, WikidataBase[]>();
 for (const b of snap.bases) {
 const key = b.country ?? 'Unknown';
 const arr = byCountry.get(key);
 if (arr) arr.push(b); else byCountry.set(key, [b]);
 }
 const countries = [...byCountry.entries()]
 .sort((a, b) => b[1].length - a[1].length)
 .slice(0, TOP_COUNTRIES);

 const summary = `<div class="wd-bases-summary">${snap.bases.length} bases · ${byCountry.size} countries</div>`;
 const sections = countries.map(([country, bases]) => {
 const preview = bases.slice(0, PER_COUNTRY_PREVIEW).map((b) => this.renderRow(b)).join('');
 const moreCount = bases.length - PER_COUNTRY_PREVIEW;
 const more = moreCount > 0 ? `<div class="wd-bases-more">+ ${moreCount} more in ${escapeHtml(country)}</div>` : '';
 return `<div class="wd-bases-country">
 <div class="wd-bases-country-head">${escapeHtml(country)} <span class="wd-bases-count">${bases.length}</span></div>
 ${preview}
 ${more}
 </div>`;
 }).join('');
 this.setContent(`${summary}${sections}`);
  }

  private renderRow(b: WikidataBase): string {
 return `<div class="wd-bases-row" data-lat="${b.lat}" data-lon="${b.lon}">
 <span class="wd-bases-name">${escapeHtml(b.name)}</span>
 </div>`;
  }

  private attachClickHandlers(): void {
 if (!this.clickHandler) return;
 this.getContentElement().querySelectorAll<HTMLElement>('.wd-bases-row').forEach((row: HTMLElement) => {
 row.addEventListener('click', () => {
 const lat = Number(row.dataset.lat);
 const lon = Number(row.dataset.lon);
 if (Number.isFinite(lat) && Number.isFinite(lon)) this.clickHandler?.(lat, lon);
 });
 });
  }
}
