/**
 * Offline Staleness Banner — single-line Apple-styled notification that sits
 * inside NotificationStack. Uses amber for stale, red only for truly offline.
 * Dismissible for stale states; persistent (non-dismissible) when offline.
 */

import { icon } from '@/components/ui/icons';
import { clearClientCachesAndReload } from '@/services/client-cache-reset';
import { subscribeOfflineState, type OfflineState } from '@/services/offline-staleness';

export class OfflineStalenessBanner {
  private el: HTMLElement | null = null;
  private unsub: (() => void) | null = null;
  private dismissed = false;
  private lastStatus = '';
  private clickAbort: AbortController | null = null;
  private labelEl: HTMLElement | null = null;
  private subtextEl: HTMLElement | null = null;
  private liveEl: HTMLElement | null = null;
  private dismissButton: HTMLButtonElement | null = null;
  private resetInFlight = false;

  mount(parent: HTMLElement = document.body): void {
    if (this.el) return;
    const el = document.createElement('div');
    el.className = 'cb-offline-staleness-banner';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Data freshness');
    el.style.display = 'none';
    this.buildRow(el);
    parent.append(el);
    this.el = el;

    this.clickAbort = new AbortController();
    el.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!button || !el.contains(button)) return;
      if (button.dataset.action === 'reset') {
        void this.resetCache(button as HTMLButtonElement);
      } else if (button.dataset.action === 'dismiss') {
        this.dismissed = true;
        el.style.display = 'none';
      }
    }, { signal: this.clickAbort.signal });

    this.unsub = subscribeOfflineState((state) => { this.render(state); });
  }

  destroy(): void {
    if (this.clickAbort) { this.clickAbort.abort(); this.clickAbort = null; }
    if (this.unsub) { this.unsub(); this.unsub = null; }
    this.el?.remove();
    this.el = null;
    this.labelEl = null;
    this.subtextEl = null;
    this.liveEl = null;
    this.dismissButton = null;
    this.resetInFlight = false;
  }

  private buildRow(el: HTMLElement): void {
    const iconEl = document.createElement('span');
    iconEl.className = 'cb-osb-icon';
    iconEl.innerHTML = icon('alert-triangle');

    const textEl = document.createElement('span');
    textEl.className = 'cb-osb-text';

    this.labelEl = document.createElement('span');
    this.labelEl.className = 'cb-osb-label';
    this.subtextEl = document.createElement('span');
    this.subtextEl.className = 'cb-osb-subtext';
    textEl.append(this.labelEl, document.createTextNode(' '), this.subtextEl);

    const actionsEl = document.createElement('span');
    actionsEl.className = 'cb-osb-actions';

    const resetButton = document.createElement('button');
    resetButton.className = 'cb-osb-btn cb-osb-reset';
    resetButton.type = 'button';
    resetButton.dataset.action = 'reset';
    resetButton.setAttribute('aria-label', 'Clear cache and reload');
    resetButton.title = 'Clear cache and reload';
    resetButton.innerHTML = icon('refresh-cw');

    this.dismissButton = document.createElement('button');
    this.dismissButton.className = 'cb-osb-dismiss';
    this.dismissButton.type = 'button';
    this.dismissButton.dataset.action = 'dismiss';
    this.dismissButton.setAttribute('aria-label', 'Dismiss staleness notice');
    this.dismissButton.title = 'Dismiss staleness notice';
    this.dismissButton.innerHTML = icon('x');

    this.liveEl = document.createElement('span');
    this.liveEl.className = 'cb-osb-live';
    this.liveEl.setAttribute('role', 'status');
    this.liveEl.setAttribute('aria-live', 'polite');
    this.liveEl.setAttribute('aria-atomic', 'true');

    actionsEl.append(resetButton, this.dismissButton);
    el.append(iconEl, textEl, actionsEl, this.liveEl);
  }

  private async resetCache(button: HTMLButtonElement): Promise<void> {
    if (this.resetInFlight || !this.el) return;
    this.resetInFlight = true;
    button.disabled = true;
    this.el.setAttribute('aria-busy', 'true');
    try {
      await clearClientCachesAndReload();
    } finally {
      this.resetInFlight = false;
      button.disabled = false;
      this.el?.removeAttribute('aria-busy');
    }
  }

  private render(state: OfflineState): void {
    const el = this.el;
    if (!el) return;

    if (state.status === 'fresh') {
      const recovered = this.lastStatus.length > 0 && this.lastStatus !== 'fresh';
      el.style.display = 'none';
      el.removeAttribute('data-status');
      this.dismissed = false;
      this.lastStatus = '';
      this.dismissButton?.removeAttribute('hidden');
      if (recovered && this.liveEl) this.liveEl.textContent = 'Data is current';
      return;
    }

    const statusChanged = state.status !== this.lastStatus;
    if (statusChanged) {
      this.dismissed = false;
      this.lastStatus = state.status;
    }

    if (this.dismissed && state.status !== 'offline') {
      el.style.display = 'none';
      return;
    }

    el.style.display = 'flex';
    el.setAttribute('data-status', state.status);
    if (this.labelEl) {
      this.labelEl.textContent = /[.!?…]$/.test(state.bannerLabel)
        ? state.bannerLabel
        : `${state.bannerLabel}.`;
    }
    if (this.subtextEl) this.subtextEl.textContent = state.bannerSubtext;
    if (statusChanged && this.liveEl) {
      this.liveEl.textContent = `${state.bannerLabel}. ${state.bannerSubtext}`;
    }
    this.dismissButton?.toggleAttribute('hidden', state.status === 'offline');
  }
}

export const offlineStalenessBanner = new OfflineStalenessBanner();
