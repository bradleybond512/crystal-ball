/* eslint-disable unicorn/prefer-event-target */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  xmlText,
  parseAlertLevel,
  parseCoordinates,
  parseRssItem,
  splitRssItems,
  parseGdacsRss,
  groupByType,
  alertLevelRgba,
  fetchGdacsRss,
} from './gdacs-rss.mjs';

const SAMPLE_ITEM = `<item>
  <title>TROPICAL CYCLONE - 1 - Red - Sri Lanka</title>
  <pubDate>Mon, 11 May 2026 06:00:00 GMT</pubDate>
  <link>https://www.gdacs.org/report.aspx?eventid=1000808</link>
  <gdacs:eventtype>TC</gdacs:eventtype>
  <gdacs:eventid>1000808</gdacs:eventid>
  <gdacs:alertlevel>Red</gdacs:alertlevel>
  <gdacs:alertscore>2.5</gdacs:alertscore>
  <gdacs:country>Sri Lanka</gdacs:country>
  <gdacs:severity>Category 4</gdacs:severity>
  <geo:lat>8.5</geo:lat>
  <geo:long>80.5</geo:long>
</item>`;

const SAMPLE_EQ_ITEM = `<item>
  <title>EARTHQUAKE - M6.5 - Orange - Japan</title>
  <gdacs:eventtype>EQ</gdacs:eventtype>
  <gdacs:eventid>1001234</gdacs:eventid>
  <gdacs:alertlevel>Orange</gdacs:alertlevel>
  <gdacs:alertscore>1.2</gdacs:alertscore>
  <gdacs:country>Japan</gdacs:country>
  <gdacs:severity>M6.5</gdacs:severity>
  <geo:lat>35.0</geo:lat>
  <geo:long>139.0</geo:long>
</item>`;

// ── xmlText ───────────────────────────────────────────────────────────────────

test('xmlText: extracts plain text content', () => {
  const xml = '<gdacs:country>Japan</gdacs:country>';
  assert.equal(xmlText(xml, 'gdacs:country'), 'Japan');
});

test('xmlText: extracts CDATA content', () => {
  const xml = '<title><![CDATA[Tropical Cyclone 1]]></title>';
  assert.equal(xmlText(xml, 'title'), 'Tropical Cyclone 1');
});

test('xmlText: returns empty string for missing tag', () => {
  assert.equal(xmlText('<root><a>x</a></root>', 'b'), '');
});

// ── parseAlertLevel ───────────────────────────────────────────────────────────

test('parseAlertLevel: extracts Red', () => {
  assert.equal(parseAlertLevel(SAMPLE_ITEM), 'Red');
});

test('parseAlertLevel: extracts Orange', () => {
  assert.equal(parseAlertLevel(SAMPLE_EQ_ITEM), 'Orange');
});

test('parseAlertLevel: defaults to Green for unknown', () => {
  assert.equal(parseAlertLevel('<item><gdacs:alertlevel>Unknown</gdacs:alertlevel></item>'), 'Green');
});

// ── parseCoordinates ──────────────────────────────────────────────────────────

test('parseCoordinates: parses geo:lat / geo:long', () => {
  const coords = parseCoordinates(SAMPLE_ITEM);
  assert.ok(coords !== null);
  assert.equal(coords[1], 8.5);  // lat
  assert.equal(coords[0], 80.5); // lon
});

test('parseCoordinates: parses georss:point fallback', () => {
  const item = '<item><georss:point>35.0 139.0</georss:point></item>';
  const coords = parseCoordinates(item);
  assert.ok(coords !== null);
  assert.equal(coords[1], 35);
  assert.equal(coords[0], 139);
});

test('parseCoordinates: returns null when no coords present', () => {
  assert.equal(parseCoordinates('<item><title>No coords</title></item>'), null);
});

// ── parseRssItem ──────────────────────────────────────────────────────────────

test('parseRssItem: parses complete TC event', () => {
  const event = parseRssItem(SAMPLE_ITEM);
  assert.ok(event !== null);
  assert.equal(event.eventType, 'TC');
  assert.equal(event.alertLevel, 'Red');
  assert.equal(event.country, 'Sri Lanka');
  assert.equal(event.score, 2.5);
  assert.ok(event.id.startsWith('gdacs-rss-TC-'));
  assert.ok(event.coordinates !== null);
});

test('parseRssItem: parses EQ event', () => {
  const event = parseRssItem(SAMPLE_EQ_ITEM);
  assert.ok(event !== null);
  assert.equal(event.eventType, 'EQ');
  assert.equal(event.alertLevel, 'Orange');
});

test('parseRssItem: returns null for item with no eventType', () => {
  const item = '<item><title>No type</title></item>';
  assert.equal(parseRssItem(item), null);
});

test('parseRssItem: truncates long severity strings', () => {
  const longSeverity = 'x'.repeat(200);
  const item = `<item>
    <gdacs:eventtype>FL</gdacs:eventtype>
    <gdacs:severity>${longSeverity}</gdacs:severity>
  </item>`;
  const event = parseRssItem(item);
  assert.ok(event !== null);
  assert.ok(event.severity.length <= 82); // 80 + ellipsis
});

// ── splitRssItems ─────────────────────────────────────────────────────────────

test('splitRssItems: splits multi-item RSS into individual blocks', () => {
  const xml = `<rss><channel>
    ${SAMPLE_ITEM}
    ${SAMPLE_EQ_ITEM}
  </channel></rss>`;
  const items = splitRssItems(xml);
  assert.equal(items.length, 2);
});

test('splitRssItems: returns empty array for feed with no items', () => {
  assert.deepEqual(splitRssItems('<rss><channel></channel></rss>'), []);
});

// ── parseGdacsRss ─────────────────────────────────────────────────────────────

test('parseGdacsRss: parses multiple events from full RSS', () => {
  const xml = `<rss><channel>${SAMPLE_ITEM}${SAMPLE_EQ_ITEM}</channel></rss>`;
  const events = parseGdacsRss(xml);
  assert.equal(events.length, 2);
});

test('parseGdacsRss: deduplicates events with same type+id', () => {
  const xml = `<rss><channel>${SAMPLE_ITEM}${SAMPLE_ITEM}</channel></rss>`;
  const events = parseGdacsRss(xml);
  assert.equal(events.length, 1);
});

// ── groupByType ───────────────────────────────────────────────────────────────

test('groupByType: groups events by eventType', () => {
  const xml = `<rss><channel>${SAMPLE_ITEM}${SAMPLE_EQ_ITEM}</channel></rss>`;
  const events = parseGdacsRss(xml);
  const groups = groupByType(events);
  assert.ok(groups['TC'] !== undefined);
  assert.ok(groups['EQ'] !== undefined);
  assert.equal(groups['TC'].length, 1);
  assert.equal(groups['EQ'].length, 1);
});

test('groupByType: sorts each group by score descending', () => {
  const item1 = `<item><gdacs:eventtype>EQ</gdacs:eventtype><gdacs:eventid>1</gdacs:eventid><gdacs:alertscore>1.0</gdacs:alertscore><gdacs:alertlevel>Green</gdacs:alertlevel></item>`;
  const item2 = `<item><gdacs:eventtype>EQ</gdacs:eventtype><gdacs:eventid>2</gdacs:eventid><gdacs:alertscore>3.0</gdacs:alertscore><gdacs:alertlevel>Red</gdacs:alertlevel></item>`;
  const events = parseGdacsRss(`<rss><channel>${item1}${item2}</channel></rss>`);
  const groups = groupByType(events);
  assert.equal(groups['EQ'][0].score, 3);
  assert.equal(groups['EQ'][1].score, 1);
});

// ── alertLevelRgba ────────────────────────────────────────────────────────────

test('alertLevelRgba: Red returns red RGBA', () => {
  const rgba = alertLevelRgba('Red');
  assert.equal(rgba[0], 229);
  assert.equal(rgba[3], 220);
});

test('alertLevelRgba: Orange returns orange RGBA', () => {
  const rgba = alertLevelRgba('Orange');
  assert.equal(rgba[0], 251);
  assert.equal(rgba[1], 140);
});

test('alertLevelRgba: Green returns green RGBA', () => {
  const rgba = alertLevelRgba('Green');
  assert.equal(rgba[1], 160);
});

// ── fetchGdacsRss ──────────────────────────────────────────────────────────────

async function fetchGdacs503() { return { ok: false, status: 503 }; }
async function fetchGdacsEmpty() {
  return { ok: true, text: async () => '<rss><channel></channel></rss>' };
}

test('fetchGdacsRss: fetches from gdacs.org and returns parsed events', async () => {
  let capturedUrl = '';
  const mockFetcher = async (url) => {
    capturedUrl = url;
    return {
      ok: true,
      text: async () => `<rss><channel>${SAMPLE_ITEM}</channel></rss>`,
    };
  };
  const events = await fetchGdacsRss(mockFetcher);
  assert.ok(capturedUrl.includes('gdacs.org'));
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'TC');
});

test('fetchGdacsRss: throws on non-200 response', async () => {
  await assert.rejects(() => fetchGdacsRss(fetchGdacs503), /GDACS RSS HTTP 503/);
});

test('fetchGdacsRss: returns empty array for empty RSS feed', async () => {
  const events = await fetchGdacsRss(fetchGdacsEmpty);
  assert.deepEqual(events, []);
});
