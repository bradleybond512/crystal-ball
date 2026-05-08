import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPrompt,
  snapshotFingerprint,
  shouldRegenerate,
  fetchThreatStateSnapshot,
  generateAiBrief,
  resetAiBriefCache,
  AI_BRIEF_TTL_MS,
  AI_BRIEF_SYSTEM_PROMPT,
  type ThreatStateSnapshot,
} from '../ai-brief-generator.ts';

const NOW = 1_746_576_000_000; // 2026-05-07T00:00:00Z (deterministic clock)

const emptySnapshot: ThreatStateSnapshot = {
  sources: { ok: [], missing: [], failed: [] },
};

const sampleSnapshot: ThreatStateSnapshot = {
  spaceweather: { kpIndex: 7, summary: 'G3 storm watch', observedAt: '2026-05-07T00:00:00Z' },
  alerts: {
    summary: '3 active CAP alerts',
    extreme: 1,
    severe: 2,
    items: [{ event: 'Tornado Warning', areaDesc: 'La Porte, IN', severity: 'Extreme' }],
  },
  wildfires: { summary: '124 active incidents (12 large)', count: 124 },
  gdelt: { summary: 'Tone declining; protest velocity up 18%' },
  economic: { summary: 'S&P -1.4%, oil +3.2%, BTC -2.1%' },
  sources: { ok: ['spaceweather', 'alerts', 'wildfires', 'gdelt', 'economic'], missing: [], failed: [] },
};

// ── buildPrompt ──────────────────────────────────────────────────────────────

test('buildPrompt: includes the system-prompt anchor + every populated section', () => {
  const prompt = buildPrompt(sampleSnapshot);
  assert.match(prompt, /space weather/i);
  assert.match(prompt, /CAP/i);
  assert.match(prompt, /wildfire/i);
  assert.match(prompt, /GDELT/i);
  assert.match(prompt, /economic/i);
  assert.match(prompt, /S&P/);
});

test('buildPrompt: emits an "all-quiet" indicator when no sources resolved', () => {
  const prompt = buildPrompt(emptySnapshot);
  assert.match(prompt, /no current data/i);
});

test('buildPrompt: marks failed/missing sources so the model can flag gaps', () => {
  const snapshot: ThreatStateSnapshot = {
    spaceweather: { kpIndex: 4, summary: 'Quiet', observedAt: '2026-05-07T00:00:00Z' },
    sources: { ok: ['spaceweather'], missing: ['vessels'], failed: ['acled'] },
  };
  const prompt = buildPrompt(snapshot);
  assert.match(prompt, /missing[\s\S]*vessels/i);
  assert.match(prompt, /failed[\s\S]*acled/i);
});

test('AI_BRIEF_SYSTEM_PROMPT: contains the analyst persona + 3-paragraph instruction', () => {
  assert.match(AI_BRIEF_SYSTEM_PROMPT, /intelligence analyst/i);
  assert.match(AI_BRIEF_SYSTEM_PROMPT, /three[- ]paragraph|3[- ]paragraph/i);
  assert.match(AI_BRIEF_SYSTEM_PROMPT, /no bullet/i);
});

// ── snapshotFingerprint ──────────────────────────────────────────────────────

test('snapshotFingerprint: stable across re-orderings', () => {
  const a = snapshotFingerprint(sampleSnapshot);
  const reordered: ThreatStateSnapshot = {
    economic: sampleSnapshot.economic,
    spaceweather: sampleSnapshot.spaceweather,
    gdelt: sampleSnapshot.gdelt,
    alerts: sampleSnapshot.alerts,
    wildfires: sampleSnapshot.wildfires,
    sources: { ok: [...sampleSnapshot.sources.ok].reverse(), missing: [], failed: [] },
  };
  const b = snapshotFingerprint(reordered);
  assert.equal(a, b);
});

test('snapshotFingerprint: changes when an upstream value changes', () => {
  const a = snapshotFingerprint(sampleSnapshot);
  const tweaked: ThreatStateSnapshot = {
    ...sampleSnapshot,
    spaceweather: { ...sampleSnapshot.spaceweather!, kpIndex: 9 },
  };
  const b = snapshotFingerprint(tweaked);
  assert.notEqual(a, b);
});

test('snapshotFingerprint: empty snapshot has a deterministic fingerprint', () => {
  const a = snapshotFingerprint(emptySnapshot);
  const b = snapshotFingerprint({ sources: { ok: [], missing: [], failed: [] } });
  assert.equal(a, b);
  assert.ok(a.length > 0);
});

// ── shouldRegenerate ─────────────────────────────────────────────────────────

test('shouldRegenerate: regenerates when cache is empty', () => {
  assert.equal(shouldRegenerate(null, 'fp-1', NOW), true);
});

test('shouldRegenerate: regenerates when fingerprint changed', () => {
  const cache = { fingerprint: 'fp-1', generatedAt: NOW - 1000, text: 'x', provider: 'local' as const };
  assert.equal(shouldRegenerate(cache, 'fp-2', NOW), true);
});

test('shouldRegenerate: regenerates when cache TTL expired', () => {
  const cache = { fingerprint: 'fp-1', generatedAt: NOW - AI_BRIEF_TTL_MS - 1, text: 'x', provider: 'local' as const };
  assert.equal(shouldRegenerate(cache, 'fp-1', NOW), true);
});

test('shouldRegenerate: hits cache when fingerprint matches and TTL is fresh', () => {
  const cache = { fingerprint: 'fp-1', generatedAt: NOW - 1000, text: 'x', provider: 'local' as const };
  assert.equal(shouldRegenerate(cache, 'fp-1', NOW), false);
});

// ── fetchThreatStateSnapshot ─────────────────────────────────────────────────

const okJson = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
const badResponse = () => new Response('upstream down', { status: 503 });

test('fetchThreatStateSnapshot: tracks ok / failed / missing per endpoint', async () => {
  const calls: string[] = [];
  const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/api/spaceweather/status')) return okJson({ kpIndex: 5 });
    if (url.endsWith('/api/alerts/active')) return okJson({ alerts: [] });
    if (url.endsWith('/api/wildfire/incidents')) return badResponse();
    if (url.endsWith('/api/gdelt-intel')) return okJson({ tone: -2.1 });
    if (url.endsWith('/api/acled-events')) return okJson({ events: [] });
    if (url.endsWith('/api/economic-stress')) return badResponse();
    if (url.endsWith('/api/dark-vessels')) return okJson({ tracked: 4 });
    throw new Error(`unexpected fetch ${url}`);
  };
  const snapshot = await fetchThreatStateSnapshot({ fetcher: fakeFetch as typeof fetch, baseUrl: 'http://test' });
  assert.deepEqual(snapshot.sources.ok.sort(), ['acled', 'alerts', 'gdelt', 'spaceweather', 'vessels']);
  assert.deepEqual(snapshot.sources.failed.sort(), ['economic', 'wildfires']);
});

test('fetchThreatStateSnapshot: tolerates fetcher throwing on a single endpoint', async () => {
  const fakeFetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('/api/spaceweather/status')) throw new Error('network');
    return okJson({ ok: true });
  };
  const snapshot = await fetchThreatStateSnapshot({ fetcher: fakeFetch as typeof fetch, baseUrl: 'http://test' });
  assert.ok(snapshot.sources.failed.includes('spaceweather'));
  assert.ok(snapshot.sources.ok.length >= 1);
});

// ── generateAiBrief ──────────────────────────────────────────────────────────

test('generateAiBrief: returns no-api-key error when ANTHROPIC_API_KEY missing AND llm returns provider=none', async () => {
  resetAiBriefCache();
  const result = await generateAiBrief({
    force: true,
    // Snapshot has data so we get past the no-data short-circuit; LLM
    // returning provider=none with no Anthropic key configured is the
    // actionable signal.
    snapshotProvider: async () => sampleSnapshot,
    generator: async () => ({ text: '', provider: 'none' }),
    isApiKeyConfigured: () => false,
  });
  assert.ok('reason' in result);
  if ('reason' in result) {
    assert.equal(result.reason, 'no-api-key');
  }
});

test('generateAiBrief: returns the generated text on success', async () => {
  resetAiBriefCache();
  const result = await generateAiBrief({
    force: true,
    snapshotProvider: async () => sampleSnapshot,
    generator: async () => ({ text: 'paragraph one\n\nparagraph two\n\nparagraph three', provider: 'local', model: 'llama' }),
    isApiKeyConfigured: () => true,
  });
  assert.ok(!('reason' in result));
  if (!('reason' in result)) {
    assert.equal(result.text, 'paragraph one\n\nparagraph two\n\nparagraph three');
    assert.equal(result.provider, 'local');
    assert.equal(result.cached, false);
  }
});

test('generateAiBrief: returns cached text on second call when fingerprint + TTL are fresh', async () => {
  resetAiBriefCache();
  let llmCalls = 0;
  const generator = async () => {
    llmCalls += 1;
    return { text: `call-${llmCalls}`, provider: 'local' as const };
  };
  const opts = {
    snapshotProvider: async () => sampleSnapshot,
    generator,
    isApiKeyConfigured: () => true,
  };
  const a = await generateAiBrief(opts);
  const b = await generateAiBrief(opts);
  assert.ok(!('reason' in a) && !('reason' in b));
  if (!('reason' in a) && !('reason' in b)) {
    assert.equal(a.cached, false);
    assert.equal(b.cached, true);
    assert.equal(a.text, b.text);
  }
  assert.equal(llmCalls, 1);
});

test('generateAiBrief: regenerates when force=true even with a fresh cache', async () => {
  resetAiBriefCache();
  let llmCalls = 0;
  const generator = async () => {
    llmCalls += 1;
    return { text: `call-${llmCalls}`, provider: 'local' as const };
  };
  const opts = {
    snapshotProvider: async () => sampleSnapshot,
    generator,
    isApiKeyConfigured: () => true,
  };
  await generateAiBrief(opts);
  await generateAiBrief({ ...opts, force: true });
  assert.equal(llmCalls, 2);
});

test('generateAiBrief: returns budget-exhausted error when llm-adapter signals provider=none with key configured', async () => {
  resetAiBriefCache();
  const result = await generateAiBrief({
    force: true,
    snapshotProvider: async () => sampleSnapshot,
    generator: async () => ({ text: '', provider: 'none' }),
    isApiKeyConfigured: () => true,
  });
  assert.ok('reason' in result);
  if ('reason' in result) {
    assert.equal(result.reason, 'budget-exhausted');
  }
});

test('generateAiBrief: returns no-data error when snapshot has zero ok sources AND llm not invoked', async () => {
  resetAiBriefCache();
  let invoked = false;
  const result = await generateAiBrief({
    force: true,
    snapshotProvider: async () => emptySnapshot,
    generator: async () => { invoked = true; return { text: 'x', provider: 'local' as const }; },
    isApiKeyConfigured: () => true,
  });
  assert.ok('reason' in result);
  if ('reason' in result) {
    assert.equal(result.reason, 'no-data');
  }
  assert.equal(invoked, false);
});
