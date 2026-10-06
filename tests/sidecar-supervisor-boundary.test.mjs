// R4-BUG-004 source gates: the native sidecar supervisor wiring in main.rs.
// The restart *policy* is contract-tested in
// src-tauri/tests/sidecar_supervisor_contract.rs; these gates pin the glue
// that a policy test cannot see (who calls it, under which lock, and which
// processes may ever be signalled).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
const PUB = readFileSync(new URL('../src-tauri/src/sidecar_publication.rs', import.meta.url), 'utf8');

function fnBody(name, source = MAIN) {
  const start = source.search(new RegExp(`\\bfn ${name}\\s*[<(]`));
  assert.ok(start >= 0, `fn ${name} not found`);
  const open = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced body for fn ${name}`);
}

function order(body, first, second, label) {
  const a = body.indexOf(first);
  const b = body.indexOf(second);
  assert.ok(a >= 0, `${label}: missing ${first}`);
  assert.ok(b >= 0, `${label}: missing ${second}`);
  assert.ok(a < b, `${label}: ${first} must come before ${second}`);
}

test('the monitor restarts the sidecar after an unexpected exit', () => {
  const body = fnBody('start_local_api');
  order(body, 'exited unexpectedly', 'supervise_after_exit(&app_handle, code, signal)', 'monitor');
  const loop = fnBody('run_restart_loop');
  assert.match(loop, /match start_local_api\(app\)/);
  assert.match(loop, /shutting_down\.load\(Ordering::SeqCst\)/);
  assert.match(loop, /on_start_failed\(/);
});

test('only this install\'s own orphaned sidecar is ever signalled', () => {
  const kills = [...MAIN.matchAll(/Command::new\("kill"\)/g)].map((m) => m.index);
  const reaper = fnBody('reap_own_orphan_sidecar');
  const reaperStart = MAIN.indexOf(reaper);
  assert.equal(kills.length, 2, 'exactly the TERM and the re-checked KILL');
  for (const index of kills) {
    assert.ok(index > reaperStart && index < reaperStart + reaper.length, 'kill outside the verified reaper');
  }
  order(reaper, 'if !sidecar_supervisor::is_own_sidecar_command(', '"-TERM"', 'TERM guard');
  order(reaper, 'continue;', '"-TERM"', 'foreign listener skipped');
  order(reaper, '"-TERM"', 'if sidecar_supervisor::is_own_sidecar_command(', 'KILL re-check');
  order(reaper, 'if sidecar_supervisor::is_own_sidecar_command(&command_of(pid)', '"-KILL"', 'KILL guard');
  assert.match(reaper, /"-ww", "-o", "args="/, 'full, untruncated command line');
  assert.doesNotMatch(fnBody('start_local_api'), /Command::new\("lsof"\)/, 'no inline unverified reaper');
});

test('shutdown wins every race with a pending restart', () => {
  order(fnBody('stop_local_api'), 'shutting_down.store(true, Ordering::SeqCst)', 'local_api_cell(&state).take_for_shutdown()', 'stop');
  const start = fnBody('start_local_api');
  order(start, '.child\n .lock()', 'shutting_down.load(Ordering::SeqCst)', 'start check under lock');
  order(start, 'shutting_down.load(Ordering::SeqCst)', '.spawn()', 'start check before spawn');
});

test('the renderer is only ever handed a confirmed port', () => {
  order(fnBody('get_local_api_port'), 'port_confirmed.load(Ordering::SeqCst)', 'state.port.lock()', 'port gate');
  assert.match(fnBody('get_local_api_port'), /not yet assigned/, 'keeps the tauri-bridge boot-noise wording');
  const monitor = fnBody('start_local_api');
  // Every publication and revocation goes through the generation-owned cell
  // (contract-tested in sidecar_supervisor_contract.rs).
  assert.match(monitor, /local_api_cell\(&state\)\.install\(&mut slot, child\)/, 'start installs through the cell');
  assert.match(monitor, /local_api_cell\(&state\)\.tick\(generation, /, 'the monitor ticks only its own generation');
  assert.match(monitor, /local_api_cell\(&state\)\.publish_start\(generation, waited, DEFAULT_LOCAL_API_PORT\)/, 'the starter publishes only for its own generation');
  const inject = fnBody('inject_secrets_into_running_sidecar');
  assert.match(inject, /let Some\(port\) = local_api_cell\(&state\)\.confirmed_live_port\(\) else/, 'secrets go only to the live confirmed port');
  assert.doesNotMatch(inject, /DEFAULT_LOCAL_API_PORT/, 'secrets never fall back to the default port');
  assert.doesNotMatch(MAIN, /port_confirmed\.store\(true|generation\.fetch_add|fn confirm_port_late/, 'no publication outside the cell');
  const status = fnBody('local_api_status');
  order(status, 'let port = if port_confirmed', 'state.port.lock()', 'status port gate');
});

test('port publication and revocation take the child lock before the port lock', () => {
  assert.match(MAIN, /^mod sidecar_publication;$/m);
  for (const name of ['publish_start', 'tick', 'take_for_shutdown', 'confirmed_live_port']) {
    const body = fnBody(name, PUB);
    const child = body.indexOf('self.child.lock()');
    const port = ['self.port.lock()', 'self.revoke()'].map((text) => body.indexOf(text)).filter((at) => at >= 0);
    assert.ok(child >= 0, `${name}: takes the child lock`);
    assert.ok(port.length > 0 && child < Math.min(...port), `${name}: child lock before the port`);
  }
  assert.doesNotMatch(PUB, /drop\(slot\)/, 'the child lock is held through every port update');
  assert.doesNotMatch(fnBody('revoke', PUB) + fnBody('owns_live', PUB), /self\.child/, 'callers already hold the child lock');
});

test('status and manual restart are trusted-window only and cannot kill a running sidecar', () => {
  for (const name of ['get_local_api_status', 'restart_local_api']) {
    const body = fnBody(name);
    assert.match(body.split('\n').slice(0, 3).join('\n'), /require_trusted_window\(webview\.label\(\)\)\?/, name);
    assert.match(MAIN, new RegExp(`generate_handler!\\[[\\s\\S]*\\b${name},`), `${name} registered`);
  }
  const restart = fnBody('restart_local_api');
  assert.match(restart, /on_manual_retry\(/);
  assert.doesNotMatch(restart, /\.kill\(|stop_local_api/);
  assert.match(MAIN, /^mod sidecar_supervisor;$/m);
});
