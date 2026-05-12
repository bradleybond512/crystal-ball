/* eslint-disable sonarjs/no-nested-template-literals */
import { Panel } from './Panel';
import {
  scorePersonalRelevance,
  loadProfile,
  saveProfile,
  emptyProfile,
  type PersonalProfile,
  type TravelEntry,
} from '@/services/intelligence/personal-relevance';
import { prioritize } from '@/services/intelligence/prioritizer';
import { getRecent } from '@/services/intelligence/observation-store';
import { getSavedPlaces } from '@/services/saved-places';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 15_000;
const PREVIEW_LIMIT = 10;

const DOMAIN_OPTIONS = [
  'weather',
  'cyber',
  'aviation',
  'maritime',
  'markets',
  'conflict',
  'humanitarian',
  'space',
  'infra',
  'macro',
] as const;

export class PersonalRelevancePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private profile: PersonalProfile = emptyProfile();

  constructor() {
    super({
      id: 'personal-relevance',
      title: 'Personal Relevance',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Tunes alert relevance to YOU — watchlist, domain interests, travel windows. The last 10 alerts are re-scored so you can preview the impact.',
    });
    this.loadProfileFromStorage();
    this.start();
  }

  private loadProfileFromStorage(): void {
    this.profile = loadProfile();
    // Always reflect the live saved places list (user manages them in Saved Places panel).
    this.profile = { ...this.profile, savedPlaces: getSavedPlaces() };
  }

  private persist(): void {
    saveProfile(this.profile);
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => {
      this.profile = { ...this.profile, savedPlaces: getSavedPlaces() };
      this.render();
    }, REFRESH_MS);
  }

  public dispose(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private render(): void {
    const recent = getRecent(PREVIEW_LIMIT);
    const prioritized = prioritize(recent, this.profile.savedPlaces);
    const enriched = prioritized.map((p) => ({
      event: p,
      personal: scorePersonalRelevance(p, this.profile),
    }));
    const boosted = enriched.filter((row) => row.personal.total > 0).length;
    this.setCount(boosted);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:14px;">
      ${this.renderPlacesSection()}
      ${this.renderWatchlistSection()}
      ${this.renderInterestsSection()}
      ${this.renderTravelSection()}
      ${this.renderPreviewSection(enriched)}
    </div>`;
    this.setContent(html);
    this.bindEvents();
  }

  private renderPlacesSection(): string {
    const places = this.profile.savedPlaces;
    if (places.length === 0) {
      return this.sectionShell(
        'Saved places',
        `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No saved places yet. Add them in the <strong>Saved Places</strong> panel — they show up here automatically.</div>`,
      );
    }
    const overflow = places.length > 8
      ? `<li style="color:var(--text-secondary,#aaa);">+ ${places.length - 8} more</li>`
      : '';
    const body = `<ul style="margin:0;padding-left:16px;font-size:12px;line-height:1.6;">${places.slice(0, 8).map((p) => `<li>${escapeHtml(p.name)} <span style="color:var(--text-secondary,#aaa);">(${p.lat.toFixed(2)}, ${p.lon.toFixed(2)})</span></li>`).join('')}${overflow}</ul>`;
    return this.sectionShell('Saved places', body);
  }

  private renderWatchlistSection(): string {
    const items = this.profile.watchlist;
    const chips = items.length === 0
      ? `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No keywords yet — try a ticker (AAPL), an MMSI, ICAO airport code, or org name.</div>`
      : `<div style="display:flex;flex-wrap:wrap;gap:6px;">${items.map((term, idx) => `<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(74,158,255,0.12);border:1px solid rgba(74,158,255,0.35);border-radius:12px;padding:3px 10px;font-size:11px;">${escapeHtml(term)}<button type="button" data-personal-rm-watch="${idx}" aria-label="Remove ${escapeHtml(term)}" style="background:none;border:none;color:inherit;cursor:pointer;font-size:11px;line-height:1;padding:0;">×</button></span>`).join('')}</div>`;
    const form = `<form data-personal-add-watch style="display:flex;gap:6px;margin-top:8px;">
      <input type="text" name="term" placeholder="Add keyword…" maxlength="64" style="flex:1;padding:4px 8px;font-size:12px;background:var(--bg-elev,#1a1a1a);border:1px solid var(--border-subtle,#333);border-radius:3px;color:inherit;" />
      <button type="submit" style="padding:4px 10px;font-size:12px;background:var(--accent,#4a9eff);color:#000;border:none;border-radius:3px;cursor:pointer;">Add</button>
    </form>`;
    return this.sectionShell('Watchlist', chips + form);
  }

  private renderInterestsSection(): string {
    const selected = new Set(this.profile.interests);
    const toggles = DOMAIN_OPTIONS.map((d) => {
      const on = selected.has(d);
      return `<label style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;font-size:11px;background:${on ? 'rgba(76,175,80,0.18)' : 'rgba(255,255,255,0.04)'};border:1px solid ${on ? 'rgba(76,175,80,0.5)' : 'var(--border-subtle,#333)'};border-radius:3px;cursor:pointer;">
        <input type="checkbox" data-personal-interest="${d}" ${on ? 'checked' : ''} style="margin:0;" />
        ${escapeHtml(d)}
      </label>`;
    }).join('');
    return this.sectionShell('Domain interests', `<div style="display:flex;flex-wrap:wrap;gap:6px;">${toggles}</div>`);
  }

  private renderTravelSection(): string {
    const trips = this.profile.travelDates;
    const list = trips.length === 0
      ? `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No trips planned. Add one to boost relevance for events near your destination during the window.</div>`
      : `<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;">${trips.map((t, idx) => `<li style="display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:12px;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:3px;">
        <span><strong>${escapeHtml(t.location)}</strong> <span style="color:var(--text-secondary,#aaa);">(${t.lat.toFixed(2)}, ${t.lon.toFixed(2)})</span> · ${formatDate(t.start)} → ${formatDate(t.end)}</span>
        <button type="button" data-personal-rm-trip="${idx}" aria-label="Remove trip" style="background:none;border:none;color:var(--text-secondary,#aaa);cursor:pointer;font-size:14px;line-height:1;">×</button>
      </li>`).join('')}</ul>`;
    const form = `<form data-personal-add-trip style="display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr 1fr auto;gap:6px;margin-top:8px;font-size:11px;">
      <input name="location" placeholder="Destination" required maxlength="64" style="padding:4px 8px;background:var(--bg-elev,#1a1a1a);border:1px solid var(--border-subtle,#333);border-radius:3px;color:inherit;" />
      <input name="lat" placeholder="Lat" required type="number" step="0.0001" min="-90" max="90" style="padding:4px 8px;background:var(--bg-elev,#1a1a1a);border:1px solid var(--border-subtle,#333);border-radius:3px;color:inherit;" />
      <input name="lon" placeholder="Lon" required type="number" step="0.0001" min="-180" max="180" style="padding:4px 8px;background:var(--bg-elev,#1a1a1a);border:1px solid var(--border-subtle,#333);border-radius:3px;color:inherit;" />
      <input name="start" required type="date" style="padding:4px 8px;background:var(--bg-elev,#1a1a1a);border:1px solid var(--border-subtle,#333);border-radius:3px;color:inherit;" />
      <input name="end" required type="date" style="padding:4px 8px;background:var(--bg-elev,#1a1a1a);border:1px solid var(--border-subtle,#333);border-radius:3px;color:inherit;" />
      <button type="submit" style="padding:4px 10px;background:var(--accent,#4a9eff);color:#000;border:none;border-radius:3px;cursor:pointer;">Add</button>
    </form>`;
    return this.sectionShell('Travel windows', list + form);
  }

  private renderPreviewSection(
    rows: { event: { id: string; title: string; relevanceScore: number; domain: string }; personal: { total: number; components: { proximity: number; watchlist: number; interests: number; travel: number }; matchedWatchlist: string[]; inTravelWindow: boolean } }[],
  ): string {
    if (rows.length === 0) {
      return this.sectionShell(
        'Live preview',
        `<div style="font-size:12px;color:var(--text-secondary,#aaa);">No recent alerts in the observation buffer yet.</div>`,
      );
    }
    const body = `<table style="width:100%;border-collapse:collapse;font-size:11px;">
      <thead>
        <tr style="text-align:left;color:var(--text-secondary,#aaa);">
          <th style="padding:4px 6px;border-bottom:1px solid var(--border-subtle,#333);">Event</th>
          <th style="padding:4px 6px;border-bottom:1px solid var(--border-subtle,#333);text-align:right;">Base</th>
          <th style="padding:4px 6px;border-bottom:1px solid var(--border-subtle,#333);text-align:right;">Personal</th>
          <th style="padding:4px 6px;border-bottom:1px solid var(--border-subtle,#333);">Why</th>
        </tr>
      </thead>
      <tbody>${rows.map((r) => {
        const baseScore = r.event.relevanceScore;
        const personalTotal = r.personal.total;
        const combined = Math.min(100, baseScore + personalTotal);
        const delta = combined - baseScore;
        const reasons: string[] = [];
        if (r.personal.components.proximity > 0) reasons.push(`prox +${r.personal.components.proximity}`);
        if (r.personal.components.watchlist > 0) {
          reasons.push(`watch +${r.personal.components.watchlist} (${r.personal.matchedWatchlist.join(', ')})`);
        }
        if (r.personal.components.interests > 0) reasons.push(`interest +${r.personal.components.interests}`);
        if (r.personal.components.travel > 0) reasons.push(`travel +${r.personal.components.travel}`);
        const reasonText = reasons.length > 0 ? reasons.join(', ') : '—';
        return `<tr>
          <td style="padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.04);">${escapeHtml(r.event.title || r.event.id)}</td>
          <td style="padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:right;font-family:ui-monospace,monospace;">${baseScore}</td>
          <td style="padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:right;font-family:ui-monospace,monospace;color:${delta > 0 ? '#4caf50' : 'inherit'};">${combined}${delta > 0 ? ` <span style="font-size:9px;">(+${delta})</span>` : ''}</td>
          <td style="padding:4px 6px;border-bottom:1px solid rgba(255,255,255,0.04);color:var(--text-secondary,#aaa);">${escapeHtml(reasonText)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
    return this.sectionShell('Live preview · last 10 alerts', body);
  }

  private sectionShell(title: string, body: string): string {
    return `<section>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">${escapeHtml(title)}</div>
      ${body}
    </section>`;
  }

  private bindEvents(): void {
    const root = this.getContentElement();
    if (!root) return;

    const addWatch = root.querySelector('form[data-personal-add-watch]') as HTMLFormElement | null;
    if (addWatch) {
      addWatch.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = addWatch.querySelector('input[name="term"]') as HTMLInputElement | null;
        const value = input?.value.trim();
        if (!value) return;
        if (!this.profile.watchlist.includes(value)) {
          this.profile = { ...this.profile, watchlist: [...this.profile.watchlist, value] };
          this.persist();
          this.render();
        }
      });
    }

    for (const btn of root.querySelectorAll('[data-personal-rm-watch]')) {
      btn.addEventListener('click', () => {
        const idx = Number((btn as HTMLElement).dataset.personalRmWatch);
        if (!Number.isFinite(idx)) return;
        const next = this.profile.watchlist.filter((_, i) => i !== idx);
        this.profile = { ...this.profile, watchlist: next };
        this.persist();
        this.render();
      });
    }

    for (const cb of root.querySelectorAll<HTMLInputElement>('input[data-personal-interest]')) {
      cb.addEventListener('change', () => {
        const domain = cb.dataset.personalInterest;
        if (!domain) return;
        const interests = cb.checked
          ? [...new Set([...this.profile.interests, domain])]
          : this.profile.interests.filter((d) => d !== domain);
        this.profile = { ...this.profile, interests };
        this.persist();
        this.render();
      });
    }

    const addTrip = root.querySelector('form[data-personal-add-trip]') as HTMLFormElement | null;
    if (addTrip) {
      addTrip.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(addTrip);
        const trip: TravelEntry = {
          location: readFormField(fd, 'location').trim(),
          lat: Number(fd.get('lat')),
          lon: Number(fd.get('lon')),
          start: parseDate(readFormField(fd, 'start')),
          end: parseDate(readFormField(fd, 'end')) + 86_400_000 - 1,
        };
        if (!trip.location || !Number.isFinite(trip.lat) || !Number.isFinite(trip.lon) || !Number.isFinite(trip.start) || !Number.isFinite(trip.end)) {
          return;
        }
        this.profile = { ...this.profile, travelDates: [...this.profile.travelDates, trip] };
        this.persist();
        this.render();
      });
    }

    for (const btn of root.querySelectorAll('[data-personal-rm-trip]')) {
      btn.addEventListener('click', () => {
        const idx = Number((btn as HTMLElement).dataset.personalRmTrip);
        if (!Number.isFinite(idx)) return;
        const next = this.profile.travelDates.filter((_, i) => i !== idx);
        this.profile = { ...this.profile, travelDates: next };
        this.persist();
        this.render();
      });
    }
  }
}

function readFormField(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

function parseDate(s: string): number {
  if (!s) return Number.NaN;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) ? Number.NaN : t;
}

function formatDate(ms: number): string {
  if (!Number.isFinite(ms)) return '?';
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
