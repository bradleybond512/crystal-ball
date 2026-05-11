/**
 * HelpOverlay — ⌘/ keyboard shortcut reference card.
 *
 * Reads bindings from a `ShortcutRegistry` so the card always reflects what's
 * actually wired (no separate static list to drift out of sync).
 */

import type { ShortcutRegistry, ShortcutBinding } from '@/services/keyboard/shortcut-registry';

export class HelpOverlay {
  private overlay: HTMLElement;
  private card: HTMLElement;
  private visible = false;
  private registry: ShortcutRegistry;

  constructor(registry: ShortcutRegistry) {
    this.registry = registry;
    this.overlay = document.createElement('div');
    this.overlay.className = 'help-overlay';
    this.overlay.hidden = true;
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-label', 'Keyboard shortcuts');

    this.card = document.createElement('div');
    this.card.className = 'help-card';

    const header = document.createElement('div');
    header.className = 'help-header';
    const title = document.createElement('h2');
    title.textContent = 'Keyboard shortcuts';
    const close = document.createElement('button');
    close.className = 'help-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', () => this.hide());
    header.append(title, close);

    const body = document.createElement('div');
    body.className = 'help-body';
    this.card.append(header, body);
    this.overlay.append(this.card);
    this.overlay.addEventListener('click', e => { if (e.target === this.overlay) this.hide(); });
  }

  mount(parent: HTMLElement): void { parent.append(this.overlay); }

  toggle(): void { if (this.visible) this.hide(); else this.show(); }

  show(): void {
    this.visible = true;
    this.overlay.hidden = false;
    this.renderBody();
  }

  hide(): void {
    this.visible = false;
    this.overlay.hidden = true;
  }

  private renderBody(): void {
    const body = this.card.querySelector<HTMLElement>('.help-body');
    if (!body) return;
    body.replaceChildren();
    const groups = new Map<string, ShortcutBinding[]>();
    for (const b of this.registry.list()) {
      const arr = groups.get(b.group) ?? [];
      arr.push(b);
      groups.set(b.group, arr);
    }
    // Stable group order: Navigation, Panels, Actions, …
    const groupOrder = ['Navigation', 'Panels', 'Actions', 'Help'];
    const sortedGroups = [...groups.entries()].sort(([a], [b]) => {
      const ai = groupOrder.indexOf(a);
      const bi = groupOrder.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });
    for (const [group, bindings] of sortedGroups) {
      const section = document.createElement('div');
      section.className = 'help-section';
      const heading = document.createElement('h3');
      heading.className = 'help-section-title';
      heading.textContent = group;
      section.append(heading);
      const list = document.createElement('ul');
      list.className = 'help-list';
      const sortedBindings = [...bindings].sort((x, y) => x.label.localeCompare(y.label));
      for (const b of sortedBindings) {
        const li = document.createElement('li');
        li.className = 'help-row';
        const lbl = document.createElement('span');
        lbl.className = 'help-label';
        lbl.textContent = b.label;
        const kbd = document.createElement('kbd');
        kbd.className = 'help-kbd';
        kbd.textContent = b.display;
        li.append(lbl, kbd);
        list.append(li);
      }
      section.append(list);
      body.append(section);
    }
    if (groups.size === 0) {
      const empty = document.createElement('p');
      empty.className = 'help-empty';
      empty.textContent = 'No shortcuts registered.';
      body.append(empty);
    }
  }
}
