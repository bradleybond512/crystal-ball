/**
 * CommandPalette — Cmd+K fuzzy launcher.
 *
 * Builds a static command list at open-time (panels, overlays, alerting
 * presets, common actions) plus a live alert list, and lets the user fuzzy
 * filter and run any of them with the keyboard.
 */

import { unifiedAlertStore } from '@/services/unified-alerts';
import { rankAlerts, panelForAlert } from '@/services/alert-routing';
import { flashPanel, jumpToPanel } from '@/services/alert-reactions';
import { setPreset } from '@/services/alerting-prefs';

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export class CommandPalette {
  private overlay: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private commands: Command[] = [];
  private filtered: Command[] = [];
  private cursor = 0;
  private visible = false;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'cmdk-overlay';
    this.overlay.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'cmdk-panel';

    this.input = document.createElement('input');
    this.input.className = 'cmdk-input';
    this.input.placeholder = 'Type a command…';
    this.input.addEventListener('input', () => { this.cursor = 0; this.refilter(); });
    this.input.addEventListener('keydown', (e) => this.onKey(e));

    this.list = document.createElement('div');
    this.list.className = 'cmdk-list';

    panel.append(this.input, this.list);
    this.overlay.append(panel);
    this.overlay.addEventListener('click', e => {
      if (e.target === this.overlay) this.hide();
    });
  }

  mount(parent: HTMLElement): void { parent.append(this.overlay); }

  toggle(): void { if (this.visible) this.hide(); else this.show(); }

  show(): void {
    this.commands = this.buildCommands();
    this.filtered = this.commands;
    this.cursor = 0;
    this.input.value = '';
    this.visible = true;
    this.overlay.hidden = false;
    this.renderList();
    setTimeout(() => this.input.focus(), 0);
  }

  hide(): void {
    this.visible = false;
    this.overlay.hidden = true;
  }

  private buildCommands(): Command[] {
    const cmds: Command[] = [
      { id: 'today', label: 'Open Today view', hint: '⌘⇧T', run: () => document.dispatchEvent(new CustomEvent('cb:toggle-today')) },
      { id: 'watchlist', label: 'Open Watchlist editor', hint: '⌘⇧W', run: () => document.dispatchEvent(new CustomEvent('cb:toggle-watchlist')) },
      { id: 'gv', label: "Toggle God's Vision", hint: 'G', run: () => document.dispatchEvent(new CustomEvent('cb:toggle-gods-vision')) },
      { id: 'preset-loud',   label: 'Alerting: Loud',   run: () => setPreset('loud') },
      { id: 'preset-visual', label: 'Alerting: Visual', run: () => setPreset('visual') },
      { id: 'preset-silent', label: 'Alerting: Silent', run: () => setPreset('silent') },
      { id: 'ack-all', label: 'Acknowledge ALL alerts', run: () => unifiedAlertStore.acknowledgeAll() },
    ];
    // Panels
    document.querySelectorAll<HTMLElement>('.mac-sidebar-panel-item[data-panel-key]').forEach(item => {
      const key = item.dataset.panelKey!;
      const name = item.textContent?.trim() ?? key;
      cmds.push({
        id: `panel:${key}`,
        label: `Jump to: ${name}`,
        run: () => { jumpToPanel(key); flashPanel(key); },
      });
    });
    // Top alerts
    for (const a of rankAlerts(unifiedAlertStore.getAll()).slice(0, 10)) {
      cmds.push({
        id: `alert:${a.id}`,
        label: `[${a.severity.toUpperCase()}] ${a.title}`,
        hint: a.source,
        run: () => { const pid = panelForAlert(a); jumpToPanel(pid); flashPanel(pid); },
      });
    }
    return cmds;
  }

  private refilter(): void {
    const q = this.input.value.trim().toLowerCase();
    if (q) {
      // Simple subsequence match scoring
      const terms = q.split(/\s+/);
      this.filtered = this.commands
        .map(c => {
          const hay = `${c.label} ${c.hint ?? ''}`.toLowerCase();
          const score = terms.every(t => hay.includes(t)) ? hay.length - q.length : -1;
          return { c, score };
        })
        .filter(x => x.score >= 0)
        .sort((a, b) => a.score - b.score)
        .map(x => x.c);
    }
    else { this.filtered = this.commands; }
    this.renderList();
  }

  private renderList(): void {
    this.list.replaceChildren();
    this.filtered.slice(0, 12).forEach((c, i) => {
      const row = document.createElement('button');
      row.className = `cmdk-row${i === this.cursor ? ' is-active' : ''}`;
      const label = document.createElement('span');
      label.className = 'cmdk-label';
      label.textContent = c.label;
      row.append(label);
      if (c.hint) {
        const hint = document.createElement('span');
        hint.className = 'cmdk-hint';
        hint.textContent = c.hint;
        row.append(hint);
      }
      row.addEventListener('click', () => { c.run(); this.hide(); });
      this.list.append(row);
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); this.hide(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.cursor = Math.min(this.cursor + 1, Math.max(0, Math.min(this.filtered.length, 12) - 1));
      this.renderList();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.cursor = Math.max(0, this.cursor - 1);
      this.renderList();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = this.filtered[this.cursor];
      if (cmd) { cmd.run(); this.hide(); }
    }
  }
}
