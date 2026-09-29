// R4-BUG-004 source gates: the native sidecar supervisor wiring in main.rs.
// The restart *policy* is contract-tested in
// src-tauri/tests/sidecar_supervisor_contract.rs; these gates pin the glue
// that a policy test cannot see (who calls it, under which lock, and which
// processes may ever be signalled).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MAIN = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');

function fnBody(name) {
  const start = MAIN.search(new RegExp(`\\bfn ${name}\\s*[<(]`));
  assert.ok(start >= 0, `fn ${name} not found`);
  const open = MAIN.indexOf('{', MAIN.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < MAIN.length; i += 1) {
    if (MAIN[i] === '{') depth += 1;
    else if (MAIN[i] === '}') {
      depth -= 1;
      if (depth === 0) return MAIN.slice(open, i + 1);
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
  order(fnBody('stop_local_api'), 'shutting_down.store(true, Ordering::SeqCst)', 'slot.take()', 'stop');
  const start = fnBody('start_local_api');
  order(start, '.child\n .lock()', 'shutting_down.load(Ordering::SeqCst)', 'start check under lock');
  order(start, 'shutting_down.load(Ordering::SeqCst)', '.spawn()', 'start check before spawn');
});

test('the renderer is only ever handed a confirmed port', () => {
  order(fnBody('get_local_api_port'), 'port_confirmed.load(Ordering::SeqCst)', 'state.port.lock()', 'port gate');
  assert.match(fnBody('get_local_api_port'), /not yet assigned/, 'keeps the tauri-bridge boot-noise wording');
  const monitor = fnBody('start_local_api');
  order(monitor, 'Ok(Some(status)) => {\n *slot = None;', 'state.port_confirmed.store(false, Ordering::SeqCst);\n if let Ok(mut port) = state.port.lock()', 'exit revokes the port');
  const status = fnBody('local_api_status');
  order(status, 'let port = if port_confirmed', 'state.port.lock()', 'status port gate');
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
