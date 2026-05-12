import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLittleSnitchTrafficCsv } from './export-little-snitch-traffic.mjs';

test('parses Little Snitch traffic CSV into sanitized panel entries', () => {
  const csv = [
    'Timestamp,Process Name,Remote Host,Direction,Protocol,Bytes In,Bytes Out,Connections,Rule Action',
    '2026-05-03 23:00:00,node,https://api.example.com/path?token=secret,outbound,TCP,100,2500000,3,allow',
  ].join('\n');

  const entries = parseLittleSnitchTrafficCsv(csv);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].app, 'node');
  assert.equal(entries[0].remoteHost, 'api.example.com');
  assert.equal(entries[0].remote, undefined);
  assert.equal(entries[0].decision, 'allow');
  assert.equal(entries[0].count, 3);
});

test('parses documented Little Snitch log-traffic CSV fields', () => {
  const csv = [
    'date,direction,uid,ipAddress,remoteHostname,protocol,port,connectCount,denyCount,byteCountIn,byteCountOut,connectingExecutable,parentAppExecutable',
    '2026-05-04 04:20:00,out,501,93.184.216.34,api.example.org,6,443,4,1,50,1200,/opt/homebrew/bin/node,/Applications/Terminal.app',
  ].join('\n');

  const entries = parseLittleSnitchTrafficCsv(csv);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].remoteHost, 'api.example.org');
  assert.equal(entries[0].app, 'Terminal.app');
  assert.equal(entries[0].direction, 'outbound');
  assert.equal(entries[0].protocol, 'tcp');
  assert.equal(entries[0].decision, 'block');
  assert.equal(entries[0].count, 4);
});
