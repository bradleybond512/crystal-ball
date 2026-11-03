// R4-BUG-003: one place to set quiet hours, saved as a valid pair; the
// Preferences panel only shows it; the mute label tells the truth.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import '../../../tests/panels/register-hook.mjs';
import '../../../tests/panels/setup-dom.mts';

const settings = await import('../../services/notifications/notification-settings-service.ts');
const { NotificationSettingsPanel, quietWindowMessage } = await import('../NotificationSettingsPanel.ts');
const { NotificationPreferencesPanel } = await import('../NotificationPreferencesPanel.ts');

function input(root: HTMLElement, id: string): HTMLInputElement {
  return root.querySelector<HTMLInputElement>(`#${id}`)!;
}
function change(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
/** Panel.setContent is debounced; let it flush. */
const rendered = () => new Promise((resolve) => setTimeout(resolve, 200));

beforeEach(() => { settings.resetSettings(); });

test('the mute control distinguishes authoritative critical warnings from derived alerts', async (t) => {
  const panel = new NotificationSettingsPanel();
  t.after(() => panel.destroy());
  await rendered();
  assert.match(panel.getContentElement().textContent ?? '', /critical authoritative alerts still come through/i);
});

test('the quiet window saves as a pair; a refused draft stays with its reason', async (t) => {
  const panel = new NotificationSettingsPanel();
  t.after(() => panel.destroy());
  await rendered();
  const root = panel.getContentElement();
  change(input(root, 'ns-quiet-start'), '07:00'); // equal to the 07:00 end
  assert.equal(root.querySelector('#ns-quiet-error')?.textContent, 'Not saved: start and end must be different times.');
  assert.equal(settings.getSettings().global.quietHoursStart, '22:00', 'nothing was stored');
  assert.equal(input(root, 'ns-quiet-start').value, '07:00', 'the draft stays on screen');
  change(input(root, 'ns-quiet-end'), '22:00');
  assert.deepEqual([settings.getSettings().global.quietHoursStart, settings.getSettings().global.quietHoursEnd], ['07:00', '22:00']);
  assert.equal(root.querySelector('#ns-quiet-error')?.textContent ?? '', '');
  await rendered();
  change(input(root, 'ns-quiet-end'), '');
  assert.equal(root.querySelector('#ns-quiet-error')?.textContent, 'Not saved: enter both times.');
  assert.equal(settings.getSettings().global.quietHoursEnd, '22:00');
});

test('refusal messages', () => {
  assert.equal(quietWindowMessage({ ok: true }), '');
  assert.equal(quietWindowMessage({ ok: false, reason: 'equal' }), 'Not saved: start and end must be different times.');
  assert.equal(quietWindowMessage({ ok: false, reason: 'invalid' }), 'Not saved: enter both times.');
});

test('the Preferences panel shows the one window read-only and links to it', async (t) => {
  settings.updateGlobalSettings({ quietHoursStart: '21:00', quietHoursEnd: '06:00' });
  settings.updateDomainSettings('weather', { quietHoursEnabled: true });
  const panel = new NotificationPreferencesPanel();
  let destroyed = false;
  t.after(() => { if (!destroyed) panel.destroy(); });
  await rendered();
  const root = panel.getContentElement();
  assert.equal(root.querySelector('#np-qh-summary')?.textContent, 'Quiet hours 21:00–06:00 · on for 2 domains');
  for (const selector of ['#np-qh-enabled', '#np-qh-start', '#np-qh-end', '[data-field="quietHoursOverride"]']) {
    assert.equal(root.querySelector(selector), null, `${selector} is gone`);
  }
  const opened: unknown[] = [];
  const listener = (event: Event) => { opened.push((event as CustomEvent).detail); };
  document.addEventListener('cb:open-panel', listener);
  root.querySelector<HTMLButtonElement>('#np-qh-open')!.click();
  document.removeEventListener('cb:open-panel', listener);
  assert.deepEqual(opened, [{ panelKey: 'notification-settings' }]);

  settings.updateGlobalSettings({ quietHoursStart: '23:00' });
  await rendered();
  assert.equal(panel.getContentElement().querySelector('#np-qh-summary')?.textContent, 'Quiet hours 23:00–06:00 · on for 2 domains');
  panel.destroy(); destroyed = true;
  settings.updateGlobalSettings({ quietHoursStart: '20:00' }); // no listener left to re-render a destroyed panel
});

test('changing the Derived alerts channel updates only that settings row', async (t) => {
  const panel = new NotificationSettingsPanel();
  t.after(() => panel.destroy());
  await rendered();
  document.body.append(panel.getElement());
  const root = panel.getContentElement();
  const channel = root.querySelector<HTMLSelectElement>('select[data-domain="derived"][data-field="channel"]');
  assert.ok(channel, 'Derived alerts has its own delivery control');
  assert.equal(channel.getAttribute('aria-label'), 'Derived alerts delivery channel');
  Object.assign(globalThis, { HTMLInputElement: window.HTMLInputElement, HTMLSelectElement: window.HTMLSelectElement });
  channel.focus();
  channel.value = 'in_app';
  channel.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(settings.getSettings().domains.derived.channel, 'in_app');
  assert.equal(settings.getSettings().domains.cyber.channel, 'both');
  await rendered();
  assert.equal(document.activeElement?.getAttribute('aria-label'), 'Derived alerts delivery channel', 'keyboard focus stays on the edited control');
  const nextChannel = root.querySelector<HTMLSelectElement>('select[data-domain="derived"][data-field="channel"]')!;
  nextChannel.value = 'native';
  nextChannel.dispatchEvent(new Event('change', { bubbles: true }));
  root.querySelector<HTMLInputElement>('input[data-domain="derived"][data-field="quietHoursEnabled"]')!.focus();
  await rendered();
  assert.equal(document.activeElement?.getAttribute('aria-label'), 'Derived alerts quiet hours', 'a tab move before refresh is respected');
});
