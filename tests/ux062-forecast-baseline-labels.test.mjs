import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { Window } from 'happy-dom';

const compiled = new Map();
const hypothesis = { id: 'h1', kind: 'situation-escalation', timestamp: 1000, risk: 'critical', confidence: 0.835, statement: 'Keep the warning visible', evidence: [] };
const forecast = {
  hypothesisId: 'h1', probability: 0.625, trend: 'rising', horizon: '24h',
  components: { baseConfidence: 0.835, pciBoost: 0.05, analogBoost: 0, providerMultiplier: 1,
    calibrationMultiplier: 1, calibrationExplanation: 'Historical calibration warning' },
};
const superforecast = {
  hypothesisId: 'h1', probability: 0.445, llmTier: 'partial', explanation: 'outside view', spread: 0.25,
  estimates: [{ source: 'base-rate', p: 0.3, weight: 1 }, { source: 'persona-analyst', p: 0.55, weight: 1 }],
  interval: { p: 0.445, lo: 0.3, hi: 0.6, alpha: 0.2, n: 57, explanation: 'global pool' },
};

function harness(t) {
  const win = new Window({ url: 'http://localhost/' });
  const state = { superforecast, accuracy: new Map(), records: [], situations: [], forbidden: [] };
  const fail = (name) => { state.forbidden.push(name); throw new Error(`Unexpected boundary access: ${name}`); };
  const boundaries = {
    'src/components/Panel.ts': { Panel: class {} },
    'src/services/hypothesis-threads.ts': { getThreadFor: () => null },
    'src/services/hypothesis-accuracy.ts': { getKindAccuracy: () => state.accuracy },
    'src/services/cognition/superforecast-state.ts': { getCachedSuperforecast: () => state.superforecast },
    'src/services/intelligence/forecast-calibration-adapter.ts': { getCalibrationStore: () => ({ all: () => state.records }) },
    'src/services/algorithms/tunable-params-store.ts': { getTunedParam: (_a, _b, fallback) => fallback },
    'src/services/situation-engine.ts': { situationEngine: { getSituations: () => state.situations, getActiveCount: () => state.situations.length } },
  };
  const real = new Set([
    'src/components/AnalystHUD.ts', 'src/components/SituationPanel.ts', 'src/components/CommandCenterPanel.ts',
    'src/components/SituationDossier.ts', 'src/components/forecast-provenance-view.ts',
    'src/services/cognition/calibration-report-view.ts', 'src/services/cognition/recalibration.ts',
    'src/services/situation-types.ts', 'src/utils/sanitize.ts', 'src/services/home-shell/dossier-view.ts',
    'src/services/home-shell/deck-view.ts', 'src/services/home-shell/readiness-constants.ts',
    'src/services/insights/confidence-urgency-matrix.ts',
  ]);
  const modules = new Map();
  function load(file) {
    if (boundaries[file]) return boundaries[file];
    if (!real.has(file)) return new Proxy({}, { get: (_target, name) => fail(`${file}:${String(name)}`) });
    if (modules.has(file)) return modules.get(file);
    if (!compiled.has(file)) compiled.set(file, ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText);
    const exports = {};
    modules.set(file, exports);
    vm.runInNewContext(compiled.get(file), {
      exports, document: win.document, window: win, HTMLElement: win.HTMLElement, CustomEvent: win.CustomEvent,
      localStorage: win.localStorage, console, Date, fetch: () => fail('fetch'),
      setTimeout: () => fail('setTimeout'), setInterval: () => fail('setInterval'),
      require(id) {
        assert.ok(id.startsWith('@/') || id.startsWith('.'), `Unexpected import ${id}`);
        let resolved = id.startsWith('@/') ? `src/${id.slice(2)}` : path.posix.normalize(path.posix.join(path.posix.dirname(file), id));
        if (!resolved.endsWith('.ts')) resolved += '.ts';
        return load(resolved);
      },
    }, { filename: file });
    return exports;
  }
  function subject(name) { return Object.create(load(`src/components/${name}.ts`)[name].prototype); }
  function html(markup) { const root = win.document.createElement('div'); root.innerHTML = markup; return root; }
  t.after(() => { win.happyDOM.abort(); assert.deepEqual(state.forbidden, [], 'labels must not read unrelated stores, fetch, or schedule work'); });
  return { win, state, load, subject, html };
}

function disclosure(root, explanation) {
  const labels = root.querySelectorAll('details.forecast-unverified');
  assert.equal(labels.length, 1, 'one independently scoped visible Unverified disclosure');
  const details = labels[0];
  assert.equal(details.firstElementChild?.tagName, 'SUMMARY');
  assert.equal(details.firstElementChild.textContent, 'Unverified');
  assert.equal(details.firstElementChild.hidden, false);
  assert.equal(details.firstElementChild.getAttribute('aria-hidden'), null);
  assert.equal(details.open, false);
  assert.equal(details.querySelector('p')?.textContent, explanation);
  assert.equal(details.querySelector('p')?.getAttribute('aria-hidden'), null);
  assert.doesNotMatch(details.textContent, /beats|trails|\d+%/i);
  return details;
}

function hudSubject(h) {
  const hud = h.subject('AnalystHUD');
  Object.assign(hud, {
    root: h.win.document.createElement('div'), visible: true, settingsOpen: false,
    snapshot: { hypotheses: [hypothesis] }, replayAtTimestamp: null, selectedHypothesisIndex: 0,
    expandedProjection: new Set(), expandedEnsemble: new Set(), expandedSuperforecast: new Set(['h1']),
  });
  hud.root.tabIndex = -1;
  h.win.document.body.append(hud.root);
  return hud;
}

function situation() {
  return {
    id: 'sit1', title: '<img src=x onerror=alert(1)>', summary: 'Official warning remains active', phase: 'active',
    domain: 'natural_hazard', confidence: 0.72,
    geo: { kind: 'point', basis: 'reported-event', lat: 0, lon: 0, label: 'Region', countries: ['US'], radiusKm: 50 },
    signals: [], domainDiversity: 1, evidence: null,
    scenarios: [0, 0.625, 1].map((probability, i) => ({ id: `sc${i}`, label: `Scenario ${i} <script>bad()</script>`,
      probability, severity: 'severe', description: 'Keep <strong>warning</strong> text', horizonHours: 24,
      confirmationIndicators: [], invalidationIndicators: [] })),
    actions: [{ id: 'act1', headline: 'Shelter now', rationale: 'Official warning', urgency: 'immediate',
      steps: ['Follow local guidance'], dismissed: false }],
  };
}

test('raw HUD confidence is independently Unverified without changing confidence or risk', (t) => {
  const h = harness(t); const hud = hudSubject(h);
  for (const accuracy of [new Map(), new Map([['situation-escalation', { hits: 99, misses: 1 }]]), new Map([['situation-escalation', { hits: 0, misses: 100 }]])]) {
    h.state.accuracy = accuracy;
    const head = hud.buildHypHead(hypothesis);
    assert.equal(head.querySelector('.analyst-hud-hyp-conf').textContent, '84%');
    assert.equal(head.querySelector('.analyst-hud-hyp-risk').textContent, 'critical');
    const details = disclosure(head, 'Baseline skill is unverified for this displayed estimate.');
    assert.equal(head.querySelector('.analyst-hud-hyp-conf').nextElementSibling, details);
  }
});

test('adjusted HUD forecast has its own explanation while exact values, bars, and provenance remain', (t) => {
  const h = harness(t); const hud = hudSubject(h);
  for (const [probability, expected] of [[0, '0'], [0.625, '63'], [1, '100']]) {
    const bar = hud.buildForecastBar({ ...forecast, probability });
    assert.equal(bar.querySelector('.analyst-hud-forecast-label').textContent, `${expected}% ↑ 24h`);
    assert.equal(bar.querySelector('.analyst-hud-forecast-fill').style.width, `${expected}%`);
    assert.deepEqual([...bar.querySelectorAll('.analyst-hud-forecast-why-row')].map(n => n.textContent),
      ['Base confidence 84%', 'Pattern (PCI) +5%', 'Historical calibration warning']);
    assert.equal(bar.querySelector('.analyst-hud-forecast-why summary').textContent, 'why');
    const details = disclosure(bar, 'No exact matching baseline evaluation for this adjusted forecast.');
    assert.equal(bar.querySelector('.analyst-hud-forecast-label').nextElementSibling, details);
  }
});

test('expanded Superforecast labels only the headline and preserves every estimate and interval', (t) => {
  const h = harness(t); const hud = hudSubject(h);
  const root = hud.buildHypSuperforecast(hypothesis);
  assert.deepEqual([...root.querySelectorAll('.analyst-hud-superforecast-line')].map(n => n.textContent), [
    'Superforecast 45% (partial LLM pipeline)', '80% interval 30%–60% (n=57)',
    'base-rate 30% (weight 1.0)', 'persona-analyst 55% (weight 1.0)', 'Estimate spread 25%',
  ]);
  const details = disclosure(root, 'No exact recorded identity for this displayed result.');
  assert.equal(root.querySelector('.analyst-hud-superforecast-line').nextElementSibling, details);
});

test('missing or collapsed Superforecast creates no new empty-state label', (t) => {
  const h = harness(t); const hud = hudSubject(h);
  hud.expandedSuperforecast.clear();
  assert.equal(hud.buildHypSuperforecast(hypothesis).textContent, '');
  hud.expandedSuperforecast.add('h1'); h.state.superforecast = null;
  assert.equal(hud.buildHypSuperforecast(hypothesis).textContent, '');
});

test('every scenario keeps its probability, warning, action, and escaping with its own disclosure', (t) => {
  const h = harness(t); const panel = h.subject('SituationPanel'); const sit = situation();
  panel._expandedSitId = sit.id;
  const card = panel.renderSituation(sit);
  assert.equal(card.querySelector('.sit-title').textContent, sit.title);
  assert.equal(card.querySelector('.sit-summary').textContent, sit.summary);
  assert.equal(card.querySelector('.sit-act-urgency').textContent, 'IMMEDIATE');
  assert.equal(card.querySelector('.sit-act-headline').textContent, 'Shelter now');
  assert.equal(card.querySelector('.sit-act-dismiss').dataset.actId, 'act1');
  assert.equal(card.querySelector('.sit-act-dismiss').textContent, 'Dismiss');
  assert.ok(card.querySelector('button.sit-map-btn'));
  assert.equal(card.querySelector('script, img, strong') === null, true, 'untrusted markup remains text');
  const scenarios = [...card.querySelectorAll('.sit-scenario')];
  assert.equal(scenarios.length, 3);
  scenarios.forEach((sc, i) => {
    const percent = ['0%', '63%', '100%'][i];
    assert.equal(sc.querySelector('.sit-sc-prob').textContent, percent);
    assert.equal(sc.querySelector('.sit-sc-fill').style.width, percent);
    assert.equal(sc.querySelector('.sit-sc-label').textContent, sit.scenarios[i].label);
    assert.equal(sc.querySelector('.sit-sc-desc').textContent, sit.scenarios[i].description);
    assert.equal(sc.querySelector('.sit-sc-horizon').textContent, '24h horizon · severe');
    assert.equal(sc.querySelector('.sit-sc-prob').nextElementSibling,
      disclosure(sc, 'No matching baseline evidence.'));
  });
});

test('scenario disclosure click does not collapse the card or dismiss its warning action', (t) => {
  const h = harness(t); const panel = h.subject('SituationPanel'); const sit = situation();
  panel._expandedSitId = sit.id; h.state.situations = [sit];
  const root = h.win.document.createElement('div'); root.append(panel.renderSituation(sit));
  root.addEventListener('click', e => panel.handleContentClick(e));
  const summary = root.querySelector('.forecast-unverified summary');
  assert.ok(summary, 'scenario explanation has native activation target');
  summary.dispatchEvent(new h.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(panel._expandedSitId, sit.id);
  assert.equal(sit.actions[0].dismissed, false);
  assert.equal(root.querySelector('.sit-act-headline').textContent, 'Shelter now');
});

test('native HUD disclosure activation is not consumed as projection or ensemble keyboard shortcuts', (t) => {
  const h = harness(t); const hud = hudSubject(h);
  hud.root.append(hud.buildHypHead(hypothesis));
  hud.root.addEventListener('keydown', e => hud.handleKeydown(e));
  const summary = hud.root.querySelector('.forecast-unverified summary');
  assert.ok(summary, 'raw confidence explanation has native activation target');
  for (const [key, shiftKey] of [['Enter', false], ['Enter', true], [' ', false]]) {
    const event = new h.win.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    summary.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, `${key} retains its native default`);
    assert.equal(hud.expandedProjection.size, 0);
    assert.equal(hud.expandedEnsemble.size, 0);
  }
  const escape = new h.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  summary.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(hud.visible, false);
  assert.equal(hud.root.hidden, true);
});

test('HUD focus trap includes the disclosure when it is the only control', (t) => {
  const h = harness(t); const hud = hudSubject(h);
  hud.root.append(hud.buildHypHead(hypothesis));
  const summary = hud.root.querySelector('.forecast-unverified summary');
  assert.ok(summary, 'raw confidence explanation is keyboard reachable');
  Object.defineProperty(summary, 'offsetParent', { get: () => hud.root });
  for (const shiftKey of [false, true]) {
    hud.root.focus();
    const event = new h.win.KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
    hud.handleKeydown(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(h.win.document.activeElement, summary);
  }
});

test('historical calibration assessments never promote the scoped baseline comparison', (t) => {
  const h = harness(t); const panel = h.subject('CommandCenterPanel');
  for (const [probability, outcomes, assessment, brier] of [
    [0.8, 12, 'runs cold', '0.04'], [0.8, 0, 'runs hot', '0.64'], [0.5, 6, 'calibrated', '0.25'],
  ]) {
    h.state.records = Array.from({ length: 12 }, (_, i) => ({ id: `old-${i}`, sourceId: 'unrelated-model',
      domain: 'weather', probability, predictedAt: 100, resolveBy: 200,
      status: i < outcomes ? 'resolved_true' : 'resolved_false', claim: '<script>unrelated</script>' }));
    const root = h.html(panel.renderCalibrationReport());
    assert.match(root.textContent, new RegExp(assessment));
    assert.match(root.textContent, new RegExp(`n=12 · Brier ${brier.replace('.', '\\.')}`));
    const note = root.querySelector('.calibration-baseline-note');
    assert.ok(note, 'historical summary explicitly scopes baseline verification');
    assert.equal(note.textContent, 'Baseline comparison: Unverified. This summary combines historical forecasts and does not verify individual forecast skill.');
    assert.equal(note.closest('details, [hidden], [aria-hidden="true"]'), null);
    assert.doesNotMatch(note.textContent, /beats|trails|\d+%/i);
    assert.equal(root.querySelector('script'), null);
  }
});

test('no resolved calibration history preserves the absent card', (t) => {
  const h = harness(t); const panel = h.subject('CommandCenterPanel');
  assert.equal(panel.renderCalibrationReport(), '');
  h.state.records = [{ id: 'pending', domain: 'weather', probability: 0.8, status: 'pending' }];
  assert.equal(panel.renderCalibrationReport(), '');
});

test('actual dossier categorical confidence and urgency remain unchanged without forecast badges', (t) => {
  const h = harness(t); const dossier = h.subject('SituationDossier');
  dossier.headerEl = h.win.document.createElement('header');
  const { buildDossierView } = h.load('src/services/home-shell/dossier-view.ts');
  for (const [confidence, label] of [['low', 'LOW'], ['medium', 'MED'], ['high', 'HIGH']]) {
    const view = buildDossierView({ situation: { id: 'warning', category: 'severe_weather', title: 'Official warning',
      severityScore: 90, confidence, minutesUntilImpact: 10 }, metadata: {}, names: {}, health: [], narratives: {} }, 1000);
    dossier.renderHeader(view);
    assert.equal(dossier.headerEl.querySelector('.hs-dossier-badge').textContent, `ACT SOON · ${label} CONF`);
    assert.equal(dossier.headerEl.querySelector('.hs-dossier-subline').textContent, `severity 90 · ${confidence} confidence · ~10 min`);
    assert.deepEqual([...dossier.headerEl.querySelectorAll('button')].map(n => n.textContent), ['Share ⌘E', 'Close ⎋']);
    assert.equal(dossier.headerEl.querySelector('.forecast-unverified'), null);
    assert.doesNotMatch(dossier.headerEl.textContent, /Unverified|baseline|\d+%/i);
  }
});
