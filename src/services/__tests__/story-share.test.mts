import assert from 'node:assert/strict';
import test from 'node:test';
import type { StoryData } from '../story-data';
import {
  generateStoryDeepLink,
  getShareUrls,
  isPublicStorySharingEnabled,
  shareTexts,
} from '../story-share';

const story: StoryData = {
  countryCode: 'US', countryName: 'United States', cii: null, news: [],
  theater: null, markets: [], convergence: null,
  threats: { critical: 0, high: 0, medium: 0, categories: [] },
  signals: { protests: 0, militaryFlights: 0, militaryVessels: 0, outages: 0, gpsJammingHexes: 0 },
};

test('public story links default off without an alternate public host', () => {
  assert.equal(isPublicStorySharingEnabled(), false);
  assert.equal(generateStoryDeepLink('US'), null);
  assert.equal(generateStoryDeepLink('US', 'brief', 50, 'high'), null);
  assert.deepEqual(getShareUrls(story), {});
});

test('share text does not advertise a retired public link or a null link', () => {
  for (const format of Object.values(shareTexts)) {
    const text = format(story);
    assert.doesNotMatch(text, /crystalball[.]app|https?:\/\/|\bnull\b/i);
  }
});
