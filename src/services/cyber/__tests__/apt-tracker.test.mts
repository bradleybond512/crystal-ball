import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advisoryToActivityEvents,
  decorateGroups,
  findActiveAlerts,
  kevToActivityEvents,
  matchPulseToGroup,
  parseAttackBundle,
  pulseToActivityEvent,
  scoreActivity,
  type AptActivityEvent,
  type AptGroup,
  type CisaAdvisoryItem,
  type CisaKevEntry,
  type OtxPulse,
  type StixBundle,
} from '../apt-tracker.ts';

const NOW = Date.parse('2026-04-15T00:00:00Z');

function isoDaysAgo(days: number): string {
  return new Date(NOW - days * 86_400_000).toISOString();
}

const FANCY: AptGroup = {
  id: 'G0007',
  name: 'APT28',
  aliases: ['Fancy Bear', 'Sofacy', 'STRONTIUM'],
  country: 'Russia',
  targetSectors: [],
  recentTechniques: [],
  activityScore: 0,
};
const LAZARUS: AptGroup = {
  id: 'G0032',
  name: 'Lazarus Group',
  aliases: ['Hidden Cobra', 'Zinc'],
  country: 'North Korea',
  targetSectors: [],
  recentTechniques: [],
  activityScore: 0,
};

// ── parseAttackBundle ─────────────────────────────────────────────────

test('parseAttackBundle: extracts intrusion-set with G-code', () => {
  const bundle: StixBundle = {
    type: 'bundle',
    objects: [
      {
        type: 'intrusion-set',
        id: 'intrusion-set--abc',
        name: 'APT28',
        aliases: ['APT28', 'Fancy Bear', 'Sofacy'],
        x_mitre_attributed_to: 'Russia',
        external_references: [
          { source_name: 'mitre-attack', external_id: 'G0007', url: 'https://attack.mitre.org/groups/G0007' },
        ],
      },
    ],
  };
  const groups = parseAttackBundle(bundle);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.id, 'G0007');
  assert.equal(groups[0]!.name, 'APT28');
  assert.deepEqual(groups[0]!.aliases, ['Fancy Bear', 'Sofacy']);
  assert.equal(groups[0]!.country, 'Russia');
});

test('parseAttackBundle: skips revoked groups', () => {
  const bundle: StixBundle = {
    type: 'bundle',
    objects: [
      {
        type: 'intrusion-set',
        id: 'intrusion-set--zzz',
        name: 'OldGroup',
        revoked: true,
        external_references: [{ source_name: 'mitre-attack', external_id: 'G9999' }],
      },
    ],
  };
  assert.deepEqual(parseAttackBundle(bundle), []);
});

test('parseAttackBundle: skips non-intrusion-set objects', () => {
  const bundle: StixBundle = {
    type: 'bundle',
    objects: [
      { type: 'attack-pattern', id: 'attack-pattern--xyz', name: 'Phishing' },
      { type: 'malware', id: 'malware--abc', name: 'Mimikatz' },
    ],
  };
  assert.deepEqual(parseAttackBundle(bundle), []);
});

test('parseAttackBundle: bad input returns []', () => {
  assert.deepEqual(parseAttackBundle({ type: 'bundle', objects: [] }), []);
});

// ── matchPulseToGroup ─────────────────────────────────────────────────

test('matchPulseToGroup: matches on adversary field (case-insensitive)', () => {
  const pulse: OtxPulse = { adversary: 'fancy bear', name: 'op X' };
  assert.equal(matchPulseToGroup(pulse, [FANCY, LAZARUS])?.id, 'G0007');
});

test('matchPulseToGroup: matches on tag', () => {
  const pulse: OtxPulse = { tags: ['malware', 'STRONTIUM'] };
  assert.equal(matchPulseToGroup(pulse, [FANCY, LAZARUS])?.id, 'G0007');
});

test('matchPulseToGroup: returns null when no candidate matches', () => {
  const pulse: OtxPulse = { adversary: 'unknown actor' };
  assert.equal(matchPulseToGroup(pulse, [FANCY, LAZARUS]), null);
});

test('matchPulseToGroup: returns null when neither adversary nor tags', () => {
  assert.equal(matchPulseToGroup({}, [FANCY]), null);
});

// ── pulseToActivityEvent ─────────────────────────────────────────────

test('pulseToActivityEvent: builds event with severity from TLP', () => {
  const pulse: OtxPulse = {
    name: 'Energy sector targeting',
    modified: isoDaysAgo(2),
    industries: ['Energy'],
    indicators: [{ indicator: '8.8.8.8', type: 'IPv4' }],
    TLP: 'AMBER',
  };
  const event = pulseToActivityEvent(pulse, FANCY);
  assert.ok(event);
  assert.equal(event!.groupId, 'G0007');
  assert.equal(event!.severity, 'high');
  assert.equal(event!.targetSector, 'Energy');
  assert.deepEqual(event!.iocs, ['8.8.8.8']);
});

test('pulseToActivityEvent: returns null without a date', () => {
  assert.equal(pulseToActivityEvent({ name: 'no date' }, FANCY), null);
});

// ── kevToActivityEvents ──────────────────────────────────────────────

test('kevToActivityEvents: matches via group name in product field', () => {
  const kev: CisaKevEntry[] = [
    { cveID: 'CVE-2026-0001', vendorProject: 'X', product: 'APT28-implant', vulnerabilityName: 'foo', dateAdded: '2026-04-10' },
  ];
  const events = kevToActivityEvents(kev, [FANCY]);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.groupId, 'G0007');
  assert.equal(events[0]!.source, 'cisa-kev');
});

test('kevToActivityEvents: ransomware-marked entries get high severity', () => {
  const kev: CisaKevEntry[] = [
    {
      cveID: 'CVE-2026-0002', vendorProject: 'Lazarus Group', product: 'p', vulnerabilityName: 'v',
      dateAdded: '2026-04-12', knownRansomwareCampaignUse: 'Known',
    },
  ];
  const events = kevToActivityEvents(kev, [LAZARUS]);
  assert.equal(events[0]!.severity, 'high');
});

test('kevToActivityEvents: 2-char group names skip (length floor)', () => {
  const tinyGroup: AptGroup = { ...FANCY, name: 'AB', aliases: [] };
  const kev: CisaKevEntry[] = [
    { cveID: 'CVE-1', vendorProject: 'AB', product: 'p', vulnerabilityName: 'v', dateAdded: '2026-04-10' },
  ];
  assert.equal(kevToActivityEvents(kev, [tinyGroup]).length, 0);
});

// ── advisoryToActivityEvents ────────────────────────────────────────

test('advisoryToActivityEvents: matches via title containing alias', () => {
  const adv: CisaAdvisoryItem[] = [
    { title: 'CISA AA26-100A: Fancy Bear targets energy sector', pubDate: '2026-04-09', description: '' },
  ];
  const events = advisoryToActivityEvents(adv, [FANCY]);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.source, 'cisa-advisory');
});

// ── scoreActivity ──────────────────────────────────────────────────

test('scoreActivity: empty events → 0', () => {
  assert.equal(scoreActivity(FANCY, [], NOW), 0);
});

test('scoreActivity: events outside window are dropped', () => {
  const old: AptActivityEvent = {
    groupId: FANCY.id, date: isoDaysAgo(45), description: '', targetSector: '', iocs: [], severity: 'high', source: 'otx',
  };
  assert.equal(scoreActivity(FANCY, [old], NOW), 0);
});

test('scoreActivity: recent + high severity > old + low severity', () => {
  const recent: AptActivityEvent = {
    groupId: FANCY.id, date: isoDaysAgo(1), description: '', targetSector: '', iocs: [], severity: 'critical', source: 'cisa-kev',
  };
  const old: AptActivityEvent = {
    groupId: FANCY.id, date: isoDaysAgo(20), description: '', targetSector: '', iocs: [], severity: 'low', source: 'otx',
  };
  const sRecent = scoreActivity(FANCY, [recent], NOW);
  const sOld = scoreActivity(FANCY, [old], NOW);
  assert.ok(sRecent > sOld);
});

test('scoreActivity: clamped to [0, 100]', () => {
  const events: AptActivityEvent[] = Array.from({ length: 200 }, (_, i) => ({
    groupId: FANCY.id, date: isoDaysAgo(i % 7), description: '', targetSector: '', iocs: [], severity: 'critical', source: 'cisa-kev',
  }));
  const score = scoreActivity(FANCY, events, NOW);
  assert.ok(score <= 100, `score=${score} exceeded 100`);
  assert.ok(score >= 90, `score=${score} should be very high`);
});

test('scoreActivity: ignores events for other groups', () => {
  const event: AptActivityEvent = {
    groupId: LAZARUS.id, date: isoDaysAgo(1), description: '', targetSector: '', iocs: [], severity: 'critical', source: 'cisa-kev',
  };
  assert.equal(scoreActivity(FANCY, [event], NOW), 0);
});

// ── decorateGroups ──────────────────────────────────────────────────

test('decorateGroups: writes activityScore + lastActiveDate', () => {
  const events: AptActivityEvent[] = [
    { groupId: FANCY.id, date: isoDaysAgo(2), description: '', targetSector: 'Energy', iocs: [], severity: 'high', source: 'cisa-advisory' },
    { groupId: FANCY.id, date: isoDaysAgo(5), description: '', targetSector: 'Energy', iocs: [], severity: 'medium', source: 'otx' },
    { groupId: FANCY.id, date: isoDaysAgo(8), description: '', targetSector: 'Healthcare', iocs: [], severity: 'medium', source: 'otx' },
  ];
  const decorated = decorateGroups([FANCY, LAZARUS], events, NOW);
  const fancy = decorated.find((g) => g.id === FANCY.id)!;
  assert.ok(fancy.activityScore > 0);
  assert.equal(fancy.lastActiveDate, isoDaysAgo(2));
  assert.equal(fancy.targetSectors[0], 'Energy', 'Energy should top the sector list');
  // Lazarus had no events.
  const lazarus = decorated.find((g) => g.id === LAZARUS.id)!;
  assert.equal(lazarus.activityScore, 0);
  assert.equal(lazarus.lastActiveDate, undefined);
});

// ── findActiveAlerts ────────────────────────────────────────────────

test('findActiveAlerts: filters by minScore + window', () => {
  const events: AptActivityEvent[] = Array.from({ length: 8 }, (_, i) => ({
    groupId: FANCY.id, date: isoDaysAgo(i), description: '', targetSector: '', iocs: [], severity: 'critical', source: 'cisa-kev',
  }));
  const decorated = decorateGroups([FANCY, LAZARUS], events, NOW);
  const alerts = findActiveAlerts(decorated, events, NOW, { minScore: 60, windowDays: 7 });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.id, FANCY.id);
});

test('findActiveAlerts: no events in window → no alert even with high score', () => {
  // Manually decorated group with high score, but events all >7d old.
  const stale: AptGroup = { ...FANCY, activityScore: 80 };
  const oldEvents: AptActivityEvent[] = [
    { groupId: FANCY.id, date: isoDaysAgo(20), description: '', targetSector: '', iocs: [], severity: 'high', source: 'otx' },
  ];
  const alerts = findActiveAlerts([stale], oldEvents, NOW, { minScore: 60, windowDays: 7 });
  assert.equal(alerts.length, 0);
});

// ── JSON serializability ────────────────────────────────────────────

test('decorated groups + events are JSON-serializable', () => {
  const events: AptActivityEvent[] = [
    { groupId: FANCY.id, date: isoDaysAgo(1), description: 'x', targetSector: '', iocs: [], severity: 'high', source: 'otx' },
  ];
  const decorated = decorateGroups([FANCY], events, NOW);
  const round = structuredClone(decorated);
  assert.equal(round[0]?.id, FANCY.id);
});
