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
      exportJsonl: () => options.jsonl?.() ?? Promise.resolve('{"header":true}\n{"entry":true}\n'),
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
