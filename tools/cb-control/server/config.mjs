// Runtime configuration: host/port, data directory, bearer token.
// Token is auto-generated on first run and persisted with 0600 perms.

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = process.env.CB_CONTROL_DIR ?? join(homedir(), '.config', 'cb-control');
const TOKEN_PATH = join(CONFIG_DIR, 'token');
const DATA_DIR = join(CONFIG_DIR, 'data');

mkdirSync(CONFIG_DIR, { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });

function ensureToken() {
  if (existsSync(TOKEN_PATH)) {
    return readFileSync(TOKEN_PATH, 'utf8').trim();
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(TOKEN_PATH, token + '\n', { mode: 0o600 });
  chmodSync(TOKEN_PATH, 0o600);
  return token;
}

export const config = {
  host: process.env.CB_CONTROL_HOST ?? '127.0.0.1',
  port: Number(process.env.CB_CONTROL_PORT ?? 46987),
  token: ensureToken(),
  dataDir: DATA_DIR,
  tokenPath: TOKEN_PATH,
  dbPath: join(DATA_DIR, 'cb-control.sqlite'),
  claudeBinary: process.env.CB_CONTROL_CLAUDE ?? 'claude',
  shell: process.env.SHELL ?? '/bin/bash',
};
