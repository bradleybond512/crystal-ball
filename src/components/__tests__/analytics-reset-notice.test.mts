import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

const window = new Window({ url: 'https://example.test/' });
Object.assign(globalThis, {
  window,
  document: window.document,
  localStorage: window.localStorage,
  HTMLElement: window.HTMLElement,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
});
const { migrateAnalyticsConsent, hasAnalyticsConsent, setAnalyticsConsent, _setCaptureForTest } = await import('../../services/analytics.ts');
const { mountAnalyticsConsentBanner } = await import('../AnalyticsConsentBanner.ts');

test('ambiguous upgrade explains reset once without moving focus or granting consent', () => {
  window.localStorage.setItem('wm-analytics-consent', 'true');
  window.localStorage.setItem('wm-installation-id', 'legacy-install');
  window.localStorage.setItem('wm-analytics-consent-prompt-seen', 'true');
  const existing = window.document.createElement('button');
  existing.textContent = 'Existing control';
  window.document.body.append(existing);
  existing.focus();
  migrateAnalyticsConsent();
  mountAnalyticsConsentBanner();
  const notice = window.document.querySelector('[role="status"]');
  assert.ok(notice, 'reset notice is non-blocking status');
  assert.ok(notice.textContent.includes("Analytics are now off. Turn them on in Privacy settings if you'd like to help."));
  assert.equal(notice.hasAttribute('aria-modal'), false);
  assert.equal(window.document.activeElement, existing);
  assert.equal(hasAnalyticsConsent(), false);
  const buttons = notice.querySelectorAll('button');
  assert.equal(buttons.length, 1, 'notice dismisses; it cannot enable analytics');
  (buttons[0] as unknown as HTMLButtonElement).click();
  migrateAnalyticsConsent();
  mountAnalyticsConsentBanner();
  assert.equal(window.document.querySelector('[role="status"]'), null);
  assert.equal(window.document.querySelector('[role="dialog"]'), null);
  assert.equal(hasAnalyticsConsent(), false);
});


test('an explicit choice before the notice mounts suppresses the stale off message', () => {
  window.localStorage.clear();
  window.document.body.innerHTML = '';
  _setCaptureForTest(null);
  window.localStorage.setItem('wm-analytics-consent', 'true');
  migrateAnalyticsConsent();
  setAnalyticsConsent(true);
  mountAnalyticsConsentBanner();
  assert.equal(hasAnalyticsConsent(), true);
  assert.equal(window.document.querySelector('[role="status"]'), null);
});
