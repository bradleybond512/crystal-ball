/**
 * Intelligence Index Panel (panel id: `intelligence-index`).
 *
 * "Find anything" surface. Prominent search bar at the top, type + domain
 * filter chips, ranked result cards (type badge, domain chip, title,
 * excerpt, score dots), result counter, and a recent-additions list
 * when the query is empty.
 */
/* eslint-disable sonarjs/no-nested-template-literals */

import { Panel } from './Panel';
import {
  getIntelligenceIndexService,
  TITLE_MATCH_SCORE,
  TAG_MATCH_SCORE,
  SUMMARY_MATCH_SCORE,
  type ArtifactType,
  type IndexedArtifact,
  type SearchResult,
} from '@/services/intelligence/intelligence-index';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const RESULT_LIMIT = 50;
const RECENT_LIMIT = 12;
const EXCERPT_LENGTH = 140;
const MAX_SCORE = TITLE_MATCH_SCORE + TAG_MATCH_SCORE + SUMMARY_MATCH_SCORE;

const TYPE_LABEL: Record<ArtifactType, string> = {
  situation: 'Situation',
  observation: 'Observation',
  hypothesis: 'Hypothesis',
  counterfactual: 'Counterfactual',
  note: 'Note',
  'calendar-event': 'Event',
  'compound-event': 'Compound',
};

const TYPE_COLOR: Record<ArtifactType, string> = {
  situation: '#e94f37',
  observation: '#4a9eff',
  hypothesis: '#a78bfa',
  counterfactual: '#f5a524',
  note: '#9ca3af',
  'calendar-event': '#2ec27e',
  'compound-event': '#e07b30',
};

const ALL_TYPES: readonly ArtifactType[] = [
  'situation',
  'observation',
  'hypothesis',
  'counterfactual',
  'note',
  'calendar-event',
  'compound-event',
];

export class IntelligenceIndexPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private listener: ((entries: IndexedArtifact[]) => void) | null = null;
  private query = '';
  private typeFilter: ArtifactType | 'all' = 'all';
  /** Either `'all'` to skip the domain filter, or a specific domain string. */
  private domainFilter = 'all';

  constructor() {
    super({
      id: 'intelligence-index',
      title: 'Intel Index',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Unified searchable index across situations, observations, hypotheses, counterfactuals, analyst notes, and events.',
    });
    const svc = getIntelligenceIndexService();
    this.listener = () => this.render();
    svc.subscribe(this.listener);
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.render();
  }

  public override destroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.listener) {
      getIntelligenceIndexService().unsubscribe(this.listener);
      this.listener = null;
    }
    super.destroy();
  }

  private render(): void {
    const svc = getIntelligenceIndexService();
    const stats = svc.getStats();
    this.setCount(stats.total);
    this.setContent(this.buildHtml(), () => this.wireHandlers());
  }

  private buildHtml(): string {
    return `<div class="iidx-panel" style="display:flex;flex-direction:column;gap:8px;padding:10px;font-size:12px;line-height:1.45;">
      ${this.renderSearchBar()}
      ${this.renderFilters()}
      ${this.renderResults()}
    </div>`;
  }

  private renderSearchBar(): string {
    return `<input class="iidx-search" type="search" placeholder="Search title, summary, or tags…" value="${escapeHtml(this.query)}" style="padding:5px 8px;background:rgba(0,0,0,0.3);color:inherit;border:1px solid rgba(255,255,255,0.12);border-radius:3px;font-size:12px;font-family:inherit;" />`;
  }

  private renderFilters(): string {
    const svc = getIntelligenceIndexService();
    const domains = new Set<string>();
    for (const type of ALL_TYPES) {
      for (const a of svc.getByType(type, 200)) domains.add(a.domain);
    }
    const sortedDomains = [...domains].sort((a, b) => a.localeCompare(b));
    return `<div style="display:flex;flex-direction:column;gap:4px;">
      <div style="display:flex;gap:3px;flex-wrap:wrap;">
        ${this.typeChip('all', 'All types')}
        ${ALL_TYPES.map((t) => this.typeChip(t, TYPE_LABEL[t])).join('')}
      </div>
      ${sortedDomains.length > 0 ? `<div style="display:flex;gap:3px;flex-wrap:wrap;">
        ${this.domainChip('all', 'All domains')}
        ${sortedDomains.map((d) => this.domainChip(d, d)).join('')}
      </div>` : ''}
    </div>`;
  }

  private typeChip(value: ArtifactType | 'all', label: string): string {
    const active = this.typeFilter === value;
    const color = value === 'all' ? '#4a9eff' : TYPE_COLOR[value];
    const bg = active ? `${color}33` : 'rgba(255,255,255,0.04)';
    const border = active ? `${color}88` : 'rgba(255,255,255,0.1)';
    return `<button class="iidx-type" data-value="${escapeHtml(value)}" type="button" style="padding:2px 7px;background:${bg};color:inherit;border:1px solid ${border};border-radius:2px;cursor:pointer;font-size:10px;font-family:inherit;">${escapeHtml(label)}</button>`;
  }

  private domainChip(value: string, label: string): string {
    const active = this.domainFilter === value;
    const bg = active ? 'rgba(74,158,255,0.22)' : 'rgba(255,255,255,0.04)';
    const border = active ? 'rgba(74,158,255,0.5)' : 'rgba(255,255,255,0.1)';
    return `<button class="iidx-domain" data-value="${escapeHtml(value)}" type="button" style="padding:1px 7px;background:${bg};color:inherit;border:1px solid ${border};border-radius:2px;cursor:pointer;font-size:10px;font-family:ui-monospace,monospace;">${escapeHtml(label)}</button>`;
  }

  private renderResults(): string {
    const svc = getIntelligenceIndexService();
    if (this.query.trim().length === 0) {
      return this.renderRecent();
    }
    const filter: { artifactType?: ArtifactType; domain?: string } = {};
    if (this.typeFilter !== 'all') filter.artifactType = this.typeFilter;
    if (this.domainFilter !== 'all') filter.domain = this.domainFilter;
    const results = svc.search(this.query, filter, RESULT_LIMIT);
    if (results.length === 0) {
      return `<div style="font-size:11px;opacity:0.55;padding:6px 0;text-align:center;">No matches for "${escapeHtml(this.query)}".</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:5px;">
      <div style="font-size:10px;opacity:0.7;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;">${results.length} result${results.length === 1 ? '' : 's'}</div>
      ${results.map((r) => this.renderResultCard(r)).join('')}
    </div>`;
  }

  private renderRecent(): string {
    const svc = getIntelligenceIndexService();
    const recent: IndexedArtifact[] = [];
    for (const type of ALL_TYPES) {
      for (const a of svc.getByType(type, RECENT_LIMIT)) recent.push(a);
    }
    recent.sort((a, b) => b.indexedAt - a.indexedAt);
    const top = recent.slice(0, RECENT_LIMIT);
    if (top.length === 0) {
      return `<div style="font-size:11px;opacity:0.55;padding:6px 0;text-align:center;">Index is empty. Producers haven't pushed any artifacts yet.</div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:5px;">
      <div style="font-size:10px;opacity:0.7;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;">Recent additions</div>
      ${top.map((a) => this.renderArtifactCard(a)).join('')}
    </div>`;
  }

  private renderResultCard(r: SearchResult): string {
    const a = r.artifact;
    const color = TYPE_COLOR[a.artifactType];
    return `<div style="border-left:3px solid ${color};background:rgba(255,255,255,0.02);border-radius:0 3px 3px 0;padding:5px 8px;display:flex;flex-direction:column;gap:3px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <span style="font-size:11.5px;color:#ddd;font-weight:600;">${escapeHtml(a.title)}</span>
        <span style="display:flex;align-items:center;gap:6px;font-size:9px;">
          ${this.renderTypeBadge(a.artifactType)}
          ${this.renderScoreDots(r.score)}
        </span>
      </div>
      <div style="display:flex;gap:5px;align-items:center;font-size:10px;opacity:0.65;">
        ${this.renderDomainChip(a.domain)}
        <span style="opacity:0.7;font-family:ui-monospace,monospace;">${escapeHtml(a.artifactId)}</span>
      </div>
      ${a.summary ? `<div style="font-size:10.5px;opacity:0.85;">${escapeHtml(excerpt(a.summary))}</div>` : ''}
      ${a.tags.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:3px;">${a.tags.map((t) => `<span style="font-size:9px;background:rgba(74,158,255,0.12);color:#9ec5ff;padding:1px 5px;border-radius:2px;">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    </div>`;
  }

  private renderArtifactCard(a: IndexedArtifact): string {
    const color = TYPE_COLOR[a.artifactType];
    return `<div style="border-left:3px solid ${color};background:rgba(255,255,255,0.02);border-radius:0 3px 3px 0;padding:5px 8px;display:flex;flex-direction:column;gap:3px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <span style="font-size:11.5px;color:#ddd;font-weight:600;">${escapeHtml(a.title)}</span>
        ${this.renderTypeBadge(a.artifactType)}
      </div>
      <div style="display:flex;gap:5px;align-items:center;font-size:10px;opacity:0.65;">
        ${this.renderDomainChip(a.domain)}
        <span style="opacity:0.7;font-family:ui-monospace,monospace;">${escapeHtml(a.artifactId)}</span>
      </div>
    </div>`;
  }

  private renderTypeBadge(type: ArtifactType): string {
    const color = TYPE_COLOR[type];
    return `<span style="font-size:9px;background:${color}22;color:${color};padding:1px 6px;border-radius:2px;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;border:1px solid ${color}55;">${escapeHtml(TYPE_LABEL[type])}</span>`;
  }

  private renderDomainChip(domain: string): string {
    return `<span style="font-size:9px;background:rgba(255,255,255,0.05);color:#aaa;padding:1px 5px;border-radius:2px;font-family:ui-monospace,monospace;">${escapeHtml(domain)}</span>`;
  }

  private renderScoreDots(score: number): string {
    const filled = Math.min(MAX_SCORE, Math.max(0, score));
    const empty = Math.max(0, MAX_SCORE - filled);
    return `<span style="font-family:ui-monospace,monospace;letter-spacing:1px;" title="Score ${score}/${MAX_SCORE}">${'●'.repeat(filled)}${'○'.repeat(empty)}</span>`;
  }

  private wireHandlers(): void {
    const root = this.getContentElement();

    const searchInput = root.querySelector<HTMLInputElement>('.iidx-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.query = searchInput.value;
        this.render();
      });
      // Refocus after re-render so keystrokes don't lose focus.
      if (this.query.length > 0) {
        searchInput.focus();
        searchInput.setSelectionRange(this.query.length, this.query.length);
      }
    }

    for (const chip of root.querySelectorAll<HTMLButtonElement>('.iidx-type')) {
      chip.addEventListener('click', () => {
        const value = chip.getAttribute('data-value');
        if (value === 'all') {
          this.typeFilter = 'all';
        } else if (value && ALL_TYPES.includes(value as ArtifactType)) {
          this.typeFilter = value as ArtifactType;
        }
        this.render();
      });
    }

    for (const chip of root.querySelectorAll<HTMLButtonElement>('.iidx-domain')) {
      chip.addEventListener('click', () => {
        const value = chip.getAttribute('data-value');
        if (!value) return;
        this.domainFilter = value === 'all' ? 'all' : value;
        this.render();
      });
    }
  }
}

function excerpt(text: string): string {
  if (text.length <= EXCERPT_LENGTH) return text;
  return `${text.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`;
}
