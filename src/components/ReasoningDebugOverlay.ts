/**
 * ReasoningDebugOverlay — full diagnostic surface for the reasoning layer.
 *
 * Toggled with ⌘⇧D (Ctrl+Shift+D). Four tabs:
 *   - Events  ring buffer log (200 entries) with category + level filter
 *   - Metrics latency histograms (p50/p95/p99/min/max/mean) + counters
 *   - State   sizes of persisted stores, budget status, queue depths,
 *             in-memory state of every reasoning service
 *   - Boot    bootstrap trace: which services started, with what latency,
 *             any boot errors
 *
 * Intentionally not styled to match the AnalystHUD's polished look — this
 * is a debug surface, not a user feature. Monospace, dense, filterable.
 */

import { replaceChildren } from '@/utils/dom-utils';
import {
  dumpDebug, getErrorCounts, clearDebug, setVerbosity, getVerbosity,
  subscribeDebug, type DebugEntry, type DebugLevel, type DebugCategory,
} from '@/services/reasoning-debug';
import { getMetricsSnapshot, resetMetrics } from '@/services/reasoning-metrics';
import { getBudgetStatus } from '@/services/llm-budget';
import { getAnalystSnapshot } from '@/services/analyst-loop';
import { getForecastSnapshot } from '@/services/mode-forecast';
import { getSnapshotCount } from '@/services/snapshot-archive';
import { getArchive } from '@/services/briefing-archive';
import { getAllThreads } from '@/services/hypothesis-threads';
import { getEntityMentions, getHotEntities } from '@/services/hypothesis-entities';
import { getAllPlaybooks } from '@/services/action-memory';
import { getKindAccuracy } from '@/services/hypothesis-accuracy';
import { getRelevanceWeights } from '@/services/relevance-learner';

type Tab = 'events' | 'metrics' | 'state' | 'boot';

const LEVEL_COLORS: Record<DebugLevel, string> = {
  info: '#8a8a8a',
  warn: '#d9a445',
  error: '#e54b4b',
};

const LEVELS: DebugLevel[] = ['info', 'warn', 'error'];
const CATEGORIES: DebugCategory[] = [
  'bootstrap', 'idb', 'llm', 'events', 'commands', 'hud',
  'hypothesis', 'forecast', 'budget', 'sidecar', 'other',
];

function fmtAgo(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(1)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function lsSizeBytes(key: string): number {
  try {
    const v = localStorage.getItem(key);
    return v ? v.length * 2 : 0; // UTF-16 approximation
  } catch { return 0; }
}

export class ReasoningDebugOverlay {
  private readonly root: HTMLElement;
  private visible = false;
  private tab: Tab = 'events';
  private filterLevel: DebugLevel = 'info';
  private filterCategory: DebugCategory | '*' = '*';
  private refreshTimer: number | null = null;
  private _unsubDebug: (() => void) | null = null;
  private _onKeydown: ((e: KeyboardEvent) => void) | null = null;
  private readonly _clickAbort = new AbortController();

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'reasoning-debug-overlay';
    this.root.hidden = true;
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) { this.hide(); return; }
      // render() calls replaceChildren(this.root, ...) on every debug write
      // (Events tab) and every 2s (other tabs), so buttons bound per-render
      // would be torn down between pointerdown and pointerup and the click
      // swallowed. Route by data attr on the stable root, which is never
      // replaced, instead of binding each rebuilt button.
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-rdo-action]');
      if (!btn || !this.root.contains(btn)) return;
      switch (btn.dataset.rdoAction) {
        case 'close': { this.hide(); break;
        }
        case 'tab': { this.tab = (btn.dataset.rdoTab as Tab) ?? this.tab; this.render(); break;
        }
        case 'clear': { clearDebug(); this.render(); break;
        }
        case 'copy': { void navigator.clipboard?.writeText(JSON.stringify(dumpDebug(), null, 2)); break;
        }
        case 'verbosity': {
          const order: DebugLevel[] = ['info', 'warn', 'error'];
          const cur = getVerbosity().llm;
          const next = order[(order.indexOf(cur) + 1) % order.length] ?? 'info';
          setVerbosity('llm', next);
          this.render();
          break;
        }
        case 'reset': { resetMetrics(); this.render(); break;
        }
      }
    }, { signal: this._clickAbort.signal });
  }

  mount(parent: HTMLElement): void {
    parent.append(this.root);
    // Store unsubscribe so destroy() can clean it up.
    this._unsubDebug = subscribeDebug(() => {
      if (this.visible && this.tab === 'events') this.render();
    });
    // Store bound handler so it can be removed in destroy().
    this._onKeydown = (e: KeyboardEvent) => {
      if (this.visible && e.key === 'Escape') { this.hide(); e.preventDefault(); return; }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        this.toggle();
      }
    };
    document.addEventListener('keydown', this._onKeydown);
  }

  toggle(): void { if (this.visible) this.hide(); else this.show(); }

  show(): void {
    // Guard: calling show() while already visible would start a second
    // setInterval and lose the old handle, leaking a timer.
    if (this.visible) return;
    this.visible = true;
    this.root.hidden = false;
    this.render();
    // Live refresh for metrics/state tabs (Events auto-refreshes via subscription).
    this.refreshTimer = window.setInterval(() => {
      if (this.tab !== 'events') this.render();
    }, 2000);
  }

  hide(): void {
    this.visible = false;
    this.root.hidden = true;
    if (this.refreshTimer !== null) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
  }

  destroy(): void {
    this.hide();
    this._clickAbort.abort();
    if (this._onKeydown) {
      document.removeEventListener('keydown', this._onKeydown);
      this._onKeydown = null;
    }
    if (this._unsubDebug) {
      this._unsubDebug();
      this._unsubDebug = null;
    }
    this.root.remove();
  }

  // ── Render ──────────────────────────────────────────────────────────────

  private render(): void {
    const card = document.createElement('div');
    card.className = 'reasoning-debug-card';
    card.append(this.buildHeader(), this.buildTabs(), this.buildTabContent());
    replaceChildren(this.root, card);
  }

  private buildHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'reasoning-debug-header';
    const title = document.createElement('h2');
    title.textContent = 'Reasoning Diagnostics';
    const errorCounts = getErrorCounts();
    const errTotal = Object.values(errorCounts).reduce((a, b) => a + b, 0);
    const errTag = document.createElement('span');
    errTag.className = errTotal > 0 ? 'reasoning-debug-err-hot' : 'reasoning-debug-err-cool';
    errTag.textContent = `${errTotal} errors`;
    const close = document.createElement('button');
    close.className = 'reasoning-debug-close';
    close.textContent = 'x';
    close.title = 'Close (Esc)';
    close.dataset.rdoAction = 'close';
    header.append(title, errTag, close);
    return header;
  }

  private buildTabs(): HTMLElement {
    const tabs = document.createElement('div');
    tabs.className = 'reasoning-debug-tabs';
    for (const t of ['events', 'metrics', 'state', 'boot'] as Tab[]) {
      const b = document.createElement('button');
      b.className = 'reasoning-debug-tab' + (this.tab === t ? ' reasoning-debug-tab-active' : '');
      b.textContent = t;
      b.dataset.rdoAction = 'tab';
      b.dataset.rdoTab = t;
      tabs.append(b);
    }
    return tabs;
  }

  private buildTabContent(): HTMLElement {
    const content = document.createElement('div');
    content.className = 'reasoning-debug-content';
    if (this.tab === 'events') content.append(this.buildEvents());
    else if (this.tab === 'metrics') content.append(this.buildMetrics());
    else if (this.tab === 'state') content.append(this.buildState());
    else content.append(this.buildBoot());
    return content;
  }

  // Events tab
  private buildEvents(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'reasoning-debug-events-wrap';
    wrap.append(this.buildEventControls());
    const list = document.createElement('div');
    list.className = 'reasoning-debug-events';
    const entries = dumpDebug()
      .filter(e => this.filterCategory === '*' || e.category === this.filterCategory)
      .filter(e => LEVELS.indexOf(e.level) >= LEVELS.indexOf(this.filterLevel));
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'reasoning-debug-empty';
      empty.textContent = 'No entries match the filter.';
      list.append(empty);
    } else {
      // Newest first
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry) list.append(this.buildEventRow(entry));
      }
    }
    wrap.append(list);
    return wrap;
  }

  private buildEventControls(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'reasoning-debug-controls';
    // Level filter
    const levelLabel = document.createElement('label');
    levelLabel.textContent = 'level ≥ ';
    const levelSel = document.createElement('select');
    for (const l of LEVELS) {
      const opt = document.createElement('option');
      opt.value = l; opt.textContent = l;
      if (l === this.filterLevel) opt.selected = true;
      levelSel.append(opt);
    }
    levelSel.addEventListener('change', () => {
      this.filterLevel = levelSel.value as DebugLevel;
      this.render();
    });
    levelLabel.append(levelSel);
    // Category filter
    const catLabel = document.createElement('label');
    catLabel.textContent = 'category: ';
    const catSel = document.createElement('select');
    for (const c of ['*', ...CATEGORIES]) {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      if (c === this.filterCategory) opt.selected = true;
      catSel.append(opt);
    }
    catSel.addEventListener('change', () => {
      this.filterCategory = (catSel.value === '*' ? '*' : catSel.value as DebugCategory);
      this.render();
    });
    catLabel.append(catSel);
    // Clear
    const clear = document.createElement('button');
    clear.textContent = 'clear';
    clear.dataset.rdoAction = 'clear';
    // Copy
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'copy JSON';
    copyBtn.dataset.rdoAction = 'copy';
    // Verbosity for LLM
    const verbWrap = document.createElement('span');
    verbWrap.className = 'reasoning-debug-verb';
    verbWrap.textContent = ' · verbose llm? ';
    const verbBtn = document.createElement('button');
    const currentLlm = getVerbosity().llm;
    verbBtn.textContent = currentLlm;
    // Delegated on the stable root (see constructor) — buildEventControls() is
    // rebuilt on every events-tab render, so a per-render click listener here
    // would be swallowed by a background re-render mid-gesture.
    verbBtn.dataset.rdoAction = 'verbosity';
    verbWrap.append(verbBtn);

    row.append(levelLabel, catLabel, clear, copyBtn, verbWrap);
    return row;
  }

  private buildEventRow(e: DebugEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'reasoning-debug-row';
    const ago = document.createElement('span');
    ago.className = 'reasoning-debug-ago';
    ago.textContent = fmtAgo(Date.now() - e.t);
    const level = document.createElement('span');
    level.className = 'reasoning-debug-level';
    level.textContent = e.level;
    level.style.color = LEVEL_COLORS[e.level];
    const cat = document.createElement('span');
    cat.className = 'reasoning-debug-cat';
    cat.textContent = e.category;
    const src = document.createElement('span');
    src.className = 'reasoning-debug-src';
    src.textContent = e.source;
    const msg = document.createElement('span');
    msg.className = 'reasoning-debug-msg';
    const latTxt = e.latencyMs === undefined ? '' : ` (${e.latencyMs.toFixed(0)}ms)`;
    msg.textContent = e.message + latTxt;
    row.append(ago, level, cat, src, msg);
    if (e.data && Object.keys(e.data).length > 0) {
      const data = document.createElement('span');
      data.className = 'reasoning-debug-data';
      data.textContent = JSON.stringify(e.data);
      row.append(data);
    }
    return row;
  }

  // Metrics tab
  private buildMetrics(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'reasoning-debug-metrics-wrap';
    const reset = document.createElement('button');
    reset.textContent = 'reset metrics';
    reset.dataset.rdoAction = 'reset';
    wrap.append(reset);

    const snapshot = getMetricsSnapshot();

    const latH = document.createElement('h3');
    latH.textContent = 'Latencies';
    wrap.append(latH);
    const latTable = document.createElement('table');
    latTable.className = 'reasoning-debug-table';
    latTable.innerHTML = '<thead><tr><th>op</th><th>count</th><th>p50</th><th>p95</th><th>p99</th><th>mean</th><th>last</th></tr></thead>';
    const tbody = document.createElement('tbody');
    const latEntries = Object.entries(snapshot.latencies);
    if (latEntries.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="7"><em>no samples yet</em></td>';
      tbody.append(tr);
    }
    latEntries.sort(([a], [b]) => a.localeCompare(b));
    for (const [op, stats] of latEntries) {
      const tr = document.createElement('tr');
      tr.append(this.td(op), this.td(String(stats.count)),
        this.td(`${stats.p50.toFixed(0)}ms`), this.td(`${stats.p95.toFixed(0)}ms`),
        this.td(`${stats.p99.toFixed(0)}ms`), this.td(`${stats.mean.toFixed(0)}ms`),
        this.td(`${stats.last.toFixed(0)}ms`));
      tbody.append(tr);
    }
    latTable.append(tbody);
    wrap.append(latTable);

    const countH = document.createElement('h3');
    countH.textContent = 'Counters';
    wrap.append(countH);
    const countTable = document.createElement('table');
    countTable.className = 'reasoning-debug-table';
    countTable.innerHTML = '<thead><tr><th>counter</th><th>value</th></tr></thead>';
    const ctbody = document.createElement('tbody');
    const counterEntries = Object.entries(snapshot.counters);
    if (counterEntries.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="2"><em>no counters yet</em></td>';
      ctbody.append(tr);
    }
    counterEntries.sort(([a], [b]) => a.localeCompare(b));
    for (const [name, value] of counterEntries) {
      const tr = document.createElement('tr');
      tr.append(this.td(name), this.td(String(value)));
      ctbody.append(tr);
    }
    countTable.append(ctbody);
    wrap.append(countTable);

    return wrap;
  }

  // State tab
  private buildState(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'reasoning-debug-state-wrap';

    const snap = getAnalystSnapshot();
    const forecast = getForecastSnapshot();
    const budget = getBudgetStatus();
    const hot = getHotEntities();

    const rows: [string, string][] = [
      ['Analyst snapshot', snap ? `${snap.hypotheses.length} hypotheses, aiEnriched=${snap.aiEnriched}, age=${fmtAgo(Date.now() - snap.timestamp)}` : 'none'],
      ['Mode forecast', forecast ? `${forecast.advisories.length} advisories, pressures=${JSON.stringify(forecast.pressure)}` : 'none'],
      ['Snapshot archive', `${getSnapshotCount()} snapshots`],
      ['Briefing archive', `${getArchive().length} briefs`],
      ['Hypothesis threads', `${getAllThreads().length} threads`],
      ['Entity mentions', `${getEntityMentions().length} total, ${hot.length} hot`],
      ['Action playbooks', `${getAllPlaybooks().length} signatures tracked`],
      ['Kind accuracy', `${getKindAccuracy().size} kinds have data`],
      ['Relevance weights', `${Object.keys(getRelevanceWeights()).length} terms`],
      ['LLM budget', `${budget.cloud}/${budget.cap} cloud (${budget.remaining} remaining), ${budget.local} local, day=${budget.date}${budget.exhausted ? ', EXHAUSTED' : ''}`],
    ];
    const table = document.createElement('table');
    table.className = 'reasoning-debug-table';
    table.innerHTML = '<thead><tr><th>store</th><th>state</th></tr></thead>';
    const tbody = document.createElement('tbody');
    for (const [k, v] of rows) {
      const tr = document.createElement('tr');
      tr.append(this.td(k), this.td(v));
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);

    // localStorage sizes for each reasoning service
    const lsH = document.createElement('h3');
    lsH.textContent = 'localStorage footprint';
    wrap.append(lsH);
    const lsKeys = [
      'crystalball-analyst-snapshot-v1', 'crystalball-mode-forecast-v1',
      'crystalball-hypothesis-feedback-v1', 'crystalball-hypothesis-accuracy-v1',
      'crystalball-hypothesis-threads-v1', 'crystalball-pressure-history-v1',
      'crystalball-pressure-baselines-v1', 'crystalball-relevance-weights-v1',
      'crystalball-action-memory-v1', 'crystalball-auto-brief-v1',
      'crystalball-briefing-archive-v1', 'crystalball-snapshot-archive-v1',
      'crystalball-skeptic-notes-v1', 'crystalball-hypothesis-projections-v1',
      'crystalball-question-answers-v1', 'crystalball-hypothesis-ensemble-v1',
      'crystalball-dismissed-hypotheses-v1', 'crystalball-llm-budget-v1',
      'crystalball-reasoning-debug-v1', 'crystalball-auto-brief-cooldowns-v1',
    ];
    const lsTable = document.createElement('table');
    lsTable.className = 'reasoning-debug-table';
    lsTable.innerHTML = '<thead><tr><th>key</th><th>size</th></tr></thead>';
    const lsBody = document.createElement('tbody');
    let total = 0;
    for (const key of lsKeys) {
      const size = lsSizeBytes(key);
      total += size;
      const tr = document.createElement('tr');
      tr.append(this.td(key), this.td(size > 0 ? fmtBytes(size) : '—'));
      lsBody.append(tr);
    }
    const tr = document.createElement('tr');
    const td1 = this.td('TOTAL'); td1.style.fontWeight = 'bold';
    const td2 = this.td(fmtBytes(total)); td2.style.fontWeight = 'bold';
    tr.append(td1, td2);
    lsBody.append(tr);
    lsTable.append(lsBody);
    wrap.append(lsTable);

    return wrap;
  }

  // Bootstrap tab
  private buildBoot(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'reasoning-debug-boot-wrap';
    const entries = dumpDebug().filter(e => e.category === 'bootstrap');
    if (entries.length === 0) {
      const p = document.createElement('p');
      p.className = 'reasoning-debug-empty';
      p.textContent = 'No bootstrap events recorded. Refresh the app to populate.';
      wrap.append(p);
      return wrap;
    }
    const list = document.createElement('div');
    list.className = 'reasoning-debug-events';
    for (const e of entries) list.append(this.buildEventRow(e));
    wrap.append(list);
    return wrap;
  }

  private td(text: string): HTMLElement {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
  }
}

// Light CSS glued as a <style> block to avoid sprawling main.css further
// for a debug-only surface. Loaded on first instantiation.
let cssLoaded = false;
export function ensureReasoningDebugCss(): void {
  if (cssLoaded) return;
  cssLoaded = true;
  const style = document.createElement('style');
  style.textContent = `
  .reasoning-debug-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); backdrop-filter: blur(6px); z-index: 550; display: flex; align-items: center; justify-content: center; }
  .reasoning-debug-overlay[hidden] { display: none; }
  .reasoning-debug-card { background: #0b0f16; border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; width: min(1100px, 95vw); max-height: 92vh; overflow-y: auto; padding: 14px 18px; color: #d0d4de; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; }
  .reasoning-debug-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; }
  .reasoning-debug-header h2 { margin: 0; font-size: 13px; font-weight: 600; flex: 1; }
  .reasoning-debug-err-hot { color: #e54b4b; font-weight: 600; }
  .reasoning-debug-err-cool { color: #8a8a8a; }
  .reasoning-debug-close { background: transparent; border: 1px solid rgba(255,255,255,0.2); color: #aaa; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; }
  .reasoning-debug-tabs { display: flex; gap: 4px; margin-bottom: 10px; }
  .reasoning-debug-tab { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12); color: #aaa; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 11px; text-transform: capitalize; }
  .reasoning-debug-tab-active { background: rgba(100,160,255,0.15); border-color: rgba(100,160,255,0.4); color: #b9d4ff; }
  .reasoning-debug-controls { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 11px; }
  .reasoning-debug-controls select, .reasoning-debug-controls button { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); color: #d0d4de; font-family: inherit; font-size: 11px; padding: 2px 6px; border-radius: 3px; }
  .reasoning-debug-events { display: flex; flex-direction: column; gap: 2px; max-height: 65vh; overflow-y: auto; }
  .reasoning-debug-row { display: grid; grid-template-columns: 60px 45px 85px 150px 1fr auto; gap: 8px; padding: 2px 4px; border-bottom: 1px solid rgba(255,255,255,0.04); line-height: 1.4; }
  .reasoning-debug-ago { color: #666; font-variant-numeric: tabular-nums; }
  .reasoning-debug-level { text-transform: uppercase; font-size: 9px; font-weight: 600; }
  .reasoning-debug-cat { color: #888; }
  .reasoning-debug-src { color: #9ec5ff; }
  .reasoning-debug-msg { color: #e0e0e0; }
  .reasoning-debug-data { color: #999; font-size: 10px; font-style: italic; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .reasoning-debug-empty { color: #666; font-style: italic; padding: 20px; text-align: center; }
  .reasoning-debug-table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 6px 0 12px; }
  .reasoning-debug-table th, .reasoning-debug-table td { text-align: left; padding: 3px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .reasoning-debug-table th { background: rgba(255,255,255,0.04); color: #9ec5ff; font-weight: 600; }
  .reasoning-debug-table td { font-variant-numeric: tabular-nums; }
  .reasoning-debug-metrics-wrap h3, .reasoning-debug-state-wrap h3 { margin: 14px 0 4px; font-size: 11px; color: #9ec5ff; text-transform: uppercase; letter-spacing: 0.5px; }
  `;
  document.head.append(style);
}
