/* eslint-disable sonarjs/no-async-constructor */
import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { getApiBaseUrl } from '@/services/runtime';
import {
  normalizeSummary,
  parseToneDescription,
  getToneClass,
  buildBarChart,
  formatThemeName,
  type GdeltSummary,
} from './gdelt-helpers';

// GDELT 2.0 updates every 15 minutes.
const REFRESH_MS = 15 * 60 * 1000;

function relativeTime(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

function maxCount(rows: { count: number }[]): number {
  return rows.reduce((m, r) => (Math.max(r.count, m)), 0);
}

export class GdeltPanel extends Panel {
  static readonly panelId = 'gdelt-monitor';
  static readonly title = 'Global Media Intelligence (GDELT)';

  private summary: GdeltSummary | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: GdeltPanel.panelId,
      title: GdeltPanel.title,
      showCount: false,
      trackActivity: false,
      infoTooltip:
        'Global media tone, themes, locations, people, and organizations from GDELT 2.0 — ' +
        'a worldwide event/news stream monitoring 100+ languages, refreshed every 15 minutes.',
    });
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    super.destroy();
  }

  private async refresh(): Promise<void> {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/gdelt/summary`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as unknown;
      this.summary = normalizeSummary(json as Partial<GdeltSummary>);
      this.render();
    } catch {
      if (!this.summary) {
        this.showError('GDELT media intelligence unavailable');
      }
    }
  }

  private render(): void {
    const s = this.summary;
    if (!s) {
      this.showError('GDELT media intelligence unavailable');
      return;
    }

    const ago = relativeTime(s.fetchedAt);
    this.setDataBadge('live', ago || undefined);

    const sections: HTMLElement[] = [
      this.renderTone(s),
      this.renderThemes(s),
      this.renderLocations(s),
    ];
    // People/orgs are only present if a GKG-backed source fills them; the free
    // DOC API path leaves them empty, so omit the sections rather than show
    // empty placeholders.
    if (s.topPeople.length) sections.push(this.renderPeople(s));
    if (s.topOrgs.length) sections.push(this.renderOrgs(s));

    replaceChildren(this.getContentElement(), ...sections);
  }

  private renderTone(s: GdeltSummary): HTMLElement {
    const toneClass = getToneClass(s.tone);
    const magnitude = buildBarChart(Math.abs(s.tone), 10, 10);
    return h('div', { className: 'gdelt-tone gdelt-tone-' + toneClass },
      h('div', { className: 'gdelt-tone-head' },
        h('span', { className: 'gdelt-tone-label' }, 'Global Media Tone'),
        h('span', { className: 'gdelt-tone-value' }, s.tone.toFixed(1)),
        h('span', { className: 'gdelt-tone-band gdelt-tone-' + toneClass },
          parseToneDescription(s.tone).toUpperCase()),
      ),
      h('div', { className: 'gdelt-tone-bar' }, magnitude),
    );
  }

  private renderThemes(s: GdeltSummary): HTMLElement {
    const section = h('div', { className: 'gdelt-section gdelt-themes' },
      h('h3', { className: 'gdelt-section-title' }, 'Top Themes (last 24h)'),
    );
    if (!s.topThemes.length) {
      section.append(h('div', { className: 'gdelt-empty' }, 'No theme data'));
      return section;
    }
    const max = maxCount(s.topThemes);
    for (const row of [...s.topThemes].sort((a, b) => b.count - a.count)) {
      section.append(
        h('div', { className: 'gdelt-row' },
          h('span', { className: 'gdelt-row-name' }, formatThemeName(row.theme)),
          h('span', { className: 'gdelt-row-bar' }, buildBarChart(row.count, max, 10)),
          h('span', { className: 'gdelt-row-count' }, row.count.toLocaleString()),
        ),
      );
    }
    return section;
  }

  private renderLocations(s: GdeltSummary): HTMLElement {
    const section = h('div', { className: 'gdelt-section gdelt-locations' },
      h('h3', { className: 'gdelt-section-title' }, 'Top Locations (news volume)'),
    );
    if (!s.topLocations.length) {
      section.append(h('div', { className: 'gdelt-empty' }, 'No location data'));
      return section;
    }
    const max = maxCount(s.topLocations);
    let rank = 1;
    for (const row of [...s.topLocations].sort((a, b) => b.count - a.count)) {
      section.append(
        h('div', { className: 'gdelt-row' },
          h('span', { className: 'gdelt-row-rank' }, String(rank++)),
          h('span', { className: 'gdelt-row-name' }, row.name),
          h('span', { className: 'gdelt-row-bar' }, buildBarChart(row.count, max, 12)),
        ),
      );
    }
    return section;
  }

  private renderPeople(s: GdeltSummary): HTMLElement {
    return this.renderChips('Top People Mentioned', s.topPeople.map(p => p.name), 'gdelt-people');
  }

  private renderOrgs(s: GdeltSummary): HTMLElement {
    return this.renderChips('Top Organizations', s.topOrgs.map(o => o.name), 'gdelt-orgs');
  }

  private renderChips(title: string, names: string[], className: string): HTMLElement {
    const section = h('div', { className: 'gdelt-section ' + className },
      h('h3', { className: 'gdelt-section-title' }, title),
    );
    if (!names.length) {
      section.append(h('div', { className: 'gdelt-empty' }, 'No data'));
      return section;
    }
    section.append(h('div', { className: 'gdelt-chips' }, names.join(' · ')));
    return section;
  }
}
