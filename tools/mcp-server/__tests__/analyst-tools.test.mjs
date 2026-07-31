import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAnalystTools, schemas } from '../tools/analyst.mjs';

function fakeClient(state, posts = []) {
  return {
    async get(route) {
      assert.equal(route, '/api/analyst-state');
      return state;
    },
    async post(route, body) {
      posts.push({ route, body });
      return { ok: true, id: `cmd-${posts.length}` };
    },
  };
}

test('analyst tools', async (t) => {
  await t.test('schemas have description + inputSchema', () => {
    for (const key of ['get_analyst_hypotheses', 'get_mode_forecast', 'get_analyst_accuracy', 'get_hot_entities']) {
      assert.ok(schemas[key].description.length > 10, `${key} has description`);
      assert.ok(schemas[key].inputSchema, `${key} has inputSchema`);
    }
  });

  await t.test('returns unavailable when state missing', async () => {
    const tools = makeAnalystTools(fakeClient({ available: false, message: 'not running' }));
    const res = await tools.get_analyst_hypotheses({});
    assert.equal(res.available, false);
    assert.match(res.summary, /not available/);
  });

  await t.test('filters hypotheses by min_risk and limit', async () => {
    const state = {
      available: true,
      ageMs: 1000,
      stale: false,
      ghostMode: false,
      analyst: {
        timestamp: Date.now(),
        aiEnriched: false,
        hypotheses: [
          { id: 'a', kind: 'cross-domain-cluster', risk: 'critical', confidence: 0.9, statement: 'Critical case', region: 'X', evidence: [{ source: 'situation-engine', id: 's1', label: 'Sit 1', panelId: 'situation-awareness' }] },
          { id: 'b', kind: 'alert-burst', risk: 'low', confidence: 0.4, statement: 'Low case', evidence: [] },
          { id: 'c', kind: 'situation-escalation', risk: 'high', confidence: 0.7, statement: 'High case', evidence: [] },
        ],
      },
      threads: [],
      entityCount: 0,
    };
    const tools = makeAnalystTools(fakeClient(state));
    const res = await tools.get_analyst_hypotheses({ min_risk: 'high', limit: 5 });
    assert.equal(res.available, true);
    assert.equal(res.hypotheses.length, 2);
    assert.deepEqual(res.hypotheses.map(h => h.risk), ['critical', 'high']);
  });

  await t.test('forecast tool reports pressure summary', async () => {
    const tools = makeAnalystTools(fakeClient({
      available: true,
      ageMs: 1000,
      stale: false,
      ghostMode: false,
      forecast: {
        timestamp: Date.now(),
        pressure: { finance: 0.4, security: 0.85, disaster: 0.1, cyber: 0.2 },
        advisories: [{ domain: 'security', pressure: 0.85, slope: 0.05, etaMin: null, statement: 'security elevated', timestamp: Date.now() }],
      },
    }));
    const res = await tools.get_mode_forecast({});
    assert.equal(res.available, true);
    assert.match(res.summary, /security:0\.85/);
    assert.equal(res.advisories.length, 1);
  });

  await t.test('accuracy tool emits per-kind percentages', async () => {
    const tools = makeAnalystTools(fakeClient({
      available: true,
      ageMs: 1000,
      stale: false,
      ghostMode: false,
      accuracy: [
        { kind: 'alert-burst', hits: 8, misses: 2, ratio: 0.8 },
        { kind: 'situation-escalation', hits: 1, misses: 1, ratio: 0.5 },
      ],
    }));
    const res = await tools.get_analyst_accuracy({});
    assert.equal(res.available, true);
    assert.match(res.summary, /alert-burst: 80%/);
  });

  await t.test('submit_hypothesis_feedback POSTs to command queue', async () => {
    const posts = [];
    const tools = makeAnalystTools(fakeClient({ available: true }, posts));
    const res = await tools.submit_hypothesis_feedback({ vote: 'down', hypothesis_id: 'h1' });
    assert.equal(res.submitted, true);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].route, '/api/analyst-commands');
    assert.equal(posts[0].body.kind, 'thumbs_down');
    assert.equal(posts[0].body.hypothesisId, 'h1');
  });

  await t.test('submit_hypothesis_feedback requires id or signature', async () => {
    const tools = makeAnalystTools(fakeClient({ available: true }));
    const res = await tools.submit_hypothesis_feedback({ vote: 'up' });
    assert.match(res.error, /Provide either/);
  });

  await t.test('dismiss_hypothesis POSTs a dismiss command', async () => {
    const posts = [];
    const tools = makeAnalystTools(fakeClient({ available: true }, posts));
    const res = await tools.dismiss_hypothesis({ signature: 'sig-1' });
    assert.equal(res.submitted, true);
    assert.equal(posts[0].body.kind, 'dismiss');
    assert.equal(posts[0].body.signature, 'sig-1');
  });

  await t.test('run_skeptic_now POSTs a run_skeptic command', async () => {
    const posts = [];
    const tools = makeAnalystTools(fakeClient({ available: true }, posts));
    const res = await tools.run_skeptic_now({ hypothesis_id: 'h2' });
    assert.equal(res.submitted, true);
    assert.equal(posts[0].body.kind, 'run_skeptic');
  });

  await t.test('hot entities tool', async () => {
    const tools = makeAnalystTools(fakeClient({
      available: true,
      ageMs: 1000,
      stale: false,
      ghostMode: false,
      hotEntities: [
        { entity: 'IRN', kind: 'country', hypothesisCount: 3 },
        { entity: 'AAPL', kind: 'ticker', hypothesisCount: 2 },
      ],
      entityCount: 8,
    }));
    const res = await tools.get_hot_entities({});
    assert.equal(res.entities.length, 2);
    assert.equal(res.totalEntities, 8);
    assert.match(res.summary, /IRN\(3\)/);
  });

  await t.test('unsafe analyst-loop conclusions are quarantined', async () => {
    const tools = makeAnalystTools(fakeClient({
      available: true,
      analyst: {
        hypotheses: [{
          id: 'h1',
          kind: 'cascade',
          risk: 'critical',
          confidence: 0.9,
          statement: 'Derived conclusion',
        }],
      },
      algorithmDiagnostics: {
        health: {
          algorithms: [{
            algorithmId: 'analyst-loop',
            criticality: 'high',
            status: 'unsafe',
            reason: 'holdout failure',
          }],
        },
      },
    }));

    const result = await tools.get_analyst_hypotheses();

    assert.equal(result.available, false);
    assert.equal(result.quarantined, true);
    assert.deepEqual(result.hypotheses, []);
    assert.match(result.summary, /quarantined/i);
  });

  await t.test('unrelated unsafe algorithms are disclosed without suppressing analyst output', async () => {
    const tools = makeAnalystTools(fakeClient({
      available: true,
      analyst: { hypotheses: [] },
      algorithmDiagnostics: {
        health: {
          algorithms: [{
            algorithmId: 'warning-verification',
            criticality: 'safety',
            status: 'unsafe',
            reason: 'below floor',
          }],
        },
      },
    }));

    const result = await tools.get_analyst_hypotheses();

    assert.equal(result.available, true);
    assert.deepEqual(result.safety.quarantinedAlgorithms, ['warning-verification']);
  });
});
