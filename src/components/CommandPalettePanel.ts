/**
 * CommandPalettePanel — Phase 2 keyboard-first ⌘K palette.
 *
 * Mounts a single overlay backed by the shared command registry. Keyboard
 * model: ↑/↓ moves the cursor, Enter runs the selected command, Escape closes,
 * and ⌘1…⌘8 jumps directly to the Nth visible result. Results are grouped by
 * category with a small category chip rendered on each row.
 */

import {
  getCommandRegistry,
  PALETTE_CATEGORY_LABELS,
  PALETTE_CATEGORY_ORDER,
  type CommandRegistry,
  type CommandSearchResult,
  type PaletteCategory,
  type PaletteCommand,
} from '@/services/command-palette/command-registry';
import { slog } from '@/services/structured-log';
import { debounce } from '@/utils';

const MAX_VISIBLE = 8;
const PANEL_WIDTH_PX = 400;
const STYLE_ELEMENT_ID = 'cmdk-v2-style';
type BuiltinCatalogModule = typeof import('@/services/command-palette/built-in-commands');

const STYLE = `
.cmdk-v2-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 10005; display: flex; align-items: flex-start; justify-content: center; padding-top: 14vh; }
.cmdk-v2-overlay[hidden] { display: none; }
.cmdk-v2-panel { width: ${PANEL_WIDTH_PX}px; max-width: 94vw; background: var(--mat-solid-3, rgba(28,28,32,0.98)); color: var(--text-primary, #f5f5f7); border: none; border-radius: var(--r-xl, 16px); box-shadow: var(--e-4, 0 24px 64px rgba(0,0,0,0.6)), var(--edge-hairline, inset 0 0 0 0.5px rgba(255,255,255,0.11)); overflow: hidden; font: 13px/1.3 -apple-system, system-ui, sans-serif; }
body.is-desktop-macos .cmdk-v2-panel { background: var(--mat-raised-bg, rgba(28,28,32,0.9)); -webkit-backdrop-filter: var(--mat-blur-raised, blur(24px)); backdrop-filter: var(--mat-blur-raised, blur(24px)); }
.cmdk-v2-input { width: 100%; box-sizing: border-box; background: transparent; border: none; border-bottom: 1px solid rgba(255,255,255,0.1); color: var(--text-primary, #f5f5f7); padding: 14px 18px; font: 15px/1.2 -apple-system, system-ui, sans-serif; outline: none; }
.cmdk-v2-list { max-height: 56vh; overflow-y: auto; padding: 6px; }
.cmdk-v2-section { font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.4); padding: 10px 12px 4px; }
.cmdk-v2-section:first-child { padding-top: 6px; }
.cmdk-v2-row { display: flex; align-items: center; gap: 10px; width: 100%; background: transparent; border: none; color: var(--text-primary, #f5f5f7); text-align: left; padding: 9px 12px; border-radius: var(--r-sm, 8px); cursor: pointer; font: 13px/1.2 -apple-system, system-ui, sans-serif; }
.cmdk-v2-row.is-active, .cmdk-v2-row:hover { background: var(--accent-selection, rgba(255,255,255,0.12)); }
.cmdk-v2-icon { width: 18px; text-align: center; opacity: 0.8; flex: 0 0 18px; }
.cmdk-v2-body { flex: 1; min-width: 0; }
.cmdk-v2-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmdk-v2-subtitle { font-size: 11px; color: rgba(255,255,255,0.5); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmdk-v2-badge { font-size: 10px; letter-spacing: 0.02em; padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); flex: 0 0 auto; }
.cmdk-v2-empty { padding: 18px; text-align: center; color: rgba(255,255,255,0.5); font-size: 13px; }
`;

function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ELEMENT_ID;
  el.textContent = STYLE;
  document.head.append(el);
}

const CATEGORY_BADGE: Record<PaletteCategory, string> = {
  navigation: 'NAV',
  panel: 'PANEL',
  action: 'ACTION',
  search: 'SEARCH',
};

export interface CommandPalettePanelOptions {
  /** Override the registry (mostly for tests). Defaults to the singleton. */
  registry?: CommandRegistry;
  /** Override the result cap. Defaults to 8. */
  maxVisible?: number;
  /** Load the standard catalog on first show; custom registries stay ready by default. */
  lazyBuiltins?: boolean;
}

export class CommandPalettePanel {
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  private overlay: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private registry: CommandRegistry;
  private results: CommandSearchResult[] = [];
  private cursor = 0;
  private visible = false;
  private readonly maxVisible: number;
  private mounted = false;
  private mountGeneration = 0;
  private catalogState: 'idle' | 'loading' | 'ready' | 'failed';
  private catalogLoad: Promise<BuiltinCatalogModule> | null = null;

  constructor(opts: CommandPalettePanelOptions = {}) {
    ensureStyles();
    this.registry = opts.registry ?? getCommandRegistry();
    this.maxVisible = opts.maxVisible ?? MAX_VISIBLE;
    this.catalogState = opts.lazyBuiltins ? 'idle' : 'ready';

    this.overlay = document.createElement('div');
    this.overlay.className = 'cmdk-v2-overlay';
    this.overlay.hidden = true;
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-label', 'Command palette');

    const panel = document.createElement('div');
    panel.className = 'cmdk-v2-panel';

    this.input = document.createElement('input');
    this.input.className = 'cmdk-v2-input';
    this.input.placeholder = 'Search commands…';
    this.input.setAttribute('aria-label', 'Command palette search');
    // Debounce: 420+ commands × 5 keyword fields = ~189 k char comparisons per
    // keystroke. 50 ms coalesces fast typing without perceptible lag.
    const refilterInput = debounce((...args: unknown[]) => {
      const [generation] = args;
      if (!this.mounted || generation !== this.mountGeneration) return;
      this.cursor = 0;
      this.refilter();
    }, 50);
    this.input.addEventListener('input', () => refilterInput(this.mountGeneration));
    this.input.addEventListener('keydown', e => this.onKeyDown(e));

    this.list = document.createElement('div');
    this.list.className = 'cmdk-v2-list';
    this.list.setAttribute('role', 'listbox');

    panel.append(this.input, this.list);
    this.overlay.append(panel);
    this.overlay.addEventListener('click', e => {
      if (e.target === this.overlay) this.hide();
    });
  }

  /** Append the overlay to a parent (typically `document.body`). */
  mount(parent: HTMLElement): void {
    if (!this.mounted) this.mountGeneration++;
    this.mounted = true;
    parent.append(this.overlay);
  }

  /** Remove the overlay from the DOM. */
  unmount(): void {
    this.hide();
    this.mounted = false;
    this.mountGeneration++;
    this.catalogLoad = null;
    if (this.catalogState === 'loading') this.catalogState = 'idle';
    this.overlay.remove();
  }

  isVisible(): boolean { return this.visible; }

  /** Current top-N search results — exposed for tests. */
  currentResults(): readonly CommandSearchResult[] { return this.results; }

  /** Current root element — exposed for tests + integration wiring. */
  element(): HTMLElement { return this.overlay; }

  toggle(): void { if (this.visible) this.hide(); else this.show(); }

  show(): void {
    if (!this.mounted || !this.overlay.isConnected) return;
    if (this.focusTimer !== null) clearTimeout(this.focusTimer);
    this.visible = true;
    this.overlay.hidden = false;
    this.input.value = '';
    this.cursor = 0;
    this.beginBuiltinCatalogLoad();
    this.refilter();
    // Focus on next tick so a key-up that fired ⌘K doesn't immediately cancel.
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      if (this.visible && this.overlay.isConnected) this.input.focus();
    }, 0);
  }

  hide(): void {
    if (this.focusTimer !== null) clearTimeout(this.focusTimer);
    this.focusTimer = null;
    this.visible = false;
    this.overlay.hidden = true;
  }

  /**
   * Handle a key event coming from outside the palette (used by the ⌘K
   * listener glue so the document keydown can be funneled in for tests).
   * Returns true if the event was handled.
   */
  handleKey(event: KeyboardEvent | { key: string; metaKey?: boolean; ctrlKey?: boolean; preventDefault?: () => void }): boolean {
    if (!this.visible) return false;
    return this.onKeyDown(event as KeyboardEvent);
  }

  private refilter(): void {
    if (!this.mounted || !this.overlay.isConnected) return;
    this.results = this.registry.search(this.input.value, this.maxVisible);
    if (this.cursor >= this.results.length) {
      this.cursor = Math.max(0, this.results.length - 1);
    }
    this.render();
  }

  private render(): void {
    if (!this.mounted || !this.overlay.isConnected) return;
    this.overlay.setAttribute('aria-busy', this.catalogState === 'loading' ? 'true' : 'false');
    this.list.replaceChildren();
    if (this.catalogState !== 'ready') {
      this.renderCatalogStatus();
      return;
    }
    if (this.results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cmdk-v2-empty';
      empty.textContent = this.input.value.trim() ? 'No commands match.' : 'No commands registered.';
      this.list.append(empty);
      return;
    }
    const grouped = groupResults(this.results);
    let row = 0;
    for (const cat of PALETTE_CATEGORY_ORDER) {
      const entries = grouped.get(cat);
      if (!entries || entries.length === 0) continue;
      const header = document.createElement('div');
      header.className = 'cmdk-v2-section';
      header.textContent = PALETTE_CATEGORY_LABELS[cat];
      this.list.append(header);
      for (const entry of entries) {
        const idx = row;
        this.list.append(this.makeRow(entry.command, idx));
        row += 1;
      }
    }
  }

  private makeRow(cmd: PaletteCommand, idx: number): HTMLElement {
    const btn = document.createElement('button');
    btn.className = `cmdk-v2-row${idx === this.cursor ? ' is-active' : ''}`;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', idx === this.cursor ? 'true' : 'false');
    btn.dataset.commandId = cmd.id;

    if (cmd.icon) {
      const icon = document.createElement('span');
      icon.className = 'cmdk-v2-icon';
      icon.textContent = cmd.icon;
      btn.append(icon);
    }

    const body = document.createElement('span');
    body.className = 'cmdk-v2-body';
    const title = document.createElement('span');
    title.className = 'cmdk-v2-title';
    title.textContent = cmd.title;
    body.append(title);
    if (cmd.subtitle) {
      const sub = document.createElement('span');
      sub.className = 'cmdk-v2-subtitle';
      sub.textContent = cmd.subtitle;
      body.append(document.createElement('br'), sub);
    }
    btn.append(body);

    const badge = document.createElement('span');
    badge.className = 'cmdk-v2-badge';
    badge.textContent = CATEGORY_BADGE[cmd.category];
    btn.append(badge);

    btn.addEventListener('click', () => this.runAt(idx));
    return btn;
  }

  private runAt(idx: number): void {
    if (!this.mounted || !this.visible || !this.overlay.isConnected || this.catalogState !== 'ready') return;
    const result = this.flatResultsInRenderOrder()[idx];
    if (!result) return;
    this.hide();
    try {
      result.command.action();
    } catch {
      // Swallow — a faulty action must not strand the palette open.
    }
  }

  protected loadBuiltinCatalog(): Promise<BuiltinCatalogModule> {
    return import('@/services/command-palette/built-in-commands');
  }

  private beginBuiltinCatalogLoad(): void {
    if (!this.mounted || !this.visible || !this.overlay.isConnected
      || this.catalogState === 'loading' || this.catalogState === 'ready') return;
    const generation = this.mountGeneration;
    this.catalogState = 'loading';
    const pending = this.loadBuiltinCatalog();
    this.catalogLoad = pending;
    void pending.then((catalog) => {
      if (!this.isCurrentCatalogLoad(generation, pending)) return;
      try {
        catalog.registerBuiltinCommands(this.registry);
      } catch (error) {
        this.failCatalogLoad(generation, pending, error);
        return;
      }
      this.catalogLoad = null;
      this.catalogState = 'ready';
      this.overlay.setAttribute('aria-busy', 'false');
      if (this.visible) this.refilter();
    }, (error: unknown) => this.failCatalogLoad(generation, pending, error));
  }

  private isCurrentCatalogLoad(generation: number, pending: Promise<BuiltinCatalogModule>): boolean {
    return this.mounted && this.overlay.isConnected
      && generation === this.mountGeneration && pending === this.catalogLoad;
  }

  private failCatalogLoad(generation: number, pending: Promise<BuiltinCatalogModule>, error: unknown): void {
    if (!this.isCurrentCatalogLoad(generation, pending)) return;
    this.catalogLoad = null;
    this.catalogState = 'failed';
    this.overlay.setAttribute('aria-busy', 'false');
    slog('error', 'palette', 'Builtin catalog failed to load', { fields: { error: String(error).slice(0, 200) } });
    if (this.visible) this.refilter();
  }

  private renderCatalogStatus(): void {
    const status = document.createElement('div');
    status.className = 'cmdk-v2-empty';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = this.catalogState === 'failed'
      ? 'Commands unavailable. Retry to load the full catalog.'
      : 'Loading commands…';
    this.list.append(status);
    if (this.catalogState !== 'failed') return;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'cmdk-v2-row';
    retry.dataset.action = 'retry-builtin-catalog';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => {
      if (!this.mounted || !this.visible || !this.overlay.isConnected) return;
      this.beginBuiltinCatalogLoad();
      this.refilter();
      this.input.focus();
    });
    this.list.append(retry);
  }

  /**
   * Results in the order they're rendered (category buckets in
   * PALETTE_CATEGORY_ORDER, scored within each).
   */
  private flatResultsInRenderOrder(): CommandSearchResult[] {
    const grouped = groupResults(this.results);
    const out: CommandSearchResult[] = [];
    for (const cat of PALETTE_CATEGORY_ORDER) {
      const entries = grouped.get(cat);
      if (!entries) continue;
      for (const e of entries) out.push(e);
    }
    return out;
  }

  private onKeyDown(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; preventDefault?: () => void }): boolean {
    if (e.key === 'Escape') {
      e.preventDefault?.();
      this.hide();
      return true;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault?.();
      this.cursor = Math.min(this.cursor + 1, Math.max(0, this.results.length - 1));
      this.render();
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault?.();
      this.cursor = Math.max(0, this.cursor - 1);
      this.render();
      return true;
    }
    if (e.key === 'Enter') {
      e.preventDefault?.();
      this.runAt(this.cursor);
      return true;
    }
    // ⌘1…⌘8 — jump straight to the Nth visible result.
    if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
      const n = Number.parseInt(e.key, 10);
      if (n - 1 < this.results.length) {
        e.preventDefault?.();
        this.runAt(n - 1);
        return true;
      }
    }
    return false;
  }
}

export function groupResults(results: readonly CommandSearchResult[]): Map<PaletteCategory, CommandSearchResult[]> {
  const map = new Map<PaletteCategory, CommandSearchResult[]>();
  for (const r of results) {
    const arr = map.get(r.command.category) ?? [];
    arr.push(r);
    map.set(r.command.category, arr);
  }
  return map;
}
