/* eslint-disable sonarjs/no-nested-template-literals */
/**
 * Analyst Notebook Panel — search-driven note library. Top: stats
 * row + search bar + category filter tabs. Body: pinned section
 * (when present), then a scrollable list of LIFO notes. Click any
 * card to expand into an inline edit form. New Note button at top
 * inserts a blank note that opens in the edit form immediately.
 */

import { Panel } from './Panel';
import {
  getAnalystNotebookService,
  NOTE_CATEGORIES,
  type Note,
  type NoteCategory,
  type NotebookStats,
} from '@/services/intelligence/analyst-notebook';
import { escapeHtml } from '@/utils/sanitize';

const REFRESH_MS = 30_000;
const DISPLAY_LIMIT = 100;
const BODY_PREVIEW_CHARS = 120;

const CATEGORY_COLOR: Record<NoteCategory, string> = {
  observation: '#4a9eff',
  hypothesis: '#ffb74d',
  assessment: '#f44336',
  action: '#4caf50',
  general: '#9e9e9e',
};

interface PanelState {
  query: string;
  category: NoteCategory | 'all';
  expandedId: string | null;
}

export class AnalystNotebookPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private state: PanelState = { query: '', category: 'all', expandedId: null };

  constructor() {
    super({
      id: 'analyst-notebook',
      title: 'Analyst Notebook',
      showCount: true,
      trackActivity: true,
      infoTooltip:
        'Persistent note-taking for analysts. Notes link to Situations and observations, support tags, search, and a pinned-first view. Working memory for the operator.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.refreshTimer = setInterval(() => this.renderWhenVisible(() => this.render()), REFRESH_MS);
    this.unsub = getAnalystNotebookService().subscribe(() => this.render());
  }

  public destroy(): void {
    super.destroy();
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
  }

  private render(): void {
    const svc = getAnalystNotebookService();
    const stats = svc.getStats();
    const notes = this.collectNotes();
    this.setCount(stats.total);

    const html = `<div style="padding:12px;display:flex;flex-direction:column;gap:12px;">
      ${renderStatsRow(stats)}
      ${this.renderToolbar()}
      ${this.renderCategoryTabs(stats)}
      ${this.renderNotes(notes)}
    </div>`;
    this.setContent(html, () => this.wireHandlers());
  }

  private collectNotes(): Note[] {
    const svc = getAnalystNotebookService();
    if (this.state.query.trim().length > 0) {
      return svc.search(this.state.query);
    }
    const filter = this.state.category === 'all' ? undefined : { category: this.state.category };
    return svc.getAll(filter, DISPLAY_LIMIT);
  }

  private renderToolbar(): string {
    return `<div style="display:flex;gap:8px;align-items:center;">
      <input id="anNotebookSearch" type="search" placeholder="Search title, body, or tags…" value="${escapeHtml(this.state.query)}" style="flex:1;padding:6px 10px;background:var(--surface-2,#1a1a1a);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;" />
      <button id="anNotebookNew" style="padding:6px 12px;font-size:11px;background:#4a9eff26;color:#4a9eff;border:1px solid #4a9eff55;border-radius:3px;cursor:pointer;">+ New Note</button>
    </div>`;
  }

  private renderCategoryTabs(stats: NotebookStats): string {
    const active = this.state.category;
    const tabs = [
      renderTabButton('all', 'All', stats.total, active === 'all'),
      ...NOTE_CATEGORIES.map((c) => renderTabButton(c, c, stats.byCategory[c], active === c)),
    ].join('');
    return `<div style="display:flex;gap:5px;flex-wrap:wrap;">${tabs}</div>`;
  }

  private renderNotes(notes: readonly Note[]): string {
    if (notes.length === 0) {
      return `<div style="font-size:12px;color:var(--text-secondary,#aaa);padding:18px;text-align:center;border:1px dashed var(--border-subtle,#333);border-radius:4px;">No notes match. Click <strong>+ New Note</strong> to start one.</div>`;
    }
    const pinned = notes.filter((n) => n.isPinned);
    const rest = notes.filter((n) => !n.isPinned);
    const sections: string[] = [];
    if (pinned.length > 0) {
      sections.push(`<div>
        <div style="font-size:10px;color:#ffb74d;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;">Pinned (${pinned.length})</div>
        <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px;">${pinned.map((n) => this.renderCard(n)).join('')}</ul>
      </div>`);
    }
    sections.push(`<div>
      <div style="font-size:10px;color:var(--text-secondary,#aaa);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;">Notes (${rest.length})</div>
      <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px;max-height:520px;overflow-y:auto;">${rest.map((n) => this.renderCard(n)).join('')}</ul>
    </div>`);
    return sections.join('');
  }

  private renderCard(n: Note): string {
    const expanded = this.state.expandedId === n.id;
    const color = CATEGORY_COLOR[n.category];
    const preview = n.body.length > BODY_PREVIEW_CHARS ? `${n.body.slice(0, BODY_PREVIEW_CHARS)}…` : n.body;
    const tagChips = n.tags
      .map((t) => `<span style="font-size:10px;padding:1px 6px;background:#4a9eff26;color:#4a9eff;border:1px solid #4a9eff55;border-radius:9px;">${escapeHtml(t)}</span>`)
      .join(' ');
    const pinGlyph = n.isPinned ? '★' : '☆';
    return `<li data-an-card="${escapeHtml(n.id)}" style="padding:9px 10px;border:1px solid ${color}55;border-radius:4px;background:var(--surface-2,#1a1a1a);font-size:12px;display:flex;flex-direction:column;gap:5px;cursor:pointer;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="display:inline-block;width:3px;height:14px;background:${color};border-radius:1px;"></span>
        <span style="font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(n.title || '(untitled)')}</span>
        <button data-an-pin="${escapeHtml(n.id)}" title="Toggle pin" style="background:transparent;border:none;color:#ffb74d;font-size:14px;cursor:pointer;">${pinGlyph}</button>
      </div>
      <div style="font-size:11px;color:var(--text-secondary,#aaa);">${escapeHtml(preview)}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <span style="display:flex;gap:4px;flex-wrap:wrap;">${tagChips}</span>
        <span style="font-size:10px;font-family:ui-monospace,monospace;color:var(--text-secondary,#666);">${escapeHtml(new Date(n.updatedAt).toISOString().slice(0, 16).replace('T', ' '))}</span>
      </div>
      ${expanded ? this.renderEditForm(n) : ''}
    </li>`;
  }

  private renderEditForm(n: Note): string {
    const categoryOpts = NOTE_CATEGORIES.map((c) =>
      `<option value="${c}"${c === n.category ? ' selected' : ''}>${c}</option>`,
    ).join('');
    return `<div data-an-form="${escapeHtml(n.id)}" style="display:flex;flex-direction:column;gap:6px;padding-top:8px;border-top:1px solid var(--border-subtle,#333);font-size:11px;" onclick="event.stopPropagation();">
      <input data-an-title type="text" value="${escapeHtml(n.title)}" placeholder="Title" style="padding:5px 8px;background:var(--surface-3,#222);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;" />
      <textarea data-an-body rows="5" placeholder="Body" style="padding:5px 8px;background:var(--surface-3,#222);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;font-family:inherit;resize:vertical;">${escapeHtml(n.body)}</textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
        <input data-an-tags type="text" value="${escapeHtml(n.tags.join(', '))}" placeholder="comma-separated tags" style="padding:5px 8px;background:var(--surface-3,#222);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;" />
        <select data-an-category style="padding:5px 8px;background:var(--surface-3,#222);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;">${categoryOpts}</select>
      </div>
      <input data-an-situations type="text" value="${escapeHtml(n.linkedSituationIds.join(', '))}" placeholder="linked situation IDs (comma-separated)" style="padding:5px 8px;background:var(--surface-3,#222);color:inherit;border:1px solid var(--border-subtle,#333);border-radius:3px;font-size:12px;" />
      <div style="display:flex;gap:8px;">
        <button data-an-save="${escapeHtml(n.id)}" style="padding:4px 12px;font-size:11px;background:#4caf5026;color:#4caf50;border:1px solid #4caf5055;border-radius:3px;cursor:pointer;">Save</button>
        <button data-an-delete="${escapeHtml(n.id)}" style="padding:4px 12px;font-size:11px;background:#f4433626;color:#f44336;border:1px solid #f4433655;border-radius:3px;cursor:pointer;">Delete</button>
      </div>
    </div>`;
  }

  private wireHandlers(): void {
    setTimeout(() => {
      const root = this.content;
      const svc = getAnalystNotebookService();

      const searchEl = root.querySelector<HTMLInputElement>('#anNotebookSearch');
      searchEl?.addEventListener('input', () => {
        this.state.query = searchEl.value;
        this.render();
      });
      root.querySelectorAll<HTMLButtonElement>('[data-an-tab]').forEach((el) => {
        el.addEventListener('click', () => {
          this.state.category = (el.dataset.anTab as NoteCategory | 'all');
          this.render();
        });
      });
      root.querySelector<HTMLButtonElement>('#anNotebookNew')?.addEventListener('click', () => {
        const fresh = svc.create({
          title: 'New note',
          body: '',
          category: 'general',
          tags: [],
          linkedSituationIds: [],
          linkedObservationIds: [],
          isPinned: false,
        });
        this.state.expandedId = fresh.id;
        this.render();
      });
      root.querySelectorAll<HTMLElement>('[data-an-card]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.dataset.anCard;
          if (!id) return;
          this.state.expandedId = this.state.expandedId === id ? null : id;
          this.render();
        });
      });
      root.querySelectorAll<HTMLButtonElement>('[data-an-pin]').forEach((el) => {
        el.addEventListener('click', (event) => togglePin(event, el));
      });
      root.querySelectorAll<HTMLButtonElement>('[data-an-save]').forEach((el) => {
        el.addEventListener('click', (event) => this.handleSaveClick(event, el, root));
      });
      root.querySelectorAll<HTMLButtonElement>('[data-an-delete]').forEach((el) => {
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          const id = el.dataset.anDelete;
          if (!id) return;
          svc.delete(id);
          this.state.expandedId = null;
          this.render();
        });
      });
    }, 0);
  }

  private handleSaveClick(event: Event, el: HTMLButtonElement, root: HTMLElement): void {
    event.stopPropagation();
    const id = el.dataset.anSave;
    if (!id) return;
    const form = root.querySelector<HTMLElement>(`[data-an-form="${CSS.escape(id)}"]`);
    if (!form) return;
    const title = form.querySelector<HTMLInputElement>('[data-an-title]')?.value ?? '';
    const body = form.querySelector<HTMLTextAreaElement>('[data-an-body]')?.value ?? '';
    const tagsRaw = form.querySelector<HTMLInputElement>('[data-an-tags]')?.value ?? '';
    const situationsRaw = form.querySelector<HTMLInputElement>('[data-an-situations]')?.value ?? '';
    const category = (form.querySelector<HTMLSelectElement>('[data-an-category]')?.value ?? 'general') as NoteCategory;
    const tags = splitCsv(tagsRaw);
    const linkedSituationIds = splitCsv(situationsRaw);
    getAnalystNotebookService().update(id, { title, body, tags, linkedSituationIds, category });
    this.state.expandedId = null;
    this.render();
  }
}

function togglePin(event: Event, el: HTMLButtonElement): void {
  event.stopPropagation();
  const id = el.dataset.anPin;
  if (!id) return;
  const svc = getAnalystNotebookService();
  const existing = svc.getAll().find((n) => n.id === id);
  if (existing) svc.update(id, { isPinned: !existing.isPinned });
}

function splitCsv(raw: string): string[] {
  const parts: string[] = [];
  for (const piece of raw.split(',')) {
    const trimmed = piece.trim();
    if (trimmed) parts.push(trimmed);
  }
  return parts;
}

function renderTabButton(key: NoteCategory | 'all', label: string, count: number, active: boolean): string {
  const bg = active ? '#4a9eff33' : 'var(--surface-2,#1a1a1a)';
  const color = active ? '#4a9eff' : 'var(--text-secondary,#aaa)';
  return `<button data-an-tab="${escapeHtml(key)}" style="padding:4px 10px;font-size:11px;background:${bg};color:${color};border:1px solid var(--border-subtle,#333);border-radius:3px;cursor:pointer;text-transform:capitalize;">${escapeHtml(label)} ${count}</button>`;
}

// ── Rendering helpers ───────────────────────────────────────────────

function renderStatsRow(stats: NotebookStats): string {
  const tagChips = stats.recentTags.slice(0, 5)
    .map((t) => `<span style="font-size:10px;padding:1px 6px;background:#4a9eff26;color:#4a9eff;border:1px solid #4a9eff55;border-radius:9px;">${escapeHtml(t)}</span>`)
    .join(' ');
  return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--text-secondary,#aaa);">
    <span><strong style="color:var(--text-primary,#ddd);">${stats.total}</strong> notes · <strong style="color:#ffb74d;">${stats.pinned}</strong> pinned</span>
    <span style="display:flex;gap:4px;flex-wrap:wrap;">${tagChips}</span>
  </div>`;
}
