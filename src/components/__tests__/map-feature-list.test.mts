import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { Window } from 'happy-dom';
import type { MapFeature, FeatureRef } from '../map-clarity-model';

const happyWindow = new Window({ url: 'http://127.0.0.1/' });
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = happyWindow;
globals.document = happyWindow.document;
globals.HTMLElement = happyWindow.HTMLElement;
globals.HTMLButtonElement = happyWindow.HTMLButtonElement;
globals.HTMLInputElement = happyWindow.HTMLInputElement;
globals.Element = happyWindow.Element;
globals.Node = happyWindow.Node;
globals.Event = happyWindow.Event;

const { MapFeatureList } = await import('../MapFeatureList.ts');

afterEach(() => document.body.replaceChildren());

function feature(index: number, overrides: Partial<MapFeature> = {}): MapFeature {
  return {
    id: `camera:${index}`,
    family: 'camera',
    title: `Camera ${String(index).padStart(3, '0')}`,
    center: [-115, 35],
    metrics: [{ label: 'Status', value: 'Available' }],
    memberIds: [`camera:${index}`],
    visible: true,
    ...overrides,
  };
}

function mount(features: MapFeature[] = [], onClose?: () => void) {
  const container = document.createElement('div');
  container.className = 'home-shell-map';
  container.innerHTML = '<div class="map-controls" hidden></div>';
  document.body.append(container);
  const selected: FeatureRef[] = [];
  const shown: FeatureRef[] = [];
  const opened: FeatureRef[] = [];
  const openStates: boolean[] = [];
  const openFocus: (Element | null)[] = [];
  let closed = 0;
  const list = new MapFeatureList(container, {
    onSelect: (ref) => selected.push(ref),
    onShowOnMap: (ref) => shown.push(ref),
    onOpenFeature: (ref) => {
      opened.push(ref);
      openStates.push(document.querySelector<HTMLElement>('.map-feature-list-panel')!.hidden);
      openFocus.push(document.activeElement);
    },
    onClose: () => { closed++; onClose?.(); },
  });
  list.update(features);
  const panel = document.querySelector<HTMLElement>('.map-feature-list-panel')!;
  const entry = container.querySelector<HTMLButtonElement>('.map-feature-list-entry')!;
  const search = panel.querySelector<HTMLInputElement>('input[type="search"]')!;
  return { list, panel, entry, search, container, selected, shown, opened, openStates, openFocus, get closed() { return closed; } };
}

function click(element: Element): void {
  element.dispatchEvent(new happyWindow.MouseEvent('click', { bubbles: true }));
}

function input(element: HTMLInputElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new happyWindow.Event('input', { bubbles: true }));
}

function button(panel: Element, label: string): HTMLButtonElement {
  const found = [...panel.querySelectorAll<HTMLButtonElement>('button')]
    .find((node) => node.getAttribute('aria-label') === label || node.textContent === label);
  assert.ok(found, `Button ${label} exists`);
  return found;
}

function row(panel: Element, id: string): HTMLButtonElement {
  const found = [...panel.querySelectorAll<HTMLButtonElement>('[data-feature-id]')]
    .find((node) => node.dataset.featureId === id);
  assert.ok(found, `Feature ${id} is on this page`);
  return found;
}

test('Home has its own keyboard entry, a labeled nonmodal region and local Escape ownership', () => {
  const fixture = mount([feature(0)]);
  assert.ok(fixture.entry.parentElement === fixture.container, 'entry is mounted directly in the map container');
  assert.ok(fixture.entry.closest('.map-controls') === null, 'entry stays outside hidden classic controls');
  assert.equal(fixture.panel.getAttribute('role'), 'region');
  assert.equal(fixture.panel.hasAttribute('aria-modal'), false);
  assert.equal(fixture.panel.hidden, true);
  fixture.entry.focus();
  click(fixture.entry);
  assert.equal(fixture.panel.hidden, false);
  assert.equal(fixture.entry.getAttribute('aria-expanded'), 'true');
  assert.ok(document.activeElement === fixture.search, 'opening the drawer focuses search');

  const outside = document.createElement('button');
  document.body.append(outside);
  outside.focus();
  outside.dispatchEvent(new happyWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(fixture.panel.hidden, false, 'background Escape is not captured');

  fixture.search.focus();
  const escape = new happyWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  fixture.search.dispatchEvent(escape);
  assert.equal(fixture.panel.hidden, true);
  assert.equal(escape.defaultPrevented, true);
  assert.ok(document.activeElement === fixture.entry, 'Escape restores focus to the entry');
  assert.equal(fixture.closed, 1);
  fixture.list.destroy();
});

test('all 275 source members remain reachable through real pagination without a 200-item cap', () => {
  const allFeatures = Array.from({ length: 275 }, (_, index) => feature(index));
  const fixture = mount(allFeatures);
  fixture.list.open();
  const seen = new Set<string>();
  let pageCount = 0;
  while (true) {
    const rows = fixture.panel.querySelectorAll<HTMLButtonElement>('[data-feature-id]');
    assert.ok(rows.length > 0 && rows.length <= 50);
    rows.forEach((node) => seen.add(node.dataset.featureId!));
    pageCount++;
    const next = button(fixture.panel, 'Next map features page');
    if (next.disabled) break;
    click(next);
    assert.ok(pageCount < 10, 'pagination terminates');
  }
  assert.equal(pageCount, 6);
  assert.deepEqual(seen, new Set(allFeatures.map((item) => item.id)));
  assert.match(fixture.panel.querySelector('[role="status"]')!.textContent!, /251–275 of 275 features/);
  assert.match(fixture.panel.textContent!, /Page 6 of 6/);
  click(button(fixture.panel, 'Previous map features page'));
  assert.match(fixture.panel.textContent!, /Page 5 of 6/);
  fixture.list.destroy();
});

test('cluster subsets support search and an explicit return to every source member', () => {
  const allFeatures = Array.from({ length: 275 }, (_, index) => feature(index));
  const fixture = mount(allFeatures);
  fixture.list.open('camera:250', ['camera:250', 'camera:251', 'camera:252']);
  assert.equal(fixture.panel.querySelectorAll('[data-feature-id]').length, 3);
  assert.match(fixture.panel.querySelector('[role="status"]')!.textContent!, /3 cluster members/);
  assert.match(fixture.panel.querySelector('.map-feature-list-detail')!.textContent!, /Camera 250/);
  input(fixture.search, '251');
  assert.equal(fixture.panel.querySelectorAll('[data-feature-id]').length, 1);
  assert.equal(row(fixture.panel, 'camera:251').getAttribute('aria-pressed'), 'false');
  click(button(fixture.panel, 'Show all map features'));
  assert.equal(fixture.search.value, '');
  assert.match(fixture.panel.querySelector('[role="status"]')!.textContent!, /of 275 features/);
  assert.equal(button(fixture.panel, 'Show all map features').hidden, true);
  assert.ok(document.activeElement === fixture.search, 'returning to all features focuses search');
  fixture.list.destroy();
});

test('source selection remains stable when coordinates, order, query and visible bounds change', () => {
  const fixture = mount([feature(0), feature(1)]);
  fixture.list.open();
  click(row(fixture.panel, 'camera:1'));
  assert.deepEqual(fixture.selected, [{ id: 'camera:1', family: 'camera' }]);
  assert.deepEqual(fixture.shown, [], 'selecting details does not move the map');
  fixture.list.update([feature(1, { center: [140, -35], title: 'Selected camera refreshed' }), feature(0)]);
  input(fixture.search, 'Camera 000');
  assert.match(fixture.panel.querySelector('.map-feature-list-detail h3')!.textContent!, /Selected camera refreshed/);
  assert.equal(fixture.panel.querySelectorAll('[data-feature-id]').length, 1);
  click(button(fixture.panel, 'Show on map'));
  assert.deepEqual(fixture.shown, [{ id: 'camera:1', family: 'camera' }]);
  assert.match(fixture.panel.querySelector('.map-feature-list-detail dl')!.textContent!, /-35\.000, 140\.000/);
  fixture.list.destroy();
});

test('removed selection remains explicit and cannot dispatch a stale map action', () => {
  const fixture = mount([feature(0), feature(1)]);
  fixture.list.open('camera:1');
  fixture.list.update([feature(0)]);
  const detail = fixture.panel.querySelector('.map-feature-list-detail')!;
  assert.match(detail.textContent!, /Camera 001/);
  assert.match(detail.textContent!, /No longer available in the latest map data/);
  const show = button(fixture.panel, 'Show on map');
  assert.equal(show.disabled, true);
  click(show);
  assert.deepEqual(fixture.selected, []);
  assert.deepEqual(fixture.shown, []);
  fixture.list.update([feature(0), feature(1)]);
  assert.equal(show.disabled, false);
  assert.doesNotMatch(detail.textContent!, /No longer available/);
  fixture.list.destroy();
});

test('refresh preserves search element, focus and caret without triggering selection', () => {
  const fixture = mount([feature(0)]);
  fixture.list.open();
  input(fixture.search, 'Camera');
  fixture.search.focus();
  fixture.search.setSelectionRange(2, 4);
  fixture.list.update([feature(0, { title: 'Camera renamed' }), feature(1)]);
  assert.ok(fixture.panel.querySelector('input') === fixture.search, 'refresh preserves the search element');
  assert.ok(document.activeElement === fixture.search, 'refresh preserves search focus');
  assert.equal(fixture.search.value, 'Camera');
  assert.equal(fixture.search.selectionStart, 2);
  assert.equal(fixture.search.selectionEnd, 4);
  assert.deepEqual(fixture.selected, []);
  fixture.list.destroy();
});

test('refresh keeps an unchanged row and the selected action button focused in place', () => {
  const fixture = mount([feature(0), feature(1)]);
  fixture.list.open();
  const existingRow = row(fixture.panel, 'camera:1');
  existingRow.focus();
  fixture.list.update([feature(0), feature(1, { title: 'Renamed but stable' })]);
  assert.ok(row(fixture.panel, 'camera:1') === existingRow, 'refresh preserves the existing source row');
  assert.ok(document.activeElement === existingRow, 'refresh preserves source row focus');
  click(existingRow);
  const action = button(fixture.panel, 'Show on map');
  action.focus();
  fixture.list.update([feature(0), feature(1)]);
  assert.ok(document.activeElement === action, 'refresh preserves the selected action focus');
  fixture.list.destroy();
});

test('hidden-layer members retain readable details without enabling or changing a layer', () => {
  const fixture = mount([feature(0, { visible: false })]);
  fixture.list.open('camera:0');
  assert.match(row(fixture.panel, 'camera:0').textContent!, /Layer hidden/);
  assert.match(fixture.panel.querySelector('.map-feature-list-detail')!.textContent!, /Layer hidden/);
  assert.equal(button(fixture.panel, 'Show on map').disabled, true);
  assert.deepEqual(fixture.selected, []);
  fixture.list.destroy();
});

test('titles, source IDs and metric strings are rendered as text without remote content', () => {
  const hostile = '<img src="https://fixture.invalid/image" onerror="alert(1)">';
  const fixture = mount([feature(0, {
    id: 'forecast:situation:<script>unsafe</script>',
    family: 'forecast',
    title: hostile,
    metrics: [{ label: '<svg onload="alert(2)">', value: hostile }],
  })]);
  fixture.list.open('forecast:situation:<script>unsafe</script>');
  assert.match(fixture.panel.textContent!, /<img src=/);
  assert.match(fixture.panel.textContent!, /<svg onload=/);
  assert.ok(fixture.panel.querySelector('img,script,svg,iframe,a') === null, 'untrusted text creates no remote content or executable elements');
  assert.ok(fixture.panel.querySelector('[onerror],[onload]') === null, 'untrusted text creates no event handler attributes');
  fixture.list.destroy();
});

test('opening a cluster does not act on the map until an individual user selection', () => {
  const fixture = mount([feature(0), feature(1, {
    id: 'forecast:situation:one', family: 'forecast', title: 'Situation',
    metrics: [{ label: 'Situation confidence', value: '60%' }],
  })]);
  fixture.list.open('forecast:situation:one', ['camera:0', 'forecast:situation:one']);
  assert.deepEqual(fixture.selected, []);
  assert.match(fixture.panel.querySelector('.map-feature-list-detail')!.textContent!, /Situation confidence60%/);
  click(row(fixture.panel, 'forecast:situation:one'));
  assert.deepEqual(fixture.selected, [{ id: 'forecast:situation:one', family: 'forecast' }]);
  fixture.list.destroy();
});

test('camera and data center viewers open only through an explicit action after the drawer closes', () => {
  const camera = feature(0);
  const datacenter = feature(1, { id: 'datacenter:one', family: 'datacenter', title: 'Data center one' });
  const fixture = mount([camera, datacenter]);
  fixture.list.open();
  click(row(fixture.panel, camera.id));
  input(fixture.search, 'Camera');
  fixture.list.update([feature(0, { title: 'Camera refreshed' }), datacenter]);
  click(button(fixture.panel, 'Show on map'));
  assert.deepEqual(fixture.opened, [], 'selection, search, refresh and Show on map never open viewers');
  assert.equal(fixture.panel.hidden, false);
  click(button(fixture.panel, 'View camera'));
  assert.deepEqual(fixture.opened, [{ id: camera.id, family: 'camera' }]);
  assert.deepEqual(fixture.openStates, [true], 'drawer closes before the existing viewer opens');
  assert.equal(fixture.closed, 1);
  assert.equal(fixture.shown.length, 1, 'opening a viewer adds no map movement');

  fixture.list.open(datacenter.id);
  click(button(fixture.panel, 'More data center details'));
  assert.deepEqual(fixture.opened.at(-1), { id: datacenter.id, family: 'datacenter' });
  assert.deepEqual(fixture.openStates, [true, true]);
  assert.equal(fixture.shown.length, 1);
  fixture.list.destroy();
});

test('forecast selections have no viewer action and removed sources cannot open stale viewers', () => {
  const forecast = feature(1, { id: 'forecast:situation:one', family: 'forecast', title: 'Forecast one' });
  const fixture = mount([feature(0), forecast]);
  fixture.list.open(forecast.id);
  const action = fixture.panel.querySelector<HTMLButtonElement>('.map-feature-list-open')!;
  assert.equal(action.hidden, true);
  click(action);
  assert.deepEqual(fixture.opened, []);
  assert.equal(fixture.panel.hidden, false);
  fixture.list.open('camera:0');
  assert.equal(action.hidden, false);
  fixture.list.update([forecast]);
  assert.equal(action.disabled, true);
  click(action);
  assert.deepEqual(fixture.opened, []);
  assert.equal(fixture.panel.hidden, false);
  fixture.list.destroy();
});

test('hidden-layer sources keep explicit viewer access without revealing or moving the map', () => {
  const fixture = mount([feature(0, { visible: false })]);
  fixture.list.open('camera:0');
  const action = button(fixture.panel, 'View camera');
  assert.equal(action.disabled, false);
  assert.equal(button(fixture.panel, 'Show on map').disabled, true);
  click(action);
  assert.deepEqual(fixture.opened, [{ id: 'camera:0', family: 'camera' }]);
  assert.deepEqual(fixture.openStates, [true]);
  assert.deepEqual(fixture.shown, []);
  assert.deepEqual(fixture.selected, []);
  fixture.list.destroy();
});

test('a source removed synchronously during drawer close is not dispatched to a viewer', () => {
  let removeSource = (): void => {};
  const fixture = mount([feature(0)], () => removeSource());
  removeSource = () => fixture.list.update([]);
  fixture.list.open('camera:0');
  click(button(fixture.panel, 'View camera'));
  assert.equal(fixture.panel.hidden, true);
  assert.deepEqual(fixture.opened, []);
  fixture.list.destroy();
});

test('viewer handoff uses the reachable entry while ordinary Escape restores a canvas invoker', () => {
  const fixture = mount([feature(0)]);
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  fixture.container.append(canvas);
  canvas.focus();
  fixture.list.open('camera:0');
  fixture.search.dispatchEvent(new happyWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(document.activeElement === canvas, 'ordinary Escape retains its original invoker');

  fixture.list.open('camera:0');
  click(button(fixture.panel, 'View camera'));
  assert.ok(fixture.openFocus[0] === fixture.entry, 'existing viewer captures a reachable return target');
  assert.deepEqual(fixture.opened, [{ id: 'camera:0', family: 'camera' }]);
  fixture.list.destroy();
});

test('destroying during close cancels viewer handoff without focusing the removed entry', () => {
  let destroyList = (): void => {};
  const fixture = mount([feature(0)], () => destroyList());
  destroyList = () => fixture.list.destroy();
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  fixture.container.append(canvas);
  canvas.focus();
  fixture.list.open('camera:0');
  click(button(fixture.panel, 'View camera'));
  assert.equal(fixture.entry.isConnected, false);
  assert.equal(fixture.panel.isConnected, false);
  assert.ok(document.activeElement === canvas, 'destroying during close retains canvas focus');
  assert.deepEqual(fixture.opened, []);
});

test('null clears selection and closing or destroying releases only owned DOM', () => {
  const fixture = mount([feature(0)]);
  fixture.list.open('camera:0');
  fixture.list.update([feature(0)], null);
  assert.equal(fixture.panel.querySelector<HTMLElement>('.map-feature-list-detail')!.hidden, true);
  fixture.list.destroy();
  fixture.list.destroy();
  fixture.list.open();
  assert.ok(document.querySelector('.map-feature-list-panel') === null, 'destroy removes the owned drawer');
  assert.ok(fixture.container.querySelector('.map-feature-list-entry') === null, 'destroy removes the owned entry');
  assert.ok(fixture.container.querySelector('.map-controls') !== null, 'destroy preserves unrelated classic controls');
});
