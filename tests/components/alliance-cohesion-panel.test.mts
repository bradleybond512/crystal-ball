/**
 * Tests for AllianceCohesionPanel + alliance-cohesion-helpers.
 *
 * Run with: tsx --import ./tests/panels/register-hook.mjs --test tests/components/alliance-cohesion-panel.test.mts
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

const G = globalThis as unknown as Record<string, unknown>;
G.__viteImportMetaEnv = { DEV: false, PROD: false, MODE: 'test', BASE_URL: '/', VITE_VARIANT: 'full' };
G.__POSTHOG_DISABLED = true;

const happyWindow = new Window({ url: 'http://127.0.0.1:46123/' });
G.window = happyWindow;
G.document = happyWindow.document;
G.HTMLElement = happyWindow.HTMLElement;
G.HTMLDivElement = (happyWindow as unknown as Record<string, unknown>).HTMLDivElement ?? happyWindow.HTMLElement;
G.HTMLButtonElement = (happyWindow as unknown as Record<string, unknown>).HTMLButtonElement ?? happyWindow.HTMLElement;
G.Element = happyWindow.Element;
G.Node = happyWindow.Node;
G.Event = happyWindow.Event;
G.CustomEvent = happyWindow.CustomEvent;
G.DOMException = (happyWindow as unknown as Record<string, unknown>).DOMException;
G.MutationObserver = (happyWindow as unknown as Record<string, unknown>).MutationObserver;
G.AbortController = happyWindow.AbortController;
G.localStorage = happyWindow.localStorage;
G.sessionStorage = happyWindow.sessionStorage;
G.getComputedStyle = happyWindow.getComputedStyle?.bind(happyWindow) ?? (() => ({ getPropertyValue: () => '', display: '', visibility: '' }));
G.matchMedia = (happyWindow as unknown as Record<string, unknown>).matchMedia ?? (() => ({
  matches: false, media: '', addEventListener: () => {}, removeEventListener: () => {},
  addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
}));
G.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
G.cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as NodeJS.Timeout);

if (typeof G.IntersectionObserver !== 'function') {
  G.IntersectionObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] { return []; }
  };
}
if (typeof G.ResizeObserver !== 'function') {
  G.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

G.fetch = () => Promise.resolve(new Response('{}', { status: 200 }));

import {
  AllianceCohesionPanel,
  type AllianceCohesionData,
} from '../../src/components/AllianceCohesionPanel.ts';
import {
  natoStatusColor,
  natoStatusLabel,
  spendingTrendColor,
  spendingTrendLabel,
  allianceHealthColor,
  allianceHealthLabel,
  cohesionScoreColor,
  agreementStatusColor,
  agreementStatusLabel,
  credibilitySignalColor,
  credibilitySignalLabel,
  defectionRiskColor,
  blocTensionColor,
  blocTensionLabel,
  countNonCompliantNato,
  countFracturedAlliances,
  countSuspendedAgreements,
  countNegativeCredibilityEvents,
  countHighDefectionRisk,
  NATO_SPENDING,
  ALLIANCE_COHESION_SCORES,
  BILATERAL_AGREEMENTS,
  CREDIBILITY_EVENTS,
  DEFECTION_RISKS,
  BLOC_TENSIONS,
  type NatoMember,
  type AllianceCohesionScore,
  type BilateralAgreement,
  type CredibilityEvent,
  type DefectionRisk,
  type BlocTension,
} from '../../src/components/alliance-cohesion-helpers.ts';

function makePanel(): AllianceCohesionPanel {
  return new AllianceCohesionPanel();
}

function emptyData(): AllianceCohesionData {
  return {
    natoSpending: [],
    allianceCohesion: [],
    bilateralAgreements: [],
    credibilityEvents: [],
    defectionRisks: [],
    blocTensions: [],
  };
}

// ── Panel identity ────────────────────────────────────────────────────────

test('panel has id alliance-cohesion', () => {
  assert.equal(makePanel().getPanelId(), 'alliance-cohesion');
});

test('panel element has data-panel attribute alliance-cohesion', () => {
  assert.equal(makePanel().getElement().dataset.panel, 'alliance-cohesion');
});

test('panel title contains Alliance', () => {
  const titleEl = makePanel().getElement().querySelector('.panel-title');
  assert.ok(titleEl?.textContent?.includes('Alliance'), `got "${titleEl?.textContent}"`);
});

// ── Section headers ───────────────────────────────────────────────────────

test('buildHtml includes NATO Defense Spending Compliance section', () => {
  assert.match(makePanel().buildHtml(emptyData()), /NATO Defense Spending Compliance/);
});

test('buildHtml includes Alliance Cohesion Scores section', () => {
  assert.match(makePanel().buildHtml(emptyData()), /Alliance Cohesion Scores/);
});

test('buildHtml includes Bilateral Security Agreements section', () => {
  assert.match(makePanel().buildHtml(emptyData()), /Bilateral Security Agreements/);
});

test('buildHtml includes Alliance Credibility Events section', () => {
  assert.match(makePanel().buildHtml(emptyData()), /Alliance Credibility Events/);
});

test('buildHtml includes Defection Risk Scoring section', () => {
  assert.match(makePanel().buildHtml(emptyData()), /Defection Risk Scoring/);
});

test('buildHtml includes Competing Bloc Membership Tensions section', () => {
  assert.match(makePanel().buildHtml(emptyData()), /Competing Bloc Membership Tensions/);
});

// ── Empty-state fallbacks ─────────────────────────────────────────────────

test('empty NATO data renders fallback text', () => {
  assert.match(makePanel().buildHtml(emptyData()), /No NATO spending data/);
});

test('empty alliance data renders fallback text', () => {
  assert.match(makePanel().buildHtml(emptyData()), /No alliance cohesion data/);
});

test('empty agreement data renders fallback text', () => {
  assert.match(makePanel().buildHtml(emptyData()), /No bilateral agreements tracked/);
});

test('empty credibility data renders fallback text', () => {
  assert.match(makePanel().buildHtml(emptyData()), /No credibility events recorded/);
});

test('empty defection data renders fallback text', () => {
  assert.match(makePanel().buildHtml(emptyData()), /No defection risk assessments/);
});

test('empty bloc tension data renders fallback text', () => {
  assert.match(makePanel().buildHtml(emptyData()), /No competing bloc tensions tracked/);
});

// ── NATO row data ─────────────────────────────────────────────────────────

test('renders NATO nation name, GDP %, status label, trend label, notes', () => {
  const member: NatoMember = {
    nation: 'Poland', gdpPct: 4.12, status: 'compliant', trend: 'rising', notes: 'F-35 deliveries',
  };
  const html = makePanel().buildHtml({ ...emptyData(), natoSpending: [member] });
  assert.match(html, /Poland/);
  assert.match(html, /4\.12% GDP/);
  assert.match(html, /Compliant/);
  assert.match(html, /↑ Rising/);
  assert.match(html, /F-35 deliveries/);
});

// ── Alliance row data ─────────────────────────────────────────────────────

test('renders alliance name, members, health, cohesion score, tension, strength', () => {
  const a: AllianceCohesionScore = {
    name: 'AUKUS', members: ['Australia', 'UK', 'USA'],
    health: 'strong', cohesionScore: 8.5,
    keyTension: 'Pillar 2 export controls', keyStrength: 'HMAS Stirling basing',
  };
  const html = makePanel().buildHtml({ ...emptyData(), allianceCohesion: [a] });
  assert.match(html, /AUKUS/);
  assert.match(html, /Australia, UK, USA/);
  assert.match(html, /Strong/);
  assert.match(html, /cohesion 8\.5\/10/);
  assert.match(html, /Pillar 2 export controls/);
  assert.match(html, /HMAS Stirling basing/);
});

// ── Bilateral agreement row data ──────────────────────────────────────────

test('renders bilateral pair, type, status, year, notes', () => {
  const a: BilateralAgreement = {
    nations: ['USA', 'Philippines'], agreementType: 'Mutual Defence Treaty',
    status: 'active', signedYear: 1951, notes: 'VFA expanded',
  };
  const html = makePanel().buildHtml({ ...emptyData(), bilateralAgreements: [a] });
  assert.match(html, /USA ↔ Philippines/);
  assert.match(html, /Mutual Defence Treaty/);
  assert.match(html, /Active/);
  assert.match(html, /since 1951/);
  assert.match(html, /VFA expanded/);
});

// ── Credibility event row data ────────────────────────────────────────────

test('renders credibility event date, alliance, signal, impact, description', () => {
  const e: CredibilityEvent = {
    date: '2026-03-18', alliance: 'NATO', signal: 'negative',
    description: 'Trump threatened US withdrawal', impactNation: 'Canada, Spain',
  };
  const html = makePanel().buildHtml({ ...emptyData(), credibilityEvents: [e] });
  assert.match(html, /2026-03-18/);
  assert.match(html, /NATO/);
  assert.match(html, /Negative/);
  assert.match(html, /impact: Canada, Spain/);
  assert.match(html, /Trump threatened US withdrawal/);
});

// ── Defection risk row data ───────────────────────────────────────────────

test('renders defection nation, primary alliance, risk score, trajectory, factors', () => {
  const r: DefectionRisk = {
    nation: 'Hungary', primaryAlliance: 'NATO / EU', riskScore: 8.1,
    riskFactors: ['Orbán pro-Putin stance', 'Paks II'], trajectory: 'rising',
  };
  const html = makePanel().buildHtml({ ...emptyData(), defectionRisks: [r] });
  assert.match(html, /Hungary/);
  assert.match(html, /NATO \/ EU/);
  assert.match(html, /defection 8\.1\/10/);
  assert.match(html, /↑ Rising/);
  assert.match(html, /Orbán pro-Putin stance · Paks II/);
});

// ── Bloc tension row data ─────────────────────────────────────────────────

test('renders bloc tension nation, blocs, level, description', () => {
  const t: BlocTension = {
    nation: 'India', bloc1: 'QUAD', bloc2: 'BRICS', tensionLevel: 3,
    description: 'Simultaneous SCO + QUAD',
  };
  const html = makePanel().buildHtml({ ...emptyData(), blocTensions: [t] });
  assert.match(html, /India/);
  assert.match(html, /QUAD vs BRICS/);
  assert.match(html, /High/);
  assert.match(html, /Simultaneous SCO \+ QUAD/);
});

// ── Helper: NATO status ───────────────────────────────────────────────────

test('natoStatusLabel maps every variant', () => {
  assert.equal(natoStatusLabel('compliant'), 'Compliant');
  assert.equal(natoStatusLabel('pledge-made'), 'Pledge Made');
  assert.equal(natoStatusLabel('below-target'), 'Below Target');
  assert.equal(natoStatusLabel('non-compliant'), 'Non-Compliant');
});

test('natoStatusColor returns non-empty CSS var fallback for every variant', () => {
  for (const s of ['compliant', 'pledge-made', 'below-target', 'non-compliant'] as const) {
    assert.match(natoStatusColor(s), /^var\(--severity-/);
  }
});

// ── Helper: spending trend ────────────────────────────────────────────────

test('spendingTrendLabel returns directional arrow', () => {
  assert.match(spendingTrendLabel('rising'), /↑/);
  assert.match(spendingTrendLabel('stable'), /→/);
  assert.match(spendingTrendLabel('falling'), /↓/);
});

test('spendingTrendColor: falling is critical, rising is low', () => {
  assert.match(spendingTrendColor('falling'), /severity-critical/);
  assert.match(spendingTrendColor('rising'), /severity-low/);
});

// ── Helper: alliance health ───────────────────────────────────────────────

test('allianceHealthLabel maps every variant', () => {
  assert.equal(allianceHealthLabel('strong'), 'Strong');
  assert.equal(allianceHealthLabel('strained'), 'Strained');
  assert.equal(allianceHealthLabel('fragile'), 'Fragile');
  assert.equal(allianceHealthLabel('fractured'), 'Fractured');
});

test('allianceHealthColor: fractured is critical, strong is low', () => {
  assert.match(allianceHealthColor('fractured'), /severity-critical/);
  assert.match(allianceHealthColor('strong'), /severity-low/);
});

// ── Helper: cohesion score color ──────────────────────────────────────────

test('cohesionScoreColor thresholds (high score = good)', () => {
  assert.match(cohesionScoreColor(9), /severity-low/);
  assert.match(cohesionScoreColor(8), /severity-low/);
  assert.match(cohesionScoreColor(7), /severity-medium/);
  assert.match(cohesionScoreColor(6), /severity-medium/);
  assert.match(cohesionScoreColor(5), /severity-high/);
  assert.match(cohesionScoreColor(4), /severity-high/);
  assert.match(cohesionScoreColor(3), /severity-critical/);
  assert.match(cohesionScoreColor(0), /severity-critical/);
});

// ── Helper: agreement status ──────────────────────────────────────────────

test('agreementStatusLabel maps every variant', () => {
  assert.equal(agreementStatusLabel('active'), 'Active');
  assert.equal(agreementStatusLabel('under-review'), 'Under Review');
  assert.equal(agreementStatusLabel('suspended'), 'Suspended');
  assert.equal(agreementStatusLabel('renegotiating'), 'Renegotiating');
  assert.equal(agreementStatusLabel('terminated'), 'Terminated');
});

test('agreementStatusColor: terminated is critical, active is low', () => {
  assert.match(agreementStatusColor('terminated'), /severity-critical/);
  assert.match(agreementStatusColor('active'), /severity-low/);
});

// ── Helper: credibility signal ────────────────────────────────────────────

test('credibilitySignalLabel maps every variant', () => {
  assert.equal(credibilitySignalLabel('positive'), 'Positive');
  assert.equal(credibilitySignalLabel('neutral'), 'Neutral');
  assert.equal(credibilitySignalLabel('negative'), 'Negative');
  assert.equal(credibilitySignalLabel('critical'), 'Critical');
});

test('credibilitySignalColor: critical is critical, positive is low', () => {
  assert.match(credibilitySignalColor('critical'), /severity-critical/);
  assert.match(credibilitySignalColor('positive'), /severity-low/);
});

// ── Helper: defection risk color (high score = bad) ───────────────────────

test('defectionRiskColor thresholds (high score = bad)', () => {
  assert.match(defectionRiskColor(8), /severity-critical/);
  assert.match(defectionRiskColor(7), /severity-critical/);
  assert.match(defectionRiskColor(6), /severity-high/);
  assert.match(defectionRiskColor(5), /severity-high/);
  assert.match(defectionRiskColor(4), /severity-medium/);
  assert.match(defectionRiskColor(3), /severity-medium/);
  assert.match(defectionRiskColor(2), /severity-low/);
  assert.match(defectionRiskColor(0), /severity-low/);
});

// ── Helper: bloc tension ──────────────────────────────────────────────────

test('blocTensionLabel maps every level', () => {
  assert.equal(blocTensionLabel(0), 'None');
  assert.equal(blocTensionLabel(1), 'Low');
  assert.equal(blocTensionLabel(2), 'Moderate');
  assert.equal(blocTensionLabel(3), 'High');
  assert.equal(blocTensionLabel(4), 'Severe');
});

test('blocTensionColor: 4 is critical, 0 is none', () => {
  assert.match(blocTensionColor(4), /severity-critical/);
  assert.match(blocTensionColor(0), /severity-none/);
});

// ── Helper: count aggregations ────────────────────────────────────────────

test('countNonCompliantNato counts non-compliant + below-target', () => {
  const members: NatoMember[] = [
    { nation: 'A', gdpPct: 3, status: 'compliant',     trend: 'stable', notes: '' },
    { nation: 'B', gdpPct: 1, status: 'non-compliant', trend: 'stable', notes: '' },
    { nation: 'C', gdpPct: 1.5, status: 'below-target', trend: 'stable', notes: '' },
    { nation: 'D', gdpPct: 1.9, status: 'pledge-made', trend: 'stable', notes: '' },
  ];
  assert.equal(countNonCompliantNato(members), 2);
});

test('countFracturedAlliances counts fragile + fractured', () => {
  const list: AllianceCohesionScore[] = [
    { name: 'X', members: [], health: 'strong',    cohesionScore: 8, keyTension: '', keyStrength: '' },
    { name: 'Y', members: [], health: 'strained',  cohesionScore: 6, keyTension: '', keyStrength: '' },
    { name: 'Z', members: [], health: 'fragile',   cohesionScore: 4, keyTension: '', keyStrength: '' },
    { name: 'W', members: [], health: 'fractured', cohesionScore: 2, keyTension: '', keyStrength: '' },
  ];
  assert.equal(countFracturedAlliances(list), 2);
});

test('countSuspendedAgreements counts suspended + terminated', () => {
  const list: BilateralAgreement[] = [
    { nations: ['A','B'], agreementType: '', status: 'active',        signedYear: 2000, notes: '' },
    { nations: ['A','C'], agreementType: '', status: 'suspended',     signedYear: 2000, notes: '' },
    { nations: ['A','D'], agreementType: '', status: 'terminated',    signedYear: 2000, notes: '' },
    { nations: ['A','E'], agreementType: '', status: 'renegotiating', signedYear: 2000, notes: '' },
  ];
  assert.equal(countSuspendedAgreements(list), 2);
});

test('countNegativeCredibilityEvents counts negative + critical', () => {
  const list: CredibilityEvent[] = [
    { date: '', alliance: '', signal: 'positive', description: '', impactNation: '' },
    { date: '', alliance: '', signal: 'neutral',  description: '', impactNation: '' },
    { date: '', alliance: '', signal: 'negative', description: '', impactNation: '' },
    { date: '', alliance: '', signal: 'critical', description: '', impactNation: '' },
  ];
  assert.equal(countNegativeCredibilityEvents(list), 2);
});

test('countHighDefectionRisk counts riskScore >= 6', () => {
  const list: DefectionRisk[] = [
    { nation: 'A', primaryAlliance: '', riskScore: 8.1, riskFactors: [], trajectory: 'stable' },
    { nation: 'B', primaryAlliance: '', riskScore: 5.9, riskFactors: [], trajectory: 'stable' },
    { nation: 'C', primaryAlliance: '', riskScore: 6.0, riskFactors: [], trajectory: 'stable' },
    { nation: 'D', primaryAlliance: '', riskScore: 4.1, riskFactors: [], trajectory: 'stable' },
  ];
  assert.equal(countHighDefectionRisk(list), 2);
});

// ── Static datasets sanity ────────────────────────────────────────────────

test('NATO_SPENDING dataset includes USA, UK, Germany, France', () => {
  const names = new Set(NATO_SPENDING.map((m) => m.nation));
  for (const n of ['USA', 'UK', 'Germany', 'France']) assert.ok(names.has(n), n);
});

test('ALLIANCE_COHESION_SCORES covers NATO, AUKUS, QUAD, Five Eyes', () => {
  const names = new Set(ALLIANCE_COHESION_SCORES.map((a) => a.name));
  for (const n of ['NATO', 'AUKUS', 'QUAD', 'Five Eyes']) assert.ok(names.has(n), n);
});

test('BILATERAL_AGREEMENTS, CREDIBILITY_EVENTS, DEFECTION_RISKS, BLOC_TENSIONS non-empty', () => {
  assert.ok(BILATERAL_AGREEMENTS.length > 0);
  assert.ok(CREDIBILITY_EVENTS.length > 0);
  assert.ok(DEFECTION_RISKS.length > 0);
  assert.ok(BLOC_TENSIONS.length > 0);
});

// ── XSS prevention ────────────────────────────────────────────────────────

test('XSS: malicious nation name in NATO row is escaped', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    natoSpending: [{ nation: '<script>x</script>', gdpPct: 2, status: 'compliant', trend: 'stable', notes: '' }],
  });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('XSS: malicious alliance name is escaped', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    allianceCohesion: [{
      name: '"><img src=x onerror=alert(1)>', members: [], health: 'strong',
      cohesionScore: 8, keyTension: '', keyStrength: '',
    }],
  });
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /&lt;img/);
});

test('XSS: malicious risk factor is escaped', () => {
  const html = makePanel().buildHtml({
    ...emptyData(),
    defectionRisks: [{
      nation: 'X', primaryAlliance: 'Y', riskScore: 5,
      riskFactors: ['<iframe src=evil></iframe>'], trajectory: 'stable',
    }],
  });
  assert.doesNotMatch(html, /<iframe/);
});

// ── refresh() defensive behavior ──────────────────────────────────────────

test('refresh() with no args uses static defaults and does not throw', () => {
  const panel = makePanel();
  assert.doesNotThrow(() => panel.refresh());
});

test('refresh() with a throwing accessor falls back to defaults', () => {
  const panel = makePanel();
  const bad = {
    get natoSpending(): NatoMember[] { throw new Error('upstream down'); },
    allianceCohesion: [] as AllianceCohesionScore[],
    bilateralAgreements: [] as BilateralAgreement[],
    credibilityEvents: [] as CredibilityEvent[],
    defectionRisks: [] as DefectionRisk[],
    blocTensions: [] as BlocTension[],
  } satisfies AllianceCohesionData;
  assert.doesNotThrow(() => panel.refresh(bad));
});

// ── Count badge ───────────────────────────────────────────────────────────

test('setCount sums NATO non-compliance + fractured alliances + suspended agreements + negative events + high defection risk', () => {
  const panel = makePanel();
  let lastCount = -1;
  const orig = panel.setCount.bind(panel);
  panel.setCount = (n: number) => { lastCount = n; orig(n); };
  panel.refresh({
    natoSpending: [
      { nation: 'A', gdpPct: 1, status: 'non-compliant', trend: 'stable', notes: '' },
    ], // +1
    allianceCohesion: [
      { name: 'X', members: [], health: 'fractured', cohesionScore: 2, keyTension: '', keyStrength: '' },
    ], // +1
    bilateralAgreements: [
      { nations: ['A','B'], agreementType: '', status: 'suspended', signedYear: 2000, notes: '' },
      { nations: ['A','C'], agreementType: '', status: 'terminated', signedYear: 2000, notes: '' },
    ], // +2
    credibilityEvents: [
      { date: '', alliance: '', signal: 'critical', description: '', impactNation: '' },
    ], // +1
    defectionRisks: [
      { nation: 'A', primaryAlliance: '', riskScore: 9, riskFactors: [], trajectory: 'stable' },
    ], // +1
    blocTensions: [],
  });
  assert.equal(lastCount, 6);
});

test('setCount is 0 when all surfaces are healthy', () => {
  const panel = makePanel();
  let lastCount = -1;
  const orig = panel.setCount.bind(panel);
  panel.setCount = (n: number) => { lastCount = n; orig(n); };
  panel.refresh({
    natoSpending: [{ nation: 'A', gdpPct: 3, status: 'compliant', trend: 'rising', notes: '' }],
    allianceCohesion: [{ name: 'X', members: [], health: 'strong', cohesionScore: 9, keyTension: '', keyStrength: '' }],
    bilateralAgreements: [{ nations: ['A','B'], agreementType: '', status: 'active', signedYear: 2000, notes: '' }],
    credibilityEvents: [{ date: '', alliance: '', signal: 'positive', description: '', impactNation: '' }],
    defectionRisks: [{ nation: 'A', primaryAlliance: '', riskScore: 2, riskFactors: [], trajectory: 'falling' }],
    blocTensions: [],
  });
  assert.equal(lastCount, 0);
});

// ── Lifecycle ─────────────────────────────────────────────────────────────

test('destroy() does not throw', () => {
  const panel = makePanel();
  assert.doesNotThrow(() => panel.destroy());
});
