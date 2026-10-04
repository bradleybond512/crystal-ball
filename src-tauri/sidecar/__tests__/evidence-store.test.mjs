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
  MAX_MISSING_QUERY,
  canonicalJson,
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
