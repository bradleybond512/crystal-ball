import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  declareAlgorithmTunables,
  exportParamOverrides,
  getParamSnapshot,
  getParamValue,
  importParamOverrides,
  listTunableAlgorithms,
  onParamChange,
  resetAllParams,
  resetParamValue,
  resetTunableRegistry,
  setParamValue,
  validateParamValue,
} from '../tunable-registry';

beforeEach(() => {
  resetTunableRegistry();
});

describe('declaration', () => {
  it('rejects defaults that violate declared bounds', () => {
    assert.throws(
      () =>
        declareAlgorithmTunables({
          algorithmId: 'bad',
          params: [
            { name: 'x', type: 'float', default: 5, min: 0, max: 1, description: 'oops' },
          ],
        }),
      /violates declared bounds/,
    );
  });

  it('rejects bool default that is not boolean', () => {
    assert.throws(
      () =>
        declareAlgorithmTunables({
          algorithmId: 'bad',
          // @ts-expect-error - test runtime validation
          params: [{ name: 'x', type: 'bool', default: 1, description: 'oops' }],
        }),
      /violates declared bounds/,
    );
  });

  it('lists declared tunables', () => {
    declareAlgorithmTunables({
      algorithmId: 'a1',
      params: [{ name: 'x', type: 'int', default: 1, min: 0, max: 5, description: 'd' }],
    });
    declareAlgorithmTunables({
      algorithmId: 'a2',
      params: [{ name: 'y', type: 'bool', default: true, description: 'd' }],
    });
    assert.equal(listTunableAlgorithms().length, 2);
  });
});

describe('validation', () => {
  it('int rejects non-integer', () => {
    const p = { name: 'x', type: 'int' as const, default: 1, min: 0, max: 10, description: '' };
    assert.equal(validateParamValue(p, 1.5), false);
    assert.equal(validateParamValue(p, 5), true);
  });

  it('float rejects out-of-bounds', () => {
    const p = { name: 'x', type: 'float' as const, default: 0.5, min: 0, max: 1, description: '' };
    assert.equal(validateParamValue(p, -0.1), false);
    assert.equal(validateParamValue(p, 1.1), false);
    assert.equal(validateParamValue(p, 0.5), true);
  });

  it('oneOf restricts allowed values', () => {
    const p = {
      name: 'mode',
      type: 'int' as const,
      default: 1,
      oneOf: [1, 2, 4, 8],
      description: '',
    };
    assert.equal(validateParamValue(p, 1), true);
    assert.equal(validateParamValue(p, 3), false);
  });

  it('bool rejects non-boolean', () => {
    const p = { name: 'x', type: 'bool' as const, default: true, description: '' };
    assert.equal(validateParamValue(p, true), true);
    // @ts-expect-error - intentional bad value
    assert.equal(validateParamValue(p, 1), false);
  });
});

describe('get/set', () => {
  it('returns default before any override', () => {
    declareAlgorithmTunables({
      algorithmId: 'a1',
      params: [{ name: 'x', type: 'int', default: 7, min: 0, max: 10, description: '' }],
    });
    assert.equal(getParamValue('a1', 'x'), 7);
  });

  it('returns override after set', () => {
    declareAlgorithmTunables({
      algorithmId: 'a1',
      params: [{ name: 'x', type: 'int', default: 7, min: 0, max: 10, description: '' }],
    });
    setParamValue('a1', 'x', 9);
    assert.equal(getParamValue('a1', 'x'), 9);
  });

  it('throws on out-of-bounds set', () => {
    declareAlgorithmTunables({
      algorithmId: 'a1',
      params: [{ name: 'x', type: 'int', default: 7, min: 0, max: 10, description: '' }],
    });
    assert.throws(() => setParamValue('a1', 'x', 99), /violates bounds/);
  });

  it('throws on unknown algorithm', () => {
    assert.throws(() => getParamValue('missing', 'x'), /No tunables declared/);
  });

  it('throws on unknown param', () => {
    declareAlgorithmTunables({
      algorithmId: 'a1',
      params: [{ name: 'x', type: 'int', default: 7, min: 0, max: 10, description: '' }],
    });
    assert.throws(() => getParamValue('a1', 'missing'), /No param/);
  });

  it('reset reverts to default', () => {
    declareAlgorithmTunables({
      algorithmId: 'a1',
      params: [{ name: 'x', type: 'int', default: 7, min: 0, max: 10, description: '' }],
    });
    setParamValue('a1', 'x', 9);
    resetParamValue('a1', 'x');
    assert.equal(getParamValue('a1', 'x'), 7);
  });
});

describe('snapshot', () => {
  it('returns full snapshot', () => {
    declareAlgorithmTunables({
      algorithmId: 'a1',
      params: [
        { name: 'x', type: 'int', default: 1, min: 0, max: 10, description: '' },
        { name: 'y', type: 'float', default: 0.5, min: 0, max: 1, description: '' },
      ],
    });
    setParamValue('a1', 'y', 0.8);
    const snap = getParamSnapshot('a1');
    assert.deepEqual(snap.params, { x: 1, y: 0.8 });
  });
});

describe('hot-reload listeners', () => {
  it('fires listener on param change', () => {
    declareAlgorithmTunables({
      algorithmId: 'a1',
      params: [{ name: 'x', type: 'int', default: 1, min: 0, max: 10, description: '' }],
    });
    const calls: { algorithmId: string; name: string; value: unknown }[] = [];
    const off = onParamChange((algorithmId, name, value) => {
      calls.push({ algorithmId, name, value });
    });
    setParamValue('a1', 'x', 5);
    setParamValue('a1', 'x', 7);
    off();
    setParamValue('a1', 'x', 3);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { algorithmId: 'a1', name: 'x', value: 5 });
    assert.deepEqual(calls[1], { algorithmId: 'a1', name: 'x', value: 7 });
  });
});

describe('persistence', () => {
  it('exports and imports overrides', () => {
    declareAlgorithmTunables({
      algorithmId: 'a1',
      params: [
        { name: 'x', type: 'int', default: 1, min: 0, max: 10, description: '' },
        { name: 'y', type: 'bool', default: true, description: '' },
      ],
    });
    setParamValue('a1', 'x', 5);
    setParamValue('a1', 'y', false);
    const exported = exportParamOverrides();
    resetAllParams();
    assert.equal(getParamValue('a1', 'x'), 1); // back to default
    importParamOverrides(exported);
    assert.equal(getParamValue('a1', 'x'), 5);
    assert.equal(getParamValue('a1', 'y'), false);
  });

  it('skips invalid values during import', () => {
    declareAlgorithmTunables({
      algorithmId: 'a1',
      params: [{ name: 'x', type: 'int', default: 1, min: 0, max: 10, description: '' }],
    });
    importParamOverrides({ a1: { x: 999 } });
    assert.equal(getParamValue('a1', 'x'), 1); // out-of-bounds skipped
  });

  it('skips unknown algorithm during import', () => {
    declareAlgorithmTunables({
      algorithmId: 'a1',
      params: [{ name: 'x', type: 'int', default: 1, min: 0, max: 10, description: '' }],
    });
    importParamOverrides({ unknown: { x: 5 } });
    // No error, just silently ignored.
    assert.deepEqual(exportParamOverrides(), {});
  });
});
