import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  adaptRuntimeSource,
  getLiveDiagnosticsSnapshot,
  recordFeedSnapshot,
  resetLiveDiagnosticsForTests,
  setFeedSnapshots,
  setSidecarHealth,
  sidecarHealthFromError,
  sidecarHealthFromPayload,
} from '../live-diagnostics-snapshot';
import type { SourceDiagnostic as RuntimeSourceDiagnostic } from '@/services/api-diagnostic';

beforeEach(() => {
  resetLiveDiagnosticsForTests();
});

describe('adaptRuntimeSource', () => {
  it('maps runtime SourceDiagnostic → system-health SourceDiagnostic', () => {
    const runtime: RuntimeSourceDiagnostic = {
      id: 'weather',
      name: 'NWS Alerts',
      status: 'degraded',
      lastUpdateMs: 1_700_000_000_000,
      ageSeconds: 120,
      lastError: null,
      itemCount: 17,
      breakerState: 'closed',
      onCooldown: false,
      cooldownRemainingSeconds: 0,
      requiredForRisk: true,
      notes: ['Stale by 2 min'],
    };
    const adapted = adaptRuntimeSource(runtime);
    assert.equal(adapted.sourceId, 'weather');
    assert.equal(adapted.label, 'NWS Alerts');
    assert.equal(adapted.status, 'degraded');
    assert.equal(adapted.lastSuccessAt, 1_700_000_000_000);
    assert.equal(adapted.reason, 'Stale by 2 min');
  });

  it("maps runtime 'silent' → system-health 'blind'", () => {
    const runtime: RuntimeSourceDiagnostic = {
      id: 'gdacs',
      name: 'GDACS',
      status: 'silent',
      lastUpdateMs: null,
      ageSeconds: null,
      lastError: 'never observed',
      itemCount: 0,
      breakerState: 'open',
      onCooldown: true,
      cooldownRemainingSeconds: 30,
      requiredForRisk: false,
      notes: [],
    };
    const adapted = adaptRuntimeSource(runtime);
    assert.equal(adapted.status, 'blind');
  });
});

describe('sidecar health adapters', () => {
  it('builds healthy sidecar from /api/health payload', () => {
    const verdict = sidecarHealthFromPayload(
      { ok: true, port: 46123, uptime_ms: 600_000 },
      1_700_000_000_000,
    );
    assert.equal(verdict.status, 'healthy');
    assert.equal(verdict.authenticated, true);
    assert.equal(verdict.lastReachableAt, 1_700_000_000_000);
    assert.match(verdict.reason, /:46123/);
  });

  it('flags failing for ok=false payload', () => {
    const verdict = sidecarHealthFromPayload({ ok: false, port: 46123 }, 1_700_000_000_000);
    assert.equal(verdict.status, 'failing');
    assert.equal(verdict.authenticated, false);
  });

  it('returns failing for non-object payload', () => {
    const verdict = sidecarHealthFromPayload(null, 1_700_000_000_000);
    assert.equal(verdict.status, 'failing');
  });

  it('flags 401 errors as degraded (auth issue) not failing (unreachable)', () => {
    const verdict = sidecarHealthFromError(new Error('HTTP 401 Unauthorized'), 1_700_000_000_000);
    assert.equal(verdict.status, 'degraded');
    assert.match(verdict.reason, /bearer-auth/);
  });

  it('flags network errors as failing', () => {
    const verdict = sidecarHealthFromError(new Error('ECONNREFUSED'), 1_700_000_000_000);
    assert.equal(verdict.status, 'failing');
    assert.match(verdict.reason, /unreachable/);
  });
});

describe('getLiveDiagnosticsSnapshot', () => {
  it('returns sidecar=unknown until setSidecarHealth is called', () => {
    const snap = getLiveDiagnosticsSnapshot();
    assert.equal(snap.sidecar.status, 'unknown');
    assert.equal(snap.sidecar.authenticated, false);
    assert.match(snap.sidecar.reason, /not yet probed/i);
  });

  it('reflects sidecar health after setSidecarHealth', () => {
    setSidecarHealth({
      status: 'healthy',
      authenticated: true,
      reason: 'OK',
      lastReachableAt: 1_700_000_000_000,
    });
    const snap = getLiveDiagnosticsSnapshot();
    assert.equal(snap.sidecar.status, 'healthy');
    assert.equal(snap.sidecar.authenticated, true);
  });

  it('exposes feed snapshots set via setFeedSnapshots', () => {
    setFeedSnapshots([
      { feedId: 'wx-nws', lastSuccessAt: 1_700_000_000_000 },
      { feedId: 'gdacs', lastSuccessAt: 1_700_000_000_000 - 60_000 },
    ]);
    const snap = getLiveDiagnosticsSnapshot();
    assert.equal(snap.feedSnapshots.length, 2);
    // Sorted by feedId for stable ordering
    assert.equal(snap.feedSnapshots[0]?.feedId, 'gdacs');
    assert.equal(snap.feedSnapshots[1]?.feedId, 'wx-nws');
  });

  it('recordFeedSnapshot upserts a single feed without disturbing others', () => {
    setFeedSnapshots([{ feedId: 'wx-nws', lastSuccessAt: 1 }]);
    recordFeedSnapshot({ feedId: 'gdacs', lastSuccessAt: 2 });
    recordFeedSnapshot({ feedId: 'wx-nws', lastSuccessAt: 3 });
    const snap = getLiveDiagnosticsSnapshot();
    assert.equal(snap.feedSnapshots.length, 2);
    const wx = snap.feedSnapshots.find((s) => s.feedId === 'wx-nws');
    assert.equal(wx?.lastSuccessAt, 3);
  });

  it('returns a JSON-serializable shape', () => {
    setSidecarHealth({ status: 'healthy', authenticated: true, reason: 'OK' });
    setFeedSnapshots([{ feedId: 'wx-nws', lastSuccessAt: 1_700_000_000_000 }]);
    const snap = getLiveDiagnosticsSnapshot();
    const json = JSON.stringify(snap);
    const parsed = JSON.parse(json) as { sidecar: { status: string }; feedSnapshots: unknown[] };
    assert.equal(parsed.sidecar.status, 'healthy');
    assert.equal(parsed.feedSnapshots.length, 1);
  });

  it('is deterministic given identical state', () => {
    setSidecarHealth({ status: 'healthy', authenticated: true, reason: 'OK' });
    const a = getLiveDiagnosticsSnapshot(() => 1_700_000_000_000);
    const b = getLiveDiagnosticsSnapshot(() => 1_700_000_000_000);
    // Ignore the unsorted recentEvents tail (event bus shared state).
    assert.deepEqual(
      { ...a, recentEvents: [] },
      { ...b, recentEvents: [] },
    );
  });
});
