import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const native = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');

function command(name) {
  const match = native.match(new RegExp(`(?:async )?fn ${name}\\([\\s\\S]*?\\n\\}`, 'u'));
  assert.ok(match, `${name} must remain a native command`);
  return match[0];
}

test('native iMessage send accepts a body but no renderer destination or consent', () => {
  const signature = command('send_imessage').split('->')[0];
  assert.match(signature, /body:\s*String/);
  assert.doesNotMatch(signature, /recipient|enabled|confirmed|approved|path|migration/i);
});

for (const name of ['get_imessage_settings', 'configure_imessage', 'disable_imessage', 'send_imessage']) {
  test(`${name} keeps trusted-window authorization before off-thread effects`, () => {
    const source = command(name);
    assert.match(source, new RegExp(`^async fn ${name}\\(`));
    const guard = source.indexOf('require_trusted_window(webview.label())');
    const blocking = source.indexOf('spawn_blocking');
    assert.ok(guard >= 0 && blocking > guard, 'authorize the caller before scheduling native work');
    assert.match(native, new RegExp(`^\\s*${name},$`, 'm'), 'command must be registered');
  });
}

test('configuration accepts a proposal without a renderer approval bypass', () => {
  const signature = command('configure_imessage').split('->')[0];
  assert.match(signature, /recipient:\s*String/);
  assert.match(signature, /enabled:\s*bool/);
  assert.doesNotMatch(signature, /confirmed|approved|path|migration/i);
  assert.doesNotMatch(command('disable_imessage').split('->')[0], /recipient|enabled|confirmed|approved/i);
});
