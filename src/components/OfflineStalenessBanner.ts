 
/**
 * Offline Staleness Banner — mounts a fixed-position banner at the top of
 * the viewport that is IMPOSSIBLE to dismiss while data is stale. Uses
 * aggressive styling (red background, bold text, blinking when very
 * stale) to prevent the user from mistaking cached data for live data.
 */

import { subscribeOfflineState, type OfflineState } from '@/services/offline-staleness';

const STYLE_ID = 'cb-offline-staleness-style';
const STYLE_CSS = `
@keyframes cb-offline-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0.55; }
}
.cb-offline-staleness-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100000;
  height: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.5);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #ffffff;
  pointer-events: none;
  user-select: none;
  text-align: center;
  padding: 4px 12px;
  box-sizing: border-box;
}
.cb-offline-staleness-banner[data-status="stale"] { background: #b00000; }
.cb-offline-staleness-banner[data-status="very-stale"] { background: #ff0000; }
.cb-offline-staleness-banner[data-status="offline"] {
  background: #ff0000;
  animation: cb-offline-blink 1s steps(1,end) infinite;
}
.cb-offline-staleness-banner .cb-osb-label {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.5px;
  line-height: 1.1;
}
.cb-offline-staleness-banner .cb-osb-subtext {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.95;
  letter-spacing: 0.4px;
  line-height: 1.1;
  margin-top: 2px;
}
`;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE_CSS;
  document.head.append(style);
}

export class OfflineStalenessBanner {
  private el: HTMLElement | null = null;
  private unsub: (() => void) | null = null;

  mount(parent: HTMLElement = document.body): void {
    if (this.el) return;
    ensureStyles();
    const el = document.createElement('div');
    el.className = 'cb-offline-staleness-banner';
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'assertive');
    el.style.display = 'none';
    const label = document.createElement('div');
    label.className = 'cb-osb-label';
    const subtext = document.createElement('div');
    subtext.className = 'cb-osb-subtext';
    el.append(label);
    el.append(subtext);
    parent.append(el);
    this.el = el;
    this.unsub = subscribeOfflineState((state) => { this.render(state); });
  }

  destroy(): void {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    if (this.el?.parentElement) this.el.remove();
    this.el = null;
  }

  private render(state: OfflineState): void {
    const el = this.el;
    if (!el) return;
    if (state.status === 'fresh') {
      el.style.display = 'none';
      el.removeAttribute('data-status');
      return;
    }
    el.style.display = 'flex';
    el.setAttribute('data-status', state.status);
    const label = el.querySelector<HTMLElement>('.cb-osb-label');
    const subtext = el.querySelector<HTMLElement>('.cb-osb-subtext');
    if (label) label.textContent = state.bannerLabel;
    if (subtext) subtext.textContent = state.bannerSubtext;
  }
}

export const offlineStalenessBanner = new OfflineStalenessBanner();
