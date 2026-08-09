import test from 'node:test';
import assert from 'node:assert/strict';

import {
  algorithmSafetyStatus,
  quarantinedAlgorithmIds,
} from '../safety-policy.mjs';

test('unsafe algorithms and failing safety algorithms are quarantined', () => {
  const health = {
    algorithms: [
      { algorithmId: 'analyst-loop', criticality: 'high', status: 'unsafe' },
      { algorithmId: 'warning-verification', criticality: 'safety', status: 'failing' },
      { algorithmId: 'mode-forecast', criticality: 'high', status: 'failing' },
    ],
  };

  assert.equal(algorithmSafetyStatus(health, 'analyst-loop').quarantined, true);
  assert.equal(algorithmSafetyStatus(health, 'warning-verification').quarantined, true);
  assert.equal(algorithmSafetyStatus(health, 'mode-forecast').quarantined, false);
  assert.deepEqual(
    quarantinedAlgorithmIds(health),
    ['analyst-loop', 'warning-verification'],
  );
});

test('missing health evidence is disclosed but does not invent a quarantine', () => {
  assert.deepEqual(algorithmSafetyStatus(null, 'analyst-loop'), {
    algorithmId: 'analyst-loop',
    status: 'unknown',
    quarantined: false,
    reason: 'No algorithm health evidence is available.',
  });
});
