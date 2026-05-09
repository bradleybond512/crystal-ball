import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSdnXml, normalizeVesselName, normalizeImo } from '../ofac-cache.mjs';

const FIXTURE = `<?xml version="1.0"?>
<sdnList xmlns="http://tempuri.org/sdnList.xsd">
  <sdnEntry>
    <uid>2001</uid>
    <lastName>STAR PROVIDER</lastName>
    <sdnType>Vessel</sdnType>
    <programList><program>IRAN</program></programList>
    <vesselInfo>
      <callSign>9HA4321</callSign>
      <vesselFlag>Iran</vesselFlag>
    </vesselInfo>
    <idList>
      <id><uid>22</uid><idType>IMO Number</idType><idNumber>9123456</idNumber></id>
    </idList>
  </sdnEntry>
</sdnList>`;

test('sidecar parser produces same vessel shape as renderer parser', () => {
  const out = parseSdnXml(FIXTURE);
  assert.equal(out.length, 1);
  const v = out[0];
  assert.equal(v.uid, '2001');
  assert.equal(v.type, 'vessel');
  assert.equal(v.name, 'STAR PROVIDER');
  assert.equal(v.vessel.callSign, '9HA4321');
  assert.equal(v.vessel.vesselFlag, 'Iran');
  assert.equal(v.vessel.imo, '9123456');
  assert.deepEqual(v.programs, ['iran']);
});

test('sidecar normalizers behave identically to renderer-side', () => {
  assert.equal(normalizeVesselName('M/V Star-Provider!!'), 'star provider');
  assert.equal(normalizeImo('IMO 9123456'), '9123456');
  assert.equal(normalizeImo('99123456'), '9123456');
});
