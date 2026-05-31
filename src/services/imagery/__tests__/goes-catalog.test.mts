import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GOES_PRODUCTS,
  GOES_SATELLITES,
  GOES_SECTORS,
  frameUrl,
  goesTimestampToEpoch,
  isValidSelection,
  latestUrl,
  parseFrameListing,
  productDirUrl,
  recentFrames,
  thumbnailUrl,
} from '../goes-catalog';

describe('catalog', () => {
  it('uses GOES-19 for East (GOES-16 was retired)', () => {
    const east = GOES_SATELLITES.find((s) => s.position === 'east');
    assert.equal(east?.id, 'GOES19');
  });

  it('uses GOES-18 for West', () => {
    const west = GOES_SATELLITES.find((s) => s.position === 'west');
    assert.equal(west?.id, 'GOES18');
  });

  it('includes fire-detection and water-vapor bands', () => {
    const ids = GOES_PRODUCTS.map((p) => p.id);
    assert.ok(ids.includes('07')); // shortwave IR / fire
    assert.ok(ids.includes('08')); // upper WV
    assert.ok(ids.includes('13')); // clean IR
    assert.ok(ids.includes('GEOCOLOR'));
  });

  it('has CONUS and Full Disk sectors', () => {
    const ids = GOES_SECTORS.map((s) => s.id);
    assert.deepEqual(ids, ['CONUS', 'FD']);
  });
});

describe('isValidSelection', () => {
  it('accepts a real combination', () => {
    assert.equal(isValidSelection('GOES19', 'CONUS', 'GEOCOLOR'), true);
  });
  it('rejects unknown satellite / sector / product', () => {
    assert.equal(isValidSelection('GOES99', 'CONUS', 'GEOCOLOR'), false);
    assert.equal(isValidSelection('GOES19', 'MESO', 'GEOCOLOR'), false);
    assert.equal(isValidSelection('GOES19', 'CONUS', 'BOGUS'), false);
  });
});

describe('URL builders', () => {
  it('builds the product directory URL', () => {
    assert.equal(
      productDirUrl('GOES19', 'CONUS', 'GEOCOLOR'),
      'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/',
    );
  });
  it('builds the latest + thumbnail URLs', () => {
    assert.equal(
      latestUrl('GOES19', 'FD', '13'),
      'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/FD/13/latest.jpg',
    );
    assert.equal(
      thumbnailUrl('GOES18', 'CONUS', '07'),
      'https://cdn.star.nesdis.noaa.gov/GOES18/ABI/CONUS/07/thumbnail.jpg',
    );
  });
  it('builds a timestamped frame URL', () => {
    assert.equal(
      frameUrl('GOES19', 'CONUS', 'GEOCOLOR', '20261511631', '1250x750'),
      'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/20261511631_GOES19-ABI-CONUS-GEOCOLOR-1250x750.jpg',
    );
  });
});

describe('goesTimestampToEpoch', () => {
  it('parses a valid YYYYDDDHHMM stamp (UTC)', () => {
    // 2026, day-of-year 151 = May 31 2026, 16:31 UTC.
    const ms = goesTimestampToEpoch('20261511631');
    assert.ok(ms !== null);
    const d = new Date(ms!);
    assert.equal(d.getUTCFullYear(), 2026);
    assert.equal(d.getUTCMonth(), 4); // May (0-indexed)
    assert.equal(d.getUTCDate(), 31);
    assert.equal(d.getUTCHours(), 16);
    assert.equal(d.getUTCMinutes(), 31);
  });

  it('parses day 1 as Jan 1', () => {
    const ms = goesTimestampToEpoch('20260010000');
    const d = new Date(ms!);
    assert.equal(d.getUTCMonth(), 0);
    assert.equal(d.getUTCDate(), 1);
  });

  it('handles leap-year day 366', () => {
    // 2024 is a leap year — day 366 = Dec 31.
    const ms = goesTimestampToEpoch('20243661200');
    assert.ok(ms !== null);
    const d = new Date(ms!);
    assert.equal(d.getUTCFullYear(), 2024);
    assert.equal(d.getUTCMonth(), 11);
    assert.equal(d.getUTCDate(), 31);
  });

  it('rejects day 366 in a non-leap year (overflow)', () => {
    // 2026 is not a leap year — day 366 would roll into next year.
    assert.equal(goesTimestampToEpoch('20263661200'), null);
  });

  it('rejects malformed stamps', () => {
    assert.equal(goesTimestampToEpoch('123'), null);
    assert.equal(goesTimestampToEpoch('2026151163X'), null);
    assert.equal(goesTimestampToEpoch('20260001200'), null); // day 0
    assert.equal(goesTimestampToEpoch('20261512599'), null); // hour 25
  });
});

describe('parseFrameListing', () => {
  const html = `
    <a href="latest.jpg">latest.jpg</a>
    <a href="20261511626_GOES19-ABI-CONUS-GEOCOLOR-1250x750.jpg">a</a>
    <a href="20261511631_GOES19-ABI-CONUS-GEOCOLOR-1250x750.jpg">b</a>
    <a href="20261511621_GOES19-ABI-CONUS-GEOCOLOR-1250x750.jpg">c</a>
    <a href="20261511631_GOES19-ABI-CONUS-GEOCOLOR-5000x3000.jpg">wrong size</a>
    <a href="20261511631_GOES18-ABI-CONUS-GEOCOLOR-1250x750.jpg">wrong sat</a>
  `;

  it('extracts frames of the requested size, sorted oldest-first', () => {
    const frames = parseFrameListing(html, 'GOES19', 'CONUS', 'GEOCOLOR', '1250x750');
    assert.equal(frames.length, 3);
    assert.deepEqual(
      frames.map((f) => f.timestamp),
      ['20261511621', '20261511626', '20261511631'],
    );
    assert.ok(frames[0]!.url.endsWith('20261511621_GOES19-ABI-CONUS-GEOCOLOR-1250x750.jpg'));
  });

  it('ignores other sizes and other satellites', () => {
    const frames = parseFrameListing(html, 'GOES19', 'CONUS', 'GEOCOLOR', '1250x750');
    assert.ok(frames.every((f) => f.size === '1250x750'));
    assert.ok(frames.every((f) => f.url.includes('GOES19')));
  });

  it('returns [] when nothing matches', () => {
    assert.deepEqual(parseFrameListing(html, 'GOES19', 'FD', '13', '1808x1808'), []);
  });

  it('dedupes repeated timestamps', () => {
    const dup = `${html}\n<a href="20261511631_GOES19-ABI-CONUS-GEOCOLOR-1250x750.jpg">dup</a>`;
    const frames = parseFrameListing(dup, 'GOES19', 'CONUS', 'GEOCOLOR', '1250x750');
    assert.equal(frames.length, 3);
  });
});

describe('recentFrames', () => {
  const frames = parseFrameListing(
    `<a href="20261511621_GOES19-ABI-CONUS-GEOCOLOR-1250x750.jpg">a</a>
     <a href="20261511626_GOES19-ABI-CONUS-GEOCOLOR-1250x750.jpg">b</a>
     <a href="20261511631_GOES19-ABI-CONUS-GEOCOLOR-1250x750.jpg">c</a>`,
    'GOES19', 'CONUS', 'GEOCOLOR', '1250x750',
  );

  it('keeps the most recent n', () => {
    const recent = recentFrames(frames, 2);
    assert.deepEqual(recent.map((f) => f.timestamp), ['20261511626', '20261511631']);
  });
  it('returns [] for n <= 0', () => {
    assert.deepEqual(recentFrames(frames, 0), []);
  });
  it('returns all when n exceeds length', () => {
    assert.equal(recentFrames(frames, 99).length, 3);
  });
});
