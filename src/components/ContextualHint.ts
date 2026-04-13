import { animateIn, animateOut } from '@/services/motion';

const STORAGE_KEY = 'cb:hints-seen';
const AUTO_DISMISS_MS = 8000;

interface HintConfig {
  id: string;
  target: HTMLElement;
  message: string;
  position?: 'top' | 'bottom';
}

function getSeenHints(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // ignore parse errors
  }
  return new Set();
}

function markSeen(id: string): void {
  const seen = getSeenHints();
  seen.add(id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
}

function buildTooltip(config: HintConfig): HTMLElement {
  const { position = 'bottom' } = config;

  const tooltip = document.createElement('div');
  tooltip.style.cssText = `
    position: fixed;
    z-index: 9999;
    max-width: 280px;
    padding: 10px 12px;
    background: rgba(28, 28, 30, 0.95);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--radius-md);
    box-shadow: var(--elevation-2);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: #ccc;
    display: flex;
    flex-direction: column;
    gap: 8px;
  `;

  // Arrow element
  const arrow = document.createElement('div');
  arrow.style.cssText = position === 'bottom' ? `
      position: absolute;
      top: -5px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-bottom: 5px solid rgba(28, 28, 30, 0.95);
    ` : `
      position: absolute;
      bottom: -5px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 5px solid rgba(28, 28, 30, 0.95);
    `;
  tooltip.append(arrow);

  // Message text node
  const msgEl = document.createElement('span');
  msgEl.textContent = config.message;
  tooltip.append(msgEl);

  // Footer row: Got it button
  const footer = document.createElement('div');
  footer.style.cssText = 'display: flex; justify-content: flex-end;';

  const btn = document.createElement('button');
  btn.className = 'cb-button';
  btn.textContent = 'Got it';
  btn.style.cssText = 'font-size: var(--text-xs); padding: 3px 10px;';
  footer.append(btn);
  tooltip.append(footer);

  return tooltip;
}

function positionTooltip(tooltip: HTMLElement, target: HTMLElement, position: 'top' | 'bottom'): void {
  const rect = target.getBoundingClientRect();
  const tooltipWidth = 280;
  const gap = 8;

  let left = rect.left + rect.width / 2 - tooltipWidth / 2;
  // Clamp to viewport with 8px margin
  left = Math.max(8, Math.min(left, window.innerWidth - tooltipWidth - 8));

  tooltip.style.width = `${tooltipWidth}px`;
  tooltip.style.left = `${left}px`;

  if (position === 'bottom') {
    tooltip.style.top = `${rect.bottom + gap}px`;
  } else {
    // We'll set top after appending so we can measure height
    tooltip.style.top = '0px';
    tooltip.style.visibility = 'hidden';
    document.body.append(tooltip);
    const tooltipHeight = tooltip.offsetHeight;
    tooltip.style.top = `${rect.top - tooltipHeight - gap}px`;
    tooltip.style.visibility = '';
    return; // already appended
  }

  document.body.append(tooltip);
}

export function showHint(config: HintConfig): void {
  const seen = getSeenHints();
  if (seen.has(config.id)) return;

  const { position = 'bottom' } = config;
  const tooltip = buildTooltip(config);

  positionTooltip(tooltip, config.target, position);

  void animateIn(tooltip, 'fade');

  let dismissed = false;

  function dismiss(): void {
    if (dismissed) return;
    dismissed = true;
    markSeen(config.id);
    void animateOut(tooltip, 'fade').then(() => {
      tooltip.remove();
    });
  }

  const timer = setTimeout(dismiss, AUTO_DISMISS_MS);

  const btn = tooltip.querySelector('button');
  if (btn) {
    btn.addEventListener('click', () => {
      clearTimeout(timer);
      dismiss();
    });
  }
}

export const HINTS = {
  alertNavigation: (target: HTMLElement) =>
    showHint({
      id: 'alert-nav',
      target,
      message: 'Use J/K to navigate alerts, A to acknowledge',
    }),
  godsVision: (target: HTMLElement) =>
    showHint({
      id: 'gods-vision',
      target,
      message: "Press G to toggle God's Vision 3D globe",
    }),
  ghostMode: (target: HTMLElement) =>
    showHint({
      id: 'ghost-mode',
      target,
      message: 'Press Cmd+Shift+G to enter Ghost Mode',
    }),
  mapNavigation: (target: HTMLElement) =>
    showHint({
      id: 'map-nav',
      target,
      message: 'Use region pills to fly between theaters, scroll to zoom',
    }),
  settings: (target: HTMLElement) =>
    showHint({
      id: 'settings',
      target,
      message: 'Configure API keys and preferences here',
    }),
};
