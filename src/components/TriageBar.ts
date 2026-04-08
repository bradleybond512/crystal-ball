/**
 * TriageBar — pinned strip showing the top 5 hottest active alerts.
 *
 * Subscribes to the unified alert store, ranks via alert-routing scoring,
 * and renders a clickable row that scrolls + flashes the source panel.
 * Auto-hides when there's nothing hot.
 */

import { unifiedAlertStore, type UnifiedAlert } from '@/services/unified-alerts';
import { rankAlerts, panelForAlert, scoreBreakdown } from '@/services/alert-routing';
import { flashPanel, jumpToPanel } from '@/services/alert-reactions';
import { getPreset, setPreset, type AlertingPreset } from '@/services/alerting-prefs';
import { getWatchlist, saveWatchlist } from '@/services/watchlist';

const MAX_VISIBLE = 5;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export class TriageBar {
  private element: HTMLElement;
  private unsubscribe: (() => void) | null = null;
  private refreshTimer: number | null = null;

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
    const ranked = rankAlerts(unifiedAlertStore.getAll());
    // Group consecutive alerts from the same source so storms collapse to one row.
    const grouped: Array<{ leader: UnifiedAlert; rest: UnifiedAlert[] }> = [];
    for (const a of ranked) {
      const last = grouped[grouped.length - 1];
      if (last && last.leader.source === a.source) last.rest.push(a);
      else grouped.push({ leader: a, rest: [] });
      if (grouped.length >= MAX_VISIBLE) break;
    }
    if (grouped.length === 0) {
      this.element.hidden = true;
      this.element.replaceChildren();
      return;
    }
    this.element.hidden = false;
    const label = document.createElement('div');
    label.className = 'triage-bar-label';
    label.textContent = '⚡ TRIAGE';
    const items = document.createElement('div');
    items.className = 'triage-bar-items';
    for (const g of grouped) items.appendChild(this.makeItem(g.leader, g.rest.length));
    const ack = document.createElement('button');
    ack.className = 'triage-bar-ack';
    ack.id = 'triageAckAll';
    ack.title = 'Acknowledge all visible';
    ack.textContent = 'Ack all';
    ack.addEventListener('click', () => {
      for (const g of grouped) {
        unifiedAlertStore.acknowledge(g.leader.id);
        for (const r of g.rest) unifiedAlertStore.acknowledge(r.id);
      }
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
    this.element.replaceChildren(label, items, ack, presetBtn);
  }

  private makeItem(a: UnifiedAlert, extraCount: number): HTMLElement {
    const el = document.createElement('div');
    el.className = `triage-bar-item triage-sev-${a.severity}`;
    el.dataset.alertId = a.id;
    const sb = scoreBreakdown(a);
    el.title =
      `${a.body}\n\n` +
      `score ${sb.total.toFixed(1)} = ` +
      `base ${sb.base} × decay ${sb.decay.toFixed(2)} × source ${sb.sourceMult} × ` +
      `prox ${sb.proximityMult} × watch ${sb.watchlistMult} × pin ${sb.pinMult}\n` +
      `(right-click to snooze)`;
    const ageMin = Math.max(0, Math.round((Date.now() - a.timestamp) / 60_000));
    const ageLabel = ageMin < 1 ? 'now' : ageMin < 60 ? `${ageMin}m` : `${Math.floor(ageMin / 60)}h`;
    const dot = document.createElement('span'); dot.className = 'triage-sev-dot';
    const src = document.createElement('span'); src.className = 'triage-source';
    src.textContent = extraCount > 0 ? `${a.source} +${extraCount}` : a.source;
    const title = document.createElement('span'); title.className = 'triage-title'; title.textContent = a.title;
    const age = document.createElement('span'); age.className = 'triage-age'; age.textContent = ageLabel;
    el.append(dot, src, title, age);
    el.addEventListener('click', () => {
      const panelId = panelForAlert(a);
      jumpToPanel(panelId);
      flashPanel(panelId);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e as MouseEvent, a);
    });
    void escapeHtml;
    return el;
  }

  private showContextMenu(e: MouseEvent, alert: UnifiedAlert): void {
    document.querySelectorAll('.triage-snooze-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'triage-snooze-menu';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    const items: Array<[string, () => void]> = [
      ['Snooze 15 min', () => unifiedAlertStore.snooze(alert.id, 15 * 60_000)],
      ['Snooze 1 hour', () => unifiedAlertStore.snooze(alert.id, 60 * 60_000)],
      ['Snooze until tomorrow', () => unifiedAlertStore.snooze(alert.id, 12 * 60 * 60_000)],
      ['Pin to top', () => unifiedAlertStore.togglePin(alert.id)],
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
    ];
    for (const [label, action] of items) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.addEventListener('click', () => { action(); menu.remove(); });
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    const dismiss = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        document.removeEventListener('mousedown', dismiss);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  }
}
