import assert from 'node:assert/strict';
import test from 'node:test';
import '../../../tests/panels/register-hook.mjs';
import '../../../tests/panels/setup-dom.mts';

test('unreadable saved preferences explain the hold and disable derived delivery controls', async (t) => {
  const key = 'wm-notification-settings-v1';
  localStorage.setItem(key, '{');
  const { NotificationSettingsPanel } = await import('../NotificationSettingsPanel.ts');
  const panel = new NotificationSettingsPanel();
  t.after(() => panel.destroy());
  await new Promise((resolve) => setTimeout(resolve, 200));
  const root = panel.getContentElement();
  assert.match(root.querySelector('[role="status"]')?.textContent ?? '', /Derived alerts are paused/);
  const controls = root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-domain="derived"][data-field]');
  assert.equal(controls.length, 4);
  assert.ok(Array.from(controls).every((control) => control.disabled));
  root.querySelector<HTMLButtonElement>('#ns-reset-defaults')!.click();
  assert.equal(localStorage.getItem(key), '{');
});
