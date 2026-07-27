
/**
 * Offline Staleness Banner — single-line Apple-styled notification that sits
 * inside NotificationStack. Uses amber for stale, red only for truly offline.
 * Dismissible for stale states; persistent (non-dismissible) when offline.
 */

import { subscribeOfflineState, type OfflineState } from '@/services/offline-staleness';

const STYLE_ID = 'cb-offline-staleness-style';
const STYLE_CSS = `
@keyframes cb-osb-in {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.cb-offline-staleness-banner {
  position: relative;
  width: 100%;
  min-height: 36px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  font-size: 13px;
  pointer-events: auto;
  user-select: none;
  animation: cb-osb-in 0.2s ease-out;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.cb-offline-staleness-banner[data-status="stale"] {
  background: rgba(160, 100, 0, 0.72);
  color: #fff3d6;
  border-bottom: 1px solid rgba(255, 180, 60, 0.3);
}
.cb-offline-staleness-banner[data-status="very-stale"] {
  background: rgba(180, 70, 0, 0.80);
  color: #ffe5c0;
  border-bottom: 1px solid rgba(255, 130, 40, 0.35);
}
.cb-offline-staleness-banner[data-status="offline"] {
  background: rgba(180, 20, 20, 0.88);
  color: var(--text-primary, #fff);
  border-bottom: 1px solid rgba(255, 80, 80, 0.35);
}
.cb-osb-icon {
  font-size: 13px;
  flex-shrink: 0;
  line-height: 1;
}
.cb-osb-text {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  overflow: hidden;
}
.cb-osb-label {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
.cb-osb-subtext {
  font-size: 12px;
  font-weight: 400;
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cb-osb-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.cb-osb-btn {
  background: rgba(255, 255, 255, 0.16);
  border: 0.5px solid rgba(255, 255, 255, 0.28);
  color: inherit;
  padding: 4px 11px;
  border-radius: 6px;
  font: 600 12px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  letter-spacing: -0.01em;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.cb-osb-btn:hover { background: rgba(255, 255, 255, 0.26); border-color: rgba(255, 255, 255, 0.4); }
.cb-osb-btn:active { background: rgba(255, 255, 255, 0.34); }
.cb-osb-dismiss {
  background: none;
  border: none;
  color: inherit;
  opacity: 0.6;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  /* ≥24px square hit target (HIG minimum) — the glyph stays small. */
  min-width: 24px;
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 6px;
  transition: opacity 0.12s;
}
.cb-osb-dismiss:hover { opacity: 1; }
`;

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLE_CSS;
  document.head.append(style);
}

const STATUS_ICON: Record<string, string> = {
  stale: '⚠',
  'very-stale': '⚠',
  offline: '⚠',
};

function buildRow(label: string, subtext: string, icon: string, canDismiss: boolean): DocumentFragment {
  const frag = document.createDocumentFragment();

  const iconEl = document.createElement('span');
  iconEl.className = 'cb-osb-icon';
  iconEl.textContent = icon;

  const textEl = document.createElement('span');
  textEl.className = 'cb-osb-text';

  const labelEl = document.createElement('span');
  labelEl.className = 'cb-osb-label';
  // Terminal period so label + subtext always read as two sentences
  // ("Data is very old. Last updated 5d ago…"), never one run-on blob.
  labelEl.textContent = /[.!?…]$/.test(label) ? label : `${label}.`;

  const subtextEl = document.createElement('span');
  subtextEl.className = 'cb-osb-subtext';
  subtextEl.textContent = subtext;

  // Whitespace text nodes are ignored by flex layout (the gap rule
  // handles visual spacing) but keep the accessible/plain-text reading
  // separated even if the injected stylesheet ever fails to apply.
  textEl.append(labelEl, document.createTextNode(' '), subtextEl);

  const actionsEl = document.createElement('span');
  actionsEl.className = 'cb-osb-actions';

  const resetBtn = document.createElement('button');
  resetBtn.className = 'cb-osb-btn';
  resetBtn.dataset.action = 'reset';
  resetBtn.textContent = 'Reset cache';
  actionsEl.append(resetBtn);

  if (canDismiss) {
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'cb-osb-dismiss';
    dismissBtn.dataset.action = 'dismiss';
    dismissBtn.setAttribute('aria-label', 'Dismiss staleness notice');
    dismissBtn.textContent = '×';
    actionsEl.append(dismissBtn);
  }

  frag.append(iconEl, document.createTextNode(' '), textEl, document.createTextNode(' '), actionsEl);
  return frag;
}

export class OfflineStalenessBanner {
  private el: HTMLElement | null = null;
  private unsub: (() => void) | null = null;
  private dismissed = false;
  private lastStatus = '';
  private clickAbort: AbortController | null = null;

  mount(parent: HTMLElement = document.body): void {
    if (this.el) return;
    ensureStyles();
    const el = document.createElement('div');
    el.className = 'cb-offline-staleness-banner';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.display = 'none';
    parent.append(el);
    this.el = el;

    // Delegate on the stable root. render() calls replaceChildren() on every
    // offline-state emit (30s cadence + per-source updates), so a listener
    // bound to a per-render button would be torn down mid-gesture: a background
    // emit landing between pointerdown and pointerup replaces the node and the
    // browser never synthesizes the click. One listener on `el` (created once,
    // never replaced) is immune to that swallowed-click race.
    this.clickAbort = new AbortController();
    el.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!btn || !el.contains(btn)) return;
      if (btn.dataset.action === 'reset') {
        window.location.reload();
      } else if (btn.dataset.action === 'dismiss') {
        this.dismissed = true;
        el.style.display = 'none';
      }
    }, { signal: this.clickAbort.signal });

    this.unsub = subscribeOfflineState((state) => { this.render(state); });
  }

  destroy(): void {
    if (this.clickAbort) { this.clickAbort.abort(); this.clickAbort = null; }
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
      this.dismissed = false;
      this.lastStatus = '';
      return;
    }

    // Reset dismiss when status escalates
    if (state.status !== this.lastStatus) {
      this.dismissed = false;
      this.lastStatus = state.status;
    }

    // Stale/very-stale can be dismissed; offline cannot
    if (this.dismissed && state.status !== 'offline') {
      el.style.display = 'none';
      return;
    }

    el.style.display = 'flex';
    el.setAttribute('data-status', state.status);

    const icon = STATUS_ICON[state.status] ?? '⚠';
    const canDismiss = state.status !== 'offline';

    // Buttons carry data-action; clicks are routed by the delegated listener
    // bound once on `el` in mount() (survives these replaceChildren rebuilds).
    el.replaceChildren(buildRow(state.bannerLabel, state.bannerSubtext, icon, canDismiss));
  }
}

export const offlineStalenessBanner = new OfflineStalenessBanner();
