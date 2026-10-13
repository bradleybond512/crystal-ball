// Real SmsSettingsPanel + Panel render/debounce integration. No setup-dom,
// private-method calls, validator copy, Panel stub or async-error suppression.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Window } from 'happy-dom';

type Entry = { phoneNumber: string; name: string; tier: 'readonly' | 'admin' };
type Config = { enabled: boolean; allowlist: Entry[] };
type Captured = { body: string; patch: unknown; status?: number; transportCompleted?: boolean; transportRejected?: boolean; nativeStatus?: number };
type SaveFault = 'before-send' | 'body-json' | 'after-persistence' | 'body-null';
const entries = (count = 27): Entry[] => Array.from({ length: count }, (_, i) => ({
  phoneNumber: `+1555600${String(i).padStart(4, '0')}`, name: `Synthetic ${i}`, tier: 'readonly',
}));
let faultFixtureFinished: Promise<void> = Promise.resolve();
let activeFaultTestName: string | null = null;
const nativeFetch = globalThis.fetch;
const happyWindow = new Window({ url: 'http://127.0.0.1/' });
const savedGlobals = new Map<string, PropertyDescriptor | undefined>();
function installGlobal(key: string, value: unknown): void {
  savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDivElement', 'HTMLButtonElement', 'HTMLInputElement',
  'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'localStorage', 'sessionStorage', 'location', 'navigator']) {
  installGlobal(key, key === 'window' ? happyWindow : Reflect.get(happyWindow, key));
}
installGlobal('requestAnimationFrame', happyWindow.requestAnimationFrame.bind(happyWindow));
installGlobal('cancelAnimationFrame', happyWindow.cancelAnimationFrame.bind(happyWindow));
installGlobal('getComputedStyle', happyWindow.getComputedStyle.bind(happyWindow));
installGlobal('__viteImportMetaEnv', { DEV: false, PROD: false, MODE: 'test', BASE_URL: '/', VITE_VARIANT: 'full' });
const { SmsSettingsPanel } = await import('../../src/components/SmsSettingsPanel');
const { Panel } = await import('../../src/components/Panel');
after(async () => {
  // Native tests may finish on an unhandled rejection before their callback.
  // Keep the DOM/global resources owned until every serialized fixture tears down.
  await faultFixtureFinished;
  globalThis.fetch = nativeFetch;
  await happyWindow.happyDOM.close();
  for (const [key, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const serverWorker = String.raw`
const workerData=JSON.parse(process.env.Q20_OWNED_PANEL_FIXTURE);
const parentPort={postMessage:value=>process.send(value),once:(_,callback)=>process.once('message',callback)};
const fs=require('node:fs'),path=require('node:path');
(async()=>{
  const home=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'sms-panel-owned-'));
  process.env.HOME=home;delete process.env.TWILIO_AUTH_TOKEN;
  const dir=path.join(home,'.config','crystalball');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'sms-config.json'),JSON.stringify({enabled:workerData.seed.enabled}));
  fs.writeFileSync(path.join(dir,'sms-allowlist.json'),JSON.stringify(workerData.seed.allowlist));
  const server=await import(workerData.module);
  const app=await server.createLocalApiServer({port:0,dataDir:home,logger:{log(){},warn(){},error(){}}});
  try {
    const {port}=await app.start();parentPort.postMessage({base:'http://127.0.0.1:'+port,dir});
    await new Promise(resolve=>parentPort.once('message',resolve));
  } finally {await app.close();fs.rmSync(home,{recursive:true,force:true});process.disconnect();}
})().catch(error=>{process.send({error:error.stack},()=>process.disconnect());process.exitCode=1;});
`;
const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(predicate: () => boolean, timeout = 1800): Promise<boolean> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (predicate()) return true;
    await pause(20);
  }
  return predicate();
}
async function fixture(seed: Config, run: (context: {
  root: HTMLElement; posts: Captured[]; current: () => Promise<Config>; disk: () => Config;
  checkbox: () => HTMLInputElement; remove: () => void; add: () => void; nextPost: (count: number, action: string) => Promise<void>;
  nextAttempt: (count: number, action: string) => Promise<void>;
}) => Promise<void>, injectedPresentationError?: string, saveFaults: Readonly<Record<number, SaveFault>> = {}): Promise<void> {
  // A separate Node process gives os.homedir() a separate native environment;
  // worker-thread process.env writes do not change libuv's native HOME lookup.
  const fixtureToken = 'fixture-only-sidecar-token';
  const worker = spawn(process.execPath, ['--input-type=commonjs', '-e', serverWorker], {
    env: { ...process.env, LOCAL_API_TOKEN: fixtureToken, Q20_OWNED_PANEL_FIXTURE: JSON.stringify({
      seed, module: new URL('../../src-tauri/sidecar/local-api-server.mjs', import.meta.url).href,
    }) }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  let panel: InstanceType<typeof SmsSettingsPanel> | undefined;
  const pending = new Set<Promise<Response>>();
  try {
    const server = await new Promise<{ base: string; dir: string }>((resolve, reject) => {
      worker.once('error', reject);
      worker.once('message', result => result.error ? reject(new Error(result.error)) : resolve(result));
      worker.once('exit', code => { if (code !== 0) reject(new Error(`owned panel server exited ${code}`)); });
    });
    const auth = { authorization: `Bearer ${fixtureToken}` };
    const posts: Captured[] = [];
    globalThis.fetch = (input, init) => {
      assert.equal(typeof input, 'string', 'panel uses relative SMS path');
      assert.ok(input === '/api/sms/config' || input === '/api/sms/status', `unexpected panel transport ${String(input)}`);
      const route = input as string;
      const method = init?.method ?? 'GET';
      assert.ok(method === 'GET' || (route === '/api/sms/config' && method === 'POST'), 'exact SMS config/status methods');
      let captured: Captured | undefined;
      if (method === 'POST') {
        assert.equal(typeof init?.body, 'string', 'captured actual JSON POST bytes');
        captured = { body: init.body as string, patch: JSON.parse(init.body as string) as unknown };
        posts.push(captured);
      }
      const fault = captured ? saveFaults[posts.length] : undefined;
      const request = (async () => {
        // This explicit fault happens before native fetch, so no server write is possible.
        if (fault === 'before-send') throw new Error('synthetic transport detail must not reach UI');
        // Only this explicit presentation test injects a response; admission
        // tests below always delegate to the real server via native fetch.
        const response = injectedPresentationError && captured
          ? new Response(JSON.stringify({ error: injectedPresentationError }), { status: 400, headers: { 'content-type': 'application/json' } })
          : await nativeFetch(`${server.base}${route}`, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), ...auth } });
        if (captured) captured.nativeStatus = response.status;
        if (fault === 'after-persistence' || fault === 'body-json' || fault === 'body-null') {
          assert.equal(response.status, 200, 'ambiguous fault follows actual successful owned API persistence');
          if (fault === 'after-persistence') {
            await response.json();
            throw new Error('synthetic lost response detail must not reach UI');
          }
          // Keep the actual successful native response; fail only its body-read boundary.
          Object.defineProperty(response, 'json', { value: async () => {
            if (fault === 'body-null') return null;
            throw new Error('synthetic response body detail must not reach UI');
          } });
        }
        if (captured) captured.status = response.status;
        return response;
      })();
      pending.add(request);
      // Bookkeeping handles both outcomes without creating a rejected finally clone.
      // The panel's own rejected saveConfig/.then chain is deliberately untouched.
      void request.then(() => {
        pending.delete(request);
        if (captured) captured.transportCompleted = true;
      }, () => {
        pending.delete(request);
        if (captured) { captured.transportCompleted = true; captured.transportRejected = true; }
      });
      return request;
    };
    const current = async (): Promise<Config> => {
      const response = await nativeFetch(`${server.base}/api/sms/config`, { headers: auth });
      assert.equal(response.status, 200, 'real authoritative GET');
      return await response.json() as Config;
    };
    const disk = (): Config => ({
      enabled: (JSON.parse(readFileSync(path.join(server.dir, 'sms-config.json'), 'utf8')) as { enabled: boolean }).enabled,
      allowlist: JSON.parse(readFileSync(path.join(server.dir, 'sms-allowlist.json'), 'utf8')) as Entry[],
    });
    assert.deepEqual(await current(), seed, 'pre-import seeded real API');
    assert.deepEqual(disk(), seed, 'seeded disk tuples and count');
    panel = new SmsSettingsPanel();
    assert.ok(panel instanceof Panel, 'actual inherited Panel class');
    const root = panel.getElement();
    document.body.append(root);
    assert.equal(await waitUntil(() => root.querySelector('#sms-enabled') !== null), true, 'real debounced first render');
    assertDomState(root, seed, 'all seeded recipients visible');
    const checkbox = (): HTMLInputElement => {
      const input = root.querySelector<HTMLInputElement>('#sms-enabled'); assert.ok(input); return input;
    };
    const remove = (): void => {
      const button = root.querySelector<HTMLButtonElement>('.sms-remove-btn'); assert.ok(button); button.click();
    };
    const add = (): void => {
      const number = root.querySelector<HTMLInputElement>('#sms-add-num'); assert.ok(number); number.value = '+15559998888';
      const name = root.querySelector<HTMLInputElement>('#sms-add-name'); assert.ok(name); name.value = 'Added synthetic';
      const button = root.querySelector<HTMLButtonElement>('#sms-add-btn'); assert.ok(button); button.click();
    };
    const nextPost = async (count: number, action: string): Promise<void> => {
      await waitUntil(() => posts.length >= count && posts[count - 1]?.status !== undefined, 900);
      assert.equal(posts.length, count, `${action}: real first-render DOM listener must send exactly one POST after bounded wait`);
      assert.ok(posts[count - 1]?.status !== undefined, `${action}: owned server POST completed`);
      await pause(250); // real 150ms setContent debounce, then reacquire elements
    };
    const nextAttempt = async (count: number, action: string): Promise<void> => {
      await waitUntil(() => posts.length >= count && posts[count - 1]?.transportCompleted === true, 900);
      assert.equal(posts.length, count, `${action}: real DOM event must attempt exactly one save`);
      assert.equal(posts[count - 1]?.transportCompleted, true, `${action}: attempted transport completed independently of HTTP status`);
      await pause(250); // actual Panel debounce; do not call private render/wiring methods
    };
    try {
      await run({ root, posts, current, disk, checkbox, remove, add, nextPost, nextAttempt });
    } catch (error) {
      // Capture the actual native assertion before any cleanup error can mask it.
      if (activeFaultTestName && error instanceof assert.AssertionError) {
        console.log('F1_NATIVE_ASSERTION', JSON.stringify({ test: activeFaultTestName, code: error.code, name: error.name,
          message: error.message, actual: error.actual, expected: error.expected, operator: error.operator, stack: error.stack }));
      }
      throw error;
    }
  } finally {
    panel?.destroy();
    await Promise.allSettled(pending);
    globalThis.fetch = nativeFetch;
    document.body.replaceChildren();
    if (worker.connected) worker.send('close');
    await Promise.race([new Promise<void>(resolve => worker.once('exit', () => resolve())), pause(1000)]);
    if (worker.exitCode === null) {
      worker.kill('SIGTERM');
      await new Promise<void>(resolve => worker.once('exit', () => resolve()));
    }
  }
}
function assertState(actual: Config, expected: Config, label: string): void {
  assert.deepEqual(actual, expected, `${label}: exact enabled and tuple multiset`);
  assert.equal(actual.allowlist.length, expected.allowlist.length, `${label}: exact recipient count`);
}

function assertDomState(root: HTMLElement, expected: Config, label: string): void {
  const tuples = Array.from(root.querySelectorAll('.sms-remove-btn'), button => {
    const row = button.closest('tr'); assert.ok(row, 'recipient row');
    const cells = row.querySelectorAll('td');
    return { phoneNumber: cells[0]?.textContent?.trim(), name: cells[1]?.querySelector('em') ? '' : cells[1]?.textContent?.trim(), tier: cells[2]?.textContent?.trim() };
  });
  assert.deepEqual(tuples, expected.allowlist, `${label}: exact rendered phone/name/tier tuples`);
  assert.equal(tuples.length, expected.allowlist.length, `${label}: rendered count`);
}

test('DOM first-render Disable sends enabled-only patch, retains27, then real Remove sends list-only26→25', async () => {
  const seed: Config = { enabled: true, allowlist: entries() };
  await fixture(seed, async ({ checkbox, nextPost, posts, current, disk, root, remove }) => {
    const input = checkbox(); input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true }));
    await nextPost(1, 'Disable');
    assert.deepEqual(posts[0]?.patch, { enabled: false }, 'actual Disable POST has only enabled');
    assert.equal(posts[0]?.status, 200, 'real API accepts partial Disable');
    assertState(await current(), { ...seed, enabled: false }, 'Disable GET');
    assertState(disk(), { ...seed, enabled: false }, 'Disable disk');
    assert.equal(checkbox().checked, false, 'authoritative disabled checkbox'); assertDomState(root, { ...seed, enabled: false }, 'Disable rows');
    for (let count = 2; count <= 3; count++) {
      remove(); await nextPost(count, 'Remove');
      const expected = { enabled: false, allowlist: seed.allowlist.slice(count - 1) };
      assert.deepEqual(posts[count - 1]?.patch, { allowlist: expected.allowlist }, 'actual Remove POST list-only');
      assert.equal(posts[count - 1]?.status, 200, 'real strict reduction accepted');
      assertState(await current(), expected, 'Remove GET'); assertState(disk(), expected, 'Remove disk');
      assertDomState(root, expected, 'rendered exact reduction');
    }
  });
});
test('DOM first-render enabled27 Remove preserves enabled authority and exact26 tuples', async () => {
  const seed: Config = { enabled: true, allowlist: entries() };
  await fixture(seed, async ({ remove, nextPost, posts, current, disk, checkbox, root }) => {
    remove(); await nextPost(1, 'enabled Remove');
    const expected = { enabled: true, allowlist: seed.allowlist.slice(1) };
    assert.deepEqual(posts[0]?.patch, { allowlist: expected.allowlist }); assert.equal(posts[0]?.status, 200);
    assertState(await current(), expected, 'enabled cleanup GET'); assertState(disk(), expected, 'enabled cleanup disk');
    assert.equal(checkbox().checked, true, 'cleanup preserves enabled'); assertDomState(root, expected, 'enabled cleanup rows');
  });
});
test('DOM rejected enable on disabled27 restores unchecked checkbox on repeated identical refusal/cache hit', async () => {
  const seed: Config = { enabled: false, allowlist: entries() };
  await fixture(seed, async ({ checkbox, nextPost, posts, current, disk, root }) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const input = checkbox(); input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true }));
      await nextPost(attempt, 'refused Enable');
      assert.deepEqual(posts[attempt - 1]?.patch, { enabled: true }, 'enable-only POST');
      assert.equal(posts[attempt - 1]?.status, 400, 'real server rejects enable over25');
      assertState(await current(), seed, 'refused Enable GET'); assertState(disk(), seed, 'refused Enable disk');
      assert.equal(checkbox().checked, false, `rejection ${attempt} restores checkbox despite identical HTML cache`);
      assert.ok(root.querySelector('.sms-save-error')?.textContent?.length, 'visible real refusal reason');
      assertDomState(root, seed, 'refusal retains all27 rows');
    }
  });
});
test('DOM Add at27 is refused with real authority and no tuple loss', async () => {
  const seed: Config = { enabled: false, allowlist: entries() };
  await fixture(seed, async ({ add, nextPost, posts, current, disk, root }) => {
    add(); await nextPost(1, 'refused Add');
    assert.deepEqual(posts[0]?.patch, { allowlist: [...seed.allowlist, { phoneNumber: '+15559998888', name: 'Added synthetic', tier: 'readonly' }] });
    assert.equal(posts[0]?.status, 400); assertState(await current(), seed, 'Add refusal GET'); assertState(disk(), seed, 'Add refusal disk');
    assertDomState(root, seed, 'Add refusal rows'); assert.ok(root.querySelector('.sms-save-error'));
  });
});
test('DOM Add at24 is allowed, authoritative25 response and exact list-only request', async () => {
  const seed: Config = { enabled: false, allowlist: entries(24) };
  await fixture(seed, async ({ add, nextPost, posts, current, disk, root }) => {
    add(); await nextPost(1, 'allowed Add');
    const expected = { enabled: false, allowlist: [...seed.allowlist, { phoneNumber: '+15559998888', name: 'Added synthetic', tier: 'readonly' as const }] };
    assert.deepEqual(posts[0]?.patch, { allowlist: expected.allowlist }); assert.equal(posts[0]?.status, 200);
    assertState(await current(), expected, 'Add GET'); assertState(disk(), expected, 'Add disk');
    assertDomState(root, expected, 'Add success rows'); assert.equal(root.querySelector('.sms-save-error'), null);
  });
});
test('presentation-only injected hostile response renders escaped refusal text; real disk stays unchanged', async () => {
  const hostile = '<img data-injected-refusal="yes" src="inert" onerror="bad()"> & <script>bad()</script>';
  const seed: Config = { enabled: false, allowlist: entries(1) };
  await fixture(seed, async ({ add, nextPost, current, disk, root }) => {
    add(); await nextPost(1, 'presentation-only Add');
    assert.equal(root.querySelector('.sms-save-error')?.textContent, hostile, 'plain refusal text preserved');
    assert.equal(root.querySelector('[data-injected-refusal]'), null, 'hostile markup absent');
    assert.equal(root.querySelector('.sms-save-error script'), null, 'hostile script absent');
    assertState(await current(), seed, 'presentation-only GET'); assertState(disk(), seed, 'presentation-only disk'); assertDomState(root, seed, 'presentation-only retained rows');
  }, hostile);
});


// Register every fault test synchronously. Each callback owns an independent
// teardown latch, so node:test ending a failed test cannot overlap DOM/fetch
// ownership. The module after hook also awaits the final latch. No process or
// window rejection listener is installed; the panel chain stays untouched.
function ownedFailureTest(name: string, run: () => Promise<void>): void {
  const previousFixture = faultFixtureFinished;
  let complete!: () => void;
  faultFixtureFinished = new Promise<void>(resolve => { complete = resolve; });
  void test(name, async () => {
    await previousFixture;
    activeFaultTestName = name;
    try {
      await run();
    } finally {
      activeFaultTestName = null;
      complete();
    }
  });
}
function assertUnconfirmed(root: HTMLElement, label: string): string {
  const reason = root.querySelector('.sms-save-error')?.textContent ?? '';
  assert.match(reason, /save.*could not be confirmed/i, `${label}: visible generic unconfirmed-save error`);
  assert.doesNotMatch(reason, /synthetic|transport detail|response body detail|lost response detail/i, `${label}: raw exception detail absent`);
  assert.doesNotMatch(reason, /refused|rejected|unchanged|not saved/i, `${label}: unconfirmed is not proof of refusal or no write`);
  return reason;
}

for (const enabled of [true, false]) {
  const action = enabled ? 'Disable' : 'Enable';
  ownedFailureTest(`F1 before-send ${action} rejection restores known checkbox twice and confirmed retry clears error`, async () => {
    const seed: Config = { enabled, allowlist: entries(2) };
    await fixture(seed, async ({ root, checkbox, nextAttempt, nextPost, posts, current, disk }) => {
      let firstReason: string | undefined;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const input = checkbox(); input.checked = !enabled; input.dispatchEvent(new Event('change', { bubbles: true }));
        await nextAttempt(attempt, `${action} before-send`);
        assert.equal(posts[attempt - 1]?.transportRejected, true, 'attempt was rejected before native fetch');
        assert.equal(posts[attempt - 1]?.nativeStatus, undefined, 'before-send fault never reached owned HTTP server');
        assert.deepEqual(posts[attempt - 1]?.patch, { enabled: !enabled }, 'attempted real checkbox event posts only enabled');
        assertState(await current(), seed, 'before-send authoritative GET unchanged');
        assertState(disk(), seed, 'before-send disk unchanged');
        assert.equal(checkbox().checked, enabled, `${action} rejection ${attempt} restores last-known checkbox`);
        const reason = assertUnconfirmed(root, `${action} rejection ${attempt}`);
        if (firstReason === undefined) firstReason = reason;
        else assert.equal(reason, firstReason, 'identical generic rejection still restores live checkbox despite Panel cache');
        assertDomState(root, seed, 'before-send last-known rows');
      }
      const retry = checkbox(); retry.checked = !enabled; retry.dispatchEvent(new Event('change', { bubbles: true }));
      await nextPost(3, 'confirmed checkbox retry');
      const expected = { ...seed, enabled: !enabled };
      assertState(await current(), expected, 'retry real GET'); assertState(disk(), expected, 'retry disk');
      assert.equal(checkbox().checked, !enabled, 'confirmed retry adopts server enabled authority');
      assertDomState(root, expected, 'confirmed retry rows');
      assert.equal(root.querySelector('.sms-save-error'), null, 'successful parsed retry clears generic error');
    }, undefined, { 1: 'before-send', 2: 'before-send' });
  });
}
for (const action of ['Add', 'Remove'] as const) {
  ownedFailureTest(`F1 before-send ${action} rejection retains exact tuples and confirmed retry clears error`, async () => {
    const seed: Config = { enabled: true, allowlist: entries(2) };
    await fixture(seed, async ({ root, add, remove, nextAttempt, nextPost, posts, current, disk }) => {
      const edit = action === 'Add' ? add : remove;
      const expected: Config = { enabled: true, allowlist: action === 'Add'
        ? [...seed.allowlist, { phoneNumber: '+15559998888', name: 'Added synthetic', tier: 'readonly' }]
        : seed.allowlist.slice(1) };
      edit(); await nextAttempt(1, `${action} before-send`);
      assert.equal(posts[0]?.transportRejected, true, 'list save attempt rejected before native fetch');
      assert.equal(posts[0]?.nativeStatus, undefined, 'list before-send fault has no server status');
      assert.deepEqual(posts[0]?.patch, { allowlist: expected.allowlist }, 'real list event keeps partial allowlist patch');
      assertState(await current(), seed, 'list before-send GET unchanged'); assertState(disk(), seed, 'list before-send disk unchanged');
      assertDomState(root, seed, 'list before-send last-known tuples'); assertUnconfirmed(root, `${action} before-send`);
      edit(); await nextPost(2, `${action} confirmed retry`);
      assertState(await current(), expected, 'list retry real GET'); assertState(disk(), expected, 'list retry disk');
      assertDomState(root, expected, 'list retry rendered tuples');
      assert.equal(root.querySelector('.sms-save-error'), null, 'confirmed list retry clears error');
    }, undefined, { 1: 'before-send' });
  });
}
ownedFailureTest('F1 successful response body JSON rejection retains known rows and reports ambiguous persisted save', async () => {
  const seed: Config = { enabled: true, allowlist: entries(3) };
  await fixture(seed, async ({ root, remove, checkbox, nextAttempt, nextPost, posts, current, disk }) => {
    remove(); await nextAttempt(1, 'successful response JSON rejection');
    const persisted = { enabled: true, allowlist: seed.allowlist.slice(1) };
    assert.equal(posts[0]?.nativeStatus, 200, 'body fault follows genuine successful HTTP response');
    assertState(await current(), persisted, 'body-read failure real server actually persisted');
    assertState(disk(), persisted, 'body-read failure disk actually persisted');
    assertDomState(root, seed, 'body-read failure keeps last-confirmed UI rows');
    assertUnconfirmed(root, 'body-read failure');
    const retry = checkbox(); retry.checked = false; retry.dispatchEvent(new Event('change', { bubbles: true }));
    await nextPost(2, 'confirmed retry after JSON rejection');
    const expected = { ...persisted, enabled: false };
    assertState(await current(), expected, 'JSON retry GET'); assertState(disk(), expected, 'JSON retry disk');
    assertDomState(root, expected, 'JSON retry adopts actual server rows rather than requested stale patch');
    assert.equal(root.querySelector('.sms-save-error'), null, 'only confirmed parsed retry clears body error');
  }, undefined, { 1: 'body-json' });
});
ownedFailureTest('F1 post-persistence response loss restores known checkbox and reports unconfirmed rather than refused', async () => {
  const seed: Config = { enabled: true, allowlist: entries(2) };
  await fixture(seed, async ({ root, checkbox, nextAttempt, nextPost, posts, current, disk }) => {
    const input = checkbox(); input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true }));
    await nextAttempt(1, 'post-persistence response loss');
    const persisted = { ...seed, enabled: false };
    assert.equal(posts[0]?.nativeStatus, 200, 'response loss follows actual admitted owned POST');
    assert.equal(posts[0]?.transportRejected, true, 'client receives rejected transport after persistence');
    assertState(await current(), persisted, 'lost response server actually changed'); assertState(disk(), persisted, 'lost response disk actually changed');
    assert.equal(checkbox().checked, true, 'lost response restores last-known checkbox without claiming server refusal');
    assertDomState(root, seed, 'lost response keeps known tuple rows'); assertUnconfirmed(root, 'lost response');
    const retry = checkbox(); retry.checked = false; retry.dispatchEvent(new Event('change', { bubbles: true }));
    await nextPost(2, 'confirmed retry after lost response');
    assertState(await current(), persisted, 'lost response retry GET'); assertState(disk(), persisted, 'lost response retry disk');
    assert.equal(checkbox().checked, false, 'retry confirms actual disabled authority');
    assert.equal(root.querySelector('.sms-save-error'), null, 'confirmed retry clears lost-response error');
  }, undefined, { 1: 'after-persistence' });
});
ownedFailureTest('F1 prior HTTP refusal becomes generic unconfirmed error after successful response body rejection', async () => {
  const seed: Config = { enabled: true, allowlist: entries() };
  await fixture(seed, async ({ root, add, remove, checkbox, nextAttempt, nextPost, posts, current, disk }) => {
    add(); await nextPost(1, 'real initial HTTP refusal');
    assert.equal(posts[0]?.status, 400, 'prior error comes from actual sidecar refusal');
    const previousError = root.querySelector('.sms-save-error')?.textContent;
    assert.ok(previousError, 'real HTTP refusal has visible error before body fault');
    remove(); await nextAttempt(2, 'body fault after prior refusal');
    const persisted = { enabled: true, allowlist: seed.allowlist.slice(1) };
    assertState(await current(), persisted, 'second ambiguous save actually persisted26');
    assertState(disk(), persisted, 'second ambiguous disk actually persisted26');
    assertDomState(root, seed, 'prior-refusal body fault keeps known27 rows');
    const reason = assertUnconfirmed(root, 'body fault after prior refusal');
    assert.notEqual(reason, previousError, 'ambiguous new attempt cannot present the old HTTP refusal as its outcome');
    const retry = checkbox(); retry.checked = false; retry.dispatchEvent(new Event('change', { bubbles: true }));
    await nextPost(3, 'confirmed retry clears previous and unconfirmed error');
    const expected = { ...persisted, enabled: false };
    assertState(await current(), expected, 'prior-error retry GET'); assertState(disk(), expected, 'prior-error retry disk');
    assertDomState(root, expected, 'prior-error retry adopts confirmed26 rows');
    assert.equal(root.querySelector('.sms-save-error'), null, 'error cleared only after confirmed parsed retry');
  }, undefined, { 2: 'body-json' });
});

ownedFailureTest('F1 successful response body null retains known rows and reports unconfirmed persisted save', async () => {
  const seed: Config = { enabled: true, allowlist: entries(3) };
  await fixture(seed, async ({ root, remove, checkbox, nextAttempt, nextPost, posts, current, disk }) => {
    remove(); await nextAttempt(1, 'successful response body null');
    const persisted = { enabled: true, allowlist: seed.allowlist.slice(1) };
    assert.equal(posts[0]?.nativeStatus, 200, 'null body follows genuine native HTTP success');
    assert.equal(posts[0]?.status, 200, 'client receives successful HTTP response before null decoded body');
    assertState(await current(), persisted, 'null body real server actually persisted');
    assertState(disk(), persisted, 'null body disk actually persisted');
    assertDomState(root, seed, 'null body keeps last-confirmed UI tuple rows');
    assert.equal(checkbox().checked, true, 'null body retains last-confirmed enabled authority');
    assertUnconfirmed(root, 'null successful response body');
    const retry = checkbox(); retry.checked = false; retry.dispatchEvent(new Event('change', { bubbles: true }));
    await nextPost(2, 'confirmed retry after null body');
    const expected = { ...persisted, enabled: false };
    assertState(await current(), expected, 'null body retry GET'); assertState(disk(), expected, 'null body retry disk');
    assertDomState(root, expected, 'null body retry adopts confirmed real server tuples');
    assert.equal(checkbox().checked, false, 'null body retry confirms disabled state');
    assert.equal(root.querySelector('.sms-save-error'), null, 'successful parsed retry clears null-body generic error');
  }, undefined, { 1: 'body-null' });
});
