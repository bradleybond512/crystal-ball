import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const panelsSrc = readFileSync(resolve(root, 'src/config/panels.ts'), 'utf8');
const panelLayoutSrc = readFileSync(resolve(root, 'src/app/panel-layout.ts'), 'utf8');
const placeBriefsSrc = readFileSync(resolve(root, 'src/services/place-briefs.ts'), 'utf8');
const componentsIndexSrc = readFileSync(resolve(root, 'src/components/index.ts'), 'utf8');
const localLogisticsPanelPath = resolve(root, 'src/components/LocalLogisticsPanel.ts');
const lifelineExpiryPath = resolve(root, 'src/components/lifeline-evidence-expiry.ts');
const localLogisticsServicePath = resolve(root, 'src/services/local-logistics.ts');
const offlineCachePath = resolve(root, 'src/services/offline-alert-cache.ts');
const localLogisticsRoutePath = resolve(root, 'api/local-logistics.js');

const localLogisticsPanelSrc = existsSync(localLogisticsPanelPath)
  ? readFileSync(localLogisticsPanelPath, 'utf8')
  : '';
const localLogisticsServiceSrc = existsSync(localLogisticsServicePath)
  ? readFileSync(localLogisticsServicePath, 'utf8')
  : '';
const offlineCacheSrc = existsSync(offlineCachePath)
  ? readFileSync(offlineCachePath, 'utf8')
  : '';
const localLogisticsRouteSrc = existsSync(localLogisticsRoutePath)
  ? readFileSync(localLogisticsRoutePath, 'utf8')
  : '';

test('registers Disaster Lifelines under the stable local-logistics panel id', () => {
  assert.match(
 panelsSrc,
 /'local-logistics':\s*\{[^}]*name:\s*'Disaster Lifelines'[^}]*enabled:\s*true[^}]*\}/,
  );
});

test('creates a local logistics panel and exports it', () => {
  assert.equal(existsSync(localLogisticsPanelPath), true, 'LocalLogisticsPanel should exist');
  assert.match(localLogisticsPanelSrc, /export class LocalLogisticsPanel extends Panel/);
  assert.match(componentsIndexSrc, /export \* from '\.\/LocalLogisticsPanel';/);
});

test('wires local logistics into panel layout and place focus', () => {
  assert.match(panelLayoutSrc, /new LocalLogisticsPanel\(/);
  assert.match(panelLayoutSrc, /this\.ctx\.panels\['local-logistics'\]\s*=\s*localLogisticsPanel/);
  assert.match(panelLayoutSrc, /localLogisticsPanel\?\.setPlaceId\(placeId\)/);
});

test('service fetches through the local route and uses offline cache', () => {
  assert.equal(existsSync(localLogisticsServicePath), true, 'local logistics service should exist');
  assert.match(localLogisticsServiceSrc, /\/api\/local-logistics/);
  assert.match(localLogisticsServiceSrc, /writeOfflineCacheEntry|withOfflineCache|readOfflineCacheEntry/);
});

test('renders Disaster Lifelines with independent truthful state and accessible actions', () => {
  assert.match(localLogisticsPanelSrc, /title:\s*'Disaster Lifelines'/);
  assert.match(localLogisticsPanelSrc, /Operational/);
  assert.match(localLogisticsPanelSrc, /Inventory/);
  assert.match(localLogisticsPanelSrc, /Power/);
  assert.match(localLogisticsPanelSrc, /Access/);
  assert.match(localLogisticsPanelSrc, /Directory listing only/);
  assert.match(localLogisticsPanelSrc, /data-logistics-focus/);
  assert.match(localLogisticsPanelSrc, /data-logistics-source/);
  assert.match(localLogisticsPanelSrc, /data-logistics-map/);
  assert.match(localLogisticsPanelSrc, /data-logistics-route/);
  assert.match(localLogisticsPanelSrc, /await planRoute\(/);
  assert.match(localLogisticsPanelSrc, /wm:show-evac-route/);
  assert.match(localLogisticsPanelSrc, /getEvacRouteDisclosure\(\)/);
  assert.match(localLogisticsPanelSrc, /routeGeneration/);
  assert.match(localLogisticsPanelSrc, /deleteRoute\(route\.id\)/);
  assert.match(localLogisticsPanelSrc, /wm:show-lifelines-overlay/);
  assert.match(localLogisticsPanelSrc, /snapshot\.placeId\s*!==\s*this\.activePlaceId/);
  assert.match(localLogisticsPanelSrc, /Offline Lifelines:/);
  assert.match(localLogisticsPanelSrc, /Recent evidence change \(review-only\)/);
  assert.match(localLogisticsPanelSrc, /aria-pressed=/);
  assert.match(localLogisticsPanelSrc, /wm:lifeline-situation-updated/);
  assert.match(localLogisticsPanelSrc, /removeEventListener\('wm:lifeline-situation-updated'/);
  assert.doesNotMatch(localLogisticsPanelSrc, /<button[^>]*>[\s\S]*?<a\s/);
});

test('service uses schema-v2 query fingerprints, coalescing, and outage context', () => {
  assert.match(localLogisticsServiceSrc, /schemaVersion:\s*2/);
  assert.match(localLogisticsServiceSrc, /queryFingerprint/);
  assert.match(localLogisticsServiceSrc, /inFlight/);
  assert.match(localLogisticsServiceSrc, /\/api\/grid-outages/);
  assert.match(localLogisticsServiceSrc, /isExpired/);
});

test('offline Lifelines persistence is observable and the latest pointer follows only a proven exact write', () => {
  assert.match(offlineCacheSrc, /export function writeOfflineCacheEntry<T>[\s\S]{0,180}: boolean/);
  assert.match(offlineCacheSrc, /getItem\(storageKey\(serviceId\)\) === serialized/);
  assert.match(
    localLogisticsServiceSrc,
    /function commitLocalLogisticsSnapshot\([\s\S]{0,700}const exactPersisted = writeOfflineCacheEntry\(key, serialized\);[\s\S]{0,160}if \(exactPersisted\)[\s\S]{0,120}writeOfflineCacheEntry\(latestKey\(placeId\)/,
  );
});

test('panel renders the effective query radius and never broad-falls back across fingerprints', () => {
  assert.match(localLogisticsPanelSrc, /snapshot\.effectiveRadiusKm/);
  assert.doesNotMatch(localLogisticsPanelSrc, /catch\s*\([^)]*\)\s*\{[\s\S]{0,300}getCachedLocalLogistics/);
});

test('panel ignores superseded async refresh completions', () => {
  assert.match(localLogisticsPanelSrc, /refreshGeneration/);
  assert.match(localLogisticsPanelSrc, /requestMatchesCurrentState/);
  assert.match(localLogisticsPanelSrc, /generation\s*===\s*this\.refreshGeneration/);
  assert.match(localLogisticsPanelSrc, /expectedPlaceGeneration\s*===\s*this\.placeGeneration/);
  assert.match(localLogisticsPanelSrc, /this\.activePlaceId\s*===\s*place\.id/);
  assert.match(localLogisticsPanelSrc, /this\.activeRadiusKm\s*===\s*requestedRadiusKm/);
  assert.match(localLogisticsPanelSrc, /expectedFingerprint/);
});

test('same-place refresh clears the prior map snapshot before requesting replacement evidence', () => {
  assert.match(
    localLogisticsPanelSrc,
    /public async refresh[\s\S]*const priorSnapshot = this\.snapshot;[\s\S]*requestOverlayClear\(priorSnapshot\)[\s\S]*this\.snapshot = null;[\s\S]*await this\.fetchSnapshot\(place, \{ radiusKm: requestedRadiusKm \}\)/,
  );
});

test('same-ID reselection clears the exact prior overlay before snapshot and expiry ownership are dropped', () => {
  const setPlaceBlock = localLogisticsPanelSrc.slice(
    localLogisticsPanelSrc.indexOf('public setPlaceId('),
    localLogisticsPanelSrc.indexOf('/** Selected place context'),
  );
  assert.match(
    setPlaceBlock,
    /const priorSnapshot = this\.snapshot;[\s\S]*if \(priorSnapshot\) this\.requestOverlayClear\(priorSnapshot\);[\s\S]*evidenceExpiryScheduler\.track\(null\);[\s\S]*this\.snapshot = null;[\s\S]*void this\.refresh\(\);/,
  );
  assert.doesNotMatch(setPlaceBlock, /activePlaceId\s*!==\s*priorPlaceId/);
});

test('accepted evidence schedules a bounded exact-place expiry transition and tears it down', () => {
  assert.equal(existsSync(lifelineExpiryPath), true, 'Lifeline expiry scheduler should exist');
  assert.match(localLogisticsPanelSrc, /new LifelineEvidenceExpiryScheduler\(/);
  assert.match(localLogisticsPanelSrc, /evidenceExpiryScheduler\.track\(null\)/);
  assert.match(localLogisticsPanelSrc, /evidenceExpiryScheduler\.track\(snapshot\)/);
  assert.match(localLogisticsPanelSrc, /evidenceExpiryScheduler\.destroy\(\)/);
  assert.match(localLogisticsPanelSrc, /node\.expiresAt\.getTime\(\) <= Date\.now\(\) \? 'unknown'/);
  assert.match(localLogisticsPanelSrc, /condition\.expiresAt\.getTime\(\) > Date\.now\(\)/);
  assert.match(
    localLogisticsPanelSrc,
    /transitionExpiredEvidence[\s\S]{0,1500}this\.snapshot === snapshot[\s\S]{0,800}renderAtExpiry:\s*\(\) => this\.render\(\)[\s\S]{0,300}clearExactOverlay:[\s\S]{0,300}requestOverlayClear\(snapshot\)[\s\S]{0,500}'wm:local-logistics-updated'/,
  );
});

test('place briefs fold cached local logistics items into the saved-place brief', () => {
  assert.match(placeBriefsSrc, /buildLocalLogisticsBriefItems|getCachedLocalLogistics/);
});

test('place briefs request the exact current-place lifelines fingerprint', () => {
  assert.match(placeBriefsSrc, /getCachedLocalLogistics\(place\)/);
  assert.doesNotMatch(placeBriefsSrc, /getCachedLocalLogistics\(place\.id\)/);
  assert.match(localLogisticsServiceSrc, /typeof placeOrId === 'string'/);
  assert.match(localLogisticsServiceSrc, /buildLocalLogisticsFingerprint\(\s*placeOrId/);
});

test('route exists and queries OSM/Overpass with a timeout', () => {
  assert.equal(existsSync(localLogisticsRoutePath), true, 'local logistics route should exist');
  assert.match(localLogisticsRouteSrc, /overpass|openstreetmap/i);
  assert.match(localLogisticsRouteSrc, /AbortController|signal/);
});
