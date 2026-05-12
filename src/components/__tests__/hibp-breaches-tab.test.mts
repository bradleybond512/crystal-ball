import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderSeverityBadge,
  formatPwnCount,
  renderDataClassChips,
  renderBreachRow,
  renderLatestTab,
  renderSearchTab,
  renderStatisticsTab,
} from '../hibp-breaches-tab.ts';
import type { HibpBreach } from '@/services/security/hibp-service';

function breach(partial: Partial<HibpBreach>): HibpBreach {
  return {
    name: 'Adobe',
    title: 'Adobe',
    domain: 'adobe.com',
    breachDate: '2013-10-04',
    addedDate: '2013-12-04T00:00:00Z',
    modifiedDate: '2022-05-15T00:00:00Z',
    pwnCount: 152_445_165,
    description: 'desc',
    dataClasses: ['Passwords', 'Email addresses'],
    isVerified: true,
    isFabricated: false,
    isSensitive: false,
    isRetired: false,
    isSpamList: false,
    isMalware: false,
    severity: 'critical',
    ...partial,
  };
}

// ── Pure helpers ─────────────────────────────────────────────────────

test('renderSeverityBadge: hex color is injected', () => {
  const html = renderSeverityBadge('critical');
  assert.match(html, /CRIT/);
  assert.match(html, /#dc2626/i);
});

test('formatPwnCount: humanizes scale', () => {
  assert.equal(formatPwnCount(500), '500');
  assert.equal(formatPwnCount(1_500), '1.5K');
  assert.equal(formatPwnCount(2_500_000), '2.5M');
  assert.equal(formatPwnCount(3_200_000_000), '3.2B');
});

test('formatPwnCount: 0 / NaN → em-dash', () => {
  assert.equal(formatPwnCount(0), '—');
  assert.equal(formatPwnCount(Number.NaN), '—');
});

test('renderDataClassChips: empty list → placeholder', () => {
  assert.match(renderDataClassChips([]), /no data classes/);
});

test('renderDataClassChips: overflow shows +N', () => {
  const html = renderDataClassChips(['A', 'B', 'C', 'D', 'E', 'F'], 4);
  assert.match(html, /\+2/);
});

test('renderBreachRow: severity color + domain + data classes appear', () => {
  const html = renderBreachRow(breach({}));
  assert.match(html, /Adobe/);
  assert.match(html, /adobe\.com/);
  assert.match(html, /152\.4M accounts/);
  assert.match(html, /Passwords/);
  assert.match(html, /CRIT/);
});

test('renderBreachRow: escapes HTML in name + domain', () => {
  const html = renderBreachRow(breach({ name: '<x>', title: '<x>', domain: '<x>' }));
  assert.equal(html.includes('<x>'), false);
  assert.match(html, /&lt;x&gt;/);
});

// ── Tab renderers ────────────────────────────────────────────────────

test('renderLatestTab: loading state', () => {
  assert.match(renderLatestTab([], true), /Loading recent breaches/i);
});

test('renderLatestTab: empty state', () => {
  assert.match(renderLatestTab([], false), /No breaches added/i);
});

test('renderLatestTab: rows + summary', () => {
  const html = renderLatestTab([breach({ name: 'A' }), breach({ name: 'B' })], false);
  assert.match(html, /2 breaches added/);
  assert.match(html, /A/);
});

test('renderSearchTab: empty query → prompt', () => {
  const html = renderSearchTab('', [], false);
  assert.match(html, /Enter a company name or domain/i);
});

test('renderSearchTab: no matches → empty message', () => {
  const html = renderSearchTab('zzz', [], false);
  assert.match(html, /No breaches matched/i);
});

test('renderSearchTab: hits rendered with count', () => {
  const html = renderSearchTab('adobe', [breach({ name: 'A' })], false);
  assert.match(html, /1 match/);
  assert.match(html, /hibp-search-input/);
});

test('renderStatisticsTab: null stats → "no data"', () => {
  assert.match(renderStatisticsTab(null, false), /No HIBP data/i);
});

test('renderStatisticsTab: renders all four severities + top classes', () => {
  const html = renderStatisticsTab(
    {
      totalBreaches: 4,
      totalPwnedAccounts: 1_500_000,
      topDataClasses: [{ dataClass: 'Email addresses', count: 4 }, { dataClass: 'Passwords', count: 3 }],
      bySeverity: { critical: 2, high: 1, medium: 1, low: 0 },
      recentBreaches: 1,
    },
    false,
  );
  assert.match(html, /Total breaches/);
  assert.match(html, /4/);
  assert.match(html, /1\.5M/);
  // Severity rows write the label in lowercase + CSS uppercases visually.
  assert.match(html, />critical</);
  assert.match(html, />high</);
  assert.match(html, />medium</);
  assert.match(html, />low</);
  assert.match(html, /Email addresses/);
});
