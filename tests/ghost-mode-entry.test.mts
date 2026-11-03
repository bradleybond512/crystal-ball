import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

type Scenario = { denies: boolean; noNotice?: boolean; brokenMain?: boolean; startup?: Promise<void> };
let sequence = 0;
let fixture: { events: string[]; requested: string[]; scenario: Scenario };
registerHooks({
  resolve(specifier, context, next) {
    if (!context.parentURL?.includes('/src/entry.ts')) return next(specifier, context);
    fixture.requested.push(specifier);
    if (specifier === './services/mode-manager') {
      return next(`./services/mode-manager.ts?boot=${sequence}`, context);
    }
    let module;
    if (specifier === './main') {
      module = "f.events.push('main'); if(f.scenario.brokenMain) throw Error('main failed'); export const appStartup=f.scenario.startup;";
    } else if (specifier === './bootstrap/ghost-mode-notice') {
      module = "if(f.scenario.noNotice) throw Error('notice failed'); export function mountGhostBootNotice(){f.events.push('notice'); return {showStartupFailure(){f.events.push('failure');}}}";
    } else if (specifier === './bootstrap/ghost-mode-notice.css') {
      module = '';
    } else return next(specifier, context);
    return { url: `data:text/javascript,${encodeURIComponent('const f=globalThis.__ghostBootTest;' + module)}#${sequence}`, shortCircuit: true };
  },
});

function start(scenario: Scenario) {
  fixture = { events: [], requested: [], scenario };
  Object.assign(globalThis, { __ghostBootTest: fixture, window: new EventTarget(), localStorage: {
    getItem(key: string) {
      fixture.events.push(key);
      if (scenario.denies) throw new Error('storage disabled');
      return null;
    },
  } });
  return import(`../src/entry.ts?boot=${++sequence}`);
}

test('healthy entry reads only mode then starts main without loading an early notice', async () => {
  await start({ denies: false, noNotice: true });
  assert.deepEqual(fixture.events, ['wm-app-mode', 'main']);
  assert.deepEqual(fixture.requested, ['./services/mode-manager', './main']);
});

test('unavailable storage mounts choices before main and propagates the original module error', async () => {
  await assert.rejects(start({ denies: true, brokenMain: true }), /main failed/);
  assert.deepEqual(fixture.events, ['wm-app-mode', 'notice', 'main', 'failure']);
  assert.ok(fixture.requested.includes('./bootstrap/ghost-mode-notice.css'));
});

test('unavailable storage keeps choices informed if application initialization later fails', async () => {
  let fail!: (reason: Error) => void;
  const startup = new Promise<void>((_, reject) => { fail = reject; });
  await start({ denies: true, startup });
  assert.deepEqual(fixture.events, ['wm-app-mode', 'notice', 'main']);
  fail(new Error('init failed'));
  await Promise.resolve();
  assert.deepEqual(fixture.events, ['wm-app-mode', 'notice', 'main', 'failure']);
});

test('an unavailable notice chunk cannot prevent loading main', async (t) => {
  const prior = globalThis.reportError;
  const report = t.mock.fn();
  globalThis.reportError = report;
  t.after(() => { globalThis.reportError = prior; });
  await start({ denies: true, noNotice: true });
  assert.equal(report.mock.callCount(), 1);
  assert.deepEqual(fixture.events, ['wm-app-mode', 'main']);
});
