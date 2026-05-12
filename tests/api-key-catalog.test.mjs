import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const expected = [
  'CENSYS_API_ID',
  'CENSYS_API_SECRET',
  'SECURITYTRAILS_API_KEY',
  'MISP_URL',
  'MISP_API_KEY',
  'OPENCTI_URL',
  'OPENCTI_API_KEY',
  'WHOISXML_API_KEY',
];

test('new enrichment API keys are wired through settings, sidecar, and Tauri keyring', () => {
  const runtimeConfig = readFileSync('src/services/runtime-config.ts', 'utf8');
  const settings = readFileSync('src/services/settings-constants.ts', 'utf8');
  const sidecar = readFileSync('src-tauri/sidecar/local-api-server.mjs', 'utf8');
  const tauri = readFileSync('src-tauri/src/main.rs', 'utf8');

  for (const key of expected) {
    assert.match(runtimeConfig, new RegExp(`'${key}'`), `${key} missing from RuntimeSecretKey`);
    assert.match(settings, new RegExp(`${key}:`), `${key} missing from settings constants`);
    assert.match(sidecar, new RegExp(`'${key}'`), `${key} missing from sidecar key lists`);
    assert.match(tauri, new RegExp(`"${key}"`), `${key} missing from Tauri supported secrets`);
  }
});
