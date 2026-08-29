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

test('canonical alert evidence has a pinned SHA-256 revision', async () => {
  assert.equal(
    await buildStormAlertSourceRevision([alert]),
    '4fd0bcc61acecabcfbc7c567e2dc2e789ae2ebebb350247f886018e5d79d7e64',
  );
});

test('missing and non-string alert identity fields fail closed', async () => {
  const identityFields = ['id', 'event', 'sent', 'expires'] as const;
  for (const field of identityFields) {
    const missing = { ...alert } as Record<string, unknown>;
    delete missing[field];
    assert.equal(
      await buildStormAlertSourceRevision([missing as unknown as NwsAlertMinimal]),
      null,
      `missing ${field}`,
    );

    const nonString = { ...alert, [field]: 7 };
    assert.equal(
      await buildStormAlertSourceRevision([nonString as unknown as NwsAlertMinimal]),
      null,
      `non-string ${field}`,
    );
  }
});

test('non-string reference and UGC zone values fail closed', async () => {
  for (const field of ['references', 'ugcZones'] as const) {
    const malformed = { ...alert, [field]: ['valid', 7] };
    assert.equal(
      await buildStormAlertSourceRevision([malformed as unknown as NwsAlertMinimal]),
      null,
      field,
    );
  }
});

test('malformed and non-finite polygon coordinates fail closed', async () => {
  const malformedCoordinates: unknown[] = [
    'not-a-coordinate',
    [-86.8, 41.5, 10],
    [Number.NaN, 41.5],
    [-86.8, Number.POSITIVE_INFINITY],
  ];
  for (const coordinate of malformedCoordinates) {
    const malformed = {
      ...alert,
      polygon: { rings: [[coordinate]] },
    };
    assert.equal(
      await buildStormAlertSourceRevision([malformed as unknown as NwsAlertMinimal]),
      null,
      JSON.stringify(coordinate),
    );
  }
});

test('digest rejection fails closed and restores the crypto descriptor', async () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  assert.ok(originalDescriptor);
  try {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        subtle: {
          digest: async () => { throw new Error('digest unavailable'); },
        },
      },
    });
    assert.equal(await buildStormAlertSourceRevision([alert]), null);
  } finally {
    Object.defineProperty(globalThis, 'crypto', originalDescriptor);
  }
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, 'crypto'), originalDescriptor);
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

test('invalid seed and publish revisions leave channel state and events unchanged', () => {
  const channel = createStormAlertRevisionChannel();
  const events: Array<{ sourceRevision: string }> = [];
  channel.subscribe((event) => events.push(event));
  const seeded = 'a'.repeat(64);
  const published = 'b'.repeat(64);

  assert.equal(channel.seedRevision(seeded), true);
  assert.equal(channel.publishRevision(published), true);
  assert.equal(channel.current(), published);
  assert.deepEqual(events, [{ sourceRevision: published }]);

  const invalidRevisions: unknown[] = [
    '',
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(64),
    `${'a'.repeat(63)}g`,
    null,
    7,
  ];
  for (const invalid of invalidRevisions) {
    assert.equal(channel.seedRevision(invalid as string), false, `seed ${String(invalid)}`);
    assert.equal(channel.current(), published);
    assert.deepEqual(events, [{ sourceRevision: published }]);

    assert.equal(channel.publishRevision(invalid as string), false, `publish ${String(invalid)}`);
    assert.equal(channel.current(), published);
    assert.deepEqual(events, [{ sourceRevision: published }]);
  }
});
