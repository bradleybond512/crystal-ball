/**
 * First-run analytics consent banner (opt-in).
 *
 * Shown once for brand-new installs that have no recorded consent choice. The
 * user must explicitly Accept to enable PostHog/Vercel analytics — declining (or
 * dismissing) leaves analytics off. Either choice records 'wm-analytics-consent'
 * and marks the prompt as seen so this never re-appears.
 *
 * Migrated / already-decided installs never reach here (migrateAnalyticsConsent
 * marks the prompt seen), so mounting is gated on hasSeenConsentPrompt().
 */

import {
  hasSeenConsentPrompt,
  markConsentPromptSeen,
  setAnalyticsConsent,
  initAnalytics,
} from '@/services/analytics';

const BANNER_ID = 'analytics-consent-banner';

function decide(banner: HTMLElement, allow: boolean, restoreFocus: HTMLElement | null): void {
  setAnalyticsConsent(allow);
  markConsentPromptSeen();
  if (allow) void initAnalytics();
  banner.remove();
  restoreFocus?.focus();
}

export function mountAnalyticsConsentBanner(): void {
  if (hasSeenConsentPrompt()) return;
  if (document.getElementById(BANNER_ID)) return;

  const banner = document.createElement('div');
  const restoreFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  banner.id = BANNER_ID;
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-modal', 'true');
  banner.setAttribute('aria-live', 'polite');
  banner.setAttribute('aria-labelledby', `${BANNER_ID}-message`);
  Object.assign(banner.style, {
    position: 'fixed',
    bottom: '16px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '10000',
    maxWidth: 'min(560px, calc(100vw - 32px))',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 18px',
    borderRadius: '14px',
    border: '1px solid rgba(120, 170, 255, 0.35)',
    background: 'rgba(14, 18, 28, 0.94)',
    boxShadow: '0 18px 48px rgba(0, 0, 0, 0.4)',
    color: '#e9eefc',
    font: '500 13px/1.45 "SF Pro Text", -apple-system, BlinkMacSystemFont, sans-serif',
    backdropFilter: 'blur(12px)',
  } as CSSStyleDeclaration);

  const text = document.createElement('span');
  text.id = `${BANNER_ID}-message`;
  text.style.flex = '1 1 240px';
  text.textContent =
    'Share anonymous usage analytics? Aggregate counts only — no key names, no personal data. Off unless you opt in.';

  const actions = document.createElement('div');
  Object.assign(actions.style, { display: 'flex', gap: '8px', flex: '0 0 auto' } as CSSStyleDeclaration);

  const decline = document.createElement('button');
  decline.type = 'button';
  decline.textContent = 'No thanks';
  Object.assign(decline.style, {
    padding: '8px 14px',
    borderRadius: '10px',
    border: '1px solid rgba(255, 255, 255, 0.18)',
    background: 'transparent',
    color: '#c4ccdd',
    font: 'inherit',
    cursor: 'pointer',
  } as CSSStyleDeclaration);
  decline.addEventListener('click', () => decide(banner, false, restoreFocus));

  const accept = document.createElement('button');
  accept.type = 'button';
  accept.textContent = 'Allow';
  Object.assign(accept.style, {
    padding: '8px 16px',
    borderRadius: '10px',
    border: '1px solid rgba(120, 170, 255, 0.6)',
    background: 'rgba(70, 120, 235, 0.9)',
    color: '#fff',
    font: '600 13px/1.45 "SF Pro Text", -apple-system, BlinkMacSystemFont, sans-serif',
    cursor: 'pointer',
  } as CSSStyleDeclaration);
  accept.addEventListener('click', () => decide(banner, true, restoreFocus));

  banner.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      decide(banner, false, restoreFocus);
      return;
    }
    if (event.key !== 'Tab') return;
    if (event.shiftKey && document.activeElement === decline) {
      event.preventDefault();
      accept.focus();
    } else if (!event.shiftKey && document.activeElement === accept) {
      event.preventDefault();
      decline.focus();
    }
  });

  actions.append(decline, accept);
  banner.append(text, actions);
  document.body.append(banner);
  decline.focus();
}
