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

const MAX_VISIBLE = 5;

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

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'triage-bar';
    this.element.id = 'triageBar';
    this.element.hidden = true;
  }

  mount(parent: HTMLElement): void {
    parent.prepend(this.element);
    this.unsubscribe = unifiedAlertStore.subscribe(() => this.render());
    this.refreshTimer = window.setInterval(() => this.render(), 30_000);
    this.render();
  }

  destroy(): void {
    this.unsubscribe?.();
    if (this.refreshTimer != null) window.clearInterval(this.refreshTimer);
    this.element.remove();
  }

  getElement(): HTMLElement { return this.element; }

  private render(): void {
    const all = rankAlerts(unifiedAlertStore.getAll());
    const ranked = this.facet === 'all'
      ? all
      : all.filter(a => SOURCE_DOMAIN[a.source] === this.facet || a.source === 'correlation');

    // Story-based grouping: cluster related alerts into narratives.
    const stories = groupIntoStories(ranked).slice(0, MAX_VISIBLE);

    if (stories.length === 0 && this.facet === 'all') {
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
      pill.textContent = DOMAIN_LABELS[d];
      pill.addEventListener('click', () => {
        this.facet = d;
        saveFacet(d);
        this.render();
      });
      facets.append(pill);
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
    ack.addEventListener('click', () => {
      const ids: string[] = [];
      for (const story of stories) {
        for (const a of story.alerts) ids.push(a.id);
      }
      unifiedAlertStore.acknowledgeMany(ids);
    });
    const presetBtn = document.createElement('button');
    presetBtn.className = 'triage-bar-preset';
    presetBtn.title = 'Cycle alerting preset (Loud → Visual → Silent)';
    const PRESET_LABEL: Record<AlertingPreset, string> = { loud: '🔊 Loud', visual: '👁 Visual', silent: '🤫 Silent' };
    const PRESET_NEXT: Record<AlertingPreset, AlertingPreset> = { loud: 'visual', visual: 'silent', silent: 'loud' };
    presetBtn.textContent = PRESET_LABEL[getPreset()];
    presetBtn.addEventListener('click', () => {
      setPreset(PRESET_NEXT[getPreset()]);
      presetBtn.textContent = PRESET_LABEL[getPreset()];
    });
    this.element.replaceChildren(label, facets, items, ack, presetBtn);
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
    dismissBtn.textContent = '×';
    dismissBtn.title = 'Dismiss';
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      unifiedAlertStore.acknowledgeMany(story.alerts.map(sa => sa.id));
    });
    elements.push(dismissBtn);

    el.append(...elements);
    el.addEventListener('click', () => {
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
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e as MouseEvent, a);
    });
    return el;
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
