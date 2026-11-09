import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';
import { Window } from 'happy-dom';
function methods(names, globals = {}) {
  const source = ts.createSourceFile('panel.ts', readFileSync('src/components/SystemDiagnosticPanel.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'SystemDiagnosticPanel');
  const text = names.map(name => { const member = cls.members.find(m => m.name?.getText(source) === name); assert.ok(member, `actual panel method ${name} exists`); return member.getText(source); }).join('\n');
  return vm.runInNewContext(ts.transpileModule(`class Base { destroy() {} hide() {} }; class Subject extends Base { ${text} }; Subject.prototype;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { Date, console, ...globals });
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('actual Diagnostics lazy quota owner ignores late loading after destroy and tracks active demand', async () => {
  let now = 1000;
  const proto = methods(['syncQuotaPanel'], { Date: { now: () => now } }); let resolve; let loads = 0; let renders = 0; const active = [];
  const subject = Object.assign(Object.create(proto), { quotaDisposed: false, quotaActive: false, quotaController: null, quotaLoad: null, quotaLoadAttemptAt: null, loadQuotaModule: () => { loads++; return new Promise(r => { resolve = r; }); }, render: () => renders++, renderWhenVisible: callback => callback() });
  subject.syncQuotaPanel(false); assert.equal(loads, 0);
  subject.syncQuotaPanel(true); subject.syncQuotaPanel(true); assert.equal(loads, 1);
  now += 30000; subject.syncQuotaPanel(true); assert.equal(loads, 1, 'pending lazy module stays single-flight after throttle window');
  subject.syncQuotaPanel(false);
  resolve({ createQuotaBudgetsController: () => ({ setActive: on => active.push(on), destroy() {} }) }); await settle();
  assert.deepEqual(active, [false]); assert.equal(renders, 0);
  subject.syncQuotaPanel(true); assert.deepEqual(active, [false,true]);
  const later = Object.assign(Object.create(proto), { quotaDisposed: false, quotaController: null, quotaLoad: null, quotaLoadAttemptAt: null, loadQuotaModule: () => new Promise(r => { resolve = r; }), render() { throw new Error('destroyed render'); } });
  later.syncQuotaPanel(true); later.quotaDisposed = true;
  let allocations = 0;
  resolve({ createQuotaBudgetsController() { allocations++; return { setActive() {}, destroy() {} }; } }); await settle();
  assert.equal(allocations, 0);
  assert.equal(later.quotaController, null);
});
test('actual Diagnostics render restores the focused budgets tab without stealing unrelated focus', () => {
  const browser = new Window(); const document = browser.document;
  const proto = methods(['render', 'captureContentFocus'], { document, escapeHtml: String });
  const content = document.createElement('div'); document.body.append(content);
  const html = '<button class="syd-tab" data-tab="budgets">API Budgets</button>';
  content.innerHTML = html; content.querySelector('button').focus();
  let flush;
  const subject = Object.assign(Object.create(proto), { activeTab: 'budgets', getContentElement: () => content, buildHtml: () => html, setContent: value => { flush = () => { const restore = subject.captureContentFocus(); content.innerHTML = value; restore?.(); }; }, wireHandlers() {} });
  subject.render(); flush(); assert.equal(document.activeElement.dataset.tab, 'budgets');
  const outside = document.createElement('button'); document.body.append(outside); subject.render(); outside.focus(); flush(); assert.equal(document.activeElement, outside, 'focus moved outside during debounce must not be stolen');
  browser.happyDOM.abort();
});


test('actual Diagnostics disclosure and visibility gate budgets without changing other tabs', () => {
  let level = 'detail'; const enabled = [];
  const proto = methods(['buildHtml'], { disclosureService: { getLevel: () => level }, renderDisclosureSwitcherHtml: () => '', escapeHtml: String, STATUS_COLOR: { healthy: 'green' }, document: { visibilityState: 'visible' } });
  const ctx = { unhealthyCount: 0, report: { status: 'healthy', summary: 'ok' }, recommendations: [], features: [], panels: [], feedAudit: { entries: [] }, recentEvents: [] };
  let visible = true; let hidden = false;
  const subject = Object.assign(Object.create(proto), { activeTab: 'budgets', collect: () => ctx, setCount() {}, syncQuotaPanel: value => enabled.push(value), isPanelInView: () => visible, getElement: () => ({ classList: { contains: () => hidden } }), renderHeader: () => '', renderTabs: () => '', renderActiveTab: () => '' });
  subject.buildHtml(); level = 'summary'; subject.buildHtml(); level = 'raw'; subject.buildHtml(); level = 'detail'; visible = false; subject.buildHtml(); visible = true; hidden = true; subject.buildHtml(); hidden = false; subject.activeTab = 'feeds'; subject.buildHtml();
  assert.deepEqual(enabled, [true,false,false,false,false,false]);
});

test('actual Diagnostics hide and destroy cancel quota ownership and retain existing teardown', () => {
  const proto = methods(['hide','destroy']); const events = [];
  const subject = Object.assign(Object.create(proto), { quotaDisposed: false, quotaController: { destroy: () => events.push('quota') }, refreshTimer: null, unsubscribeNews: () => events.push('news'), detachDisclosure: () => events.push('detach'), unsubscribeDisclosure: () => events.push('disclosure'), syncQuotaPanel: enabled => events.push(enabled) });
  subject.hide(); assert.deepEqual(events, [false]); subject.destroy();
  assert.deepEqual(events, [false,'quota','news','detach','disclosure']); assert.equal(subject.quotaDisposed, true); assert.equal(subject.quotaController, null);
});

test('quota UI production and test paths retain an admitted actual two-file selector suite', async () => {
  const { deriveScriptIndex, selectScripts } = await import('../scripts/targeted-tests.mjs');
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
  const index = deriveScriptIndex(scripts);
  const overrides = JSON.parse(readFileSync('scripts/targeted-tests-overrides.json', 'utf8'));
  for (const file of ['src/components/SystemDiagnosticPanel.ts','src/components/system-diagnostic-budgets.ts','src/services/diagnostics/quota-budgets.ts','src/services/diagnostics/__tests__/quota-budgets.test.mts','tests/quota-governor-gates.test.mjs']) {
    assert.ok(selectScripts([file], index, overrides).scripts.includes('test:quota-ui'), file);
  }
  assert.match(scripts['test:quota-ui'], /tests\/quota-governor-gates\.test\.mjs/);
  assert.match(scripts['test:quota-ui'], /src\/services\/diagnostics\/__tests__\/quota-budgets\.test\.mts/);
  assert.ok(overrides['src/components/SystemDiagnosticPanel.ts'].includes('test:sidecar-routing'));
  assert.ok(overrides['src/components/SystemDiagnosticPanel.ts'].includes('test:signing-phase-a'));
});
