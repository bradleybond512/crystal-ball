import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStormAlertSourceRevision,
  createStormAlertRevisionChannel,
} from '../storm-alert-source-revision.ts';
import type { NwsAlertMinimal } from '../../weather/weather-threat-types.ts';

const alert: NwsAlertMinimal = {
  id: 'nws-alert-1',
  event: 'Tornado Warning',
  polygon: { rings: [[[-86.8, 41.5], [-86.6, 41.5], [-86.7, 41.7], [-86.8, 41.5]]] },
  sent: '2026-08-26T12:00:00.000Z',
  expires: '2026-08-26T13:00:00.000Z',
  messageType: 'alert',
  severity: 'extreme',
  references: ['ref-b', 'ref-a'],
  ugcZones: ['INZ006', 'INZ005'],
  headline: 'Tornado Warning issued for LaPorte County',
};

test('alert source revision is strict SHA-256 over canonical evidence, independent of feed/set ordering', async () => {
  const second = { ...alert, id: 'nws-alert-2', references: ['ref-c'] };
  const revision = await buildStormAlertSourceRevision([alert, second]);
  assert.match(revision ?? '', /^[a-f0-9]{64}$/);
  assert.equal(await buildStormAlertSourceRevision([
    { ...second },
    { ...alert, references: ['ref-a', 'ref-b'], ugcZones: ['INZ005', 'INZ006'] },
  ]), revision);
  assert.notEqual(await buildStormAlertSourceRevision([
    { ...alert, expires: '2026-08-26T13:01:00.000Z' }, second,
  ]), revision);
});

test('hydration seeds silently and only changed authoritative alert evidence publishes a revision', async () => {
  const channel = createStormAlertRevisionChannel();
  const events: Array<{ sourceRevision: string }> = [];
  const unsubscribe = channel.subscribe((event) => events.push(event));

  const hydratedRevision = await channel.seedHydrated([alert]);
  assert.match(hydratedRevision ?? '', /^[a-f0-9]{64}$/);
  assert.deepEqual(events, [], 'hydration cannot invalidate persisted evidence');

  assert.equal(await channel.publishAuthoritative([{ ...alert }]), hydratedRevision);
  assert.deepEqual(events, [], 'unchanged refresh, aging, and plan recomputation stay silent');

  const changedRevision = await channel.publishAuthoritative([{
    ...alert,
    headline: 'Updated tornado warning polygon',
  }]);
  assert.notEqual(changedRevision, hydratedRevision, 'same observation time may still carry changed evidence');
  assert.deepEqual(events, [{ sourceRevision: changedRevision! }]);

  await channel.publishAuthoritative([{ ...alert, headline: 'Updated tornado warning polygon' }]);
  assert.equal(events.length, 1, 'an unchanged authoritative recapture cannot invalidate again');
  unsubscribe();
});
