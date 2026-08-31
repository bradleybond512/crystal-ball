import assert from 'node:assert/strict';
import test from 'node:test';

type UnifiedAlert = import('@/services/unified-alerts').UnifiedAlert;
type PanelAttentionModule = typeof import('@/services/panel-attention.ts');

const moduleUnderTest = (): Promise<PanelAttentionModule> => import('@/services/panel-attention.ts');

function alert(
  id: string,
  panelId: string,
  score: number,
  severity: UnifiedAlert['severity'] = 'medium',
  timestamp: number = 1_000,
): UnifiedAlert & { panelId: string; testScore: number } {
  return {
    id,
    panelId,
    testScore: score,
    source: 'breaking-news',
    severity,
    title: id,
    body: id,
    timestamp,
    relevanceScore: 0,
    acknowledged: false,
    pinned: false,
  };
}

const score = (candidate: UnifiedAlert): number => (candidate as UnifiedAlert & { testScore: number }).testScore;
const route = (candidate: UnifiedAlert): string => (candidate as UnifiedAlert & { panelId: string }).panelId;

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

test('projects every positive finite-scoring pane with consistent severity and evidence counts', async () => {
  const { projectPanelAttention } = await moduleUnderTest();
  const alerts = [
    alert('a', 'weather', 40, 'medium'),
    alert('b', 'weather', 90, 'high'),
    alert('c', 'cyber', 10, 'low'),
    alert('zero', 'quiet', 0, 'critical'),
    alert('nan', 'broken', Number.NaN, 'critical'),
  ];

  const snapshot = projectPanelAttention(alerts, { score, route, reviewed: [], incumbents: [] });

  assert.deepEqual(snapshot.panels.map((panel) => panel.panelId), ['weather', 'cyber']);
  assert.equal(snapshot.panels[0]?.activeCount, 2);
  assert.equal(snapshot.panels[0]?.unreviewedCount, 2);
  assert.equal(snapshot.panels[0]?.maxSeverity, 'high');
  assert.equal(snapshot.panels[0]?.maxScore, 90);
  assert.deepEqual(snapshot.severityCounts, { high: 1, low: 1 });
});

test('timestamp-only refreshes stay reviewed while meaningful changes reopen the same ID', async () => {
  const { markPanelReviewed, projectPanelAttention } = await moduleUnderTest();
  const initialAlert = alert('same', 'weather', 60, 'high', 1_000);
  const initial = projectPanelAttention(
    [initialAlert],
    { score, route, reviewed: [], incumbents: [] },
  );
  const reviewed = markPanelReviewed([], initial.panels[0]!, initial.panels.flatMap((panel) => panel.evidence));
  const refreshed = projectPanelAttention(
    [alert('same', 'weather', 60, 'high', 2_000)],
    { score, route, reviewed, incumbents: [] },
  );
  const changedAlert = alert('same', 'weather', 60, 'high', 2_000);
  changedAlert.body = 'Meaningfully changed evidence';
  const changed = projectPanelAttention(
    [changedAlert],
    { score, route, reviewed, incumbents: [] },
  );

  assert.equal(refreshed.panels[0]?.unreviewedCount, 0);
  assert.equal(changed.panels[0]?.unreviewedCount, 1);
});

test('reviewed critical evidence cannot color or promote lower-severity new work', async () => {
  const { markPanelReviewed, projectPanelAttention } = await moduleUnderTest();
  const oldCritical = alert('old-critical', 'weather', 120, 'critical', 1_000);
  const initial = projectPanelAttention(
    [oldCritical],
    { score, route, reviewed: [], incumbents: [] },
  );
  const reviewed = markPanelReviewed([], initial.panels[0]!, initial.panels.flatMap((panel) => panel.evidence));
  const snapshot = projectPanelAttention(
    [
      oldCritical,
      alert('new-info', 'weather', 3, 'info', 2_000),
    ],
    {
      score,
      route,
      reviewed,
      incumbents: [],
    },
  );

  assert.equal(snapshot.panels[0]?.unreviewedCount, 1);
  assert.equal(snapshot.panels[0]?.maxSeverity, 'info');
  assert.equal(snapshot.panels[0]?.maxScore, 3);
  assert.equal(snapshot.panels[0]?.newestEvidenceAt, 2_000);
  assert.deepEqual(snapshot.severityCounts, { info: 1 });
  assert.deepEqual(snapshot.promotedPanelIds, []);
});

test('future timestamps are equality tokens rather than pane-wide cutoffs', async () => {
  const { markPanelReviewed, projectPanelAttention } = await moduleUnderTest();
  const future = 9_999_999_999_999;
  const futureAlert = alert('future', 'weather', 60, 'high', future);
  const initial = projectPanelAttention(
    [futureAlert],
    { score, route, reviewed: [], incumbents: [] },
  );
  const reviewed = markPanelReviewed([], initial.panels[0]!, initial.panels.flatMap((panel) => panel.evidence));
  const snapshot = projectPanelAttention(
    [futureAlert, alert('later-id', 'weather', 40, 'medium', 2_000)],
    { score, route, reviewed, incumbents: [] },
  );

  assert.equal(snapshot.panels[0]?.unreviewedCount, 1);
  assert.deepEqual(
    snapshot.panels[0]?.unreviewedEvidence.map(({ id, observedAt }) => ({ id, observedAt })),
    [{ id: 'later-id', observedAt: 2_000 }],
  );
});

test('malformed timestamps remain reviewable through a null evidence identity', async () => {
  const { markPanelReviewed, projectPanelAttention } = await moduleUnderTest();
  const malformed = alert('bad-time', 'weather', 60);
  malformed.timestamp = Number.NaN;
  const before = projectPanelAttention([malformed], { score, route, reviewed: [], incumbents: [] });
  const reviewed = markPanelReviewed([], before.panels[0]!, before.panels.flatMap((panel) => panel.evidence));
  const after = projectPanelAttention([malformed], { score, route, reviewed, incumbents: [] });

  assert.deepEqual(
    before.panels[0]?.evidence.map(({ id, observedAt }) => ({ id, observedAt })),
    [{ id: 'bad-time', observedAt: null }],
  );
  assert.equal(after.panels[0]?.unreviewedCount, 0);
});

test('acknowledged, snoozed, nonpositive, and nonfinite scores stay out of attention', async () => {
  const { projectPanelAttention } = await moduleUnderTest();
  const acknowledged = alert('ack', 'a', 60); acknowledged.acknowledged = true;
  const snoozed = alert('snooze', 'b', 60); snoozed.snoozedUntil = 5_000;
  const snapshot = projectPanelAttention(
    [acknowledged, snoozed, alert('negative', 'c', -1), alert('nan', 'd', Number.NaN)],
    { now: 4_000, score: (candidate, now) => {
      if (candidate.acknowledged || (candidate.snoozedUntil ?? 0) > now) return 0;
      return score(candidate);
    }, route, reviewed: [], incumbents: [] },
  );

  assert.deepEqual(snapshot.panels, []);
});

test('strict persistence rejects corrupt, duplicate, and oversized ledgers', async () => {
  const { loadReviewLedger, PANEL_REVIEW_STORAGE_KEY } = await moduleUnderTest();
  const storage = new MemoryStorage();
  const invalid = [
    '{',
    JSON.stringify({ version: 2, reviewed: [] }),
    JSON.stringify({ version: 1, reviewed: [
      { id: 'x', observedAt: 1, revision: '0000000000000001' },
      { id: 'x', observedAt: 1, revision: '0000000000000001' },
    ] }),
    JSON.stringify({ version: 1, reviewed: [
      { id: 'x'.repeat(2_049), observedAt: 1, revision: '0000000000000001' },
    ] }),
    JSON.stringify({ version: 1, reviewed: [
      { id: 'x', observedAt: 1, revision: 'not-a-revision' },
    ] }),
    JSON.stringify({ version: 1, reviewed: Array.from({ length: 501 }, (_, i) => ({
      id: `a${i}`,
      observedAt: i,
      revision: i.toString(16).padStart(16, '0'),
    })) }),
  ];

  for (const raw of invalid) {
    storage.setItem(PANEL_REVIEW_STORAGE_KEY, raw);
    assert.deepEqual(loadReviewLedger(storage), [], raw);
  }
});

test('persistence retains reviewed evidence while it is temporarily inactive', async () => {
  const {
    loadReviewLedger,
    markPanelReviewed,
    persistReviewLedger,
    projectPanelAttention,
  } = await moduleUnderTest();
  const storage = new MemoryStorage();
  const snoozed = alert('snoozed', 'weather', 60, 'high', 1);
  const initial = projectPanelAttention(
    [snoozed],
    { score, route, reviewed: [], incumbents: [] },
  );
  const reviewed = markPanelReviewed([], initial.panels[0]!, initial.panels.flatMap((panel) => panel.evidence));
  reviewed.push({ id: 'active', observedAt: 2, revision: '0000000000000002' });

  assert.equal(persistReviewLedger(reviewed, storage), true);
  const reloaded = loadReviewLedger(storage);
  assert.deepEqual(reloaded, reviewed);

  const reactivated = projectPanelAttention(
    [snoozed],
    { score, route, reviewed: reloaded, incumbents: [] },
  );
  assert.equal(reactivated.panels[0]?.unreviewedCount, 0);
});

test('reviewing a second pane preserves all 500 active reviewed identities at the ledger cap', async () => {
  const { markPanelReviewed, projectPanelAttention } = await moduleUnderTest();
  const alerts = [
    ...Array.from({ length: 250 }, (_, index) => alert(`a-${index}`, 'a', 60, 'high', index)),
    ...Array.from({ length: 250 }, (_, index) => alert(`b-${index}`, 'b', 60, 'high', index + 250)),
  ];
  const initial = projectPanelAttention(alerts, {
    score,
    route,
    reviewed: [],
    incumbents: [],
  });
  const activeEvidence = initial.panels.flatMap((panel) => panel.evidence);
  const panelA = initial.panels.find((panel) => panel.panelId === 'a')!;
  const panelB = initial.panels.find((panel) => panel.panelId === 'b')!;
  const reviewedA = markPanelReviewed([], panelA, activeEvidence);
  const inactiveHistory = Array.from({ length: 250 }, (_, index) => ({
    id: `inactive-${index}`,
    observedAt: index,
    revision: index.toString(16).padStart(16, '0'),
  }));
  const reviewedAtCapacity = [...reviewedA, ...inactiveHistory];
  const reviewedBoth = markPanelReviewed(reviewedAtCapacity, panelB, activeEvidence);
  const projected = projectPanelAttention(alerts, {
    score,
    route,
    reviewed: reviewedBoth,
    incumbents: [],
  });

  assert.equal(reviewedAtCapacity.length, 500);
  assert.equal(reviewedBoth.length, 500);
  assert.deepEqual(
    projected.panels.map((panel) => [panel.panelId, panel.unreviewedCount]),
    [['a', 0], ['b', 0]],
  );
});

test('default persistence uses quota-safe eviction and preserves the session review write', async () => {
  const { loadReviewLedger, persistReviewLedger } = await moduleUnderTest();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>([['wm-unified-alerts-v1', 'disposable cache']]);
  let firstReviewWrite = true;
  const storage = {
    get length(): number { return values.size; },
    clear(): void { values.clear(); },
    getItem(key: string): string | null { return values.get(key) ?? null; },
    key(index: number): string | null { return [...values.keys()][index] ?? null; },
    removeItem(key: string): void { values.delete(key); },
    setItem(key: string, value: string): void {
      if (key.includes('panel-review') && firstReviewWrite) {
        firstReviewWrite = false;
        throw new DOMException('full', 'QuotaExceededError');
      }
      values.set(key, value);
    },
  } satisfies Storage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

  try {
    const identity = { id: 'active', observedAt: 2, revision: '0000000000000002' };
    assert.equal(persistReviewLedger([identity]), true);
    assert.deepEqual(loadReviewLedger(), [identity]);
    assert.equal(values.has('wm-unified-alerts-v1'), false, 'disposable cache was evicted for the precious review write');
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

test('promotion is capped at three and same-band challengers do not churn incumbents', async () => {
  const { projectPanelAttention } = await moduleUnderTest();
  const alerts = [
    alert('a', 'a', 50), alert('b', 'b', 60), alert('c', 'c', 70), alert('d', 'd', 99),
  ];
  const snapshot = projectPanelAttention(alerts, {
    score, route, reviewed: [], incumbents: ['a', 'b', 'c'],
  });

  assert.deepEqual(snapshot.promotedPanelIds, ['a', 'b', 'c']);
  assert.equal(snapshot.panels.filter((panel) => panel.promoted).length, 3);
});

test('an urgent challenger preempts the weakest standard incumbent', async () => {
  const { projectPanelAttention } = await moduleUnderTest();
  const snapshot = projectPanelAttention(
    [alert('a', 'a', 40), alert('b', 'b', 50), alert('c', 'c', 60), alert('urgent', 'urgent', 120)],
    { score, route, reviewed: [], incumbents: ['a', 'b', 'c'] },
  );

  assert.deepEqual(snapshot.promotedPanelIds, ['b', 'c', 'urgent']);
});

test('ineligible incumbents vacate slots for deterministic replacements', async () => {
  const { projectPanelAttention } = await moduleUnderTest();
  const snapshot = projectPanelAttention(
    [alert('old', 'old', 29), alert('z', 'z', 40), alert('a', 'a', 40)],
    { score, route, reviewed: [], incumbents: ['old'] },
  );

  assert.deepEqual(snapshot.promotedPanelIds, ['a', 'z']);
});
