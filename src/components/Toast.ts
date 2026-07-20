import { isGhostMode } from '@/services/mode-manager';
import { animateIn, animateOut } from '@/services/motion';

const MAX_TOASTS = 3;
const DURATION_NORMAL = 8000;
const DURATION_CRITICAL = 15_000;

type Severity = 'critical' | 'high' | 'elevated' | 'normal';

/** Escalation order — an absorbed duplicate can only raise the visible severity. */
const SEVERITY_RANK: Record<Severity, number> = {
  normal: 0,
  elevated: 1,
  high: 2,
  critical: 3,
};

interface ToastOptions {
  title: string;
  message?: string;
  severity?: Severity;
  /**
   * One-sentence "why this matters" explanation from the Explain stage.
   * Shown below the message, truncated at 120 chars with a "…" expand link.
   */
  why?: string;
}

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: 'var(--severity-critical)',
  high: 'var(--severity-high)',
  elevated: 'var(--severity-elevated)',
  normal: 'var(--severity-normal)',
};

function getContainer(): HTMLElement {
  let el = document.getElementById('cb-toast-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cb-toast-container';
    Object.assign(el.style, {
      position: 'fixed',
      top: 'calc(env(safe-area-inset-top, 0px) + 52px)',
      right: '16px',
      // Above the Home Shell overlay (10000) + its Library/digest/corr layers
      // (10001-10003), below ⌘K (10005). Alert toasts are safety chrome — at
      // the old 9500 they rendered BEHIND the shell, so the map swallowed every
      // click and the × was unreachable (toasts you couldn't dismiss).
      zIndex: '10004', // --z-toast
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      pointerEvents: 'none',
    });
    document.body.append(el);
  }
  return el;
}

const activeToasts: Toast[] = [];

export class Toast {
  private el: HTMLElement;
  private progress: HTMLElement;
  private titleEl: HTMLElement | null = null;
  private counterEl: HTMLElement | null = null;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private startTime = 0;
  private remaining: number;
  private duration: number;
  private dismissed = false;
  private severity: Severity;
  /** How many identical (title+message) toasts this one represents. */
  private occurrences = 1;
  private readonly key: string;

  constructor(private options: ToastOptions) {
    this.severity = options.severity ?? 'normal';
    this.duration = this.severity === 'critical' ? DURATION_CRITICAL : DURATION_NORMAL;
    this.remaining = this.duration;
    // Dedupe on the visible string only (title+message): two alerts that
    // map to the same on-screen text must never stack twice. A severity
    // escalation or changed "why" restyles the existing toast in place
    // (see absorb()) instead of spawning an identical-looking duplicate.
    this.key = `${options.title}\u0000${options.message ?? ''}`;

    this.el = this.build(this.severity);
    this.progress = this.el.querySelector('.cb-toast-progress') as HTMLElement;
  }

  private build(severity: Severity): HTMLElement {
    const color = SEVERITY_COLORS[severity];

    const el = document.createElement('div');
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'assertive');
    Object.assign(el.style, {
      pointerEvents: 'all',
      background: 'rgba(28, 28, 30, 0.92)',
      backdropFilter: 'blur(20px) saturate(1.4)',
      WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
      borderRadius: 'var(--r-md, 12px)',
      boxShadow: 'var(--elevation-3)',
      borderLeft: `3px solid ${color}`,
      minWidth: '280px',
      maxWidth: '360px',
      overflow: 'hidden',
      fontFamily: 'var(--font-ui)',
      cursor: 'default',
      position: 'relative',
    });

    const body = document.createElement('div');
    Object.assign(body.style, {
      padding: '12px 36px 12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
    });

    const title = document.createElement('div');
    title.textContent = this.options.title;
    Object.assign(title.style, {
      fontSize: 'var(--text-sm, 13px)',
      fontWeight: 'var(--fw-medium, 500)',
      color: color,
      lineHeight: '1.3',
    });
    this.titleEl = title;

    body.append(title);

    if (this.options.message) {
      const msg = document.createElement('div');
      msg.textContent = this.options.message;
      Object.assign(msg.style, {
        fontSize: 'var(--text-xs, 11px)',
        color: 'rgba(255,255,255,0.65)',
        lineHeight: '1.4',
      });
      body.append(msg);
    }

    if (this.options.why) {
      const WHY_LIMIT = 120;
      const full = this.options.why;
      const truncated = full.length > WHY_LIMIT ? `${full.slice(0, WHY_LIMIT - 1)}…` : full;
      const isLong = full.length > WHY_LIMIT;

      const whyEl = document.createElement('div');
      Object.assign(whyEl.style, {
        fontSize: 'var(--text-xs, 11px)',
        color: 'rgba(255,255,255,0.50)',
        lineHeight: '1.4',
        marginTop: '3px',
        fontStyle: 'italic',
      });

      const textSpan = document.createElement('span');
      textSpan.textContent = truncated;
      whyEl.append(textSpan);

      if (isLong) {
        let expanded = false;
        const expandBtn = document.createElement('button');
        expandBtn.textContent = ' more';
        Object.assign(expandBtn.style, {
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.45)',
          fontSize: 'var(--text-xs, 11px)',
          cursor: 'pointer',
          padding: '0',
          textDecoration: 'underline',
        });
        expandBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          expanded = !expanded;
          textSpan.textContent = expanded ? full : truncated;
          expandBtn.textContent = expanded ? ' less' : ' more';
        });
        whyEl.append(expandBtn);
      }

      body.append(whyEl);
    }

    const dismiss = document.createElement('button');
    dismiss.textContent = '×';
    Object.assign(dismiss.style, {
      position: 'absolute',
      top: '8px',
      right: '10px',
      background: 'none',
      border: 'none',
      color: 'rgba(255,255,255,0.4)',
      fontSize: '16px',
      lineHeight: '1',
      cursor: 'pointer',
      padding: '0',
    });
    dismiss.addEventListener('click', () => this.dismiss());

    const progress = document.createElement('div');
    progress.className = 'cb-toast-progress';
    Object.assign(progress.style, {
      height: '2px',
      background: color,
      width: '100%',
      transformOrigin: 'left',
      transition: `transform ${this.duration}ms linear`,
    });

    el.append(body);
    el.append(dismiss);
    el.append(progress);

    el.addEventListener('mouseenter', () => this.pause());
    el.addEventListener('mouseleave', () => this.resume());

    return el;
  }

  show(): void {
    if (isGhostMode()) return;

    // Suppress duplicates already on screen — the existing toast absorbs
    // this one (×N counter + refreshed countdown + severity escalation)
    // instead of stacking an identical copy.
    const dup = activeToasts.find((t) => t.key === this.key && !t.dismissed);
    if (dup) {
      dup.absorb(this.options);
      return;
    }

    // Evict oldest if at max
    while (activeToasts.length >= MAX_TOASTS) {
      activeToasts[0]?.dismiss();
    }

    activeToasts.push(this);
    const container = getContainer();
    container.append(this.el);
    void animateIn(this.el, 'slide-right');

    // Kick off progress bar shrink on next frame
    requestAnimationFrame(() => {
      this.progress.style.transform = 'scaleX(0)';
    });

    this.startTimer();
  }

  private startTimer(): void {
    this.startTime = performance.now();
    this.timerId = setTimeout(() => this.dismiss(), this.remaining);
  }

  pause(): void {
    if (this.dismissed || this.timerId === null) return;
    clearTimeout(this.timerId);
    this.timerId = null;
    this.remaining -= performance.now() - this.startTime;
    // Freeze progress bar
    const elapsed = this.duration - this.remaining;
    const fraction = elapsed / this.duration;
    this.progress.style.transition = 'none';
    this.progress.style.transform = `scaleX(${1 - fraction})`;
  }

  resume(): void {
    if (this.dismissed || this.timerId !== null) return;
    // Resume progress bar
    this.progress.style.transition = `transform ${this.remaining}ms linear`;
    this.progress.style.transform = 'scaleX(0)';
    this.startTimer();
  }

  /** Restart the auto-dismiss countdown — used when a duplicate is suppressed
   *  so the still-relevant toast stays on screen instead of expiring. */
  refresh(): void {
    if (this.dismissed) return;
    this.remaining = this.duration;
    // Paused under hover (timerId cleared by pause()): refill the budget but stay
    // frozen — resume() will restart the countdown with the fresh duration.
    if (this.timerId === null) {
      this.progress.style.transition = 'none';
      this.progress.style.transform = 'scaleX(1)';
      return;
    }
    clearTimeout(this.timerId);
    this.progress.style.transition = 'none';
    this.progress.style.transform = 'scaleX(1)';
    requestAnimationFrame(() => {
      this.progress.style.transition = `transform ${this.duration}ms linear`;
      this.progress.style.transform = 'scaleX(0)';
    });
    this.startTimer();
  }

  /**
   * Merge a duplicate (same title+message) into this on-screen toast:
   * bump the "×N" counter, restart the countdown, and — when the new copy
   * carries a higher severity — escalate the accent styling in place so a
   * repeat at critical is never hidden behind a stale lower tier.
   */
  absorb(options: ToastOptions): void {
    if (this.dismissed) return;
    this.occurrences += 1;
    this.renderCounter();

    const incoming = options.severity ?? 'normal';
    if (SEVERITY_RANK[incoming] > SEVERITY_RANK[this.severity]) {
      this.severity = incoming;
      const color = SEVERITY_COLORS[incoming];
      this.el.style.borderLeft = `3px solid ${color}`;
      if (this.titleEl) this.titleEl.style.color = color;
      this.progress.style.background = color;
      if (incoming === 'critical') this.duration = DURATION_CRITICAL;
    }
    this.refresh();
  }

  /** Small "×N" pill next to the title (created on the first duplicate). */
  private renderCounter(): void {
    if (!this.titleEl) return;
    if (!this.counterEl) {
      this.counterEl = document.createElement('span');
      Object.assign(this.counterEl.style, {
        display: 'inline-block',
        marginLeft: '6px',
        padding: '0 5px',
        borderRadius: '8px',
        background: 'var(--overlay-medium, rgba(255,255,255,0.1))',
        color: 'inherit',
        opacity: '0.85',
        fontSize: 'var(--text-xs, 11px)',
        fontWeight: '600',
        fontVariantNumeric: 'tabular-nums',
        verticalAlign: '1px',
      });
      this.titleEl.append(this.counterEl);
    }
    this.counterEl.textContent = `×${this.occurrences}`;
    this.counterEl.setAttribute('aria-label', `${this.occurrences} occurrences`);
    this.counterEl.title = `${this.occurrences} identical notifications merged`;
  }

  dismiss(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    const idx = activeToasts.indexOf(this);
    if (idx !== -1) activeToasts.splice(idx, 1);

    void animateOut(this.el, 'fade').then(() => {
      this.el.remove();
    });
  }
}

export function showToast(options: ToastOptions): Toast {
  const toast = new Toast(options);
  toast.show();
  return toast;
}
