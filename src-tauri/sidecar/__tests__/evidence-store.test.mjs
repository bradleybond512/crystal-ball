// R4-LOW-008: the calibration evidence journal is append-only, idempotent,
// hash-chained, allowlisted and never prunes. Drives the real node:sqlite
// store on a temporary file.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  EVIDENCE_KINDS,
  EvidenceFullError,
  EvidenceInputError,
  EvidenceStore,
  GENESIS_HASH,
  MAX_APPEND_BATCH,
  MAX_ENTRY_BYTES,
  MAX_MISSING_QUERY,
  canonicalJson,
  chainHash,
  normalizeEvidenceEntry,
  sha256Hex,
} from '../evidence-store.mjs';

const T0 = 1_790_000_000_000;
const HASH_A = `sha256:${'a'.repeat(64)}`;

function forecast(overrides = {}) {
  return {
    kind: 'forecast',
    payload: {
      id: 'fc-1',
      sourceId: 'analyst-loop',
      domain: 'security',
      probability: 0.7,
      predictedAt: T0,
      resolveBy: T0 + 86_400_000,
      status: 'pending',
      targetKeyHash: HASH_A,
      algorithmVersion: 'v3',
      ...overrides,
    },
  };
}

function outcome(overrides = {}) {
  return {
    kind: 'alert-outcome',
    payload: {
      id: 'oc-1',
      domain: 'weather',
      predictedSeverity: 'high',
      actualOutcome: 'confirmed-real',
      recordedAt: T0,
      alertIdHash: HASH_A,
      ...overrides,
    },
  };
}

function withStore(options, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'evidence-'));
  const dbPath = path.join(dir, 'evidence.db');
  let tick = T0;
  const store = new EvidenceStore({ dbPath, clock: () => (tick += 1), ...options });
  try {
    return fn(store, dbPath);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('canonicalJson sorts keys, omits undefined and matches sha256 digests', () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, 'x'], c: undefined }), '{"a":[true,null,"x"],"b":1}');
  const { entry } = normalizeEvidenceEntry(forecast());
  assert.equal(entry.digest, sha256Hex(entry.payloadJson));
  assert.equal(entry.recordedAt, T0);
});

test('append is idempotent per (kind, id, digest) and a new state appends a new row', () => {
  withStore({}, (store) => {
    assert.deepEqual(store.append([forecast()]).results, [{ status: 'appended' }]);
    assert.deepEqual(store.append([forecast()]).results, [{ status: 'duplicate' }]);
    const resolved = forecast({ status: 'resolved_true', resolvedAt: T0 + 1000, provenanceKind: 'direct', noteOrigin: 'direct' });
    assert.equal(store.append([resolved, resolved]).appended, 1, 'an in-batch duplicate is also skipped');
    assert.equal(store.summary().byKind.forecast, 2);
  });
});

test('the database itself refuses UPDATE and DELETE', () => {
  withStore({}, (store) => {
    store.append([forecast()]);
    assert.throws(() => store.db.exec("UPDATE evidence SET payload = '{}'"), /append-only/);
    assert.throws(() => store.db.exec('DELETE FROM evidence'), /append-only/);
    assert.equal(store.summary().total, 1);
  });
});

test('the chain verifies, survives reopen, and reports an edited row', () => {
  withStore({}, (store, dbPath) => {
    store.append([forecast(), outcome(), forecast({ id: 'fc-2' })]);
    assert.deepEqual({ ok: store.verifyChain().ok, count: store.verifyChain().count }, { ok: true, count: 3 });
    const head = store.summary().headHash;
    assert.notEqual(head, GENESIS_HASH);
    store.close();

    const reopened = new EvidenceStore({ dbPath });
    try {
      assert.equal(reopened.summary().headHash, head);
      assert.equal(reopened.summary().chain.ok, true);
      reopened.append([outcome({ id: 'oc-2' })]);
      assert.equal(reopened.verifyChain().ok, true);
      // Bypass the trigger the way a hostile tool would, then edit row 2.
      reopened.db.exec('DROP TRIGGER evidence_no_update');
      reopened.db.exec(`UPDATE evidence SET payload = '{"id":"oc-1","domain":"cyber"}' WHERE seq = 2`);
      const verdict = reopened.verifyChain();
      assert.equal(verdict.ok, false);
      assert.equal(verdict.brokenAtSeq, 2);
    } finally {
      reopened.close();
    }
  });
});

test('an edit that also rewrites the digest is still caught by the chain link', () => {
  withStore({}, (store) => {
    store.append([forecast(), outcome(), forecast({ id: 'fc-2' })]);
    const forged = canonicalJson({ ...outcome({ actualOutcome: 'escalated' }).payload });
    store.db.exec('DROP TRIGGER evidence_no_update');
    store.db.prepare('UPDATE evidence SET payload = ?, digest = ? WHERE seq = 2').run(forged, sha256Hex(forged));
    const verdict = store.verifyChain();
    assert.equal(verdict.ok, false);
    assert.equal(verdict.brokenAtSeq, 2);
  });
});

test('a removed tail row is caught by the head/count meta check', () => {
  withStore({}, (store) => {
    store.append([forecast(), outcome()]);
    store.db.exec('DROP TRIGGER evidence_no_delete');
    store.db.exec('DELETE FROM evidence WHERE seq = 2');
    const verdict = store.verifyChain();
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'head mismatch');
  });
});

test('per-kind allowlists drop unknown fields and reject bad values entry by entry', () => {
  withStore({}, (store) => {
    const extra = forecast({ id: 'fc-extra', claim: 'Wheat shortage in East Africa', resolutionNote: 'direct: secret', lat: 12.3 });
    const { results } = store.append([
      extra,
      forecast({ id: 'fc-p', probability: 1.5 }),
      forecast({ id: 'bad\nid' }),
      forecast({ id: 'fc-t', targetKeyHash: 'raw-target-key' }),
      { kind: 'mystery', payload: { id: 'x' } },
      outcome({ id: 'oc-a', actualOutcome: 'ignored' }),
      { kind: 'ema-forecast', payload: { id: 'e1', region: 'Kyiv', risk24h: 70, baselineCount: 3, createdAt: T0, hit: true } },
      forecast({ id: 'fc-big', resolverId: 'r'.repeat(129) }),
    ]);
    assert.deepEqual(results.map((r) => r.status), [
      'appended', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected',
    ]);
    assert.deepEqual(results.slice(1).map((r) => r.reason), [
      'invalid probability',
      'invalid id',
      'invalid targetKeyHash',
      'unknown kind',
      'invalid actualOutcome',
      'resolvedAt and hit must appear together',
      'invalid resolverId',
    ]);
    const [row] = store.records({ kind: 'forecast' }).entries;
    assert.equal(row.payload.claim, undefined);
    assert.equal(row.payload.resolutionNote, undefined);
    assert.equal(row.payload.lat, undefined);
  });
});

test('totals rows accept only the fixed id', () => {
  const ok = normalizeEvidenceEntry({ kind: 'ema-forecast-totals', payload: { id: 'totals', totalHits: 4, totalMisses: 2, updatedAt: T0 } });
  assert.ok(ok.entry);
  const bad = normalizeEvidenceEntry({ kind: 'ema-forecast-totals', payload: { id: 'other', totalHits: 4, totalMisses: 2, updatedAt: T0 } });
  assert.equal(bad.error, 'invalid id');
  assert.deepEqual([...EVIDENCE_KINDS].sort(), ['alert-outcome', 'ema-forecast', 'ema-forecast-totals', 'forecast']);
});

test('batch limits are enforced before anything is written', () => {
  withStore({}, (store) => {
    const tooMany = Array.from({ length: MAX_APPEND_BATCH + 1 }, (_, i) => outcome({ id: `oc-${i}` }));
    assert.throws(() => store.append(tooMany), EvidenceInputError);
    assert.throws(() => store.append([]), EvidenceInputError);
    assert.throws(() => store.missing(Array.from({ length: MAX_MISSING_QUERY + 1 }, () => ({}))), EvidenceInputError);
    assert.equal(store.summary().total, 0);
  });
});

test('the size ceiling refuses appends instead of pruning', () => {
  withStore({ maxBytes: 1 }, (store) => {
    assert.throws(() => store.append([forecast()]), EvidenceFullError);
    assert.equal(store.summary().total, 0);
  });
});

test('missing() returns the indexes the journal lacks, counting malformed triples as missing', () => {
  withStore({}, (store) => {
    store.append([forecast()]);
    const { entry } = normalizeEvidenceEntry(forecast());
    const absent = store.missing([
      { kind: 'forecast', id: 'fc-1', digest: entry.digest },
      { kind: 'forecast', id: 'fc-1', digest: 'f'.repeat(64) },
      { kind: 'forecast', id: 'fc-9', digest: entry.digest },
      { kind: 'nope', id: 'fc-1', digest: entry.digest },
      null,
    ]);
    assert.deepEqual(absent, [1, 2, 3, 4]);
  });
});

test('records() pages newest-first within one kind', () => {
  withStore({}, (store) => {
    store.append(Array.from({ length: 5 }, (_, i) => outcome({ id: `oc-${i}`, recordedAt: T0 + i })));
    store.append([forecast()]);
    const first = store.records({ kind: 'alert-outcome', limit: 2 });
    assert.deepEqual(first.entries.map((e) => e.recordId), ['oc-4', 'oc-3']);
    const second = store.records({ kind: 'alert-outcome', limit: 2, beforeSeq: first.nextBeforeSeq });
    assert.deepEqual(second.entries.map((e) => e.recordId), ['oc-2', 'oc-1']);
    const last = store.records({ kind: 'alert-outcome', limit: 2, beforeSeq: second.nextBeforeSeq });
    assert.deepEqual(last.entries.map((e) => e.recordId), ['oc-0']);
    assert.equal(last.nextBeforeSeq, null);
    assert.throws(() => store.records({ kind: 'nope' }), EvidenceInputError);
  });
});

test('export is a header plus one verifiable line per row', () => {
  withStore({}, (store) => {
    store.append([forecast(), outcome()]);
    const lines = store.exportJsonl().trimEnd().split('\n').map((line) => JSON.parse(line));
    assert.equal(lines[0].type, 'crystal-ball-evidence-export');
    assert.equal(lines[0].total, 2);
    assert.equal(lines[0].chain.ok, true);
    assert.equal(lines[0].headHash, lines[2].entryHash);
    assert.equal(lines[1].prevHash, GENESIS_HASH);
    assert.equal(lines[2].prevHash, lines[1].entryHash);
    assert.equal(sha256Hex(canonicalJson(lines[1].payload)), lines[1].digest);
  });
});

test('the database file is private to the user', () => {
  withStore({}, (_store, dbPath) => {
    assert.equal(statSync(dbPath).mode & 0o777, 0o600);
    const raw = new DatabaseSync(dbPath);
    try {
      const triggers = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all().map((r) => r.name);
      assert.deepEqual(triggers, ['evidence_no_delete', 'evidence_no_update']);
    } finally {
      raw.close();
    }
  });
});

// Two live handles model the brief sidecar overlap during a supervisor restart.
function withTwoStores({ seeded = false, clockA = () => T0 + 10 } = {}, fn) {
  return withStore({ clock: clockA }, (a, dbPath) => {
    if (seeded) a.append([outcome({ id: 'seed' })]);
    const b = new EvidenceStore({ dbPath, clock: () => T0 + 20 });
    try { return fn(a, b, dbPath); } finally { b.close(); }
  });
}

function assertExport(exported, expectedCount, expectedHead) {
  const [header, ...rows] = exported.trimEnd().split('\n').map((line) => JSON.parse(line));
  assert.equal(header.total, expectedCount, 'export header count matches the committed snapshot');
  assert.equal(header.chain.count, expectedCount, 'export verification count matches its rows');
  assert.equal(header.chain.ok, true, 'export reports a healthy complete chain');
  assert.equal(rows.length, expectedCount, 'export body count matches its header');
  let head = GENESIS_HASH;
  const byKind = Object.fromEntries(EVIDENCE_KINDS.map((kind) => [kind, 0]));
  for (const [index, row] of rows.entries()) {
    assert.equal(row.seq, index + 1, 'snapshot traversal neither skips nor repeats a row');
    assert.equal(row.prevHash, head, 'export links each row to its committed predecessor');
    assert.equal(row.digest, sha256Hex(canonicalJson(row.payload)), 'export payload matches its digest');
    assert.equal(row.entryHash, chainHash(head, row), 'export entry hash verifies offline');
    head = row.entryHash;
    byKind[row.kind] += 1;
  }
  assert.deepEqual(header.byKind, byKind, 'export kind counts match its body');
  assert.equal(header.headHash, head, 'export head equals the final exported row');
  if (expectedHead !== undefined) assert.equal(head, expectedHead, 'snapshot retains the expected committed head');
  return { header, rows };
}

function assertCurrentStores(a, b, expectedCount) {
  const tail = a.db.prepare('SELECT entry_hash FROM evidence ORDER BY seq DESC LIMIT 1').get()?.entry_hash ?? GENESIS_HASH;
  for (const store of [a, b]) {
    const verdict = store.verifyChain();
    assert.equal(verdict.ok, true, 'interleaved live handles preserve every chain link');
    assert.equal(verdict.count, expectedCount, 'verification sees all externally committed rows');
    const summary = store.summary();
    assert.equal(summary.total, expectedCount, 'both live summaries see all committed rows');
    assert.equal(summary.chain.ok, true, 'both live summaries freshly verify the committed chain');
    assert.equal(summary.chain.count, expectedCount, 'summary verification count is current');
    assert.equal(summary.headHash, tail, 'both live summaries report the actual SQL tail');
    assertExport(store.exportJsonl(), expectedCount, tail);
  }
}

for (const seeded of [false, true]) {
  test(`A1 overlapping ${seeded ? 'seeded' : 'empty'} handles interleave states and opposite-handle duplicates`, () => {
    withTwoStores({ seeded }, (a, b, dbPath) => {
      let count = seeded ? 1 : 0;
      const x = forecast({ id: 'overlap-x' });
      const y = outcome({ id: 'overlap-y' });
      const z = forecast({ id: 'overlap-z' });
      const changed = forecast({ id: 'overlap-x', status: 'resolved_true', resolvedAt: T0 + 100 });
      for (const [writer, entries, expectedResults, added] of [
        [a, [x], ['appended'], 1],
        [b, [y], ['appended'], 1],
        [a, [z], ['appended'], 1],
        [b, [x], ['duplicate'], 0],
        [b, [changed, changed], ['appended', 'duplicate'], 1],
        [a, [changed, y], ['duplicate', 'duplicate'], 0],
      ]) {
        assert.deepEqual(writer.append(entries).results.map((result) => result.status), expectedResults);
        count += added;
        assertCurrentStores(a, b, count);
      }
      a.close();
      b.close();
      const reopened = new EvidenceStore({ dbPath, clock: () => T0 + 30 });
      try { assertCurrentStores(reopened, reopened, count); } finally { reopened.close(); }
    });
  });
}

test('A1 alternating writers append the actual SQL tail without intervening diagnostics', () => {
  withTwoStores({}, (a, b) => {
    a.append([forecast({ id: 'no-read-x' })]);
    b.append([outcome({ id: 'no-read-y' })]);
    a.append([forecast({ id: 'no-read-z' })]);
    assertCurrentStores(a, b, 3);
  });
});

test('A2 summaries freshly observe external commits and corruption without reopen', () => {
  withTwoStores({}, (a, b) => {
    b.append([forecast(), outcome()]);
    const tail = b.db.prepare('SELECT entry_hash FROM evidence ORDER BY seq DESC LIMIT 1').get().entry_hash;
    const summary = a.summary();
    assert.equal(summary.total, 2, 'summary current total includes the other handle');
    assert.deepEqual(summary.byKind, { forecast: 1, 'alert-outcome': 1, 'ema-forecast': 0, 'ema-forecast-totals': 0 });
    assert.equal(summary.headHash, tail, 'summary current head includes the other handle');
    assert.equal(summary.chain.count, 2, 'summary current verification includes the other handle');
    assert.equal(summary.chain.ok, true);
    assert.equal(summary.firstAppendedAt, T0 + 20);
    assert.equal(summary.lastAppendedAt, T0 + 20);
    b.db.exec('DROP TRIGGER evidence_no_update');
    b.db.exec("UPDATE evidence SET payload = '{}' WHERE seq = 1");
    assert.equal(a.summary().chain.ok, false, 'summary diagnoses corruption introduced by another handle');
    assert.equal(b.summary().chain.ok, false, 'writer summary also diagnoses corruption without reopen');
    assert.equal(a.verifyChain().brokenAtSeq, 1);
    const brokenHeader = JSON.parse(a.exportJsonl().split('\n')[0]);
    assert.equal(brokenHeader.chain.ok, false, 'export never reports a corrupted journal healthy');
  });
});

for (const operation of ['exportJsonl', 'summary', 'verifyChain']) {
  test(`A3 ${operation} holds one WAL snapshot across a clock-triggered external commit and >5000 rows`, () => {
    let onClock;
    let externalCommits = 0;
    withTwoStores({ clockA: () => { const callback = onClock; onClock = undefined; callback?.(); return T0 + 10; } }, (a, b) => {
      const oldCount = 5001;
      for (let offset = 0; offset < oldCount; offset += MAX_APPEND_BATCH) {
        a.append(Array.from({ length: Math.min(MAX_APPEND_BATCH, oldCount - offset) }, (_, i) =>
          forecast({ id: `snapshot-${offset + i}` })));
      }
      const oldHead = a.db.prepare('SELECT entry_hash FROM evidence ORDER BY seq DESC LIMIT 1').get().entry_hash;
      onClock = () => {
        assert.equal(b.append([outcome({ id: 'during-snapshot' })]).appended, 1, 'real WAL writer commits while diagnostics hold a read snapshot');
        externalCommits += 1;
      };
      const result = a[operation]();
      if (operation === 'exportJsonl') assertExport(result, oldCount, oldHead);
      else if (operation === 'summary') {
        assert.equal(result.total, oldCount, 'summary bounds stay on the verified snapshot');
        assert.equal(result.byKind.forecast, oldCount);
        assert.equal(result.byKind['alert-outcome'], 0, 'summary kinds exclude the later WAL commit');
        assert.equal(result.headHash, oldHead, 'summary tail stays on the verified snapshot');
        assert.equal(result.chain.count, oldCount);
        assert.equal(result.chain.ok, true);
      } else {
        assert.equal(result.count, oldCount, 'verification traverses the complete original snapshot');
        assert.equal(result.ok, true);
      }
      assert.equal(externalCommits, 1, 'explicit diagnostics perform fresh verification and allow the concurrent WAL commit');
      assertCurrentStores(a, b, oldCount + 1);
    });
  });
}

test('A4 failed insert rolls back staged rows and metadata before diagnostics or the next append', () => {
  withTwoStores({ seeded: true }, (a, b) => {
    b.append([forecast({ id: 'committed-before-failure' })]);
    const before = b.summary();
    a.db.exec(`CREATE TRIGGER fail_test_insert BEFORE INSERT ON evidence
      WHEN NEW.record_id = 'fail-second-insert'
      BEGIN SELECT RAISE(ABORT, 'fixture insert failure'); END`);
    assert.throws(() => a.append([
      forecast({ id: 'staged-only' }), forecast({ id: 'fail-second-insert' }),
    ]), /fixture insert failure/);
    assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM evidence').get().n, 2, 'rollback removes the first staged row');
    assert.equal(a.db.prepare("SELECT value FROM evidence_meta WHERE key = 'head_hash'").get().value, before.headHash,
      'rollback preserves the committed metadata head');
    const after = a.summary();
    assert.equal(after.headHash, before.headHash, 'failed append publishes no staged or stale diagnostic head');
    assert.equal(after.total, before.total);
    assert.equal(after.chain.count, before.chain.count);
    assert.equal(after.chain.ok, true);
    a.db.exec('DROP TRIGGER fail_test_insert');
    assert.equal(a.append([forecast({ id: 'after-rollback' })]).appended, 1, 'the next append succeeds after transaction cleanup');
    assertCurrentStores(a, b, 3);
  });
});


test('A3 verification keeps the first SQL page snapshot when a clock callback commits between pages', () => {
  let onClock;
  withTwoStores({ clockA: () => { const callback = onClock; onClock = undefined; callback?.(); return T0 + 10; } }, (a, b) => {
    const oldCount = 5001;
    for (let offset = 0; offset < oldCount; offset += MAX_APPEND_BATCH) {
      a.append(Array.from({ length: Math.min(MAX_APPEND_BATCH, oldCount - offset) }, (_, i) =>
        forecast({ id: `verification-page-${offset + i}` })));
    }
    let pages = 0;
    let externalCommits = 0;
    const page = a._stmt.page;
    const readPage = page.all.bind(page);
    // Only inject timing after a real SQLite read. Every returned row and the
    // concurrent commit still come from the real WAL database, not a mock.
    page.all = (...args) => {
      const rows = readPage(...args);
      pages += 1;
      if (pages === 1) a._clock();
      return rows;
    };
    onClock = () => {
      assert.equal(b.append([outcome({ id: 'between-verification-pages' })]).appended, 1);
      externalCommits += 1;
    };
    let verified;
    try { verified = a.verifyChain(); } finally { page.all = readPage; }
    assert.equal(externalCommits, 1, 'external writer commits after the first real verification page');
    assert.equal(pages, 2, 'verification traverses both real SQLite pages');
    assert.equal(verified.ok, true, 'verification metadata and pages share one snapshot');
    assert.equal(verified.count, oldCount, 'verification excludes rows committed between its SQL pages');
    assertCurrentStores(a, b, oldCount + 1);
  });
});

test('A4 read snapshots clean up after a diagnostic clock failure and a broken-chain early return', () => {
  let failClock = false;
  withTwoStores({ clockA: () => { if (failClock) { failClock = false; throw new Error('fixture diagnostic failure'); } return T0 + 10; } }, (a, b) => {
    a.append([forecast()]);
    for (const operation of ['verifyChain', 'summary', 'exportJsonl']) {
      failClock = true;
      assert.throws(() => a[operation](), /fixture diagnostic failure/);
      let appended;
      assert.doesNotThrow(() => { appended = a.append([outcome({ id: `after-${operation}-failure` })]).appended; },
        'a failed diagnostic leaves no read transaction blocking the next append');
      assert.equal(appended, 1);
      assert.equal(a.verifyChain().ok, true);
    }
    b.db.exec('DROP TRIGGER evidence_no_update');
    b.db.exec("UPDATE evidence SET payload = '{}' WHERE seq = 1");
    assert.equal(a.verifyChain().brokenAtSeq, 1);
    let appended;
    assert.doesNotThrow(() => { appended = a.append([outcome({ id: 'after-broken-diagnostic' })]).appended; },
      'a broken-chain early return also closes its read transaction');
    assert.equal(appended, 1);
    assert.equal(a.summary().chain.ok, false, 'later appends preserve the corruption diagnostic');
  });
});

test('existing count and head corruption remain visible after append instead of being silently repaired', () => {
  for (const corruption of ['count', 'head', 'removed-tail']) {
    withStore({}, (store) => {
      store.append([forecast()]);
      if (corruption === 'removed-tail') {
        store.db.exec('DROP TRIGGER evidence_no_delete');
        store.db.exec('DELETE FROM evidence');
      } else {
        store.db.prepare('UPDATE evidence_meta SET value = ? WHERE key = ?')
          .run(corruption === 'count' ? '0' : 'f'.repeat(64), corruption === 'count' ? 'count' : 'head_hash');
      }
      assert.equal(store.verifyChain().ok, false, `${corruption} is diagnosed before append`);
      assert.equal(store.append([outcome()]).appended, 1);
      assert.equal(store.summary().chain.ok, false, `${corruption} stays visible after append`);
      assert.equal(JSON.parse(store.exportJsonl().split('\n')[0]).chain.ok, false,
        `${corruption} stays visible in the exported diagnostic`);
    });
  }
});


test('4 KiB canonical byte cap rejects valid scored strings expanded by JSON escaping', (t) => {
  const textLengths = { id: 200, sourceId: 128, domain: 64, resolverId: 128, algorithmVersion: 128 };
  const scoredState = { status: 'resolved_true', resolvedAt: T0 + 50_000, provenanceKind: 'direct', noteOrigin: 'direct' };
  const oversized = forecast({
    ...scoredState,
    ...Object.fromEntries(Object.entries(textLengths).map(([key, length]) => [key, '\uD800'.repeat(length)])),
  });
  const ordinary = forecast({
    ...scoredState,
    ...Object.fromEntries(Object.entries(textLengths).map(([key, length]) => [key, 'a'.repeat(length)])),
  });
  const oversizedBytes = Buffer.byteLength(canonicalJson(oversized.payload), 'utf8');
  const ordinaryBytes = Buffer.byteLength(canonicalJson(ordinary.payload), 'utf8');
  assert.ok(oversizedBytes > MAX_ENTRY_BYTES, 'allowlisted strings within their field limits exceed the canonical byte ceiling');
  assert.ok(ordinaryBytes < MAX_ENTRY_BYTES, 'ordinary strings with the same valid field lengths fit the byte ceiling');
  assert.deepEqual(normalizeEvidenceEntry(oversized), { error: 'entry too large' }, 'normalization rejects the canonical byte overflow');
  assert.ok(normalizeEvidenceEntry(ordinary).entry, 'the ordinary sized positive control is accepted');
  withStore({}, (store) => {
    const result = store.append([oversized, ordinary]);
    assert.equal(result.appended, 1);
    assert.deepEqual(result.results, [{ status: 'rejected', reason: 'entry too large' }, { status: 'appended' }]);
    assert.equal(store.summary().total, 1, 'only the ordinary positive control reaches SQLite');
    assert.equal(store.verifyChain().ok, true);
    assert.equal(store.records({ kind: 'forecast' }).entries[0].digest, normalizeEvidenceEntry(ordinary).entry.digest);
  });
  t.diagnostic(`oversizedCanonicalBytes=${oversizedBytes}; ordinaryCanonicalBytes=${ordinaryBytes}; limit=${MAX_ENTRY_BYTES}`);
});


test('append reads the indexed SQL tail without traversing existing history', () => {
  withStore({}, (store) => {
    const seededCount = 5001;
    for (let offset = 0; offset < seededCount; offset += MAX_APPEND_BATCH) {
      store.append(Array.from({ length: Math.min(MAX_APPEND_BATCH, seededCount - offset) }, (_, i) =>
        forecast({ id: `append-cost-${offset + i}` })));
    }
    const page = store._stmt.page;
    const head = store._stmt.head;
    const readPage = page.all.bind(page);
    const readHead = head.get.bind(head);
    let historyPageReads = 0;
    let indexedTailReads = 0;
    // Count actual SQLite operations; return every real result unchanged.
    // Instrument only after seeding, excluding the constructor's diagnostics.
    page.all = (...args) => { historyPageReads += 1; return readPage(...args); };
    head.get = (...args) => { indexedTailReads += 1; return readHead(...args); };
    try {
      const ordinary = store.append(Array.from({ length: 5 }, (_, i) => outcome({ id: `append-cost-outcome-${i}` })));
      assert.equal(ordinary.appended, 5);
      assert.deepEqual(ordinary.results.map((result) => result.status), Array.from({length: 5}).fill('appended'));
      assert.equal(historyPageReads, 0, 'ordinary bounded append never traverses the existing journal history');
      assert.equal(indexedTailReads, 1, 'ordinary append reads the actual indexed SQL tail once');

      const changed = forecast({ id: 'append-cost-0', status: 'resolved_true', resolvedAt: T0 + 100 });
      const states = store.append([forecast({ id: 'append-cost-0' }), changed, changed]);
      assert.equal(states.appended, 1);
      assert.deepEqual(states.results.map((result) => result.status), ['duplicate', 'appended', 'duplicate']);
      assert.equal(historyPageReads, 0, 'duplicate and changed-state append never traverses the existing journal history');
      assert.equal(indexedTailReads, 2, 'each normal append obtains its current indexed SQL tail');

      const verified = store.verifyChain();
      assert.equal(verified.ok, true, 'explicit verification confirms the appended chain remains healthy');
      assert.equal(verified.count, seededCount + 6, 'explicit verification sees all seeded and newly appended rows');
      assert.ok(historyPageReads > 1, 'explicit verification alone traverses the full multi-page real SQLite history');
    } finally {
      page.all = readPage;
      head.get = readHead;
    }
  });
});
