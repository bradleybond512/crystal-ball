/**
 * Entity Registry Panel — Phase 3 intelligence fabric UI.
 *
 * Surfaces the canonical entity registry: a search bar, type filter,
 * risk-ranked top 10, and a detail card with the selected entity's
 * identifiers and last 5 linked observations. Pure composition over
 * `entity-registry.ts`. 30 s auto-refresh.
 */

import { Panel } from './Panel';
import {
  allEntities,
  getByType,
  getLinkedObservations,
  resolve,
  topByRisk,
  type Entity,
  type EntityLink,
  type EntityType,
} from '@/services/intelligence/entity-registry';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;

const TYPE_FILTERS: { value: EntityType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ship', label: 'Ships' },
  { value: 'aircraft', label: 'Aircraft' },
  { value: 'person', label: 'People' },
  { value: 'organization', label: 'Orgs' },
  { value: 'facility', label: 'Facilities' },
  { value: 'location', label: 'Locations' },
];

const TYPE_COLOR: Record<EntityType, string> = {
  ship: '#4a9eff',
  aircraft: '#a78bfa',
  person: '#f59e0b',
  organization: '#f97316',
  facility: '#22c55e',
  location: '#94a3b8',
};

function ageLabel(timestamp: number, now = Date.now()): string {
  const ms = Math.max(0, now - timestamp);
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))}h ago`;
  return `${Math.round(ms / (24 * 60 * 60_000))}d ago`;
}

function riskBadge(score: number): string {
  const pct = Math.round(score * 100);
  let color = '#22c55e';
  if (score >= 0.66) color = '#ef4444';
  else if (score >= 0.33) color = '#f59e0b';
  return `<span style="display:inline-block;font-size:10px;padding:1px 5px;border-radius:2px;background:rgba(255,255,255,0.04);color:${color};font-family:ui-monospace,monospace;">${pct}%</span>`;
}

export class EntityRegistryPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private query = '';
  private typeFilter: EntityType | 'all' = 'all';
  private selectedId: string | null = null;
  private inputHandler: ((e: Event) => void) | null = null;
  private filterHandler: ((e: Event) => void) | null = null;
  private clickHandler: ((e: Event) => void) | null = null;

  constructor() {
    super({
      id: 'entity-registry',
      title: 'Entity Registry',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Canonical identity store across ships, aircraft, people, organizations, facilities, and locations. Search by name, alias, or identifier; pick an entity to see its identifiers and linked observations.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private render(): void {
    const entries = this.filteredEntities();
    this.setCount(entries.length);

    const selected = this.selectedId ? entries.find((e) => e.id === this.selectedId) ?? null : null;
    this.setContent(this.renderShell(entries, selected));
    this.attachHandlers();
  }

  private filteredEntities(): Entity[] {
    const source: Entity[] = this.typeFilter === 'all'
      ? allEntities()
      : getByType(this.typeFilter);
    if (!this.query.trim()) return source.sort((a, b) => b.lastSeen - a.lastSeen);
    const direct = resolve(this.query.trim());
    if (direct) return [direct];
    const lower = this.query.trim().toLowerCase();
    return source.filter((e) =>
      e.canonicalName.toLowerCase().includes(lower)
      || e.aliases.some((a) => a.toLowerCase().includes(lower))
      || Object.values(e.identifiers).some((v) => v.toLowerCase().includes(lower)),
    ).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  private renderShell(entries: Entity[], selected: Entity | null): string {
    return `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
      ${this.renderControls()}
      ${this.renderTopRisk()}
      ${this.renderList(entries)}
      ${selected ? this.renderDetail(selected) : ''}
    </div>`;
  }

  private renderControls(): string {
    const filters = TYPE_FILTERS.map((f) => {
      const active = this.typeFilter === f.value;
      const bg = active ? 'rgba(74,158,255,0.15)' : 'rgba(255,255,255,0.04)';
      const color = active ? '#4a9eff' : 'var(--text-secondary,#aaa)';
      return `<button data-entity-filter="${escapeHtml(f.value)}" type="button" style="background:${bg};color:${color};border:1px solid var(--border-subtle,#333);border-radius:3px;padding:3px 8px;font-size:11px;cursor:pointer;">${escapeHtml(f.label)}</button>`;
    }).join('');

    return `<div style="display:flex;flex-direction:column;gap:8px;">
      <input
        data-entity-search
        type="text"
        placeholder="Search by name, alias, MMSI, ICAO24, OFAC SDN…"
        value="${escapeHtml(this.query)}"
        style="background:rgba(255,255,255,0.04);color:#e5e5e5;border:1px solid var(--border-subtle,#333);border-radius:3px;padding:6px 8px;font-size:12px;"
      />
      <div style="display:flex;flex-wrap:wrap;gap:4px;">${filters}</div>
    </div>`;
  }

  private renderTopRisk(): string {
    const top = topByRisk(10);
    if (top.length === 0) return '';
    const rows = top.map((e) => this.renderEntityRow(e, true)).join('');
    return `<div style="display:flex;flex-direction:column;gap:6px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Top 10 by risk</div>
      <div style="display:flex;flex-direction:column;gap:3px;">${rows}</div>
    </div>`;
  }

  private renderList(entries: Entity[]): string {
    if (entries.length === 0) {
      return `<div style="padding:20px;text-align:center;color:var(--text-secondary,#aaa);font-size:12px;">No entities match the current filter.</div>`;
    }
    const rows = entries.slice(0, 50).map((e) => this.renderEntityRow(e, false)).join('');
    const heading = this.query
      ? `Search results (${entries.length})`
      : `All entities (${entries.length})`;
    return `<div style="display:flex;flex-direction:column;gap:6px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">${escapeHtml(heading)}</div>
      <div style="display:flex;flex-direction:column;gap:3px;">${rows}</div>
    </div>`;
  }

  private renderEntityRow(entity: Entity, compact: boolean): string {
    const color = TYPE_COLOR[entity.type];
    const sample = entity.identifiers.mmsi
      ?? entity.identifiers.icao24
      ?? entity.identifiers.tail
      ?? entity.identifiers['ofac-sdn']
      ?? '';
    const selected = entity.id === this.selectedId;
    const bg = selected ? 'rgba(74,158,255,0.10)' : 'rgba(255,255,255,0.02)';
    return `<button data-entity-id="${escapeHtml(entity.id)}" type="button" style="display:flex;align-items:center;gap:8px;padding:${compact ? '4px 8px' : '6px 8px'};background:${bg};border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;width:100%;text-align:left;">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
      <span style="flex:1;font-size:12px;color:#e5e5e5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(entity.canonicalName)}</span>
      <span style="font-size:10px;color:var(--text-secondary,#aaa);font-family:ui-monospace,monospace;">${escapeHtml(sample)}</span>
      ${riskBadge(entity.riskScore)}
    </button>`;
  }

  private renderDetail(entity: Entity): string {
    const color = TYPE_COLOR[entity.type];
    const links = getLinkedObservations(entity.id).slice(0, 5);
    const idRows = Object.entries(entity.identifiers).map(([k, v]) => `<div style="display:flex;gap:8px;font-size:11px;">
      <span style="color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;width:80px;">${escapeHtml(k)}</span>
      <span style="font-family:ui-monospace,monospace;">${escapeHtml(v)}</span>
    </div>`).join('');
    const aliasChips = entity.aliases.length === 0
      ? '<span style="font-size:11px;color:var(--text-secondary,#aaa);">no aliases</span>'
      : entity.aliases.map((a) => `<span style="background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:2px;font-size:10px;">${escapeHtml(a)}</span>`).join('');
    const domainChips = entity.domains.length === 0
      ? '<span style="font-size:11px;color:var(--text-secondary,#aaa);">no domains</span>'
      : entity.domains.map((d) => `<span style="background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:2px;font-size:10px;color:${color};">${escapeHtml(d)}</span>`).join('');
    return `<div style="border:1px solid ${color};border-radius:4px;padding:10px;display:flex;flex-direction:column;gap:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div>
          <div style="font-size:10px;color:${color};text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">${escapeHtml(entity.type)}</div>
          <div style="font-size:14px;font-weight:600;color:#e5e5e5;">${escapeHtml(entity.canonicalName)}</div>
        </div>
        ${riskBadge(entity.riskScore)}
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;">${idRows || '<span style="font-size:11px;color:var(--text-secondary,#aaa);">no identifiers</span>'}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">${aliasChips}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">${domainChips}</div>
      ${this.renderLinkedObservations(links)}
    </div>`;
  }

  private renderLinkedObservations(links: readonly EntityLink[]): string {
    if (links.length === 0) {
      return `<div style="font-size:11px;color:var(--text-secondary,#aaa);">No linked observations.</div>`;
    }
    const rows = links.map((l) => `<div style="display:flex;gap:8px;font-size:11px;">
      <span style="font-family:ui-monospace,monospace;color:var(--text-secondary,#aaa);">${escapeHtml(l.observationId)}</span>
      ${l.situationId ? `<span style="font-family:ui-monospace,monospace;color:#4a9eff;">${escapeHtml(l.situationId)}</span>` : ''}
      <span style="margin-left:auto;color:var(--text-secondary,#aaa);">${escapeHtml(ageLabel(l.linkedAt))}</span>
    </div>`).join('');
    return `<div style="display:flex;flex-direction:column;gap:3px;border-top:1px solid var(--border-subtle,#333);padding-top:6px;">
      <div style="font-size:11px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;">Last ${links.length} observations</div>
      ${rows}
    </div>`;
  }

  private attachHandlers(): void {
    const root = this.getContentElement();

    const input = root.querySelector<HTMLInputElement>('input[data-entity-search]');
    if (input) {
      if (this.inputHandler) input.removeEventListener('input', this.inputHandler);
      this.inputHandler = (event: Event) => {
        const value = (event.target as HTMLInputElement).value;
        if (value !== this.query) {
          this.query = value;
          this.render();
          // Re-focus after re-render.
          const next = this.getContentElement().querySelector<HTMLInputElement>('input[data-entity-search]');
          if (next) {
            next.focus();
            next.setSelectionRange(value.length, value.length);
          }
        }
      };
      input.addEventListener('input', this.inputHandler);
    }

    if (this.filterHandler) root.removeEventListener('click', this.filterHandler);
    this.filterHandler = (event: Event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-entity-filter]');
      if (!target) return;
      const value = target.dataset.entityFilter as EntityType | 'all';
      if (value && value !== this.typeFilter) {
        this.typeFilter = value;
        this.render();
      }
    };
    root.addEventListener('click', this.filterHandler);

    if (this.clickHandler) root.removeEventListener('click', this.clickHandler);
    this.clickHandler = (event: Event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-entity-id]');
      if (!target) return;
      const id = target.dataset.entityId;
      if (id) {
        this.selectedId = id === this.selectedId ? null : id;
        this.render();
      }
    };
    root.addEventListener('click', this.clickHandler);
  }
}
