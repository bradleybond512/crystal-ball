 
import type { DigestStoryCard } from '@/services/digest-alert-projection';

export type DigestOverlayStatus = 'loading' | 'empty' | 'degraded' | 'error';

export interface DigestOverlayOptions {
  onDismiss?: () => void;
}

const TITLE_ID = 'digest-dialog-title';
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Full-bleed, locally projected "since you last looked" dialog. */
export class DigestOverlay {
  private readonly overlay: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly liveEl: HTMLElement;
  private readonly onDismiss: (() => void) | null;
  private previouslyFocused: HTMLElement | null = null;
  private destroyed = false;

  private readonly onBackdropClick = (event: MouseEvent): void => {
    if (event.target === this.overlay) this.hide();
  };

  private readonly onCloseClick = (): void => this.hide();

  private readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (!this.isVisible()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.hide();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...this.overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
      .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    if (focusable.length === 0) {
      event.preventDefault();
      this.overlay.focus();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !this.overlay.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !this.overlay.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  constructor(options: DigestOverlayOptions = {}) {
    this.onDismiss = options.onDismiss ?? null;
    this.overlay = document.createElement('div');
    this.overlay.className = 'digest-overlay';
    this.overlay.hidden = true;
    this.overlay.tabIndex = -1;
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-labelledby', TITLE_ID);
    this.overlay.addEventListener('click', this.onBackdropClick);

    const card = document.createElement('div');
    card.className = 'digest-card';

    const header = document.createElement('div');
    header.className = 'digest-header';
    const title = document.createElement('h2');
    title.id = TITLE_ID;
    title.textContent = 'Crystal Ball — Since you last looked';
    this.closeButton = document.createElement('button');
    this.closeButton.type = 'button';
    this.closeButton.className = 'digest-close';
    this.closeButton.setAttribute('aria-label', 'Close since-you-last-looked brief');
    this.closeButton.textContent = '✕';
    this.closeButton.addEventListener('click', this.onCloseClick);
    header.append(title, this.closeButton);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'digest-body';

    this.liveEl = document.createElement('div');
    this.liveEl.className = 'digest-live';
    this.liveEl.setAttribute('aria-live', 'polite');
    this.liveEl.setAttribute('aria-atomic', 'true');

    const footer = document.createElement('div');
    footer.className = 'digest-footer';
    footer.textContent = 'Press Esc to dismiss';

    card.append(header, this.bodyEl, this.liveEl, footer);
    this.overlay.append(card);
    document.addEventListener('keydown', this.onDocumentKeyDown);
  }

  mount(parent: HTMLElement): void {
    if (!this.destroyed) parent.append(this.overlay);
  }

  show(cards: readonly DigestStoryCard[]): void {
    if (cards.length === 0) {
      this.showStatus('No recent activity to summarize.', 'empty');
      return;
    }
    this.renderCards(cards);
    this.open();
  }

  update(cards: readonly DigestStoryCard[]): void {
    if (!this.isVisible()) return;
    this.renderCards(cards);
    this.liveEl.textContent = cards.length === 1
      ? 'Brief updated for current alerts and saved places.'
      : `${cards.length} brief items updated for current alerts and saved places.`;
  }

  showStatus(message: string, status: DigestOverlayStatus = 'loading'): void {
    const statusEl = document.createElement('p');
    statusEl.className = `digest-status digest-status-${status}`;
    statusEl.setAttribute('role', status === 'error' ? 'alert' : 'status');
    statusEl.textContent = message;
    this.bodyEl.replaceChildren(statusEl);
    this.liveEl.textContent = '';
    this.open();
  }

  isVisible(): boolean {
    return !this.destroyed && !this.overlay.hidden;
  }

  hide(): void {
    this.close(true);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.close(false);
    this.destroyed = true;
    document.removeEventListener('keydown', this.onDocumentKeyDown);
    this.overlay.removeEventListener('click', this.onBackdropClick);
    this.closeButton.removeEventListener('click', this.onCloseClick);
    this.overlay.remove();
  }

  private close(notifyOwner: boolean): void {
    if (!this.isVisible()) return;
    this.overlay.hidden = true;
    const restoreTarget = this.previouslyFocused;
    this.previouslyFocused = null;
    if (restoreTarget?.isConnected) restoreTarget.focus();
    if (notifyOwner) this.onDismiss?.();
  }

  private open(): void {
    if (this.destroyed) return;
    if (this.overlay.hidden) {
      const active = document.activeElement;
      this.previouslyFocused = active instanceof HTMLElement ? active : null;
    }
    this.overlay.hidden = false;
    this.closeButton.focus();
  }

  private renderCards(cards: readonly DigestStoryCard[]): void {
    const fragment = document.createDocumentFragment();
    cards.forEach((story, index) => {
      const article = document.createElement('article');
      article.className = 'digest-story';
      article.dataset.impactStatus = story.impactStatus;

      const heading = document.createElement('h3');
      heading.id = `digest-story-heading-${index + 1}`;
      heading.textContent = story.headline;
      article.setAttribute('aria-labelledby', heading.id);

      const narrative = document.createElement('p');
      narrative.className = 'digest-story-narrative';
      narrative.textContent = story.narrative;

      const location = document.createElement('p');
      location.className = 'digest-story-context digest-story-location';
      location.dataset.digestLocation = '';
      location.textContent = story.locationText;

      const impact = document.createElement('p');
      impact.className = 'digest-story-context digest-story-impact';
      impact.dataset.digestImpact = '';
      impact.textContent = story.impactText;

      article.append(heading, narrative, location, impact);
      fragment.append(article);
    });
    this.bodyEl.replaceChildren(fragment);
    this.liveEl.textContent = '';
  }
}
