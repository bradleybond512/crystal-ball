import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const lifecycle = new URL('../.github/tools/filesystem-mcp/child-lifecycle.mjs', import.meta.url).href;

function runFixture(t, code, args = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cb-mcp-lifecycle-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entry = path.join(dir, 'fixture.mjs'); writeFileSync(entry, code);
  const child = spawn(process.execPath, [entry, ...args], { stdio: ['pipe', 'pipe', 'pipe'], detached: false, env: { TMPDIR: dir, LANG: 'C' } });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  return child;
}
function ended(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('owned lifecycle fixture timeout')); }, 5000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

test('real child protocol streams, EOF and nonzero exit survive the lifecycle bridge', async (t) => {
  const child = runFixture(t, `import {runChild} from ${JSON.stringify(lifecycle)};
const result=await runChild({command:process.execPath,args:['-e',"process.stdin.pipe(process.stdout);process.stdin.on('end',()=>{process.stderr.write('diagnostic');process.exitCode=7})"],options:{shell:false,detached:false,stdio:'inherit',env:{}}});process.exitCode=result.code;`);
  let stdout = '', stderr = ''; child.stdout.on('data', (b) => { stdout += b; }); child.stderr.on('data', (b) => { stderr += b; });
  const done = ended(child); child.stdin.end('synthetic protocol\n');
  assert.deepEqual(await done, { code: 7, signal: null });
  assert.equal(stdout, 'synthetic protocol\n'); assert.equal(stderr, 'diagnostic');
});

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  test(`real ${signal} forwarding reaps the owned child without a detached daemon`, async (t) => {
    const program = "process.stdout.write('READY\\n');setInterval(()=>{},1000)";
    const child = runFixture(t, `import {runChild} from ${JSON.stringify(lifecycle)};
const result=await runChild({command:process.execPath,args:['-e',${JSON.stringify(program)}],options:{shell:false,detached:false,stdio:'inherit',env:{}}});process.stdout.write('REAPED:'+result.signal+'\\n');`);
    let stdout = '', stderr = ''; const done = ended(child);
    child.stderr.on('data', (b) => { stderr += b; });
    child.stdout.on('data', (b) => { stdout += b; if (stdout === 'READY\n') child.kill(signal); });
    const result = await done;
    t.diagnostic(JSON.stringify({ signal, stderr, result, stdout }));
    assert.equal(stderr, '', 'owned fixture stderr');
    assert.deepEqual(result, { code: 0, signal: null });
    assert.equal(stdout, `READY\nREAPED:${signal}\n`);
  });
}
