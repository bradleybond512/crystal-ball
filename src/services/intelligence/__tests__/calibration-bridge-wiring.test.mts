import { test } from 'node:test';
import assert from 'node:assert';
import { wireModeForecastCalibration, settleCalibrationBridges }
  from '../calibration-bridge-wiring';

test('wireModeForecastCalibration resolves then records via injected fns', () => {
  const calls: string[] = [];
  wireModeForecastCalibration(
    { advisories: [{ domain: 'finance', pressure: 0.7 } as never] },
    {
      resolveFromObservation: (d, p) => { calls.push(`resolve:${d}:${p}`); return 0; },
      recordPredictions: (a) => { calls.push(`record:${a.length}`); },
      enabled: () => true,
    },
  );
  // resolve BEFORE record so a fresh record can't self-resolve in the same tick
  assert.deepEqual(calls, ['resolve:finance:0.7', 'record:1']);
});

test('disabled switch is a no-op', () => {
  const calls: string[] = [];
  wireModeForecastCalibration({ advisories: [] }, {
    resolveFromObservation: () => { calls.push('r'); return 0; },
    recordPredictions: () => { calls.push('rec'); },
    enabled: () => false,
  });
  assert.equal(calls.length, 0);
});

test('settleCalibrationBridges runs both settlers before generic expiry', () => {
  const order: string[] = [];
  settleCalibrationBridges({
    settleShortage: () => { order.push('shortage'); return 0; },
    settleAdvisory: () => { order.push('advisory'); return 0; },
    expirePending: () => { order.push('expire'); return 0; },
    enabled: () => true,
  });
  assert.deepEqual(order, ['shortage', 'advisory', 'expire']);
});

test('settle with disabled switch still calls expirePending only', () => {
  const order: string[] = [];
  settleCalibrationBridges({
    settleShortage: () => { order.push('shortage'); return 0; },
    settleAdvisory: () => { order.push('advisory'); return 0; },
    expirePending: () => { order.push('expire'); return 0; },
    enabled: () => false,
  });
  assert.deepEqual(order, ['expire']);
});
