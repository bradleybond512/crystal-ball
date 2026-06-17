import type { Viewer } from 'cesium';
import { Cartesian3 } from 'cesium';

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

export class GlobeSearch {
  private root: HTMLDivElement | null = null;
  private input: HTMLInputElement | null = null;
  private results: HTMLDivElement | null = null;
  private debounceId: number | null = null;

  constructor(private viewer: Viewer, private container: HTMLElement) {}

  mount(): void {
 const root = document.createElement('div');
 root.className = 'ge-search-root';

 const input = document.createElement('input');
 input.type = 'text';
 input.className = 'ge-search-input';
 input.placeholder = 'Search location\u2026';
 input.setAttribute('autocomplete', 'off');
 input.addEventListener('input', () => this.onInput());
 input.addEventListener('keydown', (e) => {
 if (e.key === 'Escape') { input.value = ''; this.clearResults(); }
 });

 const results = document.createElement('div');
 results.className = 'ge-search-results';

 root.append(input, results);
 this.container.append(root);
 this.root = root;
 this.input = input;
 this.results = results;
  }

  destroy(): void {
 this.root?.remove();
 this.root = null;
  }

  private onInput(): void {
 if (this.debounceId != null) clearTimeout(this.debounceId);
 const q = this.input?.value.trim() ?? '';
 if (q.length < 2) { this.clearResults(); return; }
 this.debounceId = window.setTimeout(() => void this.search(q), 400);
  }

  private async search(q: string): Promise<void> {
 try {
 const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`;
 const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
 const data = await res.json() as NominatimResult[];
 if (!Array.isArray(data)) { this.clearResults(); return; }
 this.renderResults(data);
 } catch {
 this.clearResults();
 }
  }

  private renderResults(data: NominatimResult[]): void {
 if (!this.results) return;
 this.results.replaceChildren();
 for (const r of data) {
 const item = document.createElement('button');
 item.className = 'ge-search-result-item';
 item.textContent = r.display_name;
 item.addEventListener('click', () => {
 const lat = Number(r.lat);
 const lon = Number(r.lon);
 this.viewer.camera.flyTo({
 destination: Cartesian3.fromDegrees(lon, lat, 300_000),
 duration: 2,
 });
 if (this.input) this.input.value = '';
 this.clearResults();
 });
 this.results.append(item);
 }
  }

  private clearResults(): void {
 this.results?.replaceChildren();
  }
}
