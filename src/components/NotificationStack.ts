/**
 * NotificationStack — single fixed-position column that owns all secondary
 * banners (staleness, offline, triage). Children render in priority order and
 * push each other down naturally. A ResizeObserver publishes the live height
 * as --notification-stack-h on :root so every content area shifts correctly
 * without manual class arithmetic.
 *
 * Z-index hierarchy:
 *   EEW bar          z: 9000  (unchanged — macOS window-chrome stand-in)
 *   NotificationStack z: 9001  (sits immediately below EEW bar)
 *
 * No child needs its own position:fixed — they flow as flex rows.
 */

const STACK_ID = 'cb-notification-stack';
const CSS_VAR = '--notification-stack-h';

export class NotificationStack {
  readonly element: HTMLDivElement;
  private ro: ResizeObserver | null = null;

  constructor() {
    const el = document.createElement('div');
    el.id = STACK_ID;
    Object.assign(el.style, {
      position: 'fixed',
      top: 'var(--eew-bar-h, 32px)',
      // Defaults to the viewport edge; desktop chrome overrides the var to the
      // sidebar width so banners stay inside the content area, not over the nav.
      left: 'var(--cb-notification-stack-left, 0px)',
      right: '0',
      zIndex: '9001',
      display: 'flex',
      flexDirection: 'column',
      pointerEvents: 'none', // individual children re-enable as needed
    });
    this.element = el;
  }

  mount(parent: HTMLElement = document.body): void {
    parent.append(this.element);
    this.ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        CSS_VAR,
        `${this.element.offsetHeight}px`,
      );
    });
    this.ro.observe(this.element);
    // Publish initial height synchronously.
    document.documentElement.style.setProperty(CSS_VAR, '0px');
  }

  destroy(): void {
    this.ro?.disconnect();
    this.element.remove();
    document.documentElement.style.removeProperty(CSS_VAR);
  }
}

export const notificationStack = new NotificationStack();
