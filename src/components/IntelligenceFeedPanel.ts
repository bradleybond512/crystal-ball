import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import { getRecent } from '@/services/intelligence/observation-store';
import { getSavedPlaces } from '@/services/saved-places';
import { prioritize } from '@/services/intelligence/prioritizer';
import { filterByProximity } from '@/services/intelligence/proximity-filter';

const NEARBY_RADIUS_KM = 500;
const DEFAULT_LIMIT = 50;

export class IntelligenceFeedPanel extends Panel {
  private nearbyOnly = false;

  constructor() {
    super({
      id: 'intelligence-feed',
      title: 'Intelligence Feed',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Prioritized observation feed — events scored by proximity to saved places, severity, and recency.',
    });
    this.render();
  }

  public refresh(): void {
    this.render();
  }

  private render(): void {
    const allEvents = getRecent(DEFAULT_LIMIT * 2);
    const savedPlaces = getSavedPlaces();

    const filtered = this.nearbyOnly
      ? filterByProximity(allEvents, savedPlaces, NEARBY_RADIUS_KM)
      : allEvents;

    const prioritized = prioritize(filtered, savedPlaces);
    const events = prioritized.slice(0, DEFAULT_LIMIT);

    this.setCount(events.length);

    if (events.length === 0) {
      this.setContent(this.renderEmpty());
      return;
    }

    const rows = events.map((ev) => renderEventRow(ev)).join('');
    this.setContent(`
      <div class="intel-feed-toolbar">
        <label class="intel-feed-toggle">
          <input type="checkbox" class="ifp-nearby-toggle"${this.nearbyOnly ? ' checked' : ''}>
          Nearby only (${NEARBY_RADIUS_KM} km)
        </label>
      </div>
      <div class="intel-feed-list">${rows}</div>
    `);
    this.wireHandlers();
  }

  private renderEmpty(): string {
    return `
      <div class="intel-feed-toolbar">
        <label class="intel-feed-toggle">
          <input type="checkbox" class="ifp-nearby-toggle"${this.nearbyOnly ? ' checked' : ''}>
          Nearby only (${NEARBY_RADIUS_KM} km)
        </label>
      </div>
      <div class="panel-empty">No observations in feed yet.</div>
    `;
  }

  private wireHandlers(): void {
    const el = this.getElement();
    if (!el) return;
    el.querySelector('.ifp-nearby-toggle')?.addEventListener('change', (e) => {
      this.nearbyOnly = (e.target as HTMLInputElement).checked;
      this.render();
    });
  }
}

function renderEventRow(ev: ReturnType<typeof prioritize>[number]): string {
  const severity = escapeHtml(ev.severity);
  const title = escapeHtml(ev.title);
  const domain = escapeHtml(ev.domain);
  const source = escapeHtml(ev.sourceId);
  const age = timeAgo(ev.timestamp);
  const score = ev.relevanceScore;

  return `
    <div class="intel-event-row intel-sev-${severity.toLowerCase()}">
      <span class="intel-event-sev">${severity}</span>
      <span class="intel-event-title">${title}</span>
      <span class="intel-event-meta">${domain} · ${source} · ${age} · ${score}pts</span>
    </div>`;
}

function timeAgo(timestampMs: number): string {
  const sec = Math.floor((Date.now() - timestampMs) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86_400)}d ago`;
}
