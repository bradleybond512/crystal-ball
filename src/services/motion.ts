// src/services/motion.ts

const STAGGER_DELAY_MS = 30;
const STAGGER_MAX_ITEMS = 10;

export function prefersReducedMotion(): boolean {
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.body.classList.contains('animations-paused')
  );
}

/**
 * Resolve when the element's CSS animation ends — but NEVER hang. If no
 * animation is actually running on the element (missing keyframes, a class
 * that resolves to `animation: none`, or a zero duration), there will be no
 * `animationend` event, so we settle on the next frame instead. A duration-
 * derived timeout is the final backstop for a dropped event. Without this, a
 * caller like Toast.dismiss() (`animateOut().then(() => el.remove())`) waits
 * on an event that never comes and the element leaks into the DOM forever —
 * e.g. a toast whose × was clicked but which never disappears.
 */
function whenAnimationSettles(el: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener('animationend', finish);
      resolve();
    };
    el.addEventListener('animationend', finish);
    const cs = getComputedStyle(el);
    const durationMs = Number.parseFloat(cs.animationDuration) * 1000;
    // No animation actually running (missing keyframes, `animation: none`, a
    // zero/NaN duration) → no animationend will fire, so settle next frame.
    if (cs.animationName === 'none' || !Number.isFinite(durationMs) || durationMs <= 0) {
      requestAnimationFrame(finish);
      return;
    }
    const capMs = durationMs + Number.parseFloat(cs.animationDelay || '0') * 1000 + 120;
    setTimeout(finish, Number.isFinite(capMs) && capMs > 0 ? capMs : 600);
  });
}

export function staggerIn(
  container: Element,
  selector: string,
  delay: number = STAGGER_DELAY_MS,
): void {
  if (prefersReducedMotion()) return;
  const items = container.querySelectorAll(selector);
  const count = Math.min(items.length, STAGGER_MAX_ITEMS);
  for (let i = 0; i < count; i++) {
    const el = items[i] as HTMLElement;
    el.classList.add('cb-stagger-item');
    el.style.animationDelay = `${i * delay}ms`;
  }
}

export function crossfadeContent(panel: HTMLElement, newContent: HTMLElement | DocumentFragment): Promise<void> {
  if (prefersReducedMotion()) {
    panel.textContent = '';
    panel.append(newContent);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    panel.classList.add('cb-animate-fade-out');
    panel.addEventListener('animationend', function handler() {
      panel.removeEventListener('animationend', handler);
      panel.classList.remove('cb-animate-fade-out');
      panel.textContent = '';
      panel.append(newContent);
      panel.classList.add('cb-animate-fade-in');
      panel.addEventListener('animationend', function handler2() {
        panel.removeEventListener('animationend', handler2);
        panel.classList.remove('cb-animate-fade-in');
        resolve();
      }, { once: true });
    }, { once: true });
  });
}

export function animateNumber(
  el: Element, from: number, to: number, duration = 300,
): void {
  if (prefersReducedMotion() || from === to) {
    el.textContent = String(to);
    return;
  }
  const start = performance.now();
  const range = to - from;
  function step(now: number) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = String(Math.round(from + range * eased));
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

export function animateIn(
  el: HTMLElement, animation: 'slide-up' | 'fade' | 'scale' | 'slide-right' = 'slide-up',
): Promise<void> {
  if (prefersReducedMotion()) {
    el.style.opacity = '1';
    return Promise.resolve();
  }
  const classMap = {
    'slide-up': 'cb-animate-slide-up',
    'fade': 'cb-animate-fade-in',
    'scale': 'cb-animate-scale-in',
    'slide-right': 'cb-animate-slide-in-right',
  };
  const cls = classMap[animation];
  el.classList.add(cls);
  return whenAnimationSettles(el).then(() => { el.classList.remove(cls); });
}

export function animateOut(
  el: HTMLElement, animation: 'fade' | 'scale-down' = 'fade',
): Promise<void> {
  if (prefersReducedMotion()) {
    el.style.opacity = '0';
    return Promise.resolve();
  }
  const classMap = {
    'fade': 'cb-animate-fade-out',
    'scale-down': 'cb-animate-scale-out',
  };
  const cls = classMap[animation];
  el.classList.add(cls);
  return whenAnimationSettles(el).then(() => { el.classList.remove(cls); });
}

export function revealContent(skeleton: HTMLElement, content: HTMLElement): Promise<void> {
  if (prefersReducedMotion()) {
    skeleton.style.display = 'none';
    content.style.display = '';
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    skeleton.classList.add('cb-animate-fade-out');
    skeleton.addEventListener('animationend', () => {
      skeleton.style.display = 'none';
      skeleton.classList.remove('cb-animate-fade-out');
      content.style.display = '';
      content.classList.add('cb-animate-fade-in');
      content.addEventListener('animationend', () => {
        content.classList.remove('cb-animate-fade-in');
        resolve();
      }, { once: true });
    }, { once: true });
  });
}
