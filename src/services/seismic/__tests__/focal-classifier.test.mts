import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBeachballSvg,
  classifyFaultType,
  parseUsgsMomentTensor,
  pickDiagnosticPlane,
  type NodalPlane,
} from '../focal-classifier.ts';

// ── classifyFaultType ──────────────────────────────────────────────────

test('classifyFaultType: pure right-lateral strike-slip (rake 0)', () => {
  assert.equal(classifyFaultType(0), 'strike_slip');
});

test('classifyFaultType: pure left-lateral strike-slip (rake 180)', () => {
  // 180 normalises to -180/180 boundary; |r|>150 triggers strike_slip.
  assert.equal(classifyFaultType(180), 'strike_slip');
  assert.equal(classifyFaultType(-180), 'strike_slip');
  assert.equal(classifyFaultType(170), 'strike_slip');
  assert.equal(classifyFaultType(-160), 'strike_slip');
});

test('classifyFaultType: pure normal fault (rake -90)', () => {
  assert.equal(classifyFaultType(-90), 'normal');
});

test('classifyFaultType: pure reverse / thrust fault (rake 90)', () => {
  assert.equal(classifyFaultType(90), 'reverse');
});

test('classifyFaultType: oblique edges fall to oblique only when discriminator misses', () => {
  // The boundary cases (|rake| === 30 or 150) are boundary inclusive
  // for reverse/normal, exclusive for strike-slip. Anything between the
  // pure ranges already falls in either reverse or normal — `oblique`
  // covers cases the rake math can't classify (e.g. NaN-normalised).
  assert.equal(classifyFaultType(45), 'reverse');
  assert.equal(classifyFaultType(-45), 'normal');
});

test('classifyFaultType: handles wraparound rake values', () => {
  assert.equal(classifyFaultType(360), 'strike_slip');
  assert.equal(classifyFaultType(-360), 'strike_slip');
  assert.equal(classifyFaultType(450), 'reverse'); // 450 → 90
});

// ── pickDiagnosticPlane ────────────────────────────────────────────────

test('pickDiagnosticPlane: prefers steeper plane', () => {
  const p1: NodalPlane = { strike: 0, dip: 30, rake: 90 };
  const p2: NodalPlane = { strike: 90, dip: 80, rake: 0 };
  assert.equal(pickDiagnosticPlane(p1, p2), p2);
});

test('pickDiagnosticPlane: equal dips → plane 1 wins', () => {
  const p1: NodalPlane = { strike: 0, dip: 45, rake: 90 };
  const p2: NodalPlane = { strike: 90, dip: 45, rake: 0 };
  assert.equal(pickDiagnosticPlane(p1, p2), p1);
});

// ── buildBeachballSvg ──────────────────────────────────────────────────

test('buildBeachballSvg: returns valid <svg> with viewBox', () => {
  const svg = buildBeachballSvg(
    { p1: { strike: 0, dip: 90, rake: 0 }, p2: { strike: 90, dip: 0, rake: 0 } },
    'strike_slip',
  );
  assert.ok(svg.startsWith('<svg'), 'starts with <svg');
  assert.ok(svg.endsWith('</svg>'), 'ends with </svg>');
  assert.ok(/viewBox="0 0 \d+ \d+"/.test(svg), 'has viewBox');
  assert.ok(svg.includes('<circle'), 'has bounding circle');
});

test('buildBeachballSvg: rotation reflects steeper plane strike', () => {
  const horizontal: NodalPlane = { strike: 0, dip: 30, rake: 90 };
  const vertical:   NodalPlane = { strike: 45, dip: 90, rake: 0 };
  const svg = buildBeachballSvg({ p1: horizontal, p2: vertical }, 'strike_slip');
  assert.ok(svg.includes('rotate(45'), 'rotation matches steeper plane (dip 90, strike 45)');
});

test('buildBeachballSvg: aria-label encodes fault type', () => {
  const svg = buildBeachballSvg(
    { p1: { strike: 0, dip: 60, rake: -90 }, p2: { strike: 180, dip: 30, rake: -90 } },
    'normal',
  );
  assert.ok(svg.includes('aria-label="normal focal mechanism"'));
});

test('buildBeachballSvg: distinct fault types produce distinct fills', () => {
  const planes = { p1: { strike: 0, dip: 60, rake: 0 }, p2: { strike: 90, dip: 60, rake: 0 } };
  const ss = buildBeachballSvg(planes, 'strike_slip');
  const nm = buildBeachballSvg(planes, 'normal');
  const rv = buildBeachballSvg(planes, 'reverse');
  const ob = buildBeachballSvg(planes, 'oblique');
  // Each variant has a unique aria-label and they should not be byte-
  // equal, since the wedge angles differ.
  assert.notEqual(ss, nm);
  assert.notEqual(nm, rv);
  assert.notEqual(rv, ob);
  assert.notEqual(ss, ob);
});

test('buildBeachballSvg: no caller-provided strings appear in SVG body', () => {
  // Defensive: SVG output is built only from numeric attributes plus
  // fixed labels — there is no caller text channel that could embed
  // unescaped HTML.
  const svg = buildBeachballSvg(
    { p1: { strike: 12.345, dip: 67.89, rake: 90 }, p2: { strike: 192.345, dip: 30, rake: 90 } },
    'reverse',
  );
  assert.ok(!svg.includes('<script'), 'no script tags');
  assert.ok(!svg.includes('javascript:'), 'no javascript: URLs');
});

// ── parseUsgsMomentTensor ──────────────────────────────────────────────

const USGS_FIXTURE = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    id: 'us7000abcd',
    properties: {
      mag: 6.4,
      place: 'Test region',
      products: {
        'moment-tensor': [{
          type: 'moment-tensor',
          properties: {
            'derived-magnitude': '6.4',
            'derived-depth': '12.5',
            'nodal-plane-1-strike': '120',
            'nodal-plane-1-dip': '60',
            'nodal-plane-1-rake': '90',
            'nodal-plane-2-strike': '300',
            'nodal-plane-2-dip': '30',
            'nodal-plane-2-rake': '90',
          },
        }],
      },
    },
  }],
};

test('parseUsgsMomentTensor: parses USGS FeatureCollection payload', () => {
  const fm = parseUsgsMomentTensor(USGS_FIXTURE);
  assert.ok(fm, 'returns a FocalMechanism');
  assert.equal(fm!.eventId, 'us7000abcd');
  assert.equal(fm!.faultType, 'reverse'); // rake 90 → reverse
  assert.equal(fm!.momentMagnitude, 6.4);
  assert.equal(fm!.depthKm, 12.5);
  assert.equal(fm!.nodalPlane1.strike, 120);
  assert.equal(fm!.nodalPlane2.dip, 30);
});

test('parseUsgsMomentTensor: returns null without moment-tensor product', () => {
  const fm = parseUsgsMomentTensor({
    type: 'Feature',
    id: 'us7000xyzw',
    properties: { products: {} },
  });
  assert.equal(fm, null);
});

test('parseUsgsMomentTensor: returns null on completely empty payload', () => {
  assert.equal(parseUsgsMomentTensor(null), null);
  assert.equal(parseUsgsMomentTensor({}), null);
  assert.equal(parseUsgsMomentTensor({ type: 'FeatureCollection', features: [] }), null);
});

test('parseUsgsMomentTensor: handles numeric and string strike/dip/rake', () => {
  const fm = parseUsgsMomentTensor({
    type: 'Feature',
    id: 'us7000num',
    properties: {
      products: {
        'moment-tensor': [{
          properties: {
            'nodal-plane-1-strike': 0,
            'nodal-plane-1-dip': 90,
            'nodal-plane-1-rake': 0,
            'nodal-plane-2-strike': 90,
            'nodal-plane-2-dip': 90,
            'nodal-plane-2-rake': 180,
          },
        }],
      },
    },
  });
  assert.ok(fm, 'parses with numeric inputs');
  assert.equal(fm!.faultType, 'strike_slip');
});

test('parseUsgsMomentTensor: missing one nodal plane → null', () => {
  const fm = parseUsgsMomentTensor({
    type: 'Feature',
    id: 'us7000bad',
    properties: {
      products: {
        'moment-tensor': [{
          properties: {
            'nodal-plane-1-strike': 0,
            'nodal-plane-1-dip': 60,
            'nodal-plane-1-rake': -90,
            // plane 2 missing
          },
        }],
      },
    },
  });
  assert.equal(fm, null);
});

test('parseUsgsMomentTensor: classifies normal-faulting earthquake', () => {
  const fm = parseUsgsMomentTensor({
    type: 'Feature',
    id: 'us7000norm',
    properties: {
      products: {
        'moment-tensor': [{
          properties: {
            'nodal-plane-1-strike': 0,
            'nodal-plane-1-dip': 60,
            'nodal-plane-1-rake': -90,
            'nodal-plane-2-strike': 180,
            'nodal-plane-2-dip': 30,
            'nodal-plane-2-rake': -90,
          },
        }],
      },
    },
  });
  assert.ok(fm);
  assert.equal(fm!.faultType, 'normal');
});

test('parseUsgsMomentTensor: emits beachball SVG in result', () => {
  const fm = parseUsgsMomentTensor(USGS_FIXTURE);
  assert.ok(fm);
  assert.ok(fm!.beachballSvg.startsWith('<svg'));
  assert.ok(fm!.beachballSvg.includes('aria-label="reverse focal mechanism"'));
});

// ── JSON serializability ──────────────────────────────────────────────

test('FocalMechanism is JSON-serializable', () => {
  const fm = parseUsgsMomentTensor(USGS_FIXTURE);
  assert.ok(fm);
  const round = JSON.parse(JSON.stringify(fm));
  assert.equal(round.faultType, 'reverse');
  assert.equal(round.eventId, 'us7000abcd');
});
