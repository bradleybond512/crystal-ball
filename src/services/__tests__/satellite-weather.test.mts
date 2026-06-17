import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gibsHourTimestamp,
  getGoesWmsTileUrl,
  getHimawariTileUrl,
} from '../satellite-weather.ts';

const FIXED = new Date('2026-06-17T04:33:10Z');

test('gibsHourTimestamp floors to the current top-of-hour UTC', () => {
  assert.equal(gibsHourTimestamp(0, FIXED), '2026-06-17T04:00:00Z');
});

test('gibsHourTimestamp steps back whole hours and rolls the date', () => {
  assert.equal(gibsHourTimestamp(1, FIXED), '2026-06-17T03:00:00Z');
  assert.equal(gibsHourTimestamp(5, FIXED), '2026-06-16T23:00:00Z');
});

test('gibsHourTimestamp emits no millisecond component', () => {
  assert.match(gibsHourTimestamp(0, FIXED), /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/);
});

test('getGoesWmsTileUrl injects the TIME segment between style and TileMatrixSet', () => {
  const url = getGoesWmsTileUrl('geocolor', 1);
  // The bug was a missing TIME segment: default/GoogleMapsCompatible_Level7.
  assert.doesNotMatch(url, /default\/GoogleMapsCompatible_Level7/);
  assert.match(
    url,
    /GOES-East_ABI_GeoColor\/default\/\d{4}-\d{2}-\d{2}T\d{2}:00:00Z\/GoogleMapsCompatible_Level7\/\{z\}\/\{y\}\/\{x\}\.png$/,
  );
});

test('getGoesWmsTileUrl maps each product to its GIBS layer', () => {
  assert.match(getGoesWmsTileUrl('infrared'), /GOES-East_ABI_Band13_Clean_Infrared/);
  assert.match(getGoesWmsTileUrl('water_vapor'), /GOES-East_ABI_Band8_Upper-Level_Water_Vapor/);
  assert.match(getGoesWmsTileUrl('visible'), /GOES-East_ABI_Band2_Red_Visible_1km/);
});

test('getHimawariTileUrl also carries a TIME segment', () => {
  const url = getHimawariTileUrl();
  assert.doesNotMatch(url, /default\/GoogleMapsCompatible_Level7/);
  assert.match(url, /Himawari_AHI_Band3_Red_Visible_1km\/default\/\d{4}-\d{2}-\d{2}T\d{2}:00:00Z\//);
});
