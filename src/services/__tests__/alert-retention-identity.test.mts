import assert from 'node:assert/strict';
import test from 'node:test';
import { identifyAlert } from '../alert-identity.ts';

const timestamp = 1_790_000_000_000;
const alert = { id: 'warning', source: 'nws', timestamp, title: 'Warning', body: 'Details', severity: 'high' };
const retention = { kind: 'nws-expiry', observedAt: timestamp, issuedAt: timestamp - 1000, expiresAt: timestamp + 1000 };

test('NWS issuance and expiry are material revisions without changing report identity', () => {
  const original = identifyAlert({ ...alert, retentionEvidence: retention });
  assert.ok(original);
  for (const update of [{ issuedAt: timestamp }, { expiresAt: timestamp + 2000 }]) {
    const revised = identifyAlert({ ...alert, retentionEvidence: { ...retention, ...update } });
    assert.ok(revised);
    assert.equal(revised.key, original.key);
    assert.notEqual(revised.revision, original.revision);
  }
});

test('repeated observations are excluded from NWS and GDACS material identity', () => {
  assert.deepEqual(identifyAlert({ ...alert, retentionEvidence: retention }),
    identifyAlert({ ...alert, retentionEvidence: { ...retention, observedAt: timestamp + 500 } }));
  assert.deepEqual(identifyAlert({ ...alert, source: 'gdacs' }),
    identifyAlert({ ...alert, source: 'gdacs', retentionEvidence: { kind: 'gdacs-observation', observedAt: timestamp } }));
});

test('unsupported or malformed lifecycle metadata does not rewrite existing identity', () => {
  for (const retentionEvidence of [{ ...retention, expiresAt: 'tomorrow' }, { ...retention, issuedAt: timestamp + 1 },
    { kind: 'unknown' }, { ...retention, expiresAt: timestamp - 1000 }]) {
    assert.deepEqual(identifyAlert({ ...alert, retentionEvidence }), identifyAlert(alert));
  }
});
