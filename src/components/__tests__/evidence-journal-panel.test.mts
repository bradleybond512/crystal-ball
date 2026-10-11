/** Execute the full panel class; isolate its base UI and service dependencies. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { Window } from 'happy-dom';
import type { OutboxDiagnostics } from '../../services/intelligence/evidence-outbox.ts';
import type { EvidenceSummary } from '../../services/intelligence/evidence-journal.ts';
import * as view from '../evidence-journal-view.ts';
import * as helpers from '../belief-helpers.ts';
import * as report from '../calibration-report-view.ts';
import * as sanitize from '../../utils/sanitize.ts';
import * as duration from '../../utils/format-duration.ts';
import * as calibration from '../../services/intelligence/forecast-calibration.ts';
import * as recalibration from '../../services/cognition/recalibration.ts';
import * as conformal from '../../services/cognition/conformal.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../BeliefCalibrationPanel.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function diagnostics(overrides: Partial<OutboxDiagnostics> = {}): OutboxDiagnostics {
  return {
    savedAwaitingSync: 0, hashing: 0, awaitingStorage: 0, terminalBlocked: 0,
    refused: 0, interrupted: 0, quarantined: 0, blocked: false,
    diagnosticsUnsaved: false, storageFailures: 0, saturated: false,
    lastReason: null, lastRefusedAt: null, byReason: {}, byKind: {}, journalFull: false,
    slots: 0, reservedBytes: 0, transientBytes: 0, workers: 0,
    highWater: { slots: 0, reservedBytes: 0, transientBytes: 0, workers: 0 },
    limits: { slots: 4096, storageBytes: 2097152, transientBytes: 2097152, inputBytes: 8192, payloadBytes: 4096, workers: 4 },
    ...overrides,
  };
}
const summary: EvidenceSummary = {
  total: 1, byKind: { forecast: 1 }, sizeBytes: 4096, maxBytes: 268435456,
  chain: { ok: true, count: 1 }, lastAppendedAt: 1,
};
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function mount(options: { summary?: () => Promise<EvidenceSummary | null>; jsonl?: () => Promise<string> } = {}) {
  const browser = new Window({ url: 'http://127.0.0.1/' });
  let data = diagnostics();
  const listeners = new Set<() => void>();
  const timers = new Map<number, () => void>();
  const delays: number[] = [];
  const downloaded: string[] = [];
  let summaryCalls = 0;
  let exportCalls = 0;
  let calibrationReads = 0;
  let nextTimer = 0;
  class BasePanel {
    readonly controller = new browser.AbortController();
    readonly content = browser.document.createElement('div');
    constructor() { browser.document.body.append(this.content); }
    protected get signal() { return this.controller.signal; }
    setContent(html: string) { this.content.innerHTML = html; }
    destroy() { this.controller.abort(); }
  }
  const dependencies: Record<string, unknown> = {
    './Panel': { Panel: BasePanel }, './belief-helpers': helpers,
    './calibration-report-view': report, './evidence-journal-view': view,
    '@/utils/sanitize': sanitize, '@/utils/format-duration': duration,
    '@/services/intelligence/forecast-calibration': calibration,
    '@/services/cognition/recalibration': recalibration,
    '@/services/cognition/conformal': conformal,
    '@/services/cognition/forecast-journal': { getOperatorBrier: () => ({ n: 0 }), getOperatorCurve: () => [] },
    '@/services/intelligence/forecast-calibration-adapter': { getCalibrationStore: () => ({ all() { calibrationReads++; return []; } }) },
    '@/services/intelligence/evidence-journal-wiring': { getEvidenceJournal: () => ({
      summary() { summaryCalls++; return options.summary?.() ?? Promise.resolve(summary); },
      exportJsonl() { exportCalls++; return options.jsonl?.() ?? Promise.resolve('{"header":true}\n{"entry":true}\n'); },
    }) },
    '@/services/intelligence/evidence-outbox': {
      getEvidenceOutboxDiagnostics: () => data,
      subscribeEvidenceOutbox(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    },
    '@/utils/export': { downloadFile: (jsonl: string) => downloaded.push(jsonl) },
  };
  const exports: Record<string, unknown> = {};
  const scope = {
    setTimeout(callback: () => void, ms: number) { const id = ++nextTimer; timers.set(id, callback); delays.push(ms); return id; },
    clearTimeout(id: number) { timers.delete(id); },
  };
  new Function('require', 'exports', 'window', compiled)((id: string) => {
    assert.ok(id in dependencies, `Unconfigured panel dependency: ${id}`);
    return dependencies[id];
  }, exports, scope);
  const Constructor = exports.BeliefCalibrationPanel as new () => BasePanel & { exportEvidence(): Promise<void> };
  const panel = new Constructor();
  return {
    panel, timers, delays, listeners, downloaded,
    get focusedElement() { return browser.document.activeElement; },
    get exportCalls() { return exportCalls; },
    get summaryCalls() { return summaryCalls; }, get calibrationReads() { return calibrationReads; },
    update(overrides: Partial<OutboxDiagnostics>) { data = diagnostics(overrides); for (const listener of listeners) listener(); },
    flush() { const queued = [...timers.values()]; timers.clear(); for (const callback of queued) callback(); },
    async close() { panel.destroy(); await browser.happyDOM.close(); },
  };
}

test('content-free capture notifications coalesce without SQL refetch or workbench rebuild and preserve export focus', async () => {
  const fixture = mount();
  try {
    await settle();
    assert.equal(fixture.listeners.size, 1, 'panel must subscribe to local capture diagnostics');
    const reads = fixture.calibrationReads;
    const calls = fixture.summaryCalls;
    const button = fixture.panel.content.querySelector<HTMLButtonElement>('button[data-evidence-action="export"]')!;
    button.focus();
    assert.equal(fixture.focusedElement, button);
    for (let index = 1; index <= 100; index++) fixture.update({ savedAwaitingSync: index });
    assert.equal(fixture.timers.size, 1, 'one fixed timer must coalesce an entire notification burst');
    assert.equal(fixture.delays.length, 1, 'later captures must not postpone the first update');
    assert.ok(fixture.delays[0]! > 0 && fixture.delays[0]! <= 250);
    fixture.flush();
    assert.match(fixture.panel.content.textContent!, /100 scored changes saved locally and awaiting sync/);
    assert.equal(fixture.summaryCalls, calls, 'capture updates must not request a SQL summary');
    assert.equal(fixture.calibrationReads, reads, 'capture updates must not recompute the workbench');
    assert.equal(fixture.panel.content.querySelector('button[data-evidence-action="export"]'), button,
      'capture updates must retain the existing export button');
    assert.equal(fixture.focusedElement, button, 'capture updates must preserve actual export focus');
    fixture.update({ hashing: 1 });
    fixture.flush();
    assert.match(fixture.panel.content.textContent!, /1 capture hashing/);
  } finally { await fixture.close(); }
});

test('abort unsubscribes cancels queued diagnostics and guards a stale timer callback', async () => {
  const fixture = mount();
  try {
    await settle();
    fixture.update({ hashing: 3 });
    assert.equal(fixture.timers.size, 1, 'capture notification must schedule a real panel update');
    const stale = [...fixture.timers.values()][0]!;
    const html = fixture.panel.content.innerHTML;
    fixture.panel.destroy();
    assert.equal(fixture.listeners.size, 0, 'abort must remove outbox subscription');
    assert.equal(fixture.timers.size, 0, 'abort must cancel pending diagnostic timer');
    fixture.update({ refused: 4 });
    stale();
    assert.equal(fixture.panel.content.innerHTML, html, 'stale callbacks must not render after abort');
    assert.equal(fixture.timers.size, 0);
  } finally { await fixture.close(); }
});

test('local capture notifications render while the engine summary is unavailable', async () => {
  const fixture = mount({ summary: () => Promise.resolve(null) });
  try {
    await settle();
    fixture.update({ savedAwaitingSync: 4, refused: 2 });
    fixture.flush();
    assert.match(fixture.panel.content.textContent!, /4 scored changes saved locally and awaiting sync/);
    assert.match(fixture.panel.content.textContent!, /2 captures refused/);
    assert.equal(fixture.summaryCalls, 1);
    assert.equal(fixture.panel.content.querySelector<HTMLButtonElement>('[data-evidence-action="export"]')!.disabled, true);
  } finally { await fixture.close(); }
});

test('completed export reports committed rows and preserves pending and refused warnings', async () => {
  const fixture = mount();
  try {
    await settle();
    fixture.update({ savedAwaitingSync: 2, refused: 7, terminalBlocked: 1 });
    fixture.flush();
    await fixture.panel.exportEvidence();
    assert.equal(fixture.downloaded.length, 1);
    assert.match(fixture.panel.content.textContent!, /Exported 1 committed journal entry/);
    assert.match(fixture.panel.content.querySelector('.evidence-journal-message')!.textContent!, /2 pending captures, 7 refused captures and 1 rejected captures/);
    assert.match(fixture.panel.content.textContent!, /backup of pending, refused or rejected captures/);
    assert.match(fixture.panel.content.textContent!, /7 captures refused/);
    assert.match(fixture.panel.content.textContent!, /2 scored changes saved locally and awaiting sync/);
  } finally { await fixture.close(); }
});

test('an export completing after disposal does not download or refresh', async () => {
  let resolve!: (value: string) => void;
  const fixture = mount({ jsonl: () => new Promise(done => { resolve = done; }) });
  try {
    await settle();
    const exporting = fixture.panel.exportEvidence();
    fixture.panel.destroy();
    resolve('{"header":true}\n{"entry":true}\n');
    await exporting;
    assert.equal(fixture.downloaded.length, 0, 'disposed panels must not download from a stale export completion');
    assert.equal(fixture.summaryCalls, 1);
  } finally { await fixture.close(); }
});


function evidenceButton(fixture: ReturnType<typeof mount>, action: 'retry' | 'export'): HTMLButtonElement {
  const button = fixture.panel.content.querySelector<HTMLButtonElement>(`button[data-evidence-action="${action}"]`);
  assert.ok(button, `mounted panel must render the ${action} evidence action`);
  return button;
}

test('initial unavailable summary recovers through rendered retry and exports in the same panel', async () => {
  let healthy = false;
  const committed = '{"header":true}\n{"committed":"initial-recovery"}\n';
  const fixture = mount({ summary: () => Promise.resolve(healthy ? summary : null), jsonl: () => Promise.resolve(committed) });
  const originalPanel = fixture.panel;
  try {
    await settle();
    assert.equal(evidenceButton(fixture, 'export').disabled, true);
    healthy = true;
    fixture.update({ savedAwaitingSync: 3, refused: 2 });
    fixture.flush();
    assert.equal(fixture.summaryCalls, 1, 'backend recovery and capture diagnostics must not automatically read the summary');
    const retry = evidenceButton(fixture, 'retry');
    assert.equal(retry.disabled, false, 'unavailable summary must offer an enabled retry');
    retry.click();
    await settle();
    assert.equal(fixture.summaryCalls, 2, 'rendered retry must request a second summary');
    assert.match(fixture.panel.content.querySelector('.evidence-journal-status')!.textContent!, /1 entry.*hash chain verified/);
    assert.equal(fixture.panel.content.querySelector('[data-evidence-action="retry"]'), null, 'ready summary needs only export');
    assert.equal(evidenceButton(fixture, 'export').disabled, false);
    evidenceButton(fixture, 'export').click();
    await settle();
    assert.equal(fixture.exportCalls, 1);
    assert.deepEqual(fixture.downloaded, [committed], 'recovered panel must download the injected committed journal');
    assert.match(fixture.panel.content.textContent!, /Exported 1 committed journal entry/);
    assert.equal(fixture.summaryCalls, 3, 'completed export must refresh through the summary path');
    assert.equal(fixture.panel, originalPanel, 'recovery must not reconstruct the panel');
  } finally { await fixture.close(); }
});

test('failed export and repeated unavailable retries recover with historical error and capture warnings retained', async () => {
  let healthy = true;
  let exportFails = false;
  const committed = '{"header":true}\n{"committed":"repeated-recovery"}\n';
  const fixture = mount({
    summary: () => Promise.resolve(healthy ? summary : null),
    jsonl: () => exportFails ? Promise.reject(new Error('fixture engine unavailable')) : Promise.resolve(committed),
  });
  const originalPanel = fixture.panel;
  try {
    await settle();
    fixture.update({ savedAwaitingSync: 2, refused: 7, terminalBlocked: 1 });
    fixture.flush();
    evidenceButton(fixture, 'export').click();
    await settle();
    assert.deepEqual(fixture.downloaded, [committed]);
    exportFails = true;
    healthy = false;
    evidenceButton(fixture, 'export').click();
    await settle();
    assert.equal(fixture.summaryCalls, 3, 'failed export must refresh the summary as well');
    assert.equal(fixture.exportCalls, 2);
    assert.equal(fixture.downloaded.length, 1, 'failed export must not download');
    assert.match(fixture.panel.content.textContent!, /Export failed:/);
    const error = fixture.panel.content.querySelector('.evidence-journal-message')!.textContent;
    assert.equal(evidenceButton(fixture, 'export').disabled, true);
    evidenceButton(fixture, 'retry').click();
    await settle();
    assert.equal(fixture.summaryCalls, 4, 'a failed retry must perform exactly one summary read');
    assert.equal(evidenceButton(fixture, 'retry').disabled, false, 'failed retry must remain retryable');
    assert.equal(evidenceButton(fixture, 'export').disabled, true);
    assert.equal(fixture.panel.content.querySelector('.evidence-journal-message')!.textContent, error);
    healthy = true;
    exportFails = false;
    evidenceButton(fixture, 'retry').click();
    await settle();
    assert.equal(fixture.summaryCalls, 5);
    assert.equal(evidenceButton(fixture, 'export').disabled, false);
    assert.equal(fixture.panel.content.querySelector('.evidence-journal-message')!.textContent, error,
      'a healthy retry must retain the historical failed-export message until the next export');
    assert.match(fixture.panel.content.textContent!, /2 scored changes saved locally and awaiting sync/);
    assert.match(fixture.panel.content.textContent!, /7 captures refused/);
    evidenceButton(fixture, 'export').click();
    await settle();
    assert.equal(fixture.exportCalls, 3);
    assert.equal(fixture.summaryCalls, 6);
    assert.deepEqual(fixture.downloaded, [committed, committed]);
    assert.match(fixture.panel.content.textContent!, /Exported 1 committed journal entry/);
    assert.match(fixture.panel.content.querySelector('.evidence-journal-message')!.textContent!, /2 pending captures, 7 refused captures and 1 rejected captures/);
    assert.equal(fixture.panel, originalPanel);
  } finally { await fixture.close(); }
});

test('deferred retry bounds click bursts and diagnostics reads and ignores completion after disposal', async () => {
  let requested = 0;
  let resolveRetry!: (value: EvidenceSummary | null) => void;
  const fixture = mount({ summary: () => ++requested === 1
    ? Promise.resolve(null)
    : new Promise(done => { resolveRetry = done; }) });
  try {
    await settle();
    evidenceButton(fixture, 'retry').click();
    assert.equal(fixture.summaryCalls, 2, 'retry must start one read before yielding');
    const retry = evidenceButton(fixture, 'retry');
    const exporting = evidenceButton(fixture, 'export');
    assert.equal(retry.disabled, true, 'retry must be disabled while its summary is pending');
    assert.match(retry.textContent!, /Checking evidence journal/);
    assert.equal(exporting.disabled, true, 'export must be disabled while summary is pending');
    assert.match(fixture.panel.content.querySelector('.evidence-journal-status')!.textContent!, /Checking the evidence journal/);
    const reads = fixture.calibrationReads;
    for (let index = 1; index <= 100; index++) {
      retry.click();
      exporting.click();
      fixture.update({ savedAwaitingSync: index, refused: 4 });
    }
    await fixture.panel.exportEvidence();
    assert.equal(fixture.summaryCalls, 2, 'burst clicks must not overlap or queue summary reads');
    assert.equal(fixture.exportCalls, 0, 'even a direct export entry must be guarded while summary loads');
    assert.equal(fixture.timers.size, 1, '100 notifications must share the existing fixed diagnostics timer');
    assert.deepEqual(fixture.delays, [100], 'capture bursts must keep the fixed 100 ms diagnostics timer');
    const staleDiagnostics = [...fixture.timers.values()][0]!;
    fixture.flush();
    assert.match(fixture.panel.content.textContent!, /100 scored changes saved locally and awaiting sync/);
    assert.equal(fixture.summaryCalls, 2, 'diagnostics must not read a summary during a retry');
    assert.equal(fixture.calibrationReads, reads, 'diagnostics must not recompute calibration during a retry');
    fixture.update({ hashing: 1 });
    assert.equal(fixture.timers.size, 1);
    const html = fixture.panel.content.innerHTML;
    fixture.panel.destroy();
    assert.equal(fixture.listeners.size, 0);
    assert.equal(fixture.timers.size, 0);
    resolveRetry(summary);
    await settle();
    staleDiagnostics();
    fixture.update({ refused: 9 });
    retry.click();
    exporting.click();
    await fixture.panel.exportEvidence();
    await settle();
    assert.equal(fixture.panel.content.innerHTML, html, 'late summary and diagnostic callbacks must not render after disposal');
    assert.equal(fixture.summaryCalls, 2, 'disposed actions must not start another summary');
    assert.equal(fixture.exportCalls, 0);
    assert.deepEqual(fixture.downloaded, []);
    assert.equal(fixture.timers.size, 0);
    assert.equal(fixture.listeners.size, 0);
  } finally { await fixture.close(); }
});
