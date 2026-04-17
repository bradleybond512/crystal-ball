 
/**
 * DigestOverlay — full-bleed welcome card showing the AI-generated
 * "since you last looked" digest. Replaces stuffing the digest into the
 * unified alert store as a pinned info row.
 */

export class DigestOverlay {
  private overlay: HTMLElement;
  private bodyEl: HTMLElement;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'digest-overlay';
    this.overlay.hidden = true;
    this.overlay.addEventListener('click', e => {
      if (e.target === this.overlay) this.hide();
    });

    const card = document.createElement('div');
    card.className = 'digest-card';

    const header = document.createElement('div');
    header.className = 'digest-header';
    const title = document.createElement('h2');
    title.textContent = 'Crystal Ball — Since you last looked';
    const close = document.createElement('button');
    close.className = 'digest-close';
    close.textContent = '✕';
    close.addEventListener('click', () => this.hide());
    header.append(title, close);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'digest-body';

    const footer = document.createElement('div');
    footer.className = 'digest-footer';
    footer.textContent = 'Press Esc to dismiss';

    card.append(header, this.bodyEl, footer);
    this.overlay.append(card);

    document.addEventListener('keydown', e => {
      if (!this.overlay.hidden && e.key === 'Escape') this.hide();
    });
  }

  mount(parent: HTMLElement): void {
    parent.append(this.overlay);
  }

  show(text: string): void {
    this.bodyEl.replaceChildren();
    // Render bullet lines with simple line-by-line layout.
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const row = document.createElement('div');
      row.className = 'digest-line';
      row.textContent = line.replace(/^[-•*]\s*/, '• ');
      this.bodyEl.append(row);
    }
    this.overlay.hidden = false;
  }

  hide(): void { this.overlay.hidden = true; }
}
