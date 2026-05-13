import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatStatus,
  formatBrief,
  formatSitrep,
  formatHelp,
  formatWatchConfirm,
  formatAlertConfirm,
  formatError,
  formatUnauthorized,
  segmentCount,
} from './sms-response-formatter.mjs';

describe('formatStatus', () => {
  it('includes posture in uppercase', () => {
    const text = formatStatus({ posture: 'elevated', threads: [] }, []);
    assert.ok(text.includes('CB ELEVATED'));
  });

  it('handles null state', () => {
    const text = formatStatus(null, []);
    assert.ok(text.includes('CB UNKNOWN'));
  });

  it('shows top 3 threads with short domain labels', () => {
    const text = formatStatus({
      posture: 'normal',
      threads: [
        { domain: 'earthquake', label: 'Quake A' },
        { domain: 'cyber', label: 'Intrusion B' },
        { domain: 'wildfire', label: 'Fire C' },
        { domain: 'aviation', label: 'Plane D' },
      ],
    }, []);
    assert.ok(text.includes('EQ:Quake A'));
    assert.ok(text.includes('CYB:Intrusion B'));
    assert.ok(text.includes('FIRE:Fire C'));
    assert.ok(!text.includes('Plane D'));
  });

  it('reports feed health summary', () => {
    const text = formatStatus({ posture: 'normal', threads: [] }, [
      { lastError: null },
      { lastError: 'timeout' },
    ]);
    assert.ok(text.includes('feeds 1/2 ok'));
  });

  it('fits in 2 SMS segments', () => {
    const text = formatStatus({
      posture: 'critical',
      threads: Array.from({ length: 5 }, (_, i) => ({
        domain: 'cyber',
        label: `Long thread description with many characters ${i}`,
      })),
    }, Array.from({ length: 10 }, () => ({ lastError: null })));
    assert.ok(text.length <= 320, `status too long: ${text.length}`);
  });
});

describe('formatBrief', () => {
  it('returns no-hypothesis text when empty', () => {
    assert.ok(formatBrief({ threads: [] }).includes('no active'));
  });

  it('returns up to 3 numbered bullets', () => {
    const text = formatBrief({
      threads: [
        { label: 'Alpha', confidence: 0.9 },
        { label: 'Beta', confidence: 0.7 },
        { label: 'Gamma', confidence: 0.5 },
        { label: 'Delta', confidence: 0.3 },
      ],
    });
    assert.ok(text.includes('1. Alpha'));
    assert.ok(text.includes('2. Beta'));
    assert.ok(text.includes('3. Gamma'));
    assert.ok(!text.includes('Delta'));
  });

  it('includes confidence percentage', () => {
    const text = formatBrief({ threads: [{ label: 'A', confidence: 0.85 }] });
    assert.ok(text.includes('85%'));
  });
});

describe('formatSitrep', () => {
  it('includes posture line', () => {
    const text = formatSitrep({ posture: 'elevated', threads: [], entities: [] }, []);
    assert.ok(text.includes('CB Sitrep: ELEVATED'));
  });

  it('shows lead thread', () => {
    const text = formatSitrep({ posture: 'normal', threads: [{ label: 'Lead Hyp' }], entities: [1] }, []);
    assert.ok(text.includes('Lead: Lead Hyp'));
  });

  it('handles empty threads', () => {
    const text = formatSitrep({ posture: 'normal', threads: [], entities: [] }, []);
    assert.ok(text.includes('Lead: none'));
  });
});

describe('formatHelp', () => {
  it('lists all 6 commands', () => {
    const text = formatHelp();
    for (const cmd of ['STATUS', 'BRIEF', 'SITREP', 'WATCH', 'ALERT', 'HELP']) {
      assert.ok(text.includes(cmd), `missing ${cmd} in help`);
    }
  });

  it('marks admin commands', () => {
    assert.ok(formatHelp().includes('admin'));
  });
});

describe('formatWatchConfirm', () => {
  it('includes the keyword', () => {
    const text = formatWatchConfirm('cobalt');
    assert.ok(text.includes('cobalt'));
    assert.ok(text.toUpperCase().includes('CANCEL'));
  });

  it('rejects empty keyword', () => {
    assert.ok(formatWatchConfirm('').includes('requires a keyword'));
  });

  it('truncates long keywords', () => {
    const long = 'x'.repeat(100);
    const text = formatWatchConfirm(long);
    assert.ok(text.length <= 160);
  });
});

describe('formatAlertConfirm', () => {
  it('formats valid threshold + domain', () => {
    const text = formatAlertConfirm('0.7', 'cyber');
    assert.ok(text.includes('0.70'));
    assert.ok(text.includes('CYB'));
  });

  it('rejects out-of-range threshold', () => {
    const text = formatAlertConfirm('5', 'cyber');
    assert.ok(text.toLowerCase().includes('threshold'));
  });

  it('rejects non-numeric threshold', () => {
    assert.ok(formatAlertConfirm('foo', 'cyber').toLowerCase().includes('threshold'));
  });
});

describe('formatError', () => {
  it('is short', () => {
    assert.ok(formatError('some_reason').length <= 100);
  });

  it('handles unknown', () => {
    assert.ok(formatError(null).includes('unknown'));
  });
});

describe('formatUnauthorized', () => {
  it('explains tier_required', () => {
    assert.ok(formatUnauthorized('tier_required').toLowerCase().includes('admin'));
  });

  it('explains rate_limit', () => {
    assert.ok(formatUnauthorized('rate_limit').toLowerCase().includes('rate'));
  });

  it('falls back to unauthorized', () => {
    assert.ok(formatUnauthorized('whatever').toLowerCase().includes('unauthorized'));
  });
});

describe('segmentCount', () => {
  it('is 0 for empty', () => assert.equal(segmentCount(''), 0));
  it('is 1 for ≤160 chars', () => {
    assert.equal(segmentCount('a'.repeat(160)), 1);
  });
  it('is 2 for 161-306 chars', () => {
    assert.equal(segmentCount('a'.repeat(161)), 2);
    assert.equal(segmentCount('a'.repeat(306)), 2);
  });
  it('is 3 for 307+ chars', () => {
    assert.equal(segmentCount('a'.repeat(307)), 3);
  });
});
