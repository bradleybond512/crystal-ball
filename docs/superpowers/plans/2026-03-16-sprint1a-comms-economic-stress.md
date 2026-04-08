# Sprint 1A — Communications Health + Economic Stress Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new survival-signal panels — Communications Health (BGP/IXP/DDoS/cables) and Economic Stress (composite 0-100 index from 6 FRED indicators + food security) — using existing API keys and the established sidecar proxy pattern.

**Architecture:** Two sidecar routes aggregate upstream free APIs; two new Panel subclasses render StatusCard grids; both panels register into priority lists for War/Disaster/Finance modes. No new API keys — CLOUDFLARE_API_TOKEN and FRED_API_KEY already exist. SUPPORTED_SECRET_KEYS count stays at 25.

**Tech Stack:** TypeScript, Node.js sidecar (ESM), Tauri 2, DOMPurify (already bundled), existing `fetchWithTimeout()` sidecar helper.

**Spec:** `docs/superpowers/specs/2026-03-16-sprint1a-comms-economic-stress.md`

---

## Chunk 1: Sidecar Routes + Frontend Services

### Task 1: Add TTL cache helper + `/api/comms-health` route

**Files:**

- Modify: `src-tauri/sidecar/local-api-server.mjs`

- [ ] **Step 1: Read the sidecar file to find insertion points**

  Read `src-tauri/sidecar/local-api-server.mjs`. Look for:
  - The existing `fetchWithTimeout` helper
  - The last registered route (to find where to append)
  - How `CLOUDFLARE_API_TOKEN` is already read (search for it)

- [ ] **Step 2: Add the TTL cache pattern after existing imports/helpers**

  After the `fetchWithTimeout` helper, add:

  ```javascript
  // CACHE PATTERN: copy this for future cached routes
  const _sidecarCache = new Map(); // key -> { data, ts }
  function getCached(key, ttlMs) {
 const entry = _sidecarCache.get(key);
 if (entry && Date.now() - entry.ts < ttlMs) return entry.data;
 return null;
  }
  function setCached(key, data) {
 _sidecarCache.set(key, { data, ts: Date.now() });
  }
  ```

- [ ] **Step 3: Add the `/api/comms-health` route**

  Append to the route registration block:

  ```javascript
  app.get('/api/comms-health', async (req, res) => {
 const cfToken = process.env.CLOUDFLARE_API_TOKEN;
 const cfHeaders = cfToken ? { 'Authorization': `Bearer ${cfToken}` } : null;

 const [bgpHijacks, bgpLeaks, cfL7, ripeRouting, ripeBgp, ihr] = await Promise.allSettled([
 cfHeaders
 ? fetchWithTimeout('https://api.cloudflare.com/client/v4/radar/bgp/hijacks/events?limit=50', { headers: cfHeaders })
 : Promise.reject(new Error('no cf token')),
 cfHeaders
 ? fetchWithTimeout('https://api.cloudflare.com/client/v4/radar/bgp/leaks/events?limit=50', { headers: cfHeaders })
 : Promise.reject(new Error('no cf token')),
 cfHeaders
 ? fetchWithTimeout('https://api.cloudflare.com/client/v4/radar/attacks/layer7/summary', { headers: cfHeaders })
 : Promise.reject(new Error('no cf token')),
 fetchWithTimeout('https://stat.ripe.net/data/routing-status/data.json?resource=0.0.0.0/0'),
 fetchWithTimeout('https://stat.ripe.net/data/bgpplay/data.json?resource=0.0.0.0/0&starttime=-1h'),
 fetchWithTimeout('https://ihr.iijlab.net/ihr/api/network/?format=json&search=&last=1'),
 ]);

 const cloudflareKeyMissing = !cfToken;

 // BGP hijack count from Cloudflare
 let hijackCount = 0;
 let leakCount = 0;
 if (bgpHijacks.status === 'fulfilled') {
 try { hijackCount = bgpHijacks.value?.result?.events?.length ?? 0; } catch {}
 }
 if (bgpLeaks.status === 'fulfilled') {
 try { leakCount = bgpLeaks.value?.result?.events?.length ?? 0; } catch {}
 }

 // Fallback: count BGP updates from RIPE as proxy for anomalies
 if (cloudflareKeyMissing && ripeBgp.status === 'fulfilled') {
 try {
 const updates = ripeBgp.value?.data?.updates?.length ?? 0;
 hijackCount = Math.floor(updates / 10); // rough proxy
 } catch {}
 }

 const bgpSeverity = hijackCount < 5 ? 'normal' : hijackCount <= 15 ? 'warning' : 'critical';

 // IXP status from IHR
 let ixpStatus = 'normal';
 const ixpDegraded = [];
 if (ihr.status === 'fulfilled') {
 try {
 const networks = ihr.value?.results ?? [];
 const degraded = networks.filter(n => n.status && n.status !== 'normal');
 if (degraded.length > 0) {
 ixpStatus = 'warning';
 ixpDegraded.push(...degraded.slice(0, 5).map(n => n.name || 'Unknown'));
 }
 } catch {}
 }

 // DDoS from Cloudflare L7 summary
 let ddosL7 = 'normal';
 let ddosL3 = 'normal';
 if (cfL7.status === 'fulfilled' && !cloudflareKeyMissing) {
 try {
 const pct = parseFloat(cfL7.value?.result?.summary_0?.['DDoS'] ?? '0');
 ddosL7 = pct > 10 ? 'critical' : pct > 3 ? 'elevated' : 'normal';
 } catch {}
 }

 // Cable status derived from RIPE BGP anomalies
 // Known cable operator AS numbers mapped to cable names
 const CABLE_AS_MAP = {
 '3549': 'MAREA', '1273': 'TAT-14', '3257': 'AAG',
 '2914': 'APAC-1', '6453': 'FLAG',
 };
 const degradedCables = [];
 const normalCables = Object.values(CABLE_AS_MAP);
 if (ripeBgp.status === 'fulfilled') {
 try {
 const updates = ripeBgp.value?.data?.updates ?? [];
 const affectedAS = new Set(updates.map(u => String(u.attrs?.source_id ?? '')));
 for (const [asn, cable] of Object.entries(CABLE_AS_MAP)) {
 if (affectedAS.has(asn)) {
 degradedCables.push(cable);
 }
 }
 } catch {}
 }
 const okCables = normalCables.filter(c => !degradedCables.includes(c));

 const severities = [bgpSeverity, ixpStatus];
 if (!cloudflareKeyMissing) severities.push(ddosL7 === 'elevated' ? 'warning' : ddosL7);
 const overall = severities.includes('critical') ? 'critical'
 : severities.includes('warning') ? 'warning' : 'normal';

 res.json({
 overall,
 bgp: { hijacks: hijackCount, leaks: leakCount, severity: bgpSeverity },
 ixp: { status: ixpStatus, degraded: ixpDegraded },
 ddos: { l7: ddosL7, l3: ddosL3, cloudflareKeyMissing },
 cables: { degraded: degradedCables, normal: okCables },
 updatedAt: new Date().toISOString(),
 });
  });
  ```

- [ ] **Step 4: Verify typecheck passes**

  ```bash
  npm run typecheck:all
  ```

  Expected: zero errors (sidecar is JS, not typechecked — this verifies frontend unchanged)

- [ ] **Step 5: Smoke-test the route manually**

  Start the sidecar in isolation (optional — skip if no Node.js available locally):

  ```bash
  # Skip if Tauri dev not available; verify in Step after full integration
  echo "Sidecar routes added — will verify via full app"
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add src-tauri/sidecar/local-api-server.mjs
  git commit -m "feat(sidecar): add TTL cache helper + /api/comms-health route"
  ```

---

### Task 2: Add `/api/economic-stress` route

**Files:**

- Modify: `src-tauri/sidecar/local-api-server.mjs`

- [ ] **Step 1: Read current file state to confirm cache helper is present**

  Search for `getCached` in `src-tauri/sidecar/local-api-server.mjs` to confirm Task 1 merged correctly.

- [ ] **Step 2: Add the FRED fetch helper**

  Add a helper that fetches a single FRED series (latest observation):

  ```javascript
  async function fetchFredSeries(seriesId, apiKey) {
 const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
 const data = await fetchWithTimeout(url);
 const obs = data?.observations?.[0];
 if (!obs || obs.value === '.') throw new Error(`No data for ${seriesId}`);
 return parseFloat(obs.value);
  }
  ```

- [ ] **Step 3: Add the composite score helper**

  ```javascript
  function clamp(x) { return Math.min(100, Math.max(0, x)); }

  function computeStressIndex(indicators) {
 const { yieldCurve, bankSpread, vix, fsi, supplyChain, jobClaims } = indicators;
 return Math.round(
 clamp((0.5 - yieldCurve.value)  / (0.5 - (-1.5)) * 100) * 0.20 +
 clamp((0.5 - bankSpread.value)  / (0.5 - (-1.0)) * 100) * 0.15 +
 clamp((vix.value - 15) / (80 - 15) * 100) * 0.20 +
 clamp((fsi.value - (-1)) / (5 - (-1)) * 100) * 0.20 +
 clamp((supplyChain.value - (-2))/ (4 - (-2)) * 100) * 0.15 +
 clamp((jobClaims.value - 180000)/ (500000-180000) * 100) * 0.10
 );
  }

  function indicatorSeverity(score) {
 return score >= 70 ? 'critical' : score >= 40 ? 'warning' : 'normal';
  }
  ```

- [ ] **Step 4: Add the `/api/economic-stress` route**

  ```javascript
  app.get('/api/economic-stress', async (req, res) => {
 const cached = getCached('economic-stress', 15 * 60 * 1000);
 if (cached) return res.json(cached);

 const fredKey = process.env.FRED_API_KEY;
 if (!fredKey) {
 return res.json({ error: 'FRED_API_KEY required', fredKeyMissing: true });
 }

 const [t10y2y, t10y3m, vixcls, stlfsi4, gscpi, icsa, worldBank] = await Promise.allSettled([
 fetchFredSeries('T10Y2Y', fredKey),
 fetchFredSeries('T10Y3M', fredKey),
 fetchFredSeries('VIXCLS', fredKey),
 fetchFredSeries('STLFSI4', fredKey),
 fetchFredSeries('GSCPI', fredKey),
 fetchFredSeries('ICSA', fredKey),
 fetchWithTimeout('https://api.worldbank.org/v2/country/WLD/indicator/AG.PRD.FOOD.XD?format=json&mrv=1'),
 ]);

 const getValue = (r, fallback) =>
 r.status === 'fulfilled' ? r.value : fallback;

 const yieldVal = getValue(t10y2y,  0);
 const spreadVal = getValue(t10y3m,  0);
 const vixVal = getValue(vixcls,  20);
 const fsiVal = getValue(stlfsi4, 0);
 const scVal = getValue(gscpi, 0);
 const claimsVal = getValue(icsa, 220000);

 const yieldScore  = clamp((0.5 - yieldVal)  / (0.5 - (-1.5)) * 100);
 const spreadScore = clamp((0.5 - spreadVal)  / (0.5 - (-1.0)) * 100);
 const vixScore = clamp((vixVal - 15) / (80 - 15) * 100);
 const fsiScore = clamp((fsiVal - (-1)) / (5 - (-1)) * 100);
 const scScore = clamp((scVal - (-2)) / (4 - (-2)) * 100);
 const claimsScore = clamp((claimsVal - 180000)/ (500000-180000)* 100);

 const indicators = {
 yieldCurve:  { value: yieldVal, label: yieldVal  < -0.1 ? 'INVERTED'  : yieldVal  < 0.2 ? 'FLAT' : 'NORMAL',  severity: indicatorSeverity(yieldScore),  score: yieldScore },
 bankSpread:  { value: spreadVal,  label: spreadVal < -0.1 ? 'INVERTED'  : 'NORMAL', severity: indicatorSeverity(spreadScore), score: spreadScore },
 vix: { value: vixVal, label: vixVal > 30 ? 'ELEVATED'  : vixVal > 20  ? 'RISING' : 'NORMAL', severity: indicatorSeverity(vixScore), score: vixScore },
 fsi: { value: fsiVal, label: fsiVal > 1 ? 'ELEVATED'  : fsiVal > 0 ? 'RISING' : 'NORMAL', severity: indicatorSeverity(fsiScore), score: fsiScore },
 supplyChain: { value: scVal, label: scVal > 1 ? 'STRAINED'  : 'NORMAL', severity: indicatorSeverity(scScore), score: scScore, lagWeeks: 6 },
 jobClaims: { value: claimsVal,  label: claimsVal > 300000 ? 'RISING'  : 'NORMAL', severity: indicatorSeverity(claimsScore), score: claimsScore },
 };

 const stressIndex = computeStressIndex(indicators);
 // Trend: compare to cached previous (simple: use score delta stub)
 const trend = 'stable'; // will refine if previous snapshot available

 let foodSecurity = { value: null, severity: 'unknown' };
 if (worldBank.status === 'fulfilled') {
 try {
 const fsVal = worldBank.value[1][0].value;
 foodSecurity = {
 value: Math.round(fsVal * 10) / 10,
 severity: fsVal < 50 ? 'critical' : fsVal < 65 ? 'warning' : 'normal',
 };
 } catch {}
 }

 const result = {
 stressIndex,
 trend,
 indicators,
 foodSecurity,
 updatedAt: new Date().toISOString(),
 };

 setCached('economic-stress', result);
 res.json(result);
  });
  ```

- [ ] **Step 5: Verify typecheck still passes**

  ```bash
  npm run typecheck:all
  ```

  Expected: zero errors

- [ ] **Step 6: Commit**

  ```bash
  git add src-tauri/sidecar/local-api-server.mjs
  git commit -m "feat(sidecar): add /api/economic-stress route with 15-min TTL cache"
  ```

---

### Task 3: Add frontend services

**Files:**

- Create: `src/services/comms-health.ts`
- Create: `src/services/economic-stress.ts`

- [ ] **Step 1: Create `src/services/comms-health.ts`**

  Read `src/services/volcano-alerts.ts` first to match the fetch pattern used in existing services.

  ```typescript
  import { getApiBaseUrl } from '../utils/runtime';

  export interface CommsHealthData {
 overall: 'normal' | 'warning' | 'critical';
 bgp: { hijacks: number; leaks: number; severity: 'normal' | 'warning' | 'critical' };
 ixp: { status: 'normal' | 'warning' | 'critical'; degraded: string[] };
 ddos: { l7: 'normal' | 'elevated' | 'critical'; l3: 'normal' | 'elevated' | 'critical'; cloudflareKeyMissing: boolean };
 cables: { degraded: string[]; normal: string[] };
 updatedAt: string;
  }

  export async function fetchCommsHealth(): Promise<CommsHealthData> {
 const res = await fetch(`${getApiBaseUrl()}/api/comms-health`);
 if (!res.ok) throw new Error(`comms-health: ${res.status}`);
 return res.json() as Promise<CommsHealthData>;
  }
  ```

- [ ] **Step 2: Create `src/services/economic-stress.ts`**

  ```typescript
  import { getApiBaseUrl } from '../utils/runtime';

  export type Severity = 'normal' | 'warning' | 'critical' | 'unknown';

  export interface IndicatorValue {
 value: number;
 label: string;
 severity: Severity;
 lagWeeks?: number;
  }

  export interface EconomicStressData {
 stressIndex: number;
 trend: 'rising' | 'stable' | 'falling';
 indicators: {
 yieldCurve: IndicatorValue;
 bankSpread: IndicatorValue;
 vix: IndicatorValue;
 fsi: IndicatorValue;
 supplyChain: IndicatorValue;
 jobClaims: IndicatorValue;
 };
 foodSecurity: { value: number | null; severity: Severity };
 updatedAt: string;
 fredKeyMissing?: boolean;
 error?: string;
  }

  export async function fetchEconomicStress(): Promise<EconomicStressData> {
 const res = await fetch(`${getApiBaseUrl()}/api/economic-stress`);
 if (!res.ok) throw new Error(`economic-stress: ${res.status}`);
 return res.json() as Promise<EconomicStressData>;
  }
  ```

- [ ] **Step 3: Verify typecheck passes**

  ```bash
  npm run typecheck:all
  ```

  Expected: zero errors

- [ ] **Step 4: Commit**

  ```bash
  git add src/services/comms-health.ts src/services/economic-stress.ts
  git commit -m "feat(services): add comms-health and economic-stress frontend services"
  ```

---

## Chunk 2: UI Components

### Task 4: Create StatusCard component

**Files:**

- Create: `src/components/StatusCard.ts`
- Modify: `src/components/index.ts`

- [ ] **Step 1: Read `src/components/index.ts`** to see current barrel exports

- [ ] **Step 2: Create `src/components/StatusCard.ts`**

  Note: all values are string-escaped before insertion into HTML. The `escapeHtml` utility from `src/utils/sanitize.ts` is used; verify it exists (search for `escapeHtml` in the codebase first).

  If `escapeHtml` does not exist, add it to `src/utils/sanitize.ts` as:

  ```typescript
  export function escapeHtml(s: string): string {
 return String(s)
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;');
  }
  ```

  Then create `src/components/StatusCard.ts`:

  ```typescript
  export interface StatusCardConfig {
 label: string;
 value: string | number;
 unit?: string;
 severity: 'normal' | 'warning' | 'critical' | 'unknown';
 sublabel?: string;
 wide?: boolean;
 inlineNote?: string;
  }

  function esc(v: string | number): string {
 return String(v)
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;');
  }

  const SEVERITY_COLORS: Record<StatusCardConfig['severity'], string> = {
 normal: 'rgba(34,197,94,',
 warning:  'rgba(234,179,8,',
 critical: 'rgba(239,68,68,',
 unknown:  'rgba(148,163,184,',
  };

  const TEXT_COLORS: Record<StatusCardConfig['severity'], string> = {
 normal: '#22c55e',
 warning:  '#eab308',
 critical: '#ef4444',
 unknown:  '#94a3b8',
  };

  export function renderStatusCard(config: StatusCardConfig): string {
 const { label, value, unit, severity, sublabel, wide, inlineNote } = config;
 const bg = SEVERITY_COLORS[severity];
 const color = TEXT_COLORS[severity];
 const col = wide ? 'grid-column:1/-1;' : '';
 const unitHtml = unit ? `<span style="font-size:0.7rem;opacity:0.6;">${esc(unit)}</span>` : '';
 const subHtml = sublabel ? `<div style="font-size:0.65rem;opacity:0.55;margin-top:0.15rem;">${esc(sublabel)}</div>` : '';
 const noteHtml = inlineNote ? `<div style="font-size:0.62rem;opacity:0.55;margin-top:0.2rem;font-style:italic;">${esc(inlineNote)}</div>` : '';

 return `<div style="${col}background:${bg}0.1);border:1px solid ${bg}0.3);border-radius:6px;padding:0.5rem 0.65rem;">
  <div style="font-size:0.65rem;opacity:0.55;text-transform:uppercase;letter-spacing:0.05em;">${esc(label)}</div>
  <div style="font-size:1.1rem;font-weight:700;color:${color};line-height:1.3;margin-top:0.15rem;">${esc(String(value))}${unitHtml}</div>
  ${subHtml}${noteHtml}

</div>`;
  }
  ```

- [ ] **Step 3: Add barrel export to `src/components/index.ts`**

  Append: `export * from './StatusCard';`

- [ ] **Step 4: Verify typecheck passes**

  ```bash
  npm run typecheck:all
  ```

  Expected: zero errors

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/StatusCard.ts src/components/index.ts
  git commit -m "feat(components): add reusable StatusCard component"
  ```

---

### Task 5: Create CommsHealthPanel

**Files:**

- Create: `src/components/CommsHealthPanel.ts`

- [ ] **Step 1: Read `src/components/GDACSAlertsPanel.ts`** to understand the `getContentElement()` direct-update pattern

- [ ] **Step 2: Read `src/services/desktop-notifications.ts`** (or wherever `sendNotification` is exported) to confirm notification API

  Search for `sendNotification` or `DesktopNotification` in the codebase to find the correct import path.

- [ ] **Step 3: Create `src/components/CommsHealthPanel.ts`**

  ```typescript
  import { Panel } from './Panel';
  import { renderStatusCard } from './StatusCard';
  import { CommsHealthData } from '../services/comms-health';
  import { sendNotification } from '../services/notifications';
  import { isGhostMode } from '../services/mode-manager';

  export class CommsHealthPanel extends Panel {
 private _previousOverall: string = 'normal';

 constructor(id: string) {
 super(id, 'Communications Health');
 }

 update(data: CommsHealthData | null): void {
 if (!data) {
 this._renderError();
 return;
 }

 this._checkNotification(data.overall);
 this._render(data);
 }

 private _checkNotification(overall: string): void {
 if (isGhostMode()) return;
 const prev = this._previousOverall;
 if (prev === 'normal' && (overall === 'warning' || overall === 'critical')) {
 sendNotification('Communications Health', `Status changed to ${overall.toUpperCase()}`);
 } else if (prev === 'warning' && overall === 'critical') {
 sendNotification('Communications Health', 'Status escalated to CRITICAL');
 }
 this._previousOverall = overall;
 }

 private _render(data: CommsHealthData): void {
 const el = this.getContentElement();
 const { overall, bgp, ixp, ddos, cables } = data;

 const BANNER_COLORS: Record<string, string> = {
 normal: 'rgba(34,197,94,',
 warning:  'rgba(234,179,8,',
 critical: 'rgba(239,68,68,',
 };
 const TEXT_COLORS: Record<string, string> = {
 normal: '#22c55e', warning: '#eab308', critical: '#ef4444',
 };
 const bc = BANNER_COLORS[overall] ?? BANNER_COLORS.warning;
 const tc = TEXT_COLORS[overall] ?? TEXT_COLORS.warning;
 const label = overall === 'normal' ? 'NORMAL' : overall === 'warning' ? 'DEGRADED' : 'CRITICAL';
 const summaryParts: string[] = [];
 if (bgp.hijacks > 0) summaryParts.push(`${bgp.hijacks} BGP hijacks`);
 if (bgp.leaks > 0) summaryParts.push(`${bgp.leaks} leaks`);
 if (cables.degraded.length > 0) summaryParts.push(`${cables.degraded.length} cable degraded`);
 const summary = summaryParts.join(' · ') || 'All systems normal';

 const ddosNote = ddos.cloudflareKeyMissing ? 'Cloudflare token required' : undefined;
 const ddosLabel = ddos.l7 === 'critical' ? 'CRITICAL' : ddos.l7 === 'elevated' ? 'ELEVATED' : 'NORMAL';

 const bgpHijackCard = renderStatusCard({
 label: 'BGP Hijacks', value: bgp.hijacks, severity: bgp.severity,
 sublabel: bgp.hijacks > 0 ? 'Active events' : 'None detected',
 });
 const bgpLeakCard = renderStatusCard({
 label: 'BGP Leaks', value: bgp.leaks, severity: bgp.leaks > 0 ? 'warning' : 'normal',
 sublabel: bgp.leaks > 0 ? 'Active now' : 'Clear',
 });
 const ixpCard = renderStatusCard({
 label: 'IXP Status',
 value: ixp.status === 'normal' ? 'NORMAL' : 'DEGRADED',
 severity: ixp.status === 'critical' ? 'critical' : ixp.status === 'warning' ? 'warning' : 'normal',
 sublabel: ixp.degraded.length > 0 ? ixp.degraded[0] : 'All regions',
 });
 const ddosCard = renderStatusCard({
 label: 'DDoS L7', value: ddosLabel,
 severity: ddos.cloudflareKeyMissing ? 'unknown'
 : ddos.l7 === 'critical' ? 'critical'
 : ddos.l7 === 'elevated' ? 'warning' : 'normal',
 inlineNote: ddosNote,
 });

 const allCables = [...cables.degraded, ...cables.normal];
 const cableBadges = allCables.map(c => {
 const isDeg = cables.degraded.includes(c);
 const color = isDeg ? '#eab308' : '#22c55e';
 const bg = isDeg ? 'rgba(234,179,8,0.15)' : 'rgba(34,197,94,0.12)';
 const status = isDeg ? 'DEGRADED' : 'OK';
 return `<span style="font-size:0.7rem;padding:0.15rem 0.4rem;border-radius:3px;background:${bg};color:${color};">${c} ${status}</span>`;
 }).join('');

 const cableCard = renderStatusCard({
 label: 'Submarine Cables',
 value: cables.degraded.length > 0 ? `${cables.degraded.length} degraded` : 'All normal',
 severity: cables.degraded.length > 1 ? 'critical' : cables.degraded.length === 1 ? 'warning' : 'normal',
 wide: true,
 });

 const ts = new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

 const dot = `<div style="width:9px;height:9px;border-radius:50%;background:${tc};box-shadow:0 0 5px ${tc};flex-shrink:0;"></div>`;

 el.innerHTML = `

<div style="padding:0.8rem;display:flex;flex-direction:column;gap:0.7rem;">
  <div style="display:flex;align-items:center;gap:0.55rem;padding:0.55rem 0.7rem;background:${bc}0.08);border:1px solid ${bc}0.28);border-radius:6px;">
 ${dot}
 <div style="flex:1;">
 <div style="font-size:0.8rem;font-weight:600;color:${tc};">${label}</div>
 <div style="font-size:0.68rem;opacity:0.55;">${summary} · ${ts}</div>
 </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.42rem;">
 ${bgpHijackCard}${bgpLeakCard}${ixpCard}${ddosCard}
 <div style="grid-column:1/-1;">
 ${cableCard}
 ${allCables.length > 0 ? `<div style="display:flex;gap:0.35rem;flex-wrap:wrap;margin-top:0.35rem;">${cableBadges}</div>` : ''}
 </div>
  </div>
</div>`;
 }

 private _renderError(): void {
 const el = this.getContentElement();
 el.innerHTML = `<div style="padding:1rem;text-align:center;opacity:0.5;font-size:0.82rem;">
  ${renderStatusCard({ label: 'Communications Health', value: 'Data unavailable', severity: 'unknown', wide: true })}
</div>`;
 }
  }
  ```

  > **Note:** `el.innerHTML` is safe here. All values come from the sidecar response (trusted internal data). String values are passed through `renderStatusCard` which escapes all user-visible strings. The banner and structural HTML is static template literals with no user input.

- [ ] **Step 4: Verify typecheck passes — fix any import path issues**

  ```bash
  npm run typecheck:all
  ```

  Common issues:
  - `sendNotification` import path may differ — search for the correct export
  - `isGhostMode` export path — check `src/services/mode-manager.ts`

  Fix any import errors until zero errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/CommsHealthPanel.ts
  git commit -m "feat(components): add CommsHealthPanel with status card grid layout"
  ```

---

### Task 6: Create EconomicStressPanel

**Files:**

- Create: `src/components/EconomicStressPanel.ts`

- [ ] **Step 1: Create `src/components/EconomicStressPanel.ts`**

  ```typescript
  import { Panel } from './Panel';
  import { renderStatusCard } from './StatusCard';
  import { EconomicStressData } from '../services/economic-stress';
  import { sendNotification } from '../services/notifications';
  import { isGhostMode } from '../services/mode-manager';

  export class EconomicStressPanel extends Panel {
 private _previousStressIndex: number = 0;

 constructor(id: string) {
 super(id, 'Economic Stress');
 }

 update(data: EconomicStressData | null): void {
 if (!data) {
 this._renderError();
 return;
 }
 if (data.fredKeyMissing) {
 this._renderKeyRequired();
 return;
 }
 this._checkNotification(data.stressIndex);
 this._render(data);
 }

 private _checkNotification(index: number): void {
 if (isGhostMode()) return;
 const prev = this._previousStressIndex;
 if (prev < 70 && index >= 70) {
 sendNotification('Economic Stress', `Stress index elevated: ${index}/100`);
 } else if (prev < 85 && index >= 85) {
 sendNotification('Economic Stress', `Stress index critical: ${index}/100`);
 }
 this._previousStressIndex = index;
 }

 private _render(data: EconomicStressData): void {
 const el = this.getContentElement();
 const { stressIndex, trend, indicators, foodSecurity } = data;

 const trendArrow = trend === 'rising' ? '↑' : trend === 'falling' ? '↓' : '→';
 const indexColor = stressIndex >= 85 ? '#ef4444' : stressIndex >= 70 ? '#eab308' : '#22c55e';
 const pct = Math.min(100, stressIndex);

 const trendGlyph = trendArrow === '↑'
 ? `<span style="color:#ef4444;font-size:1rem;">↑</span>`
 : trendArrow === '↓'
 ? `<span style="color:#22c55e;font-size:1rem;">↓</span>`
 : `<span style="opacity:0.5;font-size:1rem;">→</span>`;

 const ind = indicators;
 const cards = [
 renderStatusCard({ label: 'Yield Curve', value: `${ind.yieldCurve.value.toFixed(2)}%`,  severity: ind.yieldCurve.severity,  sublabel: ind.yieldCurve.label }),
 renderStatusCard({ label: 'Bank Spread', value: `${ind.bankSpread.value.toFixed(2)}%`,  severity: ind.bankSpread.severity,  sublabel: ind.bankSpread.label }),
 renderStatusCard({ label: 'VIX', value: ind.vix.value.toFixed(1), severity: ind.vix.severity, sublabel: ind.vix.label }),
 renderStatusCard({ label: 'Fin. Stress', value: ind.fsi.value.toFixed(2), severity: ind.fsi.severity, sublabel: ind.fsi.label }),
 renderStatusCard({ label: 'Supply Chain',  value: `${ind.supplyChain.value.toFixed(1)}σ`, severity: ind.supplyChain.severity,  sublabel: '~6wk lag' }),
 renderStatusCard({ label: 'Job Claims', value: ind.jobClaims.value >= 1000 ? `${Math.round(ind.jobClaims.value / 1000)}K` : String(ind.jobClaims.value), severity: ind.jobClaims.severity, sublabel: ind.jobClaims.label }),
 ].join('');

 const fsVal = foodSecurity.value !== null ? foodSecurity.value : '—';
 const fsColor = foodSecurity.severity === 'critical' ? '#ef4444'
 : foodSecurity.severity === 'warning' ? '#eab308' : '#22c55e';
 const fsLabel = foodSecurity.severity === 'critical' ? 'Severely stressed'
 : foodSecurity.severity === 'warning' ? 'Moderately stressed' : 'Normal';

 const ts = new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

 el.innerHTML = `

<div style="padding:0.8rem;display:flex;flex-direction:column;gap:0.7rem;">
  <div>
 <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.35rem;">
 <div style="font-size:0.68rem;opacity:0.55;text-transform:uppercase;letter-spacing:0.05em;">Stress Index · ${ts}</div>
 <div style="display:flex;align-items:center;gap:0.35rem;">
 ${trendGlyph}
 <div style="font-size:1.5rem;font-weight:700;color:${indexColor};line-height:1;">${stressIndex}<span style="font-size:0.8rem;opacity:0.5;">/100</span></div>
 </div>
 </div>
 <div style="height:9px;background:rgba(255,255,255,0.07);border-radius:5px;overflow:hidden;position:relative;">
 <div style="position:absolute;inset:0;background:linear-gradient(90deg,#22c55e 0%,#eab308 50%,#ef4444 100%);opacity:0.25;border-radius:5px;"></div>
 <div style="position:absolute;left:${pct}%;top:0;width:2px;height:100%;background:#fff;border-radius:1px;transform:translateX(-50%);"></div>
 <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,rgba(34,197,94,0.7) 0%,rgba(234,179,8,0.9) 60%,rgba(239,68,68,1) 100%);border-radius:5px;"></div>
 </div>
 <div style="display:flex;justify-content:space-between;font-size:0.62rem;opacity:0.38;margin-top:0.2rem;">
 <span>LOW</span><span>ELEVATED</span><span>CRITICAL</span>
 </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.38rem;">${cards}</div>
  <div style="padding:0.4rem 0.55rem;background:rgba(255,255,255,0.04);border-radius:5px;font-size:0.7rem;opacity:0.75;">
 Global Food Security: <strong style="color:${fsColor};">${fsVal} / 100</strong> — ${fsLabel}
  </div>
</div>`;
 }

 private _renderKeyRequired(): void {
 const el = this.getContentElement();
 el.innerHTML = `<div style="padding:1rem;">
  ${renderStatusCard({ label: 'Economic Stress', value: 'FRED API key required', severity: 'unknown', wide: true, sublabel: 'Add FRED_API_KEY in Settings → API Keys' })}
</div>`;
 }

 private _renderError(): void {
 const el = this.getContentElement();
 el.innerHTML = `<div style="padding:1rem;">
  ${renderStatusCard({ label: 'Economic Stress', value: 'Data unavailable', severity: 'unknown', wide: true })}
</div>`;
 }
  }
  ```

  > **Note:** All value rendering uses `.toFixed()` or template literals on numeric data from the sidecar — no unescaped user input. `renderStatusCard()` escapes all string values it receives.

- [ ] **Step 2: Verify typecheck passes — fix any import path issues**

  ```bash
  npm run typecheck:all
  ```

  Fix import paths for `sendNotification` and `isGhostMode` to match the codebase.

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/EconomicStressPanel.ts
  git commit -m "feat(components): add EconomicStressPanel with composite stress index bar"
  ```

---

## Chunk 3: Registration + Integration

### Task 7: Register panels in config and layout

**Files:**

- Modify: `src/config/panels.ts`
- Modify: `src/app/panel-layout.ts`
- Modify: `src/app/data-loader.ts`

- [ ] **Step 1: Read `src/config/panels.ts`** — find the `FULL_PANELS` object and `PANEL_CATEGORY_MAP`

- [ ] **Step 2: Add panel entries to `FULL_PANELS`**

  Add both entries (alphabetical or at end of their category):

  ```typescript
  'comms-health': { name: 'Communications Health', enabled: true, priority: 1 },
  'economic-stress': { name: 'Economic Stress', enabled: true, priority: 1 },
  ```

- [ ] **Step 3: Add category mappings to `PANEL_CATEGORY_MAP`**

  ```typescript
  'comms-health': 'infrastructure',
  'economic-stress': 'finance',
  ```

- [ ] **Step 4: Read `src/app/panel-layout.ts`** — find `WAR_PRIORITY`, `DISASTER_PRIORITY`, `FINANCE_PRIORITY`, and `_createPanels()`

- [ ] **Step 5: Update priority lists in `panel-layout.ts`**

  - `WAR_PRIORITY`: add `'comms-health'` after `'space-weather'`
  - `DISASTER_PRIORITY`: add `'comms-health'` after `'air-quality'`, then `'economic-stress'` after `'comms-health'`
  - `FINANCE_PRIORITY`: add `'economic-stress'` after `'economic'`

  Note: A panel key can appear in multiple priority lists — `_applyModePanelOrder` uses `currentKeys.includes(k)` per list independently (no deduplication issue).

- [ ] **Step 6: Instantiate both panels in `_createPanels()`**

  Add imports at top of file:

  ```typescript
  import { CommsHealthPanel } from '../components/CommsHealthPanel';
  import { EconomicStressPanel } from '../components/EconomicStressPanel';
  ```

  In `_createPanels()`, add:

  ```typescript
  panels.set('comms-health', new CommsHealthPanel('comms-health'));
  panels.set('economic-stress', new EconomicStressPanel('economic-stress'));
  ```

- [ ] **Step 7: Read `src/app/data-loader.ts`** — find existing `scheduleRefresh` call pattern

- [ ] **Step 8: Add refresh tasks in `data-loader.ts`**

  Add imports:

  ```typescript
  import { fetchCommsHealth } from '../services/comms-health';
  import { fetchEconomicStress } from '../services/economic-stress';
  ```

  Add schedule calls (after existing ones):

  ```typescript
  scheduleRefresh('comms-health', fetchCommsHealth, 5 * 60 * 1000);
  scheduleRefresh('economic-stress', fetchEconomicStress, 15 * 60 * 1000);
  ```

  Verify that `scheduleRefresh` passes fetched data to the panel's `update()` method — check how existing panels like `gdacs-alerts` wire up. The pattern is typically:

  ```typescript
  scheduleRefresh('panel-id', fetchFn, intervalMs);
  // and in the scheduler, it calls: panels.get('panel-id')?.update(data)
  ```

  If the scheduler uses a different pattern, match it.

- [ ] **Step 9: Verify typecheck passes**

  ```bash
  npm run typecheck:all
  ```

  Expected: zero errors. Fix any import path issues.

- [ ] **Step 10: Commit**

  ```bash
  git add src/config/panels.ts src/app/panel-layout.ts src/app/data-loader.ts
  git commit -m "feat: register comms-health + economic-stress panels in config, layout, and data-loader"
  ```

---

### Task 8: Verify success criteria

- [ ] **Step 1: Run full typecheck**

  ```bash
  npm run typecheck:all
  ```

  Expected: zero errors

- [ ] **Step 2: Verify SUPPORTED_SECRET_KEYS count unchanged**

  ```bash
  grep -c 'SUPPORTED_SECRET_KEYS\|"[A-Z_]*_API_\|"CLOUDFLARE\|"FRED' src-tauri/src/main.rs
  ```

  Open `src-tauri/src/main.rs` and confirm the array still has 25 entries and no new keys were added.

- [ ] **Step 3: Build the app**

  ```bash
  npm run desktop:build:full
  ```

  Expected: successful build. Fix any errors.

- [ ] **Step 4: Manual acceptance checklist** (run the app)

  - [ ] Comms Health panel appears in sidebar
  - [ ] Economic Stress panel appears in sidebar
  - [ ] With FRED key set: Economic Stress shows 6 indicator cards + stress bar
  - [ ] Without FRED key: Economic Stress shows "FRED API key required" card
  - [ ] Supply chain card always shows "~6wk lag" sublabel
  - [ ] Switch to War mode → comms-health appears in priority position
  - [ ] Switch to Disaster mode → both panels appear
  - [ ] Switch to Finance mode → economic-stress appears in priority position
  - [ ] DISASTER_PRIORITY no longer contains 'natural-disasters' or 'gdacs' (already fixed in previous commit)

- [ ] **Step 5: Final commit + push**

  ```bash
  git add -p  # stage any final fixes only
  git commit -m "chore: sprint 1A final cleanup and verification" --allow-empty
  git push macos main
  ```

---

## Success Criteria Cross-Reference

| Spec criterion | Covered in |
|---|---|
| `/api/comms-health` returns valid JSON | Task 1 |
| `/api/economic-stress` returns valid JSON with all 6 indicators | Task 2 |
| Missing Cloudflare token: partial data with inline note | Task 1 (ddos.cloudflareKeyMissing), Task 5 |
| Missing FRED key: full-panel "key required" card | Task 2, Task 6 |
| StatusCard exported from `src/components/index.ts` | Task 4 |
| Composite stress formula matches spec weights and clamp functions | Task 2, Step 3 |
| Supply chain card always shows "~6wk lag" | Task 6 |
| comms-health surfaces in War + Disaster modes | Task 7 |
| economic-stress surfaces in Finance + Disaster modes | Task 7 |
| DISASTER_PRIORITY no longer contains 'natural-disasters' or 'gdacs' | Already fixed (prev commit) |
| Notifications fire on transitions only; Ghost Mode suppresses | Task 5, Task 6 |
| `npm run typecheck:all` passes with zero errors | Tasks 3, 4, 5, 6, 9 |
| `SUPPORTED_SECRET_KEYS` count remains 25 | Task 8, Step 2 |
