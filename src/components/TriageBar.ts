/**
 * TriageBar — pinned strip showing the top 5 hottest active alerts.
 *
 * Subscribes to the unified alert store, ranks via alert-routing scoring,
 * and renders a clickable row that scrolls + flashes the source panel.
 * Auto-hides when there's nothing hot.
 */

/* eslint-disable sonarjs/no-nested-template-literals */
import { unifiedAlertStore, type UnifiedAlert } from '@/services/unified-alerts';
import { rankAlerts, panelForAlert, scoreBreakdown } from '@/services/alert-routing';
import { flashPanel, jumpToPanel, pulseAlertOnMap } from '@/services/alert-reactions';
import { getPreset, setPreset, type AlertingPreset } from '@/services/alerting-prefs';
import { getWatchlist, saveWatchlist } from '@/services/watchlist';
import { groupIntoStories, type AlertStory } from '@/services/alert-stories';
import { getLifecyclePhase, getLifecycleSamples, type LifecyclePhase } from '@/services/alert-lifecycle';
import { recordSnooze, getSnoozeSuggestion, formatSnoozeDuration } from '@/services/snooze-learning';
import { estimateEscalation } from '@/services/escalation-predictor';
import { getAnnotation, setAnnotation } from '@/services/alert-annotations';
import { getCollections, addToCollection, createCollection } from '@/services/alert-bookmarks';
import { formatDurationMinutes } from '@/utils/format-duration';
import { icon, type IconName } from '@/components/ui/icons';
import { getActiveRegimeShifts, REGIME_SHIFT_EVENT } from '@/services/cognition/regime-monitor';
import type { ForecastDomain } from '@/services/mode-forecast';

const MAX_VISIBLE = 5;

const PRESET_META: Record<AlertingPreset, { label: string; icon: IconName; desc: string }> = {
  loud:   { label: 'Loud',   icon: 'bell',       desc: 'Sound, banner flashes and notifications' },
  visual: { label: 'Visual', icon: 'eye',        desc: 'Flashes and notifications, no sound' },
  silent: { label: 'Silent', icon: 'bell-slash', desc: 'Panel and map cues only — also halves feed-poll frequency' },
};
const PRESET_ORDER: AlertingPreset[] = ['loud', 'visual', 'silent'];

type Domain = 'all' | 'weather' | 'conflict' | 'cyber' | 'health' | 'infra' | 'space';
const DOMAIN_LABELS: Record<Domain, string> = {
  all: 'All', weather: 'Weather', conflict: 'Conflict', cyber: 'Cyber',
  health: 'Health', infra: 'Infra', space: 'Space',
};
const SOURCE_DOMAIN: Record<string, Exclude<Domain, 'all'>> = {
  nws: 'weather', gdacs: 'weather', tsunami: 'weather', cyclone: 'weather', fire: 'weather',
  earthquake: 'weather', volcano: 'weather', spc: 'weather', hazard: 'weather', 'air-quality': 'weather',
  oref: 'conflict', 'breaking-news': 'conflict',
  cyber: 'cyber', 'local-ids': 'cyber',
  disease: 'health', radiation: 'health',
  'power-grid': 'infra', 'comms-health': 'infra', maritime: 'infra',
  'aviation-hazard': 'infra', 'travel-advisory': 'infra', resource: 'infra',
  'space-weather': 'space',
};
const FACET_KEY = 'crystalball-triage-facet-v1';
function loadFacet(): Domain {
  try { return (localStorage.getItem(FACET_KEY) as Domain) || 'all'; } catch { return 'all'; }
}
function saveFacet(d: Domain): void {
  try { localStorage.setItem(FACET_KEY, d); } catch { /* noop */ }
}

export class TriageBar {
  private element: HTMLElement;
  private unsubscribe: (() => void) | null = null;
  private refreshTimer: number | null = null;
  private facet: Domain = loadFacet();
  /** Non-null while the preset popover is open; call to close + unhook. */
  private presetMenuCleanup: (() => void) | null = null;
  /** Visible stories from the last render — resolved by delegated handlers. */
  private visibleStories: AlertStory[] = [];
  /** Opens the current render's preset popover (delegated preset-toggle). */
  private openPresetMenu: (() => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'triage-bar';
    this.element.id = 'triageBar';
    this.element.hidden = true;
    // Delegate on the stable root. render() calls replaceChildren() ~1/s on
    // alert-store churn, orphaning any per-node listener a click gesture
    // straddles (Defect B1). One listener on this.element — which is never
    // replaced — survives every re-render (same pattern as AnalystHUD.ts).
    this.element.addEventListener('click', (e) => this.onClick(e as MouseEvent));
    this.element.addEventListener('contextmenu', (e) => this.onContextMenu(e as MouseEvent));
  }

  /** Re-render on new BOCPD detections so the regime chip appears promptly. */
  private readonly onRegimeShift = (): void => this.render();

  mount(parent: HTMLElement): void {
    parent.prepend(this.element);
    this.unsubscribe = unifiedAlertStore.subscribe(() => this.render());
    this.refreshTimer = window.setInterval(() => this.render(), 30_000);
    document.addEventListener(REGIME_SHIFT_EVENT, this.onRegimeShift);
    this.render();
  }

  destroy(): void {
    this.unsubscribe?.();
    if (this.refreshTimer != null) window.clearInterval(this.refreshTimer);
    document.removeEventListener(REGIME_SHIFT_EVENT, this.onRegimeShift);
    this.presetMenuCleanup?.();
    this.element.remove();
  }

  getElement(): HTMLElement { return this.element; }

  private render(): void {
    // Any open preset popover belongs to the DOM we're about to replace —
    // close it first so its document-level listeners don't leak.
    this.presetMenuCleanup?.();
    const all = rankAlerts(unifiedAlertStore.getAll());
    const ranked = this.facet === 'all'
      ? all
      : all.filter(a => SOURCE_DOMAIN[a.source] === this.facet || a.source === 'correlation');

    // Story-based grouping: cluster related alerts into narratives.
    const stories = groupIntoStories(ranked).slice(0, MAX_VISIBLE);

    // Active BOCPD change-points (empty when quiet or kill-switched off).
    // A live regime shift keeps the bar visible even with no hot alerts —
    // it is exactly the "something changed" condition the bar exists for.
    const regimeShifts = getActiveRegimeShifts();
    const regimeDomains = Object.keys(regimeShifts) as ForecastDomain[];

    if (stories.length === 0 && this.facet === 'all' && regimeDomains.length === 0) {
      this.element.hidden = true;
      this.element.replaceChildren();
      document.body.classList.remove('has-triage-bar');
      return;
    }
    this.element.hidden = false;
    document.body.classList.add('has-triage-bar');
    const label = document.createElement('div');
    label.className = 'triage-bar-label';
    label.textContent = '⚡ TRIAGE';
    // Domain facet pills
    const facets = document.createElement('div');
    facets.className = 'triage-bar-facets';
    for (const d of Object.keys(DOMAIN_LABELS) as Domain[]) {
      const pill = document.createElement('button');
      pill.className = `triage-facet${this.facet === d ? ' active' : ''}`;
      pill.dataset.facet = d;
      pill.textContent = DOMAIN_LABELS[d];
      facets.append(pill);
    }
    // Amber regime-shift chips after the facet pills; absent when quiet.
    for (const domain of regimeDomains) {
      const shift = regimeShifts[domain];
      if (!shift) continue;
      const chip = document.createElement('button');
      chip.className = 'triage-regime-chip';
      chip.type = 'button';
      const pct = Math.round(shift.changeProbability * 100);
      chip.textContent = `Regime shift: ${domain} (${pct}%)`;
      chip.title = `${shift.explanation}\n\nClick to open the Analyst HUD posture advisories.`;
      chip.setAttribute('aria-label', `Regime shift detected in ${domain}, confidence ${pct} percent. Open Analyst HUD.`);
      facets.append(chip);
    }
    const items = document.createElement('div');
    items.className = 'triage-bar-items';
    for (const story of stories) {
      items.append(this.makeStoryItem(story));
    }
    const ack = document.createElement('button');
    ack.className = 'triage-bar-ack';
    ack.id = 'triageAckAll';
    ack.title = 'Acknowledge all visible';
    ack.textContent = 'Ack all';
    this.visibleStories = stories;
    // No "Ack all" when only a regime chip is showing — nothing to ack.
    const tail = stories.length > 0 ? [ack] : [];
    this.element.replaceChildren(label, facets, items, ...tail, this.buildPresetControl());
  }

  /**
   * Alerting-preset control: an anchored popover menu listing all three
   * presets with a checkmark on the active one (replaces the old blind
   * cycle button). Esc / outside-click closes; arrow keys rove.
   */
  private buildPresetControl(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'triage-preset-wrap';

    const btn = document.createElement('button');
    btn.className = 'triage-bar-preset';
    btn.dataset.action = 'preset-toggle';
    btn.title = 'Alerting preset';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    const syncBtn = (): void => {
      const meta = PRESET_META[getPreset()];
      // safe-html: icon() output and preset labels are static strings.
      btn.innerHTML = `${icon(meta.icon, { size: 14 })} ${meta.label}`;
    };
    syncBtn();

    const openMenu = (): void => {
      const menu = document.createElement('div');
      menu.className = 'triage-preset-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', 'Alerting preset');

      const items: HTMLButtonElement[] = PRESET_ORDER.map((preset) => {
        const meta = PRESET_META[preset];
        const item = document.createElement('button');
        item.className = 'triage-preset-item';
        item.setAttribute('role', 'menuitemradio');
        const active = getPreset() === preset;
        item.setAttribute('aria-checked', String(active));
        item.tabIndex = -1;
        item.title = meta.desc;
        // safe-html: static icon/label strings only.
        item.innerHTML =
          `<span class="triage-preset-check" aria-hidden="true">${active ? '✓' : ''}</span>` +
          `${icon(meta.icon, { size: 14 })}<span>${meta.label}</span>`;
        item.addEventListener('click', () => {
          setPreset(preset);
          syncBtn();
          this.closePresetMenu();
          btn.focus();
        });
        menu.append(item);
        return item;
      });

      let focusIdx = Math.max(0, PRESET_ORDER.indexOf(getPreset()));
      const focusItem = (i: number): void => {
        focusIdx = (i + items.length) % items.length;
        items[focusIdx]?.focus();
      };
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') { e.preventDefault(); this.closePresetMenu(); btn.focus(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(focusIdx + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(focusIdx - 1); }
        else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
        else if (e.key === 'End') { e.preventDefault(); focusItem(items.length - 1); }
        else if (e.key === 'Tab') { this.closePresetMenu(); }
      };
      const onOutside = (e: MouseEvent): void => {
        if (!wrap.contains(e.target as Node)) this.closePresetMenu();
      };
      menu.addEventListener('keydown', onKey);
      document.addEventListener('mousedown', onOutside);
      wrap.append(menu);
      btn.setAttribute('aria-expanded', 'true');
      this.presetMenuCleanup = () => {
        document.removeEventListener('mousedown', onOutside);
        menu.remove();
        btn.setAttribute('aria-expanded', 'false');
        this.presetMenuCleanup = null;
      };
      focusItem(focusIdx);
    };

    // Opened via the delegated preset-toggle branch in onClick (the btn lives
    // inside replaceChildren, so a per-node listener would be orphaned).
    this.openPresetMenu = openMenu;

    wrap.append(btn);
    return wrap;
  }

  private closePresetMenu(): void {
    this.presetMenuCleanup?.();
  }

  private makeStoryItem(story: AlertStory): HTMLElement {
    const a = story.leadAlert;
    const el = document.createElement('div');
    el.className = `triage-bar-item triage-sev-${a.severity}`;
    el.dataset.alertId = a.id;

    const phase = getLifecyclePhase(a.id);
    const PHASE_ICON: Record<LifecyclePhase, string> = { rising: '↑', peaked: '●', cooling: '↓', resolved: '○' };

    const sb = scoreBreakdown(a);
    el.title =
      `${a.body}\n\nscore ${sb.total.toFixed(1)}\nlifecycle: ${phase}\n(right-click to snooze)`;
    const ageMin = Math.max(0, Math.round((Date.now() - a.timestamp) / 60_000));
    const ageLabel = ageMin < 1 ? 'now' : formatDurationMinutes(ageMin);
    const dot = document.createElement('span'); dot.className = 'triage-sev-dot';
    const lc = document.createElement('span'); lc.className = `triage-lifecycle triage-lc-${phase}`;
    lc.textContent = PHASE_ICON[phase];
    lc.title = phase;
    const src = document.createElement('span'); src.className = 'triage-source';
    src.textContent = story.alerts.length > 1 ? `${story.label} (${story.alerts.length})` : a.source;
    const title = document.createElement('span'); title.className = 'triage-title'; title.textContent = a.title;
    const age = document.createElement('span'); age.className = 'triage-age'; age.textContent = ageLabel;
    const spark = this.buildSparkline(a.id);
    const esc = estimateEscalation(a);
    const elements: (HTMLElement | SVGSVGElement)[] = [dot, lc, src, title, spark];
    if (esc.likelyToEscalate) {
      const escBadge = document.createElement('span');
      escBadge.className = 'triage-esc-badge';
      escBadge.textContent = `\u26A0 ${esc.probability}%`;
      escBadge.title = `${esc.probability}% chance of escalating to critical`;
      elements.push(escBadge);
    }
    elements.push(age);

    // Dismiss button — acknowledges all alerts in the story
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'triage-dismiss-btn';
    dismissBtn.dataset.action = 'dismiss';
    dismissBtn.textContent = '×';
    dismissBtn.title = 'Dismiss';
    elements.push(dismissBtn);

    el.append(...elements);
    // Click / contextmenu are handled by the delegated listeners on
    // this.element (see onClick / onContextMenu); the item carries its identity
    // via el.dataset.alertId so the handler resolves the story from
    // this.visibleStories. This survives the ~1/s replaceChildren re-render.
    return el;
  }

  /** Resolve the story a delegated event landed on, via the item's alertId. */
  private storyFor(item: HTMLElement | null): AlertStory | undefined {
    const id = item?.dataset.alertId;
    return id ? this.visibleStories.find(s => s.leadAlert.id === id) : undefined;
  }

  /** Navigate / entity-filter / correlation for a clicked story item. */
  private activateStory(story: AlertStory): void {
    const a = story.leadAlert;
    if (story.alerts.length > 1 && story.entityName) {
      document.dispatchEvent(new CustomEvent('cb:entity-filter', {
        detail: { entity: story.entityName, alertIds: story.alerts.map(sa => sa.id) },
      }));
      return;
    }
    if (a.source === 'correlation' && a.correlationMembers && a.correlationMembers.length > 0) {
      this.showCorrelationDetails(a);
      return;
    }
    const panelId = panelForAlert(a);
    jumpToPanel(panelId);
    flashPanel(panelId);
    document.dispatchEvent(new CustomEvent('cb:show-related', { detail: { alertId: a.id, title: a.title } }));
    if (a.location) {
      document.dispatchEvent(new CustomEvent('cb:focus-map', {
        detail: { lat: a.location.lat, lon: a.location.lon, zoom: 5 },
      }));
      pulseAlertOnMap(a);
    }
  }

  /** Single delegated click handler on the stable root (Defect B1). */
  private onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    // Dismiss handled before the item branch so it doesn't also navigate;
    // stopPropagation preserves the prior per-node behavior.
    if (t.closest('.triage-dismiss-btn')) { e.stopPropagation(); this.dismissStory(t.closest<HTMLElement>('.triage-bar-item')); return; }
    const facet = t.closest<HTMLElement>('.triage-facet[data-facet]');
    if (facet) { this.selectFacet(facet.dataset.facet as Domain); return; }
    if (t.closest('.triage-bar-ack')) { this.ackAllVisible(); return; }
    if (t.closest('.triage-regime-chip')) {
      // The regime detail lives in the Analyst HUD posture advisories.
      document.dispatchEvent(new CustomEvent('cb:toggle-analyst-hud'));
      return;
    }
    if (t.closest('.triage-bar-preset')) { this.togglePresetMenu(); return; }
    const story = this.storyFor(t.closest<HTMLElement>('.triage-bar-item'));
    if (story) this.activateStory(story);
  }

  private dismissStory(item: HTMLElement | null): void {
    const story = this.storyFor(item);
    if (story) unifiedAlertStore.acknowledgeMany(story.alerts.map(a => a.id));
  }

  private selectFacet(facet: Domain): void {
    this.facet = facet;
    saveFacet(facet);
    this.render();
  }

  private ackAllVisible(): void {
    const ids: string[] = [];
    for (const story of this.visibleStories) for (const a of story.alerts) ids.push(a.id);
    unifiedAlertStore.acknowledgeMany(ids);
  }

  private togglePresetMenu(): void {
    if (this.presetMenuCleanup) this.closePresetMenu();
    else this.openPresetMenu?.();
  }

  /** Delegated contextmenu (snooze) for story items (Defect B1). */
  private onContextMenu(e: MouseEvent): void {
    const story = this.storyFor((e.target as HTMLElement | null)?.closest<HTMLElement>('.triage-bar-item') ?? null);
    if (!story) return;
    e.preventDefault();
    this.showContextMenu(e, story.leadAlert);
  }

  private buildSparkline(alertId: string): SVGSVGElement {
    const samples = getLifecycleSamples(alertId);
    const w = 40; const h = 16;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.classList.add('triage-sparkline');
    if (samples.length < 2) return svg;
    const max = Math.max(...samples, 1);
    const pts = samples.map((s, i) => {
      const x = (i / (samples.length - 1)) * w;
      const y = h - (s / max) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    path.setAttribute('points', pts.join(' '));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    return svg;
  }

  private showCorrelationDetails(a: UnifiedAlert): void {
    const all = unifiedAlertStore.getAll();
    const byId = new Map(all.map(x => [x.id, x]));
    const memberIds = a.correlationMembers ?? [];
    const members = memberIds.map(id => byId.get(id)).filter((x): x is UnifiedAlert => !!x);
    const staleCount = memberIds.length - members.length;
    const overlay = document.createElement('div');
    overlay.className = 'corr-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const card = document.createElement('div');
    card.className = 'corr-card';
    const h = document.createElement('div'); h.className = 'corr-header';
    const title = document.createElement('h3'); title.textContent = a.title;
    const close = document.createElement('button'); close.className = 'corr-close'; close.textContent = '✕';
    close.addEventListener('click', () => overlay.remove());
    h.append(title, close);
    const meta = document.createElement('div'); meta.className = 'corr-meta';
    const pair = a.correlationPair ? `${a.correlationPair[0]} → ${a.correlationPair[1]}` : '—';
    meta.textContent = `Causal pair: ${pair}  ·  members: ${members.length}${staleCount > 0 ? ` (${staleCount} expired)` : ''}  ·  confidence ${a.relevanceScore}%`;
    const list = document.createElement('div'); list.className = 'corr-list';
    for (const m of members) {
      const row = document.createElement('div'); row.className = 'corr-row';
      const src = document.createElement('span'); src.className = 'corr-row-src'; src.textContent = m.source;
      const mt = document.createElement('span'); mt.className = 'corr-row-title'; mt.textContent = m.title;
      row.append(src, mt);
      row.addEventListener('click', () => {
        const pid = panelForAlert(m);
        jumpToPanel(pid); flashPanel(pid);
        if (m.location) {
          document.dispatchEvent(new CustomEvent('cb:focus-map', { detail: { lat: m.location.lat, lon: m.location.lon, zoom: 5 } }));
          pulseAlertOnMap(m);
        }
        overlay.remove();
      });
      list.append(row);
    }
    card.append(h, meta, list);
    overlay.append(card);
    document.body.append(overlay);
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
    };
    document.addEventListener('keydown', onKey);
  }

  private showContextMenu(e: MouseEvent, alert: UnifiedAlert): void {
    document.querySelectorAll('.triage-snooze-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'triage-snooze-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    const snoozeAndRecord = (ms: number) => {
      unifiedAlertStore.snooze(alert.id, ms);
      recordSnooze(alert.source, alert.severity, ms);
    };
    const items: [string, () => void][] = [
      ['Snooze 15 min', () => snoozeAndRecord(15 * 60_000)],
      ['Snooze 1 hour', () => snoozeAndRecord(60 * 60_000)],
      ['Snooze until tomorrow', () => snoozeAndRecord(12 * 60 * 60_000)],
    ];
    const suggested = getSnoozeSuggestion(alert.source, alert.severity);
    if (suggested) {
      items.unshift([`Snooze ${formatSnoozeDuration(suggested)} (learned)`, () => snoozeAndRecord(suggested)]);
    }
    items.push(
      ['Pin to top', () => unifiedAlertStore.togglePin(alert.id)],
      ['Annotate', () => {
        const existing = getAnnotation(alert.id) ?? '';
        const note = prompt('Add note to this alert:', existing);
        if (note !== null) setAnnotation(alert.id, note);
      }],
      ['Bookmark', () => {
        const cols = getCollections();
        if (cols.length === 0) {
          const name = prompt('Create a collection name:', 'Important');
          if (name) {
            const col = createCollection(name);
            addToCollection(col.id, alert.id);
          }
        } else {
          const names = cols.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
          const choice = prompt(`Add to collection:\n${names}\n\nEnter number (or new name):`, '1');
          if (choice) {
            const idx = Number.parseInt(choice, 10) - 1;
            if (idx >= 0 && idx < cols.length) {
              addToCollection(cols[idx]!.id, alert.id);
            } else {
              const col = createCollection(choice);
              addToCollection(col.id, alert.id);
            }
          }
        }
      }],
      ['Watch this entity', () => {
        const list = getWatchlist();
        list.push({
          id: `wl-${Date.now()}`,
          label: alert.title.slice(0, 40),
          keywords: [alert.title.split(/[—:·,]/)[0]?.trim() ?? alert.title.slice(0, 20)],
          lat: alert.location?.lat,
          lon: alert.location?.lon,
          radiusKm: alert.location ? 100 : undefined,
        });
        saveWatchlist(list);
      }],
    );
    for (const [label, action] of items) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.addEventListener('click', () => { action(); menu.remove(); });
      menu.append(btn);
    }
    document.body.append(menu);
    const dismiss = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        document.removeEventListener('mousedown', dismiss);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  }
}
