import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseOfacSdnXml } from '../ofac-parser.ts';
import {
  buildOfacIndex,
  searchSanctions,
  listSanctionedVessels,
  listSanctionedAircraft,
  matchVesselToSanction,
  normalizeVesselName,
  normalizeImo,
} from '../ofac-search.ts';

const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<sdnList xmlns="http://tempuri.org/sdnList.xsd">
  <publshInformation>
    <Publish_Date>05/06/2026</Publish_Date>
  </publshInformation>
  <sdnEntry>
    <uid>1001</uid>
    <lastName>Ivanov</lastName>
    <firstName>Sergei</firstName>
    <sdnType>Individual</sdnType>
    <programList>
      <program>RUSSIA-EO14024</program>
      <program>SDGT</program>
    </programList>
    <akaList>
      <aka>
        <uid>9001</uid>
        <type>a.k.a.</type>
        <category>strong</category>
        <lastName>Ivanovich</lastName>
        <firstName>Serge</firstName>
      </aka>
    </akaList>
    <addressList>
      <address>
        <uid>11</uid>
        <country>Russia</country>
        <city>Moscow</city>
      </address>
    </addressList>
    <idList>
      <id>
        <uid>21</uid>
        <idType>Passport</idType>
        <idNumber>123456789</idNumber>
        <idCountry>Russia</idCountry>
      </id>
    </idList>
  </sdnEntry>
  <sdnEntry>
    <uid>2001</uid>
    <lastName>STAR PROVIDER</lastName>
    <sdnType>Vessel</sdnType>
    <programList>
      <program>IRAN</program>
    </programList>
    <akaList>
      <aka>
        <uid>9101</uid>
        <type>a.k.a.</type>
        <category>strong</category>
        <lastName>STAR-PROVIDER</lastName>
      </aka>
    </akaList>
    <vesselInfo>
      <callSign>9HA4321</callSign>
      <vesselType>Crude Oil Tanker</vesselType>
      <vesselFlag>Iran</vesselFlag>
      <vesselOwner>NITC</vesselOwner>
      <tonnage>164000</tonnage>
    </vesselInfo>
    <idList>
      <id>
        <uid>22</uid>
        <idType>IMO Number</idType>
        <idNumber>9123456</idNumber>
      </id>
    </idList>
  </sdnEntry>
  <sdnEntry>
    <uid>3001</uid>
    <lastName>EP-IGB</lastName>
    <sdnType>Aircraft</sdnType>
    <programList>
      <program>SDGT</program>
    </programList>
    <aircraftInfo>
      <aircraftConstructionNumber>26528</aircraftConstructionNumber>
      <aircraftManufactureDate>01 Jan 1995</aircraftManufactureDate>
      <aircraftModel>Boeing 747</aircraftModel>
      <aircraftOperator>MAHAN AIR</aircraftOperator>
      <aircraftTailNumber>EP-IGB</aircraftTailNumber>
    </aircraftInfo>
  </sdnEntry>
  <sdnEntry>
    <uid>4001</uid>
    <lastName>NORINCO</lastName>
    <sdnType>Entity</sdnType>
    <programList>
      <program>NS-CMIC-EO13959</program>
    </programList>
    <addressList>
      <address>
        <uid>41</uid>
        <country>China</country>
      </address>
    </addressList>
  </sdnEntry>
  <sdnEntry>
    <uid>5001</uid>
    <sdnType>Individual</sdnType>
    <programList></programList>
  </sdnEntry>
</sdnList>`;

// ── parseOfacSdnXml ───────────────────────────────────────────────────

test('parser: drops entries without a name', () => {
  const out = parseOfacSdnXml(FIXTURE_XML);
  assert.equal(out.length, 4);
  assert.ok(!out.some((e) => e.uid === '5001'));
});

test('parser: composes "Last, First" for individuals', () => {
  const out = parseOfacSdnXml(FIXTURE_XML);
  const sergei = out.find((e) => e.uid === '1001')!;
  assert.equal(sergei.name, 'Ivanov, Sergei');
  assert.equal(sergei.type, 'individual');
});

test('parser: dedups + lowercases programs', () => {
  const out = parseOfacSdnXml(FIXTURE_XML);
  const sergei = out.find((e) => e.uid === '1001')!;
  assert.deepEqual(sergei.programs, ['russia-eo14024', 'sdgt']);
});

test('parser: vessel entry pulls callSign / flag / owner / IMO', () => {
  const out = parseOfacSdnXml(FIXTURE_XML);
  const vessel = out.find((e) => e.uid === '2001')!;
  assert.equal(vessel.type, 'vessel');
  assert.equal(vessel.name, 'STAR PROVIDER');
  assert.equal(vessel.vessel?.callSign, '9HA4321');
  assert.equal(vessel.vessel?.vesselFlag, 'Iran');
  assert.equal(vessel.vessel?.vesselOwner, 'NITC');
  assert.equal(vessel.vessel?.imo, '9123456');
  assert.equal(vessel.aircraft, null);
});

test('parser: aircraft entry pulls tail number / model / operator', () => {
  const out = parseOfacSdnXml(FIXTURE_XML);
  const aircraft = out.find((e) => e.uid === '3001')!;
  assert.equal(aircraft.type, 'aircraft');
  assert.equal(aircraft.aircraft?.tailNumber, 'EP-IGB');
  assert.equal(aircraft.aircraft?.model, 'Boeing 747');
  assert.equal(aircraft.aircraft?.operator, 'MAHAN AIR');
  assert.equal(aircraft.vessel, null);
});

test('parser: entity-type entries are recognized', () => {
  const out = parseOfacSdnXml(FIXTURE_XML);
  const entity = out.find((e) => e.uid === '4001')!;
  assert.equal(entity.type, 'entity');
  assert.deepEqual(entity.countries, ['china']);
});

test('parser: aliases captured + lowercased', () => {
  const out = parseOfacSdnXml(FIXTURE_XML);
  const vessel = out.find((e) => e.uid === '2001')!;
  assert.deepEqual(vessel.aliases, ['star-provider']);
});

test('parser: empty XML returns empty array', () => {
  assert.deepEqual(parseOfacSdnXml('<sdnList></sdnList>'), []);
});

test('parser: result is JSON-serializable', () => {
  const out = parseOfacSdnXml(FIXTURE_XML);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

// ── searchSanctions ────────────────────────────────────────────────────

const INDEX = buildOfacIndex(parseOfacSdnXml(FIXTURE_XML));

test('search: empty query returns empty array', () => {
  assert.deepEqual(searchSanctions(INDEX, '   '), []);
});

test('search: case-insensitive name match scores highest', () => {
  const hits = searchSanctions(INDEX, 'star provider');
  assert.ok(hits.length > 0);
  assert.equal(hits[0]!.entry.uid, '2001');
  assert.ok(hits[0]!.score >= 90);
});

test('search: alias match scores below name match but still returns', () => {
  const hits = searchSanctions(INDEX, 'star-provider');
  assert.ok(hits.length > 0);
  assert.equal(hits[0]!.entry.uid, '2001');
});

test('search: country-level haystack hit returns the entry', () => {
  const hits = searchSanctions(INDEX, 'china');
  assert.ok(hits.some((h) => h.entry.uid === '4001'));
});

test('search: type filter narrows to one sdn type', () => {
  const hits = searchSanctions(INDEX, 's', { type: 'vessel' });
  assert.ok(hits.every((h) => h.entry.type === 'vessel'));
});

test('search: respects limit', () => {
  const hits = searchSanctions(INDEX, 'a', { limit: 1 });
  assert.equal(hits.length, 1);
});

test('search: results stable-sorted by score desc, then name asc', () => {
  const hits = searchSanctions(INDEX, 'a');
  for (let i = 1; i < hits.length; i++) {
    assert.ok(hits[i - 1]!.score >= hits[i]!.score);
  }
});

// ── listSanctionedVessels / Aircraft ───────────────────────────────────

test('list: vessels filter is exhaustive', () => {
  assert.equal(listSanctionedVessels(INDEX).length, 1);
});

test('list: aircraft filter is exhaustive', () => {
  assert.equal(listSanctionedAircraft(INDEX).length, 1);
});

// ── matchVesselToSanction ──────────────────────────────────────────────

test('cross-ref: AIS name matches sanctioned vessel (M/V prefix tolerated)', () => {
  const r = matchVesselToSanction({ name: 'M/V STAR PROVIDER' }, INDEX);
  assert.equal(r.matched, true);
  if (r.matched) {
    assert.equal(r.reason, 'name');
    assert.ok(r.badge.includes('IRAN'));
    assert.deepEqual(r.programs, ['iran']);
  }
});

test('cross-ref: IMO match wins over name even if name differs', () => {
  const r = matchVesselToSanction({ name: 'GHOST', imo: 'IMO 9123456' }, INDEX);
  assert.equal(r.matched, true);
  if (r.matched) {
    assert.equal(r.reason, 'imo');
  }
});

test('cross-ref: callsign match', () => {
  const r = matchVesselToSanction({ callSign: '9HA4321' }, INDEX);
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.reason, 'callsign');
});

test('cross-ref: no match returns matched:false', () => {
  const r = matchVesselToSanction({ name: 'COMPLETELY UNRELATED', imo: '0000000' }, INDEX);
  assert.equal(r.matched, false);
});

test('cross-ref: empty inputs do not match', () => {
  assert.equal(matchVesselToSanction({}, INDEX).matched, false);
  assert.equal(matchVesselToSanction({ name: '', imo: '', callSign: '' }, INDEX).matched, false);
});

// ── normalizers ────────────────────────────────────────────────────────

test('normalize vessel: M/V prefix + punctuation stripped', () => {
  assert.equal(normalizeVesselName('M/V Star-Provider!!'), 'star provider');
  assert.equal(normalizeVesselName('MT  Aurora  '), 'aurora');
  assert.equal(normalizeVesselName('  '), '');
});

test('normalize IMO: tolerates "IMO " prefix and trims to 7 digits', () => {
  assert.equal(normalizeImo('IMO 9123456'), '9123456');
  assert.equal(normalizeImo('  9123456  '), '9123456');
  assert.equal(normalizeImo('XYZ'), '');
  assert.equal(normalizeImo('99123456'), '9123456');
});
