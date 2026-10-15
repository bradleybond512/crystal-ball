import assert from 'node:assert/strict';
import test from 'node:test';
import type { ForecastRegion } from '../../services/forecast-overlay.ts';
import type { ScoredFAACamera } from '../../services/faa-cameras.ts';
import {
  CameraPresentationIndex,
  forecastFeatures,
  groupForecastPresentation,
  layoutMapLabels,
  type MapLabelCandidate,
} from '../map-clarity-model.ts';

function region(overrides: Partial<ForecastRegion> = {}): ForecastRegion {
  return {
    id: 'ema-north america', center: [-100, 45], riskScore: 80, velocity: 1,
    trend: 'rising', domains: ['infrastructure'], label: 'North America', radius: 500,
    geometry: 'radius', radiusBasis: 'regional-context', contributions: [
      { kind: 'ema', id: 'ema-north america', label: 'North America', riskScore: 35, center: [-100, 45], radius: 500 },
      { kind: 'situation', id: 'source-a', title: 'Reported outage', confidence: 0.8, center: [-110, 30], radius: 0 },
    ],
    ...overrides,
  };
}

function camera(id: string, lon = -105, lat = 40, overrides: Partial<ScoredFAACamera> = {}): ScoredFAACamera {
  return {
    id, name: `Camera ${id}`, lon, lat, state: 'CO', category: 'remote', imageUrl: '/fixture',
    isOnline: true, lastUpdated: '2026-10-15T00:00:00Z', alertProximityMi: null,
    alertLabel: null, relevanceScore: 30, aiConditions: null, ...overrides,
  };
}

test('forecast features retain source IDs, original metrics and contribution geometry after legacy EMA merging', () => {
  const input = [region()];
  const snapshot = JSON.stringify(input);
  const features = forecastFeatures(input);
  assert.deepEqual(features.map(f => f.id), ['forecast:ema:ema-north america', 'forecast:situation:source-a']);
  assert.deepEqual(features[0]?.metrics, [{ label: 'EMA forecast score', value: '35' }]);
  assert.deepEqual(features[1]?.metrics, [{ label: 'Situation confidence', value: '80%' }]);
  assert.deepEqual(features[1]?.center, [-110, 30]);
  assert.deepEqual(features.map(f => f.memberIds), features.map(f => [f.id]));
  const groups = groupForecastPresentation(input);
  assert.equal(groups.length, 2);
  assert.equal(groups.find(g => g.geometry === 'point')?.radius, 0);
  assert.equal(groups.find(g => g.geometry === 'radius')?.radius, 500);
  assert.equal(JSON.stringify(input), snapshot, 'adapters must not mutate provider or scoring data');
});

test('coincident presentation groups every member without changing source identity or inventing a score', () => {
  const contribution = region().contributions[1]!;
  const point = region({ id: 'sit-a', center: [-110, 30], radius: 0, geometry: 'point', contributions: [contribution] });
  const other = region({ id: 'sit-b', center: [-110, 30], radius: 0, geometry: 'point', contributions: [
    { kind: 'situation', id: 'source-b', title: '  ', confidence: 0.39, center: [-110, 30], radius: 0 },
  ] });
  const grouped = groupForecastPresentation([point, other]);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0]?.memberIds, ['forecast:situation:source-a', 'forecast:situation:source-b']);
  assert.equal(grouped[0]?.label, '2 forecast items');
  assert.equal(grouped[0]?.features[1]?.title, 'Reported situation');
  assert.equal('riskScore' in grouped[0]!, false);
  assert.equal(groupForecastPresentation([other, point])[0]?.id, grouped[0]?.id, 'group identity must survive shuffled input');
  assert.equal(groupForecastPresentation([point])[0]?.features[0]?.id, contribution.kind === 'situation' ? `forecast:situation:${contribution.id}` : '', 'source selection survives a group splitting');
});

test('duplicate region contributions deduplicate source IDs while distinct real radii remain distinct', () => {
  const first = region();
  const differentRadius = region({ contributions: [
    { kind: 'situation', id: 'area', title: 'Regional event', confidence: 0.6, center: [-100, 45], radius: 80 },
  ] });
  assert.equal(forecastFeatures([first, first]).length, 2);
  assert.deepEqual(groupForecastPresentation([first, differentRadius]).filter(g => g.geometry === 'radius').map(g => g.radius).sort((a, b) => a - b), [80, 500]);
});

test('zero coordinates are valid and malformed forecast positions fail closed with meaningful fallback names', () => {
  const input = region({ contributions: [
    { kind: 'ema', id: 'zero', label: '\n ', riskScore: 0, center: [0, 0], radius: 100 },
    { kind: 'situation', id: 'bad-nan', title: 'Invalid', confidence: 0.6, center: [Number.NaN, 4], radius: 0 },
    { kind: 'situation', id: 'bad-lat', title: 'Invalid', confidence: 0.6, center: [0, 95], radius: 0 },
    { kind: 'situation', id: 'bad-shape', title: 'Invalid', confidence: 0.6, center: null as unknown as [number, number], radius: 0 },
  ] });
  const features = forecastFeatures([input]);
  assert.equal(features.length, 1);
  assert.equal(features[0]?.title, 'Forecast region');
  assert.deepEqual(features[0]?.center, [0, 0]);
  assert.equal(groupForecastPresentation([input])[0]?.label, 'Forecast region');
});

test('camera clustering conserves all source IDs through zoom and pan, including zero and antimeridian positions', () => {
  const cameras = [camera('zero', 0, 0), camera('east', 179.9, 20), camera('west', -179.9, 20), camera('inland', -105, 40)];
  const snapshot = JSON.stringify(cameras);
  const index = new CameraPresentationIndex(cameras);
  const expected = cameras.map(c => `camera:${c.id}`).sort();
  for (const zoom of [0, 4, 10, 16, 19]) {
    const clusters = index.getClusters([-180, -90, 180, 90], zoom);
    assert.deepEqual(clusters.flatMap(c => c.memberIds).sort(), expected, `global member IDs at zoom ${zoom}`);
    assert.equal(clusters.reduce((total, c) => total + c.count, 0), cameras.length);
  }
  assert.deepEqual(index.getClusters([170, 10, -170, 30], 5).flatMap(c => c.memberIds).sort(), ['camera:east', 'camera:west']);
  assert.deepEqual(index.getClusters([-1, -1, 1, 1], 10).flatMap(c => c.memberIds), ['camera:zero']);
  assert.deepEqual(index.getFeatures().map(f => f.id).sort(), expected, 'panning cannot erase global accessible features');
  assert.equal(JSON.stringify(cameras), snapshot);
});

test('dense camera clusters expose every leaf above the old 200 cap and aggregate proximity without severity', () => {
  const cameras = Array.from({ length: 503 }, (_, i) => camera(`dense-${String(i).padStart(3, '0')}`, -105, 40, i === 502 ? { alertProximityMi: 5, alertLabel: 'Severe source alert' } : {}));
  const index = new CameraPresentationIndex(cameras);
  const clusters = index.getClusters([-180, -90, 180, 90], 3);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.count, 503);
  assert.equal(clusters[0]?.memberIds.length, 503);
  assert.equal(new Set(clusters[0]?.memberIds).size, 503);
  assert.equal(clusters[0]?.nearAlert, true);
  assert.equal('severity' in clusters[0]!, false);
  for (const id of clusters[0]!.memberIds) assert.ok(index.getCamera(id), `camera ${id} remains accessible`);
  assert.ok(Number.isFinite(index.expansionZoom(clusters[0]!.clusterId!)));
  assert.equal(index.getClusters([-180, -90, 180, 90], 3)[0]?.id, clusters[0]?.id);
  index.rebuild([...cameras].reverse());
  assert.equal(index.getClusters([-180, -90, 180, 90], 3)[0]?.id, clusters[0]?.id, 'snapshot order does not alter presentation identity');
});

test('camera refresh preserves selected source identity and rejects malformed positions without losing valid zero coordinates', () => {
  const index = new CameraPresentationIndex([camera('selected', 0, 0), camera('bad', 200, 10), camera('nan', 0, Number.NaN)]);
  assert.deepEqual(index.getFeatures().map(f => f.id), ['camera:selected']);
  index.rebuild([camera('selected', 20, 25, { name: 'Refreshed name' }), camera('new', 40, 40)]);
  assert.equal(index.getCamera('camera:selected')?.name, 'Refreshed name');
  assert.deepEqual(index.getFeatures().find(f => f.id === 'camera:selected')?.center, [20, 25]);
  index.rebuild([camera('new', 40, 40)]);
  assert.equal(index.getCamera('camera:selected'), undefined, 'removed selection is explicit to the details owner');
});

function candidate(id: string, x = 100, overrides: Partial<MapLabelCandidate> = {}): MapLabelCandidate {
  return { id, x, y: 100, width: 60, height: 20, category: 'forecast', ...overrides };
}

test('label collision placement deterministically favors selection then authoritative urgency', () => {
  const labels = [candidate('a-routine'), candidate('z-urgent', 100, { sourceSeverity: 'critical' }), candidate('selected', 100, { selected: true })];
  const snapshot = JSON.stringify(labels);
  assert.deepEqual(layoutMapLabels(labels).map(l => l.id), ['selected']);
  assert.deepEqual(layoutMapLabels(labels.filter(l => !l.selected)).map(l => l.id), ['z-urgent']);
  assert.deepEqual(layoutMapLabels([...labels].reverse()), layoutMapLabels(labels));
  assert.equal(JSON.stringify(labels), snapshot);
  assert.deepEqual(layoutMapLabels([candidate('a'), candidate('z', 100, { sourceSeverity: 'confidence-100' })]).map(l => l.id), ['a'], 'unknown strings cannot manufacture urgency');
});

test('label layout recalculates projected collisions on pan and zoom without removing source candidates', () => {
  const labels = [candidate('a'), candidate('b', 120), candidate('c', 240)];
  assert.deepEqual(layoutMapLabels(labels).map(l => l.id), ['a', 'c']);
  const zoomed = labels.map((l, i) => ({ ...l, x: 100 + i * 100 }));
  assert.deepEqual(layoutMapLabels(zoomed).map(l => l.id), ['a', 'b', 'c']);
  assert.equal(labels.length, 3);
  const visible = layoutMapLabels(zoomed, { viewport: { width: 260, height: 200 } });
  assert.deepEqual(visible.map(l => l.id), ['a', 'b']);
  for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
    const a = visible[i]!.rect, b = visible[j]!.rect;
    assert.ok(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  }
});

test('dense label placement stays bounded and rejects malformed projected boxes', () => {
  const labels = Array.from({ length: 3000 }, (_, i) => candidate(`label-${String(i).padStart(4, '0')}`, i * 100));
  labels.push(candidate('bad', Number.NaN), candidate('bad-size', 100, { width: Number.POSITIVE_INFINITY }), candidate('bad-extreme', Number.MAX_VALUE));
  const placed = layoutMapLabels(labels, { maxLabels: 120 });
  assert.equal(placed.length, 120);
  assert.equal(new Set(placed.map(l => l.id)).size, 120);
  assert.deepEqual(layoutMapLabels([...labels].reverse(), { maxLabels: 120 }), placed);
});
