import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, ROOT), 'utf8');
}

test('grid intelligence consumes exact-county Lifelines ODIN events without polling the old outage route', async () => {
  const [loader, logisticsPanel] = await Promise.all([
    source('src/services/infrastructure/grid-intelligence-loader.ts'),
    source('src/components/LocalLogisticsPanel.ts'),
  ]);
  assert.match(loader, /ACTIVE_LOCAL_LOGISTICS_SNAPSHOT_EVENT = 'wm:active-local-logistics-snapshot-updated'/);
  assert.match(loader, /addEventListener\(ACTIVE_LOCAL_LOGISTICS_SNAPSHOT_EVENT, onLifelineSnapshot\)/);
  assert.match(loader, /const now = Date\.now\(\);\s*\n\s*const detail = .*?\.detail;/);
  assert.match(loader, /const snapshot = exactCachedSnapshotForEvent\(detail, options\.getActivePlaceId\(\)\)/);
  assert.match(loader, /const summary = buildOutageSummary\(snapshot, now\)/);
  assert.match(loader, /candidateValue\.queryFingerprint === cached\.queryFingerprint/);
  assert.match(loader, /candidateValue\.countyFips === cached\.countyFips/);
  assert.doesNotMatch(loader, /['"]wm:local-logistics-updated['"]/);
  assert.doesNotMatch(loader, /fetchJson\('\/api\/infrastructure\/outages'\)/);
  assert.match(loader, /removeEventListener\(ACTIVE_LOCAL_LOGISTICS_SNAPSHOT_EVENT, onLifelineSnapshot\)/);
  assert.match(logisticsPanel, /this\.snapshot = snapshot;[\s\S]*?dispatchEvent\(new CustomEvent\('wm:active-local-logistics-snapshot-updated',[\s\S]*?detail: \{ snapshot: this\.snapshot \}/);
});

test('grid outage context is bound to explicit active selection, exact cache, and teardown', async () => {
  const [loader, logisticsPanel, panelLayout] = await Promise.all([
    source('src/services/infrastructure/grid-intelligence-loader.ts'),
    source('src/components/LocalLogisticsPanel.ts'),
    source('src/app/panel-layout.ts'),
  ]);
  assert.match(loader, /LOCAL_LOGISTICS_ACTIVE_PLACE_EVENT = 'wm:local-logistics-active-place-changed'/);
  assert.match(loader, /getCachedLocalLogistics\(place\)/);
  assert.doesNotMatch(loader, /getCachedLocalLogistics\(placeId\)/);
  assert.match(loader, /selectActiveOutageSummary\(/);
  assert.match(loader, /latestOutageSummary = resetActiveOutageSummary\(\s*\n\s*exactCachedOutageSummary\(activeId, now\), activeId, now/);
  assert.match(loader, /addEventListener\(LOCAL_LOGISTICS_ACTIVE_PLACE_EVENT, onActivePlaceChanged\)/);
  assert.match(loader, /removeEventListener\(LOCAL_LOGISTICS_ACTIVE_PLACE_EVENT, onActivePlaceChanged\)/);
  assert.match(logisticsPanel, /new CustomEvent\('wm:local-logistics-active-place-changed',\s*\{\s*\n\s*detail: \{ placeId: this\.getActivePlaceId\(\) \}/);
  assert.match(panelLayout, /startGridIntelligenceLoader\(gridIntelPanel, \{\s*\n\s*getActivePlaceId: \(\) => localLogisticsPanel\?\.getActivePlaceId\(\) \?\? null/);
  assert.match(panelLayout, /this\.gridIntelligenceLoader\?\.stop\(\);\s*\n\s*this\.gridIntelligenceLoader = null/);
  assert.match(loader, /let stopped = false/);
  assert.match(loader, /controllers\[source\]\?\.abort\(\)/);
  assert.match(loader, /generations\[source\] === generation/);
  assert.match(loader, /if \(stopped\) return;/);
});

test('grid outage UI names ODIN and states the unknown/zero/facility limits', async () => {
  const panel = await source('src/components/GridIntelligencePanel.ts');
  assert.match(panel, /ORNL ODIN · exact-county reports/);
  assert.match(panel, /Empty, missing, or expired ODIN data is not an all-clear\./);
  assert.match(panel, /Reported zero is preserved, but it is not a countywide all-clear\./);
  assert.match(panel, /reportedCustomersOut === 0\s*\n\s*\? 'reported zero'/);
  assert.match(panel, /reportedCustomersOut === 0\s*\n\s*\? 'color-mix\(in srgb, var\(--text-tertiary\) 14%, transparent\)'/);
  assert.match(panel, /does not establish power at any facility\./);
  assert.doesNotMatch(panel, /compareToPrev|report total (?:increased|decreased|unchanged)/);
  assert.doesNotMatch(panel, /customers affected nationally|No active outages reported nationally|PowerOutage\.us/);
});

test('grid BGP and radiation UI distinguishes unknown, reported empty, and known background evidence', async () => {
  const [panel, loader] = await Promise.all([
    source('src/components/GridIntelligencePanel.ts'),
    source('src/services/infrastructure/grid-intelligence-loader.ts'),
  ]);
  const alertCountBlock = panel.slice(
    panel.indexOf('private computeAlertCount()'),
    panel.indexOf('private renderTabStrip()'),
  );
  assert.match(panel, /BGP coverage unknown\./);
  assert.match(panel, /reported 0 BGP hijack events in its latest 24-hour query/);
  assert.match(panel, /Reported zero is preserved, but it is not proof that internet connectivity is healthy\./);
  assert.match(panel, /Radiation coverage unknown\./);
  assert.match(panel, /reported 0 valid station readings in its latest response/);
  assert.match(panel, /not evidence that radiation is within background/);
  assert.match(panel, /valid readings in this reported response were below the configured alert threshold/);
  assert.doesNotMatch(panel, /No BGP hijack events in the last 24h|All stations within background/);
  assert.match(loader, /if \(data\.keyMissing === true\)/);
  assert.match(loader, /data\.coverage !== 'reported'/);
  assert.match(loader, /acceptedRows !== data\.events\.length/);
  assert.match(loader, /acceptedRows !== data\.stations\.length/);
  assert.match(panel, /countActiveBgpAlerts\(this\.bgp, Date\.now\(\)\)/);
  assert.doesNotMatch(panel, /countActiveGridDeficits|status === 'deficit'|status === 'surplus'/);
  assert.doesNotMatch(alertCountBlock, /this\.grid|demandMwh|generationMwh/);
  assert.match(panel, /Differences do not establish shortage, surplus, or import\/export direction/);
  assert.match(panel, /Power-grid evidence stale\.[\s\S]*?demand and net-generation observations are unknown/);
  assert.doesNotMatch(panel, /coverage === 'reported' \? this\.bgp\.(?:criticalCount|elevatedCount)/);
  assert.match(panel, /BGP evidence stale\.[\s\S]*?Active-event status is unknown/);
  assert.match(panel, /activeAlerts\.critical[\s\S]*?active critical[\s\S]*?activeAlerts\.elevated[\s\S]*?active elevated/);
  assert.match(panel, /countActiveRadiationAlerts\(this\.radiation, Date\.now\(\)\)/);
  assert.match(panel, /Radiation evidence stale\.[\s\S]*?Current background and alert conditions are unknown/);
  assert.match(loader, /const overlayNow = Date\.now\(\);[\s\S]*?bgpBanner: bgpToBanner\(bgp, overlayNow\)/);
  assert.match(loader, /radiationHotspots: radiationToHotspots\(radiation, overlayNow\)/);
});

test('active grid diagnostics use one ODIN entry and no PowerOutage.us entry', async () => {
  const catalog = await source('src/services/diagnostics/feed-catalog.ts');
  const smoke = await source('src/services/diagnostics/self-test-runner.ts');
  assert.equal((catalog.match(/id: 'ornl-odin'/g) ?? []).length, 1);
  assert.doesNotMatch(catalog, /id: 'poweroutage-us'|name: 'PowerOutage\.us'/);
  assert.match(smoke, /infrastructure:\s*\['eia-930', 'ornl-odin', 'cloudflare-bgp'\]/);
});

test('globe heatmap does not turn county-only ODIN context into an unlabelled point', async () => {
  const heatmap = await source('src/components/globe/GlobeHeatmapRenderer.ts');
  assert.match(heatmap, /infrastructure:\s*async \(\) => \[\]/);
  assert.match(heatmap, /would imply facility\s*\n\s*\/\/ or statewide coverage/);
  assert.match(heatmap, /never means power is on/);
  assert.doesNotMatch(heatmap, /api\/infrastructure\/outages/);
});

test('active infrastructure playbook uses scoped, unexpired ODIN report language', async () => {
  const playbooks = await source('src/services/intelligence/operational-playbooks.ts');
  assert.match(playbooks, /Accepted, unexpired ORNL ODIN reports > 50k customers out for the active saved-place county/);
  assert.doesNotMatch(playbooks, /PowerOutage\.us/);
});

test('infrastructure risk matrix makes national power unknown and performs no unsupported power fetch', async () => {
  const service = await source('src/services/infrarisks/infra-risk-service.ts');
  const panel = await source('src/components/InfraRiskMatrixPanel.ts');
  const sidecar = await source('src-tauri/sidecar/local-api-server.mjs');
  assert.match(service, /coverage: 'unknown'/);
  assert.match(service, /not included in composite/);
  assert.doesNotMatch(service, /\$\{baseUrl\}\/power|PowerOutage\.us|poweroutage\.us/);
  assert.match(panel, /Missing coverage is not an all-clear and does not mean power is on\./);
  assert.match(panel, /Power: unknown\/excluded/);
  assert.doesNotMatch(panel, /PowerOutage\.us|poweroutage\.us/);
  assert.match(sidecar, /no_supported_national_feed/);
  assert.doesNotMatch(sidecar, /api\/infrastructure\/outages|api\/infrarisks\/power|poweroutage\.us/i);
});
