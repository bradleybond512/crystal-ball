/**
 * InfrastructureBannerBar — top-of-app DOM banner for BGP hijack alerts.
 *
 * The user's spec asked for the banner to live "in EEWStatusBar" but
 * that component doesn't exist in this codebase. This is a small
 * standalone bar that mounts itself into `document.body` and can be
 * relocated by a future EEWStatusBar without breaking the public API.
 *
 * Public API:
 *   - InfrastructureBannerBar.ensure() — singleton accessor
 *   - .setState(state: BgpBannerState) — show/hide + update text
 *
 * Built with DOM APIs (no innerHTML) so user-controlled message strings
 * cannot escape into HTML even if escapeHtml is somehow bypassed.
 */

import type { BgpBannerState } from '@/services/infrastructure/infrastructure-overlay';

const HOST_ID = 'cb-infrastructure-banner';

let _instance: InfrastructureBannerBar | null = null;

export class InfrastructureBannerBar {
  private host: HTMLElement;

  private constructor(host: HTMLElement) {
    this.host = host;
  }

  static ensure(): InfrastructureBannerBar {
    if (_instance) return _instance;
    const existing = document.getElementById(HOST_ID);
    const host = existing ?? createHost();
    if (!existing) document.body.append(host);
    _instance = new InfrastructureBannerBar(host);
    return _instance;
  }

  setState(state: BgpBannerState): void {
    while (this.host.firstChild) this.host.firstChild.remove();
    if (!state.visible) {
      this.host.style.display = 'none';
      this.host.removeAttribute('data-severity');
      return;
    }
    const bg = state.severity === 'critical' ? 'rgba(220,38,38,0.92)' : 'rgba(245,158,11,0.92)';
    this.host.dataset.severity = state.severity;
    this.host.style.display = 'block';
    this.host.style.background = bg;

    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.justifyContent = 'space-between';
    wrapper.style.padding = '6px 12px';
    wrapper.style.color = '#fff';
    wrapper.style.fontSize = '13px';
    wrapper.style.fontWeight = '600';

    const left = document.createElement('div');
    const icon = document.createElement('span');
    icon.style.marginRight = '8px';
    icon.textContent = '⚠';
    left.append(icon);
    const messageNode = document.createTextNode(state.message);
    left.append(messageNode);

    if (state.criticalEvents.length > 0) {
      const tooltip = state.criticalEvents
        .map((e) => `${e.prefix} (expected AS${e.expectedAsn ?? '?'} → detected AS${e.detectedAsns[0] ?? '?'})`)
        .join(' · ');
      const detailHint = document.createElement('span');
      detailHint.style.marginLeft = '10px';
      detailHint.style.opacity = '0.85';
      detailHint.style.fontWeight = '400';
      detailHint.style.fontSize = '11px';
      detailHint.title = tooltip;
      detailHint.textContent = '[hover for details]';
      left.append(detailHint);
    }

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.dataset.bannerClose = '1';
    dismissBtn.setAttribute('aria-label', 'Dismiss banner');
    dismissBtn.style.background = 'transparent';
    dismissBtn.style.border = '1px solid rgba(255,255,255,0.4)';
    dismissBtn.style.color = '#fff';
    dismissBtn.style.borderRadius = '3px';
    dismissBtn.style.padding = '1px 8px';
    dismissBtn.style.cursor = 'pointer';
    dismissBtn.style.fontSize = '12px';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', () => {
      this.host.style.display = 'none';
    });

    wrapper.append(left, dismissBtn);
    this.host.append(wrapper);
  }
}

function createHost(): HTMLElement {
  const el = document.createElement('div');
  el.id = HOST_ID;
  el.style.position = 'fixed';
  el.style.top = '0';
  el.style.left = '0';
  el.style.right = '0';
  el.style.zIndex = '9999';
  el.style.display = 'none';
  el.style.pointerEvents = 'auto';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  return el;
}
