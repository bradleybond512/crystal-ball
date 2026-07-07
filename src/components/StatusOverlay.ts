 
/**
 * StatusOverlay — single card with three sections:
 *   1. Source Health (from source-health tracker)
 *   2. Watchlist management (add / remove / view)
 *   3. Daily Rollup (latest cb:daily-rollup text)
 *
 * Toggled with ⌘⇧S or the cb:toggle-status event.
 */

import { getSourceHealth, type SourceHealth } from '@/services/source-health';
import { formatDurationMinutes } from '@/utils/format-duration';
import { getWatchlist, saveWatchlist, type WatchlistEntry } from '@/services/watchlist';
import { getForecastAccuracy } from '@/services/forecast-accuracy';
import { getSourceTrust } from '@/services/source-trust';
import { getSourceFeedbackMult } from '@/services/source-feedback';
import { buildCooccurrenceGraph } from '@/services/entity-cooccurrence';
import { getCustomRules, addCustomRule, removeCustomRule, toggleCustomRule, type CustomCausalRule } from '@/services/custom-correlation-rules';
import { getReliabilityLeaderboard } from '@/services/source-reliability';
import { getLearnedPatterns } from '@/services/pattern-memory';
import { getGeofences, addGeofence, removeGeofence, toggleGeofence } from '@/services/geofence-alerts';
import { getPeriodicSources } from '@/services/periodicity-detector';
import { getSilenceStatus } from '@/services/silence-anomaly';
import { projectEntityHeat } from '@/services/entity-heat-projection';
import { getCollections, deleteCollection } from '@/services/alert-bookmarks';

export class StatusOverlay {
  private overlay: HTMLElement;
  private visible = false;
  private latestRollup = '';
  private refreshTimer: number | null = null;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'status-overlay';
    this.overlay.hidden = true;
    this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.hide(); });
    document.addEventListener('cb:daily-rollup', (e) => {
      const det = (e as CustomEvent<{ text: string }>).detail;
      this.latestRollup = det?.text ?? '';
      if (this.visible) this.render();
    });
  }

  mount(parent: HTMLElement): void {
    parent.append(this.overlay);
  }

  toggle(): void { if (this.visible) this.hide(); else this.show(); }

  show(): void {
    this.visible = true;
    this.overlay.hidden = false;
    this.render();
    this.refreshTimer = window.setInterval(() => this.render(), 15_000);
  }

  hide(): void {
    this.visible = false;
    this.overlay.hidden = true;
    if (this.refreshTimer != null) { window.clearInterval(this.refreshTimer); this.refreshTimer = null; }
  }

  private render(): void {
    this.overlay.textContent = '';
    const card = document.createElement('div');
    card.className = 'status-card';

    // Header
    const header = document.createElement('div');
    header.className = 'status-header';
    const title = document.createElement('h2'); title.textContent = 'System Status';
    const close = document.createElement('button'); close.className = 'status-close'; close.textContent = '✕';
    close.addEventListener('click', () => this.hide());
    header.append(title, close);
    card.append(header);

    // Daily rollup section
    const rollupSec = document.createElement('section');
    rollupSec.className = 'status-section';
    const rh = document.createElement('h3'); rh.textContent = 'Daily Rollup';
    rollupSec.append(rh);
    const rb = document.createElement('pre'); rb.className = 'status-rollup';
    rb.textContent = this.latestRollup || '(waiting for first rollup — updates every 15 min)';
    rollupSec.append(rb);
    card.append(rollupSec);

    // Forecast accuracy section
    card.append(this.renderForecastSection());

    // Source health section
    card.append(this.renderHealthSection());

    // Entity co-occurrence graph
    card.append(this.renderCooccurrenceSection());

    // Source reliability leaderboard
    card.append(this.renderReliabilitySection());

    // Learned patterns
    card.append(this.renderPatternsSection());

    // Custom correlation rules
    card.append(this.renderCustomRulesSection());

    // Geofences
    card.append(this.renderGeofenceSection());

    // Bookmark collections
    card.append(this.renderBookmarksSection());

    // Periodicity + silence
    card.append(this.renderPeriodicitySection());

    // Entity heat projection
    card.append(this.renderHeatProjectionSection());

    // Watchlist section
    card.append(this.renderWatchlistSection());

    this.overlay.append(card);
  }

  private renderForecastSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'status-section';
    const h = document.createElement('h3'); h.textContent = 'Forecast Accuracy';
    sec.append(h);
    const acc = getForecastAccuracy();
    if (acc.totalPredictions === 0) {
      const empty = document.createElement('p'); empty.className = 'status-empty';
      empty.textContent = '(no predictions logged yet)';
      sec.append(empty);
      return sec;
    }
    const bar = document.createElement('div'); bar.className = 'status-forecast-bar';
    const fill = document.createElement('div'); fill.className = 'status-forecast-fill';
    fill.style.width = `${acc.accuracy}%`;
    bar.append(fill);
    const label = document.createElement('div'); label.className = 'status-forecast-label';
    label.textContent = `${acc.accuracy}% accuracy (${acc.hits} hits / ${acc.hits + acc.misses} resolved, ${acc.pending} pending)`;
    sec.append(bar, label);
    return sec;
  }

  private renderHealthSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'status-section';
    const h = document.createElement('h3'); h.textContent = 'Source Health';
    sec.append(h);
    const items = getSourceHealth();
    if (items.length === 0) {
      const empty = document.createElement('p'); empty.className = 'status-empty';
      empty.textContent = '(no sources polled yet)';
      sec.append(empty);
      return sec;
    }
    const grid = document.createElement('div'); grid.className = 'status-health-grid';
    for (const h of items) grid.append(this.buildHealthRow(h));
    sec.append(grid);
    return sec;
  }

  private buildHealthRow(h: SourceHealth): HTMLElement {
    const row = document.createElement('div');
    row.className = `status-health-row status-health-${h.status}`;
    const dot = document.createElement('span'); dot.className = 'status-dot';
    const name = document.createElement('span'); name.className = 'status-name'; name.textContent = h.name;
    const stat = document.createElement('span'); stat.className = 'status-stat';
    const total = h.successCount + h.errorCount;
    const lastOkAgo = h.lastOk ? `${Math.round((Date.now() - h.lastOk) / 60_000)}m ago` : 'never';
    stat.textContent = `${h.successCount}/${total} · ${lastOkAgo}`;
    const badge = document.createElement('span'); badge.className = 'status-badge'; badge.textContent = h.status.toUpperCase();
    // Trust score bar
    const sourceName = h.name as import('@/services/unified-alerts').AlertSource;
    const baseTrust = getSourceTrust(sourceName);
    const feedbackMult = getSourceFeedbackMult(sourceName);
    const effectiveTrust = Math.min(1, baseTrust * feedbackMult);
    const trustBar = document.createElement('div'); trustBar.className = 'status-trust-bar';
    const trustFill = document.createElement('div'); trustFill.className = 'status-trust-fill';
    trustFill.style.width = `${Math.round(effectiveTrust * 100)}%`;
    let trustColor = 'var(--semantic-critical, #ff4444)';
    if (effectiveTrust >= 0.8) trustColor = '#44cc88';
    else if (effectiveTrust >= 0.5) trustColor = '#ffcc00';
    trustFill.style.background = trustColor;
    trustBar.append(trustFill);
    trustBar.title = `Trust: ${(effectiveTrust * 100).toFixed(0)}% (base ${(baseTrust * 100).toFixed(0)}% × feedback ${feedbackMult.toFixed(2)})`;
    row.append(dot, name, stat, badge, trustBar);
    return row;
  }

  private renderCooccurrenceSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'status-section';
    const h = document.createElement('h3'); h.textContent = 'Entity Network';
    sec.append(h);

    const graph = buildCooccurrenceGraph();
    if (graph.nodes.length === 0) {
      const empty = document.createElement('p'); empty.className = 'status-empty';
      empty.textContent = '(no co-occurring entities yet)';
      sec.append(empty);
      return sec;
    }

    const W = 320; const H = 200;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.classList.add('cooc-graph');

    // Position nodes in a circle.
    const nodes = graph.nodes;
    const posMap = new Map<string, { x: number; y: number }>();
    const cx = W / 2; const cy = H / 2; const r = Math.min(W, H) * 0.35;
    for (let i = 0; i < nodes.length; i++) {
      const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
      posMap.set(nodes[i]!.name, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    }

    // Draw edges.
    const maxW = Math.max(...graph.edges.map(e => e.weight), 1);
    for (const edge of graph.edges) {
      const pa = posMap.get(edge.a);
      const pb = posMap.get(edge.b);
      if (!pa || !pb) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', pa.x.toFixed(1));
      line.setAttribute('y1', pa.y.toFixed(1));
      line.setAttribute('x2', pb.x.toFixed(1));
      line.setAttribute('y2', pb.y.toFixed(1));
      line.setAttribute('stroke', 'rgba(96,165,250,0.3)');
      line.setAttribute('stroke-width', String(Math.max(1, (edge.weight / maxW) * 3)));
      svg.append(line);
    }

    // Draw nodes.
    const maxMentions = Math.max(...nodes.map(n => n.mentions), 1);
    for (const node of nodes) {
      const pos = posMap.get(node.name);
      if (!pos) continue;
      const nodeR = 4 + (node.mentions / maxMentions) * 8;
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', pos.x.toFixed(1));
      circle.setAttribute('cy', pos.y.toFixed(1));
      circle.setAttribute('r', nodeR.toFixed(1));
      circle.setAttribute('fill', 'var(--sev-info, #60a5fa)');
      circle.setAttribute('opacity', '0.8');
      svg.append(circle);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', pos.x.toFixed(1));
      label.setAttribute('y', (pos.y + nodeR + 10).toFixed(1));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', '#ccc');
      label.setAttribute('font-size', '9');
      label.textContent = node.name;
      svg.append(label);
    }

    sec.append(svg);
    return sec;
  }

  private renderReliabilitySection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'status-section';
    const h = document.createElement('h3'); h.textContent = 'Source Reliability';
    sec.append(h);

    const entries = getReliabilityLeaderboard();
    if (entries.length === 0) {
      const empty = document.createElement('p'); empty.className = 'status-empty';
      empty.textContent = '(need ≥3 predictions per source to rank)';
      sec.append(empty);
      return sec;
    }

    const grid = document.createElement('div'); grid.className = 'status-reliability-grid';
    for (const [i, entry] of entries.entries()) {
      const e = entry!;
      const row = document.createElement('div'); row.className = 'status-reliability-row';
      const rank = document.createElement('span'); rank.className = 'status-rel-rank';
      rank.textContent = `#${i + 1}`;
      const name = document.createElement('span'); name.className = 'status-rel-name';
      name.textContent = e.source;
      const acc = document.createElement('span'); acc.className = 'status-rel-acc';
      acc.textContent = `${e.accuracy}%`;
      const trend = document.createElement('span'); trend.className = `status-rel-trend status-rel-${e.trend}`;
      const TREND_ICON: Record<string, string> = { up: '↑', down: '↓', stable: '→' };
      trend.textContent = TREND_ICON[e.trend] ?? '→';
      const ct = document.createElement('span'); ct.className = 'status-rel-ct';
      ct.textContent = `trust ${(e.compositeTrust * 100).toFixed(0)}%`;
      const count = document.createElement('span'); count.className = 'status-rel-count';
      count.textContent = `${e.total} pred`;
      row.append(rank, name, acc, trend, ct, count);
      grid.append(row);
    }
    sec.append(grid);
    return sec;
  }

  private renderPatternsSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'status-section';
    const h = document.createElement('h3'); h.textContent = 'Learned Patterns';
    sec.append(h);

    const patterns = getLearnedPatterns();
    if (patterns.length === 0) {
      const empty = document.createElement('p'); empty.className = 'status-empty';
      empty.textContent = '(no recurring patterns detected yet)';
      sec.append(empty);
      return sec;
    }

    const list = document.createElement('div'); list.className = 'status-patterns-list';
    for (const p of patterns) {
      const row = document.createElement('div'); row.className = 'status-pattern-row';
      const pair = document.createElement('span'); pair.className = 'status-pattern-pair';
      pair.textContent = `${p.cause} → ${p.effect}`;
      const rate = document.createElement('span'); rate.className = 'status-pattern-rate';
      const hitRate = p.hits / (p.hits + p.misses);
      rate.textContent = `${Math.round(hitRate * 100)}% (${p.hits}/${p.hits + p.misses})`;
      const lag = document.createElement('span'); lag.className = 'status-pattern-lag';
      lag.textContent = `~${Math.round(p.avgLagMs / 60_000)}m lag`;
      row.append(pair, rate, lag);
      list.append(row);
    }
    sec.append(list);
    return sec;
  }

  private renderCustomRulesSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'status-section';
    const h = document.createElement('h3'); h.textContent = 'Custom Correlation Rules';
    sec.append(h);

    const rules = getCustomRules();
    if (rules.length === 0) {
      const empty = document.createElement('p'); empty.className = 'status-empty';
      empty.textContent = '(no custom rules — add cause→effect pairs below)';
      sec.append(empty);
    } else {
      const list = document.createElement('div'); list.className = 'status-rules-list';
      for (const rule of rules) {
        list.append(this.buildRuleRow(rule));
      }
      sec.append(list);
    }

    // Add form
    const form = document.createElement('div'); form.className = 'status-rules-form';
    const causeInput = document.createElement('input'); causeInput.placeholder = 'Cause (e.g. earthquake)';
    const effectInput = document.createElement('input'); effectInput.placeholder = 'Effect (e.g. tsunami)';
    const lagInput = document.createElement('input'); lagInput.placeholder = 'Lag (min)'; lagInput.type = 'number'; lagInput.value = '60';
    const radiusInput = document.createElement('input'); radiusInput.placeholder = 'Radius (km)'; radiusInput.type = 'number'; radiusInput.value = '500';
    const addBtn = document.createElement('button'); addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', () => {
      const cause = causeInput.value.trim();
      const effect = effectInput.value.trim();
      const lag = Number(lagInput.value) || 60;
      const radius = Number(radiusInput.value) || 500;
      if (!cause || !effect) return;
      addCustomRule({
        cause: cause as import('@/services/unified-alerts').AlertSource,
        effect: effect as import('@/services/unified-alerts').AlertSource,
        maxLagMs: lag * 60_000,
        radiusKm: radius,
        label: `${cause} → ${effect}`,
      });
      causeInput.value = ''; effectInput.value = '';
      this.render();
    });
    form.append(causeInput, effectInput, lagInput, radiusInput, addBtn);
    sec.append(form);
    return sec;
  }

  private buildRuleRow(rule: CustomCausalRule): HTMLElement {
    const row = document.createElement('div');
    row.className = `status-rule-row${rule.enabled ? '' : ' status-rule-disabled'}`;
    const label = document.createElement('span');
    label.className = 'status-rule-label';
    label.textContent = `${rule.cause} → ${rule.effect} (${Math.round(rule.maxLagMs / 60_000)}m, ${rule.radiusKm}km)`;
    const toggle = document.createElement('button');
    toggle.className = 'status-rule-toggle';
    toggle.textContent = rule.enabled ? 'ON' : 'OFF';
    toggle.addEventListener('click', () => { toggleCustomRule(rule.id); this.render(); });
    const del = document.createElement('button');
    del.className = 'status-wl-del';
    del.textContent = '\u2715';
    del.addEventListener('click', () => { removeCustomRule(rule.id); this.render(); });
    row.append(label, toggle, del);
    return row;
  }

  private renderGeofenceSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'status-section';
    const h = document.createElement('h3'); h.textContent = 'Geofences';
    sec.append(h);

    const fences = getGeofences();
    if (fences.length > 0) {
      const list = document.createElement('div'); list.className = 'status-rules-list';
      for (const f of fences) {
        const row = document.createElement('div');
        row.className = `status-rule-row${f.enabled ? '' : ' status-rule-disabled'}`;
        const label = document.createElement('span'); label.className = 'status-rule-label';
        label.textContent = `${f.label} (${f.lat.toFixed(2)}, ${f.lon.toFixed(2)}) ${f.radiusKm}km`;
        const toggle = document.createElement('button'); toggle.className = 'status-rule-toggle';
        toggle.textContent = f.enabled ? 'ON' : 'OFF';
        toggle.addEventListener('click', () => { toggleGeofence(f.id); this.render(); });
        const del = document.createElement('button'); del.className = 'status-wl-del'; del.textContent = '\u2715';
        del.addEventListener('click', () => { removeGeofence(f.id); this.render(); });
        row.append(label, toggle, del);
        list.append(row);
      }
      sec.append(list);
    }

    const form = document.createElement('div'); form.className = 'status-rules-form';
    const labelIn = document.createElement('input'); labelIn.placeholder = 'Label';
    const latIn = document.createElement('input'); latIn.placeholder = 'Lat'; latIn.type = 'number'; latIn.step = 'any';
    const lonIn = document.createElement('input'); lonIn.placeholder = 'Lon'; lonIn.type = 'number'; lonIn.step = 'any';
    const radIn = document.createElement('input'); radIn.placeholder = 'Radius km'; radIn.type = 'number'; radIn.value = '100';
    const addBtn = document.createElement('button'); addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', () => {
      const lbl = labelIn.value.trim();
      const lat = Number(latIn.value);
      const lon = Number(lonIn.value);
      const rad = Number(radIn.value) || 100;
      if (!lbl || Number.isNaN(lat) || Number.isNaN(lon)) return;
      addGeofence(lbl, lat, lon, rad);
      labelIn.value = ''; latIn.value = ''; lonIn.value = '';
      this.render();
    });
    form.append(labelIn, latIn, lonIn, radIn, addBtn);
    sec.append(form);
    return sec;
  }

  private renderBookmarksSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'status-section';
    const h = document.createElement('h3'); h.textContent = 'Bookmark Collections';
    sec.append(h);

    const cols = getCollections();
    if (cols.length === 0) {
      const empty = document.createElement('p'); empty.className = 'status-empty';
      empty.textContent = '(no collections — right-click an alert to bookmark)';
      sec.append(empty);
      return sec;
    }

    const list = document.createElement('div'); list.className = 'status-rules-list';
    for (const col of cols) {
      const row = document.createElement('div'); row.className = 'status-rule-row';
      const label = document.createElement('span'); label.className = 'status-rule-label';
      label.textContent = `${col.name} (${col.alertIds.length} alerts)`;
      const del = document.createElement('button'); del.className = 'status-wl-del'; del.textContent = '\u2715';
      del.addEventListener('click', () => { deleteCollection(col.id); this.render(); });
      row.append(label, del);
      list.append(row);
    }
    sec.append(list);
    return sec;
  }

  private renderPeriodicitySection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'status-section';
    const h = document.createElement('h3'); h.textContent = 'Source Periodicity & Silence';
    sec.append(h);

    const silence = getSilenceStatus();
    if (silence.isSilent) {
      const warn = document.createElement('div'); warn.className = 'status-silence-warn';
      warn.textContent = `Alert rate at ${Math.round(silence.ratio * 100)}% of baseline (${silence.currentRate} vs ~${silence.baselineRate} expected)`;
      sec.append(warn);
    }

    const periodic = getPeriodicSources();
    if (periodic.length === 0) {
      const empty = document.createElement('p'); empty.className = 'status-empty';
      empty.textContent = '(no periodic sources detected yet)';
      sec.append(empty);
      return sec;
    }

    const grid = document.createElement('div'); grid.className = 'status-reliability-grid';
    for (const p of periodic) {
      const row = document.createElement('div');
      row.className = `status-reliability-row${p.overdue ? ' status-overdue' : ''}`;
      const name = document.createElement('span'); name.className = 'status-rel-name'; name.textContent = p.source;
      const interval = document.createElement('span'); interval.className = 'status-rel-acc';
      interval.textContent = `~${formatDurationMinutes(p.meanIntervalMin)}`;
      const last = document.createElement('span'); last.className = 'status-rel-ct';
      last.textContent = `${formatDurationMinutes(p.lastSeenAgoMin)} ago`;
      const badge = document.createElement('span');
      badge.className = p.overdue ? 'status-rel-down' : 'status-rel-up';
      badge.textContent = p.overdue ? 'OVERDUE' : 'OK';
      row.append(name, interval, last, badge);
      grid.append(row);
    }
    sec.append(grid);
    return sec;
  }

  private renderHeatProjectionSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'status-section';
    const h = document.createElement('h3'); h.textContent = 'Entity Heat Projection (4h)';
    sec.append(h);

    const projections = projectEntityHeat().slice(0, 10);
    if (projections.length === 0) {
      const empty = document.createElement('p'); empty.className = 'status-empty';
      empty.textContent = '(no entity data yet)';
      sec.append(empty);
      return sec;
    }

    const grid = document.createElement('div'); grid.className = 'status-reliability-grid';
    for (const p of projections) {
      const row = document.createElement('div'); row.className = 'status-reliability-row';
      const name = document.createElement('span'); name.className = 'status-rel-name'; name.textContent = p.name;
      const current = document.createElement('span'); current.className = 'status-rel-acc';
      current.textContent = String(p.currentHeat);
      const arrow = document.createElement('span');
      const TREND_ICON: Record<string, string> = { rising: '↑', falling: '↓', stable: '→' };
      const TREND_CLASS: Record<string, string> = { rising: 'up', falling: 'down', stable: 'stable' };
      const trendClass = TREND_CLASS[p.trend] ?? 'stable';
      arrow.className = `status-rel-${trendClass}`;
      arrow.textContent = TREND_ICON[p.trend] ?? '→';
      const projected = document.createElement('span'); projected.className = 'status-rel-ct';
      projected.textContent = `→ ${p.projectedHeat}`;
      const conf = document.createElement('span'); conf.className = 'status-rel-count';
      conf.textContent = `${p.confidence}%`;
      row.append(name, current, arrow, projected, conf);
      grid.append(row);
    }
    sec.append(grid);
    return sec;
  }

  private renderWatchlistSection(): HTMLElement {
    const sec = document.createElement('section');
    sec.className = 'status-section';
    const h = document.createElement('h3'); h.textContent = 'Watchlist';
    sec.append(h);
    const list = getWatchlist();
    if (list.length === 0) {
      const empty = document.createElement('p'); empty.className = 'status-empty';
      empty.textContent = '(empty — right-click an alert in Triage to add)';
      sec.append(empty);
    } else {
      const items = document.createElement('div'); items.className = 'status-wl-list';
      for (const e of list) items.append(this.buildWatchlistRow(e));
      sec.append(items);
    }
    // Add form
    const form = document.createElement('div'); form.className = 'status-wl-form';
    const input = document.createElement('input');
    input.placeholder = 'Add keyword (e.g. "Taiwan", "SCADA")';
    const btn = document.createElement('button'); btn.textContent = '+ Add';
    btn.addEventListener('click', () => {
      const val = input.value.trim();
      if (!val) return;
      const cur = getWatchlist();
      cur.push({ id: `wl-${Date.now()}`, label: val, keywords: [val] });
      saveWatchlist(cur);
      input.value = '';
      this.render();
    });
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') btn.click(); });
    form.append(input, btn);
    sec.append(form);
    return sec;
  }

  private buildWatchlistRow(e: WatchlistEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'status-wl-row';
    const label = document.createElement('span'); label.className = 'status-wl-label'; label.textContent = e.label;
    const kw = document.createElement('span'); kw.className = 'status-wl-kw';
    kw.textContent = e.keywords.join(', ');
    const del = document.createElement('button'); del.className = 'status-wl-del'; del.textContent = '✕';
    del.addEventListener('click', () => {
      const cur = getWatchlist().filter(x => x.id !== e.id);
      saveWatchlist(cur);
      this.render();
    });
    row.append(label, kw, del);
    return row;
  }
}
