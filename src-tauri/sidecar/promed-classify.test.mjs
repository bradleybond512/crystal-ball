// src-tauri/sidecar/promed-classify.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifySeverity,
  extractCaseCount,
  extractDisease,
  extractCountry,
  parseProMedRss,
} from './promed-classify.mjs';

// ── classifySeverity ─────────────────────────────────────────────────────────

test('classifySeverity: NOVEL_PATHOGEN takes precedence over OUTBREAK keywords', () => {
  assert.equal(
    classifySeverity({ title: 'Novel coronavirus outbreak in Wuhan', description: '' }),
    'NOVEL_PATHOGEN',
  );
  assert.equal(
    classifySeverity({ title: 'Undiagnosed febrile illness', description: '' }),
    'NOVEL_PATHOGEN',
  );
  assert.equal(
    classifySeverity({ title: 'Unknown etiology cluster reported', description: '' }),
    'NOVEL_PATHOGEN',
  );
  assert.equal(
    classifySeverity({ title: 'First case of new pathogen', description: '' }),
    'NOVEL_PATHOGEN',
  );
});

test('classifySeverity: OUTBREAK matches outbreak/epidemic/surge', () => {
  assert.equal(classifySeverity({ title: 'Cholera outbreak in Yemen', description: '' }), 'OUTBREAK');
  assert.equal(classifySeverity({ title: 'Dengue epidemic update', description: '' }), 'OUTBREAK');
  assert.equal(classifySeverity({ title: 'Measles surge in Europe', description: '' }), 'OUTBREAK');
});

test('classifySeverity: UNUSUAL_CLUSTER matches cluster/spike/excess (without novel/outbreak)', () => {
  assert.equal(
    classifySeverity({ title: 'Cluster of pneumonia cases', description: '' }),
    'UNUSUAL_CLUSTER',
  );
  assert.equal(
    classifySeverity({ title: 'Unusual respiratory illness in school', description: '' }),
    'UNUSUAL_CLUSTER',
  );
  assert.equal(
    classifySeverity({ title: 'Excess mortality in nursing home', description: '' }),
    'UNUSUAL_CLUSTER',
  );
});

test('classifySeverity: ROUTINE for surveillance updates with no escalation keywords', () => {
  assert.equal(classifySeverity({ title: 'Weekly malaria report', description: '' }), 'ROUTINE');
  assert.equal(classifySeverity({ title: 'Annual TB summary', description: '' }), 'ROUTINE');
});

test('classifySeverity: also scans the description', () => {
  assert.equal(
    classifySeverity({ title: 'Health update', description: 'Investigators describe a novel pathogen' }),
    'NOVEL_PATHOGEN',
  );
});

// ── extractCaseCount ─────────────────────────────────────────────────────────

test('extractCaseCount: parses cases from description', () => {
  assert.deepEqual(
    extractCaseCount({ description: 'A total of 245 confirmed cases were reported.' }),
    { cases: 245 },
  );
});

test('extractCaseCount: parses both cases and deaths', () => {
  assert.deepEqual(
    extractCaseCount({ description: 'There have been 1,532 cases and 47 deaths to date.' }),
    { cases: 1532, deaths: 47 },
  );
});

test('extractCaseCount: handles commas and singular "case"', () => {
  assert.deepEqual(
    extractCaseCount({ description: '1 case confirmed in lab.' }),
    { cases: 1 },
  );
});

test('extractCaseCount: returns empty object when no numbers present', () => {
  assert.deepEqual(extractCaseCount({ description: 'Investigation ongoing.' }), {});
  assert.deepEqual(extractCaseCount({ description: '' }), {});
  assert.deepEqual(extractCaseCount({}), {});
});

// ── extractDisease ───────────────────────────────────────────────────────────

test('extractDisease: returns canonical disease names from a known list', () => {
  assert.equal(extractDisease('Mpox - Democratic Republic of the Congo'), 'Mpox');
  assert.equal(extractDisease('Cholera in Haiti'), 'Cholera');
  assert.equal(extractDisease('Avian influenza H5N1 detected in poultry'), 'Avian influenza');
});

test('extractDisease: falls back to leading title segment when no known disease matches', () => {
  assert.equal(extractDisease('Mystery illness - Update 3'), 'Mystery illness');
});

// ── extractCountry ───────────────────────────────────────────────────────────

test('extractCountry: prefers parenthetical at end', () => {
  assert.equal(extractCountry('Cholera outbreak (Yemen)', ''), 'Yemen');
});

test('extractCountry: matches "in <Country>" pattern', () => {
  assert.equal(extractCountry('Mpox cases reported in Sweden', ''), 'Sweden');
});

test('extractCountry: returns Unknown when neither pattern matches', () => {
  assert.equal(extractCountry('Worldwide health bulletin update', ''), 'Unknown');
});

// ── parseProMedRss ───────────────────────────────────────────────────────────

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>ProMED-mail</title>
    <item>
      <title><![CDATA[Mpox - Democratic Republic of the Congo: outbreak]]></title>
      <link>https://promedmail.org/post/12345</link>
      <pubDate>Tue, 04 May 2026 12:00:00 GMT</pubDate>
      <guid>12345</guid>
      <description><![CDATA[There have been 1,200 cases and 35 deaths.]]></description>
    </item>
    <item>
      <title>Novel respiratory illness - China</title>
      <link>https://promedmail.org/post/12346</link>
      <pubDate>Mon, 03 May 2026 09:00:00 GMT</pubDate>
      <guid>12346</guid>
      <description>Cluster of unknown etiology cases under investigation.</description>
    </item>
    <item>
      <title>Weekly cholera summary</title>
      <link>https://promedmail.org/post/12347</link>
      <pubDate>Sun, 02 May 2026 08:00:00 GMT</pubDate>
      <guid>12347</guid>
      <description>Routine surveillance update.</description>
    </item>
  </channel>
</rss>`;

test('parseProMedRss: extracts items with all fields', () => {
  const items = parseProMedRss(SAMPLE_RSS);
  assert.equal(items.length, 3);
  assert.equal(items[0].id, '12345');
  assert.equal(items[0].title, 'Mpox - Democratic Republic of the Congo: outbreak');
  assert.equal(items[0].link, 'https://promedmail.org/post/12345');
  assert.equal(items[0].severity, 'OUTBREAK');
  assert.equal(items[0].cases, 1200);
  assert.equal(items[0].deaths, 35);
  assert.equal(items[0].disease, 'Mpox');
});

test('parseProMedRss: classifies novel/outbreak/routine independently', () => {
  const items = parseProMedRss(SAMPLE_RSS);
  assert.equal(items[1].severity, 'NOVEL_PATHOGEN');
  assert.equal(items[2].severity, 'ROUTINE');
});

test('parseProMedRss: returns empty array when input is malformed', () => {
  assert.deepEqual(parseProMedRss(''), []);
  assert.deepEqual(parseProMedRss('not even xml'), []);
});

test('parseProMedRss: caps results at 100', () => {
  const itemBlock = '<item><title>Test</title><link>x</link><pubDate>now</pubDate><guid>x</guid><description>none</description></item>';
  const xml = `<rss><channel>${itemBlock.repeat(150)}</channel></rss>`;
  const items = parseProMedRss(xml);
  assert.equal(items.length, 100);
});
