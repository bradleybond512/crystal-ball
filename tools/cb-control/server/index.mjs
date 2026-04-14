#!/usr/bin/env node
// cb-control: local daemon for remote-controlling Claude Code CLI sessions.
//
//   npm start                    # run on 127.0.0.1:46987
//   CB_CONTROL_HOST=0.0.0.0 npm start   # bind all interfaces (use with Tailscale)
//
// First run prints the bearer token and API URL. Put that token into the
// PWA Settings panel on your iPhone.

import { createServer } from 'node:http';
import { config } from './config.mjs';
import { handleRequest } from './api.mjs';
import { attachWebSocket } from './ws.mjs';
import { sessions } from './sessions.mjs';

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[cb-control] unhandled error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal error' }));
    }
  });
});

attachWebSocket(server);

// Re-attach to any external tmux sessions still alive from a previous run.
try { sessions.rehydrate(); } catch (err) { console.error('[cb-control] rehydrate error:', err); }

server.listen(config.port, config.host, () => {
  const origin = `http://${config.host}:${config.port}`;
  console.log('[cb-control] listening on ' + origin);
  console.log('[cb-control] data dir:  ' + config.dataDir);
  console.log('[cb-control] token:     ' + config.token);
  console.log('[cb-control] token path: ' + config.tokenPath);
  console.log('');
  console.log('Open the PWA on your iPhone:');
  console.log('  ' + origin + '/');
  console.log('Paste the token above into Settings → Token.');
});
