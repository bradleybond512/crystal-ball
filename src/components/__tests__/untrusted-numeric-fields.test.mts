// R3-SEC-009 / R4-LOW-005: numbers from feeds render as numbers or "—",
// never as markup, even if a provider sends a string.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import '../../../tests/panels/register-hook.mjs';
import '../../../tests/panels/setup-dom.mts';

const { MapPopup } = await import('../MapPopup.ts');

const HOSTILE = '"><img src=x onerror=window.pwned=1>';

function mountPopup(): InstanceType<typeof MapPopup> {
  document.body.replaceChildren();
  const container = document.createElement('div');
  document.body.append(container);
  return new MapPopup(container);
}

test('AIS popup numbers cannot carry markup', () => {
  const popup = mountPopup();
  popup.show({
    type: 'ais',
    data: { id: 'a', name: 'Hormuz', type: 'gap_spike', lat: 26.5, lon: 56.3, severity: 'high', changePct: HOSTILE, windowHours: HOSTILE, darkShips: HOSTILE, region: 'Gulf', description: 'd' } as never,
    x: 10,
    y: 10,
  });
  assert.equal(document.querySelector('img'), null);
  const values = [...document.querySelectorAll('.stat-value')].map((v) => v.textContent?.trim());
  assert.deepEqual(values.slice(0, 3), ['—% ↑', '—', '—H']);
  popup.hide();
});

test('AIS popup shows real numbers normally', () => {
  const popup = mountPopup();
  popup.show({
    type: 'ais',
    data: { id: 'a', name: 'Hormuz', type: 'chokepoint_congestion', lat: 26.5, lon: 56.3, severity: 'low', changePct: 42.25, windowHours: 6, vesselCount: 1250, description: 'd' } as never,
    x: 10,
    y: 10,
  });
  const values = [...document.querySelectorAll('.stat-value')].map((v) => v.textContent?.trim());
  assert.deepEqual(values.slice(0, 3), ['42.3% ↑', '1,250', '6H']);
  popup.hide();
});

test('protest fatalities cannot carry markup', () => {
  const popup = mountPopup();
  popup.show({
    type: 'protest',
    data: { id: 'p', title: 't', eventType: 'riot', country: 'X', lat: 1, lon: 2, time: new Date(0), severity: 'high', fatalities: HOSTILE, sources: [], sourceType: 'acled', confidence: 'high', validated: true } as never,
    x: 10,
    y: 10,
  });
  assert.equal(document.querySelector('img'), null);
  assert.equal(document.querySelector('.stat-value.alert')?.textContent, '—');
  popup.hide();
});

test('the adapters and other sinks coerce or escape at the source', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const maritime = read('../../services/maritime/index.ts');
  for (const field of ['changePct', 'windowHours']) assert.match(maritime, new RegExp(`${field}: finiteOr\\(proto\\.${field}, 0\\)`));
  for (const field of ['darkShips', 'vesselCount']) assert.match(maritime, new RegExp(`${field}: finiteOrUndefined\\(proto\\.${field}\\)`));
  assert.match(read('../../services/unrest/index.ts'), /fatalities: positiveCountOrUndefined\(e\.fatalities\)/);
  assert.match(read('../CountryIntelModal.ts'), /\$\{sign\}\$\{formatFiniteNumber\(pct, 2\)\}% \(1W\)/);
  assert.match(read('../S2UndergroundPanel.ts'), /Could not start Patreon connect: \$\{escapeHtml\(msg\)\}/);
  assert.match(read('../../services/survival-advisor.ts'), /partitionStoredItems\(req\.result as unknown\[\]\)\.items/);
});
