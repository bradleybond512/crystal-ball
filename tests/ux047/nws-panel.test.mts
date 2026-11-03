import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import '../panels/register-hook.mjs';
import { happyWindow } from '../panels/setup-dom.mts';
import type { NWSAlert } from '../../src/services/nws-alert-snapshot.ts';
const { NWSAlertsPanel } = await import('../../src/components/NWSAlertsPanel.ts');
after(() => happyWindow.close());
const NOW = Date.now();
const row = (id = 'one'): NWSAlert => ({ id, event: 'Flood Warning', headline: '<Flood>', description: '', severity: 'Severe', urgency: 'Immediate', areaDesc: 'Test', sent: '2026-10-31T12:00:00Z', onset: '2026-11-01T14:00:00Z', expires: '2026-11-03T00:00:00Z', status: 'Actual', messageType: 'Alert', centroid: null });
async function render(panel: InstanceType<typeof NWSAlertsPanel>) {
  document.body.append(panel.getElement());
  await new Promise(resolve => setTimeout(resolve, 225));
  return panel.getElement();
}
test('only a current complete empty snapshot claims no active warnings', async () => {
  const panel = new NWSAlertsPanel();
  try {
    assert.match(panel.getElement().textContent ?? '', /Fetching NWS/);
    for (const state of ['stale', 'unavailable', 'current'] as const) {
      panel.updateSnapshot({ alerts: [], state, observedAt: state === 'unavailable' ? null : NOW });
      const el = await render(panel);
      assert.equal(/No active NWS hazard alerts/.test(el.textContent ?? ''), state === 'current');
      assert.equal(el.querySelector('.panel-count')?.textContent, state === 'current' ? '0' : '—');
      assert.ok(el.querySelector('[role="status"]'));
    }
  } finally { panel.destroy(); }
});
test('national count is independent of bounded rendering, with distinct issued and starts times', async () => {
  const panel = new NWSAlertsPanel();
  try {
    panel.updateSnapshot({ alerts: Array.from({ length: 600 }, (_, i) => row(String(i))), state: 'current', observedAt: NOW });
    const el = await render(panel);
    assert.equal(el.querySelector('.panel-count')?.textContent, '600');
    assert.equal(el.querySelectorAll('tbody tr').length, 80);
    assert.match(el.textContent ?? '', /Issued/);
    assert.match(el.textContent ?? '', /Starts/);
    const times = el.querySelectorAll('tbody tr:first-child time');
    assert.equal(times[0]?.getAttribute('datetime'), row().sent);
    assert.equal(times[1]?.getAttribute('datetime'), row().onset);
    assert.match(el.textContent ?? '', /80 of 600/);
  } finally { panel.destroy(); }
});
test('degraded update preserves external keyboard focus and tolerates missing onset in narrow layout', async () => {
  const panel = new NWSAlertsPanel();
  const button = document.createElement('button'); document.body.append(button); button.focus();
  try {
    panel.getElement().style.width = '240px';
    panel.updateSnapshot({ alerts: [{ ...row(), onset: undefined }], state: 'stale', observedAt: NOW });
    const el = await render(panel);
    assert.equal(document.activeElement, button);
    assert.match(el.textContent ?? '', /Stale/);
    assert.equal(el.querySelectorAll('tbody time').length, 1);
    assert.equal(el.querySelector('tbody td:last-child')?.textContent?.trim(), '—');
    assert.ok(el.querySelector('.ct-panel-content .ct-table'));
  } finally { panel.destroy(); button.remove(); }
});
