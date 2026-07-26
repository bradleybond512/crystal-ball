import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countryFlagEmoji,
  parseBatchInput,
  renderResultCard,
  renderThreatContext,
  renderHistory,
  renderBatchResults,
  renderSingleLookupForm,
  renderBatchForm,
  renderLookupNotice,
} from '../ipinfo-tab.ts';
import type { IpInfo, IpThreatContext, HistoryEntry } from '@/services/security/ipinfo-service';

function info(partial: Partial<IpInfo>): IpInfo {
  return {
    ip: '8.8.8.8',
    hostname: 'dns.google',
    city: 'Mountain View',
    region: 'California',
    country: 'US',
    countryCode: 'US',
    lat: 37.4056,
    lon: -122.0775,
    org: 'AS15169 Google LLC',
    asn: 'AS15169',
    orgName: 'Google LLC',
    timezone: 'America/Los_Angeles',
    anycast: true,
    fetchedAt: '2026-05-09T00:00:00Z',
    ...partial,
  };
}

// ── Flags ────────────────────────────────────────────────────────────

test('countryFlagEmoji: US → 🇺🇸 regional indicators', () => {
  assert.equal(countryFlagEmoji('US'), '🇺🇸');
  assert.equal(countryFlagEmoji('us'), '🇺🇸');
});

test('countryFlagEmoji: missing / bad code → empty string', () => {
  assert.equal(countryFlagEmoji(undefined), '');
  assert.equal(countryFlagEmoji('USA'), '');
  assert.equal(countryFlagEmoji('1A'), '');
});

// ── Forms ────────────────────────────────────────────────────────────

test('renderSingleLookupForm: prefills current value (HTML-escaped)', () => {
  const html = renderSingleLookupForm('<x>');
  assert.equal(html.includes('<x>'), false);
  assert.match(html, /&lt;x&gt;/);
});

test('renderBatchForm: textarea + submit button', () => {
  const html = renderBatchForm('1.1.1.1\n8.8.8.8');
  assert.match(html, /<textarea/);
  assert.match(html, /Look up batch/);
});

test('renderLookupNotice: escapes lookup and error text before HTML insertion', () => {
  const html = renderLookupNotice('<img src=x onerror=alert(1)>', 'error');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

// ── Result card ──────────────────────────────────────────────────────

test('renderResultCard: includes flag, city, region, ASN, hostname', () => {
  const html = renderResultCard(info({}), null);
  assert.match(html, /8\.8\.8\.8/);
  assert.match(html, /Mountain View/);
  assert.match(html, /California/);
  assert.match(html, /AS15169/);
  assert.match(html, /dns\.google/);
  assert.match(html, /Anycast/);
});

test('renderResultCard: null info → empty string', () => {
  assert.equal(renderResultCard(null, null), '');
});

test('renderResultCard: HTML-escapes attacker-controlled hostname', () => {
  const html = renderResultCard(info({ hostname: '<script>x</script>' }), null);
  assert.equal(html.includes('<script>x</script>'), false);
  assert.match(html, /&lt;script&gt;/);
});

// ── Threat context ───────────────────────────────────────────────────

test('renderThreatContext: known bad actor → red banner', () => {
  const threat: IpThreatContext = {
    ip: '1.2.3.4',
    knownBadActor: true,
    notes: ['ASN AS200651 (Flokinet) is on the bad-actor watchlist.'],
  };
  const html = renderThreatContext(threat);
  assert.match(html, /KNOWN BAD ACTOR/);
  assert.match(html, /Flokinet/);
  assert.match(html, /#dc2626/);
});

test('renderThreatContext: clean / null → empty string', () => {
  assert.equal(renderThreatContext(null), '');
  assert.equal(renderThreatContext({ ip: 'x', knownBadActor: false, notes: [] }), '');
});

test('renderThreatContext: anycast + bogon notes use amber banner', () => {
  const html = renderThreatContext({
    ip: '8.8.8.8',
    knownBadActor: false,
    notes: ['IP is part of an anycast block — geolocation is approximate.'],
  });
  assert.match(html, /CONTEXT/);
  assert.match(html, /#fbbf24/);
});

// ── History ──────────────────────────────────────────────────────────

test('renderHistory: empty → "no recent lookups" placeholder', () => {
  assert.match(renderHistory([]), /No recent lookups/i);
});

test('renderHistory: items are clickable (data-ip attr)', () => {
  const list: HistoryEntry[] = [
    { ip: '8.8.8.8', countryCode: 'US', city: 'Mountain View', asn: 'AS15169', at: 1 },
    { ip: '1.1.1.1', countryCode: 'US', city: 'Los Angeles', asn: 'AS13335', at: 2 },
  ];
  const html = renderHistory(list);
  assert.match(html, /data-ip="8\.8\.8\.8"/);
  assert.match(html, /data-ip="1\.1\.1\.1"/);
  assert.match(html, /AS15169/);
});

// ── Batch ────────────────────────────────────────────────────────────

test('parseBatchInput: splits on newlines, trims, drops blanks', () => {
  const out = parseBatchInput(' 8.8.8.8 \n\n1.1.1.1\r\n  9.9.9.9  ');
  assert.deepEqual(out, ['8.8.8.8', '1.1.1.1', '9.9.9.9']);
});

test('parseBatchInput: caps at maxIps', () => {
  const blob = Array.from({ length: 60 }, (_, i) => `10.0.0.${i}`).join('\n');
  assert.equal(parseBatchInput(blob, 25).length, 25);
});

test('renderBatchResults: table with one row per input, null → "lookup failed"', () => {
  const rows = [
    info({ ip: '8.8.8.8' }),
    null,
    info({ ip: '1.1.1.1', city: 'San Francisco', region: 'California' }),
  ];
  const html = renderBatchResults(rows, ['8.8.8.8', 'bad', '1.1.1.1']);
  assert.match(html, /8\.8\.8\.8/);
  assert.match(html, /1\.1\.1\.1/);
  assert.match(html, /lookup failed/);
  assert.match(html, /bad/);
});

test('renderBatchResults: empty input → empty string', () => {
  assert.equal(renderBatchResults([], []), '');
});
