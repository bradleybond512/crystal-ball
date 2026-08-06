import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CustomDataSource } from 'cesium';

import { GlobeWebcamLayer } from '../webcam-globe-layer.ts';
import type { WebcamFeed } from '../webcam-types.ts';

function feed(id: string, over: Partial<WebcamFeed> = {}): WebcamFeed {
  return {
    id, source: 'GEONET', name: 'Cam', lat: -39.157, lon: 175.632,
    snapshotUrl: 'https://images.geonet.org.nz/volcano/cameras/latest/shared.jpg',
    refreshIntervalSec: 300, category: 'volcano', metadata: {}, ...over,
  };
}

// Regression for the God's Vision crash: GeoNet can list the same camera under
// two volcano entries with an identical derived id. Cesium's EntityCollection
// throws (and halts the render loop) on a duplicate add — refresh() must skip
// the repeat instead of letting it propagate.
test('GlobeWebcamLayer.refresh: duplicate feed ids are deduped, not thrown', async () => {
  const feeds = [feed('GEONET:shared'), feed('GEONET:shared'), feed('GEONET:other')];
  const layer = new GlobeWebcamLayer({} as never, { fetchFeeds: async () => feeds });
  (layer as unknown as { dataSource: CustomDataSource }).dataSource = new CustomDataSource('test');

  await assert.doesNotReject(() => layer.refresh());

  const ds = (layer as unknown as { dataSource: CustomDataSource }).dataSource;
  assert.equal(ds.entities.values.length, 2);
  assert.ok(ds.entities.getById('GEONET:shared'));
  assert.ok(ds.entities.getById('GEONET:other'));
});
