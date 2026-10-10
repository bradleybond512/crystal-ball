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
const SYNC = readFileSync(new URL('../src-tauri/src/secret_sync.rs', import.meta.url), 'utf8');

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
  // Trace every caller edge: loaded snapshots select keys, and the actual
  // controller resolves the live target again inside each retry. These are
  // source wiring assertions, not execution of a real AppHandle or native IPC.
  const syncKeys = fnBody('sync_selected_secret_keys');
  assert.match(syncKeys, /for key in keys \{\s*let outcome = post_secret_update_owned\(app, &client, &key, generation\)\.await;/);
  const post = fnBody('post_secret_update_owned');
  assert.match(post, /secret_sync::send\(\s*\|\| cache\.state\.transport_snapshot\(&cache\.revisions, key\),\s*\|\| confirmed_sidecar_target_owned\(app, generation\),\s*\|\(token, port\), snapshot\| \{/,
    'the production sender supplies authoritative cache and generation-aware fresh-target closures');
  assert.match(post, /client\.post\(format!\("http:\/\/127\.0\.0\.1:\{port\}\/api\/local-env-update"\)\)/,
    'transport uses the port supplied by that target');
  const controller = fnBody('send', SYNC);
  assert.match(controller, /for attempt in 0\.\.3 \{\s*let state = match snapshot\(\) \{[\s\S]*?\};\s*let destination = match target\(\) \{[\s\S]*?\};\s*if post\(destination, state\)\.await/,
    'each retry resolves both state and target before posting');
  const target = fnBody('confirmed_sidecar_target');
  assert.match(target, /let alive = match state\.child\.lock\(\) \{[\s\S]*?matches!\(child\.try_wait\(\), Ok\(None\)\)/,
    'the target checks the owned child is alive');
  assert.match(target, /if !alive \{\s*return Err\("sidecar not alive"\);/);
  assert.match(target, /if !state\.port_confirmed\.load\(Ordering::SeqCst\) \{\s*return Err\("sidecar port unconfirmed"\);/);
  assert.match(target, /let Some\(port\) = local_api_cell\(&state\)\.confirmed_live_port\(\) else \{\s*return Err\("sidecar port revoked"\);/,
    'the target refuses a revoked live port');
  assert.match(target, /Ok\(\(token, port\)\)/);
  for (const body of [syncKeys, post, controller, target]) {
    assert.doesNotMatch(body, /DEFAULT_LOCAL_API_PORT/, 'every secret-sync edge excludes default-port fallback');
  }
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


test('transport adapters reserve while owning the sole native map and fail closed on poison', () => {
  const coordinator = readFileSync(new URL('../src-tauri/src/vault_coordinator.rs', import.meta.url), 'utf8');
  const owned = fnBody('with_transport_map', coordinator);
  assert.match(owned, /let inner = self\.inner\.lock\(\)\.map_err\(\|_\| \(\)\)\?;\s*f\(&inner\.map\)/);
  assert.match(fnBody('transport_snapshot', coordinator), /self\.with_transport_map\(\|map\| clock\.snapshot_owned_map\(map, key\)\)/);
  assert.match(fnBody('transport_launch', coordinator), /self\.with_transport_map\(\|map\| clock\.launch_owned_map\(map\)\)/);
  assert.match(fnBody('start_local_api'), /state\.transport_launch\(&secrets_cache\.revisions\)/);
});

test('launch selections enter the bounded writer and retry admission after every live monitor tick', () => {
  const schedule = fnBody('schedule_launch_secret_reconciliation');
  order(schedule, 'confirmed_sidecar_target_owned(app, Some(generation))', 'try_enqueue_changed(', 'preflight precedes pending lock');
  assert.match(schedule, /cache\.state\.with_transport_map\(\|map\| Ok\(map\.clone\(\)\)\)/);
  assert.match(schedule, /writer\.try_push_keys\(generation, keys\)/);
  assert.doesNotMatch(schedule, /spawn|block_on|\.await/);
  const start = fnBody('start_local_api');
  assert.match(start, /Tick::Running\(late\) => \{\s*if let Some\(port\) = late \{[\s\S]*?\}\s*\/\/ tick has released child ownership[^\n]*\n\s*schedule_launch_secret_reconciliation\(&app_handle, generation\);\s*continue;/);
  assert.match(start, /Duration::from_millis\(1500\)/);
  const target = fnBody('confirmed_sidecar_target_owned');
  assert.match(target, /target_for_generation\(\s*generation,\s*\|\| state\.generation\.load\(Ordering::SeqCst\),\s*\|\| confirmed_sidecar_target\(app\)\.map_err/);
  const guard = fnBody('target_for_generation', SYNC);
  assert.equal((guard.match(/owner\(\) != generation/g) ?? []).length, 2, 'generation checked before and after target');
});
