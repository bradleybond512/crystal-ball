# Phase 3: Situation Dossier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the situation dossier — a drawer over the Home Shell's map composing evidence panels via new `evidenceFor` metadata, with an honest "why this surfaced" trace ladder, action brief + timeline right rail, ⌘/ ask bar, and entry from briefing rows and ⌘K.

**Architecture:** `evidenceFor?: readonly PlaybookCategory[]` extends the panel-metadata registry (PlaybookCategory is the exact type live `SituationDescriptor.category` carries — zero mapping layer). A pure `dossier-view.ts` composes header badge, why-surfaced lines (from the stored pipeline/notification traces — BigEvent trigger rationales are discarded upstream, so we do not fabricate them), ranked evidence cards (reusing `buildDeckCards` + a relevance wrapper), and a merged trace timeline. A DOM-built `SituationDossier` drawer (third child of `.home-shell`, `.mac-inspector-drawer`-style slide, `--hs-*` tokens) is owned by HomeShellOverlay. Briefing rows get structured entries threading situation/event ids.

**Tech Stack:** TypeScript, Vite, `node:test` via `tsx --test`, Playwright for the drawer smoke. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-11-ui-shell-reimagination-design.md` §"Situation view — the dossier". Phases 1-2 merged (PRs #1393, #1401).

---

## Verified codebase facts (do not re-derive)

- **Situation identity:** `SituationDescriptor` (`src/services/insights/action-briefs.ts:21-38`): `{id, title, category: PlaybookCategory, severityScore, confidence: 'low'|'medium'|'high', minutesUntilImpact?, observedConfirming?}` — **no location**. For weather/quake, `situation.id` IS the source alert id; coordinates recover via `getRecentEvents().find(e => e.eventId === situation.id)?.location` (`{latitude, longitude}`).
- **PlaybookCategory** (`src/services/insights/reaction-playbooks.ts:16-27`) — exactly 11: `severe_weather | wildfire | oil_fuel_shortage | food_shortage | cyber_campaign | banking_outage | conflict_escalation | travel_disruption | grid_outage | disease_outbreak | earthquake`. Live bridges emit only `severe_weather`, `wildfire`, `earthquake` today; the other 8 are dormant until bridges produce them.
- **BigEventResult is DISCARDED** after routing (data-loader ~:1717-1776) — per-trigger rationales are not stored anywhere. Honest "why surfaced" sources: `getPipelineTraceRegistry().get(situation.id)` (stages `ingested|scored|clustered|evaluated|routed|dropped`, events `{at, stage, reason?, detail?}`) and `getNotificationTraceRegistry().bySituation('nws-' + situation.id)` (**note the `nws-` dedupe-key prefix**; entries `{candidate, events: {at, kind, reason}[], decision, rung?}`).
- **Action brief:** `getActiveActionBrief(): ActionBrief | undefined` (insights-state:54); `ActionBrief` has `tier ('monitor'|'prepare'|'act_now'|'shelter')`, `headline`, `recommendedActions[]`, `confirmingSources[]`, `invalidatingSources[]`, `recommendedPanels[]`, `reason`.
- **Action memory:** `recordAction(ref: {kind, evidence, region}, kind: 'panel-jump'|..., detail?)`, `getPlaybookFor(ref): Playbook | null`, `summarizePlaybook(book): string` (`src/services/action-memory.ts:86/:133/:158`). Keyed by hypothesis signature — a synthetic ref `{kind: 'dossier:' + category, evidence: [], region: ''}` gives a stable per-category key.
- **Ask:** `askLive(question): AnswerPacket` (`src/services/insights/ask-context.ts:31`); packet `{question, intent, answer, evidence: {id,label,fact,confidence?}[], followUps[]}`. **No situation context slot exists** — situation-scoped answers are a documented deferral.
- **Share:** `buildSharePacket({shareId, briefing}: ...): SharePacket` + `selectFormat(packet, 'markdown'|...)` (`src/services/insights/share-packet.ts:87/:110`); `BriefingContent {title, generatedAt, summary, category?, severityScore?, confidence?, sections: {heading, body?, bullets?}[]}` (`presentation-export.ts:44-61`). Clipboard convention: `void navigator.clipboard?.writeText(text)` — write-only, fire-and-forget (clipboard-audit posture).
- **Map:** MapContainer `setCenter(lat, lon, zoom?)` (`:189`) + `flashLocation(lat, lon, durationMs?)` (`:721`). **No arbitrary polygon API**; NWS alert polygons already render via the weather layer. The shell's map is a **non-interactive backdrop** (pointer-events) — **marker-click entry is deferred** (documented deviation).
- **Shell DOM:** `.home-shell` root has exactly two children (`this.mapSlot`, `scroll` — `HomeShellOverlay.ts:108`); the drawer becomes the **third** (`root.append(this.mapSlot, scroll, drawerRoot)`), painting above via DOM order + local `z-index: 1`. cmdk (body, z 10005) and Library (body, z 10001) always paint above the drawer — correct layering.
- **Escape chain:** cmdk = input-level target-phase preventDefault; Library = document **capture** handler that guards `document.querySelector('.cmdk-v2-overlay:not([hidden])')`, then preventDefault + hide (`LibraryOverlay.ts:27-37`); shell = document bubble handler checking `!e.defaultPrevented` (`HomeShellOverlay.ts:70`). The dossier's Esc must be **capture-phase**, guard cmdk AND `.library-overlay:not([hidden])`, then `preventDefault()` + close.
- **Briefing views:** `BriefingBandView.lines: readonly string[]` are preformatted strings with ids stripped; ids exist upstream (`BriefingInput.situation.id`, `recentEvents[].eventId`) — Task 3 threads them through as structured entries.
- **Drawer CSS precedent:** `.mac-inspector-drawer` (`macos-native.css:2062-2139`): `transform: translateX(100%)` → `--open { transform: translateX(0) }`, `transition: transform 180ms ease`. Use `--hs-*` tokens (the shell's family); `home-shell.css`'s `prefers-reduced-motion` block already neutralizes transitions for `.home-shell *`.
- **Deck adapter reuse:** `buildDeckCards(pins, {names, health, narratives}, now): DeckCardView[]` (`deck-view.ts:86`) — `DeckCardView {panelId, title, tone, statusLabel, narrative?}`. Evidence cards = DeckCardView + a `reason` string (thin wrapper, no new adapter).
- **PanelMeta today** (`src/config/panel-metadata.ts:15-27`): `{domain, tags, tier, featured?, icon?, aliasOf?}`; 406 entries; validation test invariants at `src/config/__tests__/panel-metadata.test.mts` (key parity, domains, tags lowercase, ≥25 system in system-health, ≥4 featured/domain, aliasOf resolves, deck pins exist). Adding an optional field keeps all green. `panel-metadata.ts` has no imports today; add `import type { PlaybookCategory } from '../services/insights/reaction-playbooks';`. Re-running the generator OVERWRITES curation — evidenceFor is curated-only; do NOT run the generator.
- **Palette:** `getCommandRegistry().register/unregister` (overwrite-on-collision semantics, tested); `PaletteCommand` supports `weight`. No situation commands exist; register/unregister an `situation:active` command as the active situation changes.
- Conventions: DOM via createElement/textContent only; colors via `--hs-*`/`rgba(var(--hs-*-rgb), α)`; services use relative `.ts` imports; components use `@/`; eslint hooks dislike nested ternaries/`.slice()` clones/named-callback refs; test files aren't typechecked; cwd resets between turns — cd in the same command.

## File structure

```
src/config/panel-metadata.ts                              (modify — evidenceFor field + curated lists)
src/config/__tests__/panel-metadata.test.mts              (modify — evidenceFor invariants)
src/services/home-shell/dossier-view.ts                   (new — pure dossier view-model)
src/services/home-shell/__tests__/dossier-view.test.mts   (new)
src/services/home-shell/briefing-view.ts                  (modify — structured entries with ids)
src/services/home-shell/__tests__/briefing-view.test.mts  (modify)
src/components/SituationDossier.ts                        (new — DOM drawer)
src/styles/home-shell.css                                 (modify — .hs-dossier styles appended)
src/components/HomeShellOverlay.ts                        (modify — hosts dossier, entry wiring, palette command)
src/app/panel-layout.ts                                   (modify — cb:map-focus listener, tracked)
e2e/home-shell-boot.spec.ts                               (modify — dossier smoke test)
package.json                                              (modify — test:homeshell += dossier-view)
CLAUDE.md, spec status note                               (modify — Task 7)
```

Work in `/Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase3` on branch `claude/phase3-situation-dossier` (created from post-#1401 origin/main). All git commands must cd into the worktree in the same shell command.

## Documented deferrals (spec deviations — recorded in Task 7's spec note)

1. **Map-marker click entry** — the shell's map is a non-interactive backdrop; entry points are briefing rows + ⌘K + `cb:open-dossier`.
2. **Situation-scoped ask answers** — `AskContext` has no situation slot; the ask bar ships context-free (`askLive`), extension is Phase 4+.
3. **Big-event trigger rationales** — discarded upstream; why-surfaced uses the stored trace ladder instead (extending data-loader to persist BigEventResult is a separate follow-up).
4. **Bespoke M-cards** — evidence cards are adapter cards + relevance reason; bespoke per-panel treatments are progressive Phase 4 work.

---

### Task 1: `evidenceFor` metadata extension

**Files:**

- Modify: `src/config/panel-metadata.ts` (interface + curated entries)
- Modify: `src/config/__tests__/panel-metadata.test.mts` (new invariants)

- [ ] **Step 1: Extend the interface**

In `src/config/panel-metadata.ts`, add the import at the top (type-only, no runtime coupling):

```ts
import type { PlaybookCategory } from '../services/insights/reaction-playbooks';
```

and extend `PanelMeta`:

```ts
  /** Situation categories this panel illuminates — the dossier composes
   *  evidence from these. Curated by hand; keyed on PlaybookCategory, the
   *  exact type a live SituationDescriptor.category carries. */
  evidenceFor?: readonly PlaybookCategory[];
```

- [ ] **Step 2: Apply the curated evidence lists**

Add `evidenceFor` to these entries (every key verified present in the registry). A key appearing under multiple categories gets all of them in one array. You may write a throwaway node script to apply this table and delete it afterward — do NOT run `scripts/generate-panel-metadata.mjs` (it overwrites curation).

| Category | Panel keys |
|---|---|
| severe_weather | nws-alerts, severe-weather, weather-radar, spc-mesoscale, tropical-cyclones, flood-monitor, storm-posture, power-grid, saved-places, family-tracker, evacuation |
| wildfire | wildfire-intel, wildfire-incidents, wildfire-smoke, satellite-fires, firms-thermal, air-quality, nws-alerts, evacuation, saved-places, family-tracker |
| earthquake | earthquakes, emsc-seismic, shakealert, tsunami-alerts, earthquake-super, seismic-superpower, volcano-alerts, population-exposure, saved-places, family-tracker, evacuation |
| conflict_escalation | airstrikes, orbat, ucdp-events, conflict-escalation, escalation-forecast, liveuamap, isw-reports, oref-sirens, sanctions-intel, combatant-commands, strike-packages, live-news |
| cyber_campaign | cyber-threats, cve-tracker, threat-intel-hub, hibp-breaches, ics-ot-dashboard, critical-infra-attack, cyber-incident-response, cyber-espionage, vulners-cve, stix-taxii, ioc-manager, threat-inbox |
| oil_fuel_shortage | shortage-radar, shortage-detail-diesel, shortage-detail-gasoline, shortage-detail-jet-fuel, shortage-detail-natural-gas, fuel-prices, commodities, supply-chain, supply-chain-disruption, markets |
| food_shortage | shortage-radar, shortage-detail-wheat, shortage-detail-corn, shortage-detail-rice, shortage-detail-soybeans, food-insecurity, food-security-superpower, humanitarian-crisis, supply-chain, commodities |
| grid_outage | power-grid, grid-intelligence, electric-grid-vulnerability, infrastructure, internet-disruptions, hazard-alerts, population-exposure, nws-alerts, saved-places |
| disease_outbreak | disease-outbreaks, disease-intel, ecdc-surveillance, pandemic-preparedness, global-health-security, humanitarian-crisis, air-quality, hazard-alerts |
| banking_outage | markets, fdic-failures, financial-contagion, macro-signals, stablecoins, crypto, internet-disruptions, threat-intel-hub |
| travel_disruption | air-traffic, aviation-intel, faa-tfrs, faa-weather-cams, amtrak-alerts, travel-safety, security-advisories, nws-alerts, live-news |

- [ ] **Step 3: Add invariants to the validation test**

Append to `src/config/__tests__/panel-metadata.test.mts` (match the file's existing import/builder style):

```ts
const PLAYBOOK_CATEGORIES = [
  'severe_weather', 'wildfire', 'oil_fuel_shortage', 'food_shortage',
  'cyber_campaign', 'banking_outage', 'conflict_escalation',
  'travel_disruption', 'grid_outage', 'disease_outbreak', 'earthquake',
] as const;

test('evidenceFor values are known playbook categories', () => {
  for (const [key, meta] of Object.entries(PANEL_METADATA)) {
    for (const cat of meta.evidenceFor ?? []) {
      assert.ok(
        (PLAYBOOK_CATEGORIES as readonly string[]).includes(cat),
        `${key}: unknown evidenceFor category '${cat}'`,
      );
    }
  }
});

test('every playbook category has at least 6 evidence panels', () => {
  for (const cat of PLAYBOOK_CATEGORIES) {
    const count = Object.values(PANEL_METADATA).filter(
      (m) => m.evidenceFor?.includes(cat),
    ).length;
    assert.ok(count >= 6, `${cat}: only ${count} evidence panels`);
  }
});
```

- [ ] **Step 4: Run + commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase3 && npx tsx --test src/config/__tests__/panel-metadata.test.mts && npm run typecheck
```

Expected: 8 tests pass, zero type errors. Then:

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase3 && git add src/config/panel-metadata.ts src/config/__tests__/panel-metadata.test.mts && git commit -m "feat(dossier): evidenceFor metadata across 11 playbook categories

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: `dossier-view.ts` — pure view-model

**Files:**

- Create: `src/services/home-shell/dossier-view.ts`
- Test: `src/services/home-shell/__tests__/dossier-view.test.mts`

- [ ] **Step 1: Write the failing test**

Create `src/services/home-shell/__tests__/dossier-view.test.mts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDossierView } from '../dossier-view.ts';
import type { DossierInputs } from '../dossier-view.ts';
import type { PanelMeta } from '../../../config/panel-metadata.ts';

const NOW = 1_752_500_000_000;

function meta(overrides: Partial<PanelMeta> = {}): PanelMeta {
  return { domain: 'hazards-weather', tags: ['weather'], tier: 'library', evidenceFor: ['severe_weather'], ...overrides };
}

function inputs(overrides: Partial<DossierInputs> = {}): DossierInputs {
  return {
    situation: {
      id: 'alert-1',
      title: 'Severe cell → NW Indiana',
      category: 'severe_weather',
      severityScore: 82,
      confidence: 'high',
      minutesUntilImpact: 40,
    },
    metadata: {
      'nws-alerts': meta({ featured: true, icon: '⚠️' }),
      'weather-radar': meta(),
      'power-grid': meta({ domain: 'cyber-infrastructure' }),
      'saved-places': meta({ domain: 'personal-safety' }),
      earthquakes: meta({ evidenceFor: ['earthquake'] }),
      'self-test': meta({ domain: 'system-health', tier: 'system' }),
    },
    names: {
      'nws-alerts': { name: 'NWS Alerts' },
      'weather-radar': { name: 'Weather Radar' },
      'power-grid': { name: 'Power Grid' },
      'saved-places': { name: 'Saved Places' },
      earthquakes: { name: 'Earthquakes' },
      'self-test': { name: 'Self-Test' },
    },
    health: [{ panelId: 'nws-alerts', status: 'healthy', lastRenderAt: NOW - 30_000 }],
    narratives: { 'nws-alerts': '1 warning · 2 watches' },
    pipelineEvents: [
      { at: NOW - 300_000, stage: 'ingested' },
      { at: NOW - 240_000, stage: 'evaluated', reason: 'big event (tier critical)' },
      { at: NOW - 200_000, stage: 'routed' },
    ],
    notificationEvents: [{ at: NOW - 190_000, kind: 'dispatched', reason: 'rung notify_now' }],
    ...overrides,
  };
}

test('header badge maps urgency and confidence', () => {
  const view = buildDossierView(inputs(), NOW);
  assert.equal(view.title, 'Severe cell → NW Indiana');
  assert.equal(view.badge.text, 'ACT SOON · HIGH CONF');
  assert.equal(view.badge.tone, 'critical');
  assert.ok(view.subline.includes('~40 min'));
});

test('low urgency maps to monitor/info', () => {
  const view = buildDossierView(
    inputs({ situation: { id: 's', title: 'T', category: 'severe_weather', severityScore: 20, confidence: 'low' } }),
    NOW,
  );
  assert.equal(view.badge.text, 'MONITOR · LOW CONF');
  assert.equal(view.badge.tone, 'info');
});

test('evidence composes only matching category, system tier excluded from top, capped with runners-up', () => {
  const many = inputs();
  for (let i = 0; i < 8; i++) {
    const key = `extra-${i}`;
    (many.metadata as Record<string, PanelMeta>)[key] = meta();
    (many.names as Record<string, { name: string }>)[key] = { name: `Extra ${i}` };
  }
  const view = buildDossierView(many, NOW);
  assert.ok(view.evidence.length <= 6);
  assert.ok(view.runnersUp.length <= 4);
  const all = [...view.evidence, ...view.runnersUp].map((c) => c.panelId);
  assert.ok(!all.includes('earthquakes'), 'wrong-category panel leaked in');
  assert.equal(view.evidence[0]!.panelId, 'nws-alerts', 'featured+healthy ranks first');
  assert.ok(view.evidence[0]!.reason.length > 0);
});

test('why-surfaced lines come from traces, honest fallback when absent', () => {
  const view = buildDossierView(inputs(), NOW);
  assert.ok(view.whySurfaced.some((l) => l.includes('big event')));
  assert.ok(view.whySurfaced.some((l) => l.includes('notify_now')));
  const bare = buildDossierView(inputs({ pipelineEvents: undefined, notificationEvents: undefined }), NOW);
  assert.equal(bare.whySurfaced.length, 1);
  assert.ok(bare.whySurfaced[0]!.includes('no pipeline trace recorded'));
});

test('timeline merges and sorts both trace sources', () => {
  const view = buildDossierView(inputs(), NOW);
  assert.equal(view.timeline.length, 4);
  const times = view.timeline.map((r) => r.at);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.ok(view.timeline[3]!.label.includes('dispatched'));
});

test('variant gate: panels missing from names are skipped', () => {
  const view = buildDossierView(inputs({ names: { 'nws-alerts': { name: 'NWS Alerts' } } }), NOW);
  const all = [...view.evidence, ...view.runnersUp].map((c) => c.panelId);
  assert.deepEqual(all, ['nws-alerts']);
});
```

- [ ] **Step 2: Run to verify FAIL** (`Cannot find module '../dossier-view.ts'`)

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase3 && npx tsx --test src/services/home-shell/__tests__/dossier-view.test.mts
```

- [ ] **Step 3: Implement**

Create `src/services/home-shell/dossier-view.ts`:

```ts
/**
 * Dossier view-model — composes the situation drawer's header badge,
 * honest why-surfaced lines (from stored pipeline/notification traces;
 * BigEvent trigger rationales are discarded upstream and are NOT
 * fabricated here), ranked evidence cards, and a merged trace timeline.
 *
 * Pure deterministic: no DOM, no fetch, no globals; `now` caller-supplied.
 */

import type { PanelMeta } from '../../config/panel-metadata.ts';
import type { SituationDescriptor } from '../insights/action-briefs.ts';
import { classifyUrgency } from '../insights/confidence-urgency-matrix.ts';
import { buildDeckCards, formatAge } from './deck-view.ts';
import type { DeckCardView, PanelHealthLike } from './deck-view.ts';

export interface TraceEventLike {
  at: number;
  stage?: string;
  kind?: string;
  reason?: string;
}

export interface DossierInputs {
  situation: SituationDescriptor;
  location?: { latitude: number; longitude: number };
  metadata: Readonly<Record<string, PanelMeta>>;
  /** DEFAULT_PANELS-shaped lookup; doubles as the variant gate. */
  names: Readonly<Record<string, { name: string } | undefined>>;
  health: readonly PanelHealthLike[];
  narratives: Readonly<Record<string, string | undefined>>;
  pipelineEvents?: readonly TraceEventLike[];
  notificationEvents?: readonly TraceEventLike[];
}

export interface EvidenceCardView extends DeckCardView {
  /** Why this panel is here ("featured severe_weather evidence"). */
  reason: string;
}

export interface TimelineRow {
  at: number;
  label: string;
}

export interface DossierView {
  title: string;
  badge: { text: string; tone: 'critical' | 'elevated' | 'info' };
  subline: string;
  whySurfaced: readonly string[];
  evidence: readonly EvidenceCardView[];
  runnersUp: readonly EvidenceCardView[];
  timeline: readonly TimelineRow[];
}

const EVIDENCE_CAP = 6;
const RUNNERS_UP_CAP = 4;

const URGENCY_LABEL = { high: 'ACT SOON', medium: 'WATCH', low: 'MONITOR' } as const;
const URGENCY_TONE = { high: 'critical', medium: 'elevated', low: 'info' } as const;
const CONF_LABEL = { high: 'HIGH CONF', medium: 'MED CONF', low: 'LOW CONF' } as const;

export function buildDossierView(inputs: DossierInputs, now: number): DossierView {
  const { situation } = inputs;
  const urgency = classifyUrgency(situation.severityScore);
  const badge = {
    text: `${URGENCY_LABEL[urgency]} · ${CONF_LABEL[situation.confidence]}`,
    tone: URGENCY_TONE[urgency],
  };
  const sublineParts = [`severity ${situation.severityScore}`, `${situation.confidence} confidence`];
  if (situation.minutesUntilImpact !== undefined) {
    sublineParts.push(`~${situation.minutesUntilImpact} min`);
  }

  const { evidence, runnersUp } = composeEvidence(inputs, now);

  return {
    title: situation.title,
    badge,
    subline: sublineParts.join(' · '),
    whySurfaced: buildWhySurfaced(inputs),
    evidence,
    runnersUp,
    timeline: buildTimeline(inputs),
  };
}

function composeEvidence(
  inputs: DossierInputs,
  now: number,
): { evidence: EvidenceCardView[]; runnersUp: EvidenceCardView[] } {
  const category = inputs.situation.category;
  const healthById = new Map(inputs.health.map((h) => [h.panelId, h]));
  const candidates = Object.entries(inputs.metadata)
    .filter(([panelId, meta]) => {
      if (!meta.evidenceFor?.includes(category)) return false;
      // Variant gate: no name entry means the panel is not in this variant.
      return inputs.names[panelId] !== undefined;
    })
    .map(([panelId, meta]) => ({ panelId, meta }));

  candidates.sort((a, b) => rankScore(b, healthById) - rankScore(a, healthById) || a.panelId.localeCompare(b.panelId));

  const ranked = candidates.slice(0, EVIDENCE_CAP + RUNNERS_UP_CAP);
  const cards = buildDeckCards(
    ranked.map((c) => c.panelId),
    { names: inputs.names, health: inputs.health, narratives: inputs.narratives },
    now,
  );
  const withReason: EvidenceCardView[] = cards.map((card, i) => {
    const meta = ranked[i]!.meta;
    const parts: string[] = [];
    if (meta.featured) parts.push('featured');
    parts.push(`${category} evidence`);
    return { ...card, reason: parts.join(' ') };
  });
  return {
    evidence: withReason.slice(0, EVIDENCE_CAP),
    runnersUp: withReason.slice(EVIDENCE_CAP),
  };
}

function rankScore(
  candidate: { panelId: string; meta: PanelMeta },
  healthById: ReadonlyMap<string, PanelHealthLike>,
): number {
  let score = 0;
  if (candidate.meta.featured) score += 4;
  if (candidate.meta.tier === 'library') score += 2;
  const h = healthById.get(candidate.panelId);
  if (h?.status === 'healthy') score += 1;
  return score;
}

function buildWhySurfaced(inputs: DossierInputs): string[] {
  const lines: string[] = [];
  for (const e of inputs.pipelineEvents ?? []) {
    if (e.stage === 'evaluated' || e.stage === 'routed' || e.stage === 'dropped') {
      lines.push(e.reason ? `${e.stage} — ${e.reason}` : `${e.stage}`);
    }
  }
  for (const e of inputs.notificationEvents ?? []) {
    if (e.kind && e.reason) lines.push(`${e.kind} — ${e.reason}`);
  }
  if (lines.length === 0) {
    lines.push('no pipeline trace recorded for this situation — surfaced via the active-situation bridge');
  }
  return lines;
}

function buildTimeline(inputs: DossierInputs): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const e of inputs.pipelineEvents ?? []) {
    rows.push({ at: e.at, label: e.reason ? `${e.stage ?? 'event'} — ${e.reason}` : (e.stage ?? 'event') });
  }
  for (const e of inputs.notificationEvents ?? []) {
    rows.push({ at: e.at, label: e.reason ? `${e.kind ?? 'event'} — ${e.reason}` : (e.kind ?? 'event') });
  }
  rows.sort((a, b) => a.at - b.at);
  return rows;
}

export { formatAge };
```

(If eslint objects to the sort comparator or nullish patterns, adjust minimally without behavior change.)

- [ ] **Step 4: Run to verify PASS** (6 tests), `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase3 && git add src/services/home-shell/dossier-view.ts src/services/home-shell/__tests__/dossier-view.test.mts && git commit -m "feat(dossier): pure dossier view-model

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Structured briefing entries (thread ids to rows)

**Files:**

- Modify: `src/services/home-shell/briefing-view.ts`
- Modify: `src/services/home-shell/__tests__/briefing-view.test.mts`
- Modify: `src/components/HomeShellOverlay.ts` (renderBand only — dossier wiring is Task 5)

- [ ] **Step 1: Change the contract**

In `briefing-view.ts`, replace `lines: readonly string[]` on `BriefingBandView` with:

```ts
export interface BriefingLineView {
  text: string;
  /** Present on critical-band rows — opens the situation dossier. */
  situationId?: string;
}
```

and `entries: readonly BriefingLineView[];`. Update the three band builders: personal/changed bands emit `{ text }` (map their existing string construction); the critical band emits `{ text, situationId: input.situation.id }` for the situation row and `{ text, situationId: e.eventId }` for event rows. `MAX_LINES` semantics unchanged.

- [ ] **Step 2: Update the tests**

In `briefing-view.test.mts`, replace every `lines` access with `entries` (`personal.entries[0]!.text.includes(...)`, `changed.entries.length`, etc.), and add:

```ts
test('critical entries carry situation/event ids for dossier entry', () => {
  const view = buildBriefingView({ ...quiet(), situation: sit(), recentEvents: [
    { eventId: 'e9', description: 'High-sev event', domain: 'conflict', severity: 88 },
  ] }, NOW);
  const critical = view.bands.find((b) => b.kind === 'critical')!;
  assert.equal(critical.entries[0]!.situationId, 'sit-1');
  assert.equal(critical.entries[1]!.situationId, 'e9');
});

test('personal entries carry no ids', () => {
  const view = buildBriefingView({ ...quiet(), personal: report([impact()]) }, NOW);
  const personal = view.bands.find((b) => b.kind === 'personal')!;
  assert.equal(personal.entries[0]!.situationId, undefined);
});
```

- [ ] **Step 3: Update `renderBand` in HomeShellOverlay.ts**

```ts
function renderBand(b: BriefingBandView): HTMLElement {
  const band = el('div', `hs-band hs-tone-${b.tone}`);
  band.append(el('div', 'hs-band-label', b.label), el('div', 'hs-band-headline', b.headline));
  for (const entry of b.entries) {
    const line = el('div', entry.situationId ? 'hs-band-line hs-band-link' : 'hs-band-line', entry.text);
    if (entry.situationId) line.dataset.situationId = entry.situationId;
    band.append(line);
  }
  if (b.staleness) band.append(el('div', 'hs-band-stale', b.staleness));
  return band;
}
```

(Import `BriefingLineView` type if needed; add `.hs-band-link { cursor: pointer; text-decoration: underline dotted; }` to `home-shell.css`.)

- [ ] **Step 4: Run + commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase3 && npx tsx --test src/services/home-shell/__tests__/briefing-view.test.mts && npm run test:homeshell && npm run typecheck:all
```

Expected: briefing file now 15 tests; full suite green (49 + new − none removed); zero type errors.

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase3 && git add src/services/home-shell/briefing-view.ts src/services/home-shell/__tests__/briefing-view.test.mts src/components/HomeShellOverlay.ts src/styles/home-shell.css && git commit -m "feat(dossier): briefing entries thread situation ids

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: `SituationDossier` component + drawer CSS

**Files:**

- Create: `src/components/SituationDossier.ts`
- Modify: `src/styles/home-shell.css` (append `.hs-dossier` block)

All DOM via createElement/textContent. Colors via `--hs-*` only.

- [ ] **Step 1: Append the drawer CSS to `home-shell.css`**

```css
/* ── Situation dossier drawer (Phase 3) ─────────────────────────── */

.hs-dossier-scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: rgba(var(--hs-base-rgb), 0.45);
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease;
}

.hs-dossier-scrim--open {
  opacity: 1;
  pointer-events: auto;
}

.hs-dossier {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 60vw;
  max-width: 960px;
  min-width: 480px;
  z-index: 2;
  background: var(--hs-bg-ribbon);
  border-left: 1px solid rgba(var(--hs-white-rgb), 0.1);
  transform: translateX(100%);
  transition: transform 180ms ease;
  display: flex;
  flex-direction: column;
  font-family: ui-monospace, Menlo, Monaco, monospace;
}

.hs-dossier--open { transform: translateX(0); }

.hs-dossier-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(var(--hs-white-rgb), 0.08);
}

.hs-dossier-title { font-size: 13px; font-weight: 600; color: var(--hs-fg); }

.hs-dossier-badge {
  font-size: 9px;
  border-radius: 3px;
  padding: 1px 6px;
  letter-spacing: 0.05em;
}

.hs-dossier-badge--critical { color: var(--hs-bad); border: 1px solid rgba(var(--hs-bad-rgb), 0.45); background: rgba(var(--hs-bad-rgb), 0.15); }
.hs-dossier-badge--elevated { color: var(--hs-warn); border: 1px solid rgba(var(--hs-warn-rgb), 0.45); background: rgba(var(--hs-warn-rgb), 0.15); }
.hs-dossier-badge--info { color: var(--hs-fg-muted); border: 1px solid rgba(var(--hs-white-rgb), 0.2); background: rgba(var(--hs-white-rgb), 0.06); }

.hs-dossier-subline { font-size: 10px; color: var(--hs-fg-dim); }

.hs-dossier-actions { margin-left: auto; display: flex; gap: 6px; }

.hs-dossier-actions button {
  border: 1px solid rgba(var(--hs-white-rgb), 0.14);
  border-radius: 6px;
  background: transparent;
  color: var(--hs-fg-muted);
  font: inherit;
  font-size: 10px;
  padding: 4px 10px;
  cursor: pointer;
}

.hs-dossier-body {
  flex: 1;
  display: flex;
  gap: 14px;
  padding: 12px 16px;
  overflow-y: auto;
  min-height: 0;
}

.hs-dossier-main { flex: 1.6; min-width: 0; }
.hs-dossier-rail { flex: 1; min-width: 0; }

.hs-dossier-section-label {
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--hs-fg-muted);
  margin: 10px 0 6px;
}

.hs-dossier-why { font-size: 10px; color: var(--hs-fg-line); line-height: 1.6; }

.hs-dossier-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 7px;
}

.hs-dossier .hs-card-reason { font-size: 9px; color: var(--hs-fg-dim); margin-top: 3px; }

.hs-dossier-more {
  margin-top: 8px;
  background: transparent;
  border: 1px dashed rgba(var(--hs-white-rgb), 0.2);
  border-radius: 6px;
  color: var(--hs-fg-faint);
  font: inherit;
  font-size: 10px;
  padding: 5px 10px;
  cursor: pointer;
}

.hs-dossier-brief { font-size: 10px; color: var(--hs-fg-line); line-height: 1.7; }
.hs-dossier-brief .hs-brief-tier { color: var(--hs-warn); }
.hs-dossier-memory { font-size: 9px; color: var(--hs-fg-dim); margin-top: 6px; }

.hs-dossier-timeline { font-size: 9px; color: var(--hs-fg-dim); line-height: 1.8; }

.hs-dossier-ask {
  border-top: 1px solid rgba(var(--hs-white-rgb), 0.08);
  padding: 10px 16px;
}

.hs-dossier-ask input {
  width: 100%;
  background: var(--hs-bg-card);
  border: 1px solid rgba(var(--hs-white-rgb), 0.14);
  border-radius: 8px;
  color: var(--hs-fg);
  font: inherit;
  font-size: 11px;
  padding: 6px 12px;
}

.hs-dossier-answer { font-size: 10px; color: var(--hs-fg-line); line-height: 1.6; margin-top: 8px; }
.hs-dossier-followups { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }

.hs-dossier-followups button {
  background: rgba(var(--hs-white-rgb), 0.06);
  border: none;
  border-radius: 10px;
  color: var(--hs-fg-muted);
  font: inherit;
  font-size: 9px;
  padding: 3px 9px;
  cursor: pointer;
}
```

- [ ] **Step 2: Create the component**

Create `src/components/SituationDossier.ts`:

```ts
/**
 * Situation Dossier — Phase 3 of the UI shell re-imagination
 * (docs/superpowers/specs/2026-07-11-ui-shell-reimagination-design.md §4).
 *
 * Drawer over the Home Shell's map: header badge, honest why-surfaced
 * trace lines, evidence cards composed via evidenceFor metadata, action
 * brief + timeline rail, and a context-free ask bar. Owned by
 * HomeShellOverlay (mounted as a child of .home-shell). All DOM via
 * createElement/textContent — no HTML-string sinks.
 */

import { DEFAULT_PANELS } from '@/config/panels';
import { PANEL_METADATA } from '@/config/panel-metadata';
import { getPlaybookFor, recordAction, summarizePlaybook } from '@/services/action-memory';
import { getPanelHealthRegistry } from '@/services/diagnostics/diagnostics-state';
import { getNotificationTraceRegistry } from '@/services/diagnostics/diagnostics-state';
import { getPipelineTraceRegistry } from '@/services/diagnostics/diagnostics-state';
import type { ActionBrief, SituationDescriptor } from '@/services/insights/action-briefs';
import { askLive } from '@/services/insights/ask-context';
import { getActiveActionBrief, getRecentEvents } from '@/services/insights/insights-state';
import { buildSharePacket, selectFormat } from '@/services/insights/share-packet';
import { buildDossierView } from '@/services/home-shell/dossier-view';
import type { DossierView, EvidenceCardView, TraceEventLike } from '@/services/home-shell/dossier-view';

export interface SituationDossierOptions {
  getNarrative: (panelId: string) => string | undefined;
  /** Called after open with the situation's coordinates (fly the map). */
  onLocate?: (lat: number, lon: number) => void;
  /** Called when the user opens a panel (host closes shell layers). */
  onOpenPanel: (panelId: string) => void;
}

export class SituationDossier {
  private scrim: HTMLElement | null = null;
  private drawer: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private headerEl: HTMLElement | null = null;
  private askAnswerEl: HTMLElement | null = null;
  private subject: SituationDescriptor | null = null;
  private view: DossierView | null = null;
  private showAllRunnersUp = false;
  private openState = false;
  private readonly opts: SituationDossierOptions;

  private readonly onKeydown = (e: KeyboardEvent): void => {
    // Defer to global overlays stacked above the shell.
    if (document.querySelector('.cmdk-v2-overlay:not([hidden])')) return;
    if (document.querySelector('.library-overlay:not([hidden])')) return;
    if (e.key === 'Escape' && !e.defaultPrevented && this.openState) {
      e.preventDefault();
      this.close();
    }
  };

  constructor(options: SituationDossierOptions) {
    this.opts = options;
  }

  mount(parent: HTMLElement): void {
    if (this.drawer) return;
    this.scrim = el('div', 'hs-dossier-scrim');
    this.scrim.addEventListener('click', () => this.close());

    const drawer = el('aside', 'hs-dossier');
    this.headerEl = el('header', 'hs-dossier-header');
    this.bodyEl = el('div', 'hs-dossier-body');
    const ask = el('div', 'hs-dossier-ask');
    const askInput = document.createElement('input');
    askInput.type = 'search';
    askInput.placeholder = 'Ask: why high risk? · what changed? · what to watch?';
    askInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && askInput.value.trim()) {
        e.stopPropagation();
        this.renderAnswer(askInput.value.trim());
      }
    });
    this.askAnswerEl = el('div', 'hs-dossier-answer');
    ask.append(askInput, this.askAnswerEl);
    drawer.append(this.headerEl, this.bodyEl, ask);
    drawer.addEventListener('click', (e) => this.onClick(e));

    parent.append(this.scrim, drawer);
    this.drawer = drawer;
  }

  open(subject: SituationDescriptor): void {
    if (!this.drawer || !this.scrim) return;
    this.subject = subject;
    this.showAllRunnersUp = false;
    this.refresh();
    this.openState = true;
    this.drawer.classList.add('hs-dossier--open');
    this.scrim.classList.add('hs-dossier-scrim--open');
    document.addEventListener('keydown', this.onKeydown, true);

    const location = getRecentEvents().find((e) => e.eventId === subject.id)?.location;
    if (location && this.opts.onLocate) this.opts.onLocate(location.latitude, location.longitude);
  }

  close(): void {
    if (!this.drawer || !this.scrim || !this.openState) return;
    this.openState = false;
    this.drawer.classList.remove('hs-dossier--open');
    this.scrim.classList.remove('hs-dossier-scrim--open');
    document.removeEventListener('keydown', this.onKeydown, true);
  }

  isOpen(): boolean {
    return this.openState;
  }

  destroy(): void {
    this.close();
    this.scrim?.remove();
    this.drawer?.remove();
    this.scrim = null;
    this.drawer = null;
  }

  // ── Data + render ─────────────────────────────────────────────────

  private refresh(): void {
    if (!this.subject || !this.headerEl || !this.bodyEl) return;
    const now = Date.now();
    const narratives: Record<string, string | undefined> = {};
    for (const key of Object.keys(PANEL_METADATA)) {
      if (PANEL_METADATA[key]?.evidenceFor?.includes(this.subject.category)) {
        narratives[key] = this.opts.getNarrative(key);
      }
    }
    this.view = buildDossierView(
      {
        situation: this.subject,
        metadata: PANEL_METADATA,
        names: DEFAULT_PANELS,
        health: getPanelHealthRegistry().all(),
        narratives,
        pipelineEvents: readPipelineEvents(this.subject.id),
        notificationEvents: readNotificationEvents(this.subject.id),
      },
      now,
    );
    this.renderHeader(this.view);
    this.renderBody(this.view, getActiveActionBrief());
  }

  private renderHeader(view: DossierView): void {
    if (!this.headerEl) return;
    const badge = el('span', `hs-dossier-badge hs-dossier-badge--${view.badge.tone}`, view.badge.text);
    const share = button('share', 'Share ⌘E');
    const close = button('close', 'Close ⎋');
    const actions = el('div', 'hs-dossier-actions');
    actions.append(share, close);
    this.headerEl.replaceChildren(
      el('span', 'hs-dossier-title', view.title),
      badge,
      el('span', 'hs-dossier-subline', view.subline),
      actions,
    );
  }

  private renderBody(view: DossierView, brief: ActionBrief | undefined): void {
    if (!this.bodyEl) return;
    const main = el('div', 'hs-dossier-main');
    main.append(el('div', 'hs-dossier-section-label', 'WHY THIS SURFACED'));
    const why = el('div', 'hs-dossier-why');
    for (const line of view.whySurfaced) why.append(el('div', undefined, line));
    main.append(why);

    main.append(el('div', 'hs-dossier-section-label', `EVIDENCE · ${view.evidence.length} PANELS`));
    main.append(grid(view.evidence));
    if (view.runnersUp.length > 0) {
      if (this.showAllRunnersUp) {
        main.append(el('div', 'hs-dossier-section-label', `MORE (${view.runnersUp.length})`));
        main.append(grid(view.runnersUp));
      } else {
        const more = button('more', `+ ${view.runnersUp.length} lower-relevance panels →`);
        more.className = 'hs-dossier-more';
        main.append(more);
      }
    }

    const rail = el('div', 'hs-dossier-rail');
    rail.append(el('div', 'hs-dossier-section-label', brief ? `ACTION BRIEF · ${brief.tier.toUpperCase()}` : 'ACTION BRIEF'));
    const briefEl = el('div', 'hs-dossier-brief');
    if (brief) {
      briefEl.append(el('div', 'hs-brief-tier', brief.headline));
      for (const action of brief.recommendedActions) briefEl.append(el('div', undefined, `☐ ${action}`));
      if (brief.confirmingSources.length > 0) {
        briefEl.append(el('div', undefined, `watch: ${brief.confirmingSources.join(', ')}`));
      }
    } else {
      briefEl.append(el('div', undefined, 'no action brief for this situation'));
    }
    const memory = this.memorySummary();
    if (memory) briefEl.append(el('div', 'hs-dossier-memory', memory));
    rail.append(briefEl);

    rail.append(el('div', 'hs-dossier-section-label', 'TIMELINE'));
    const timeline = el('div', 'hs-dossier-timeline');
    if (view.timeline.length === 0) {
      timeline.append(el('div', undefined, 'no trace events recorded'));
    }
    for (const row of view.timeline) {
      timeline.append(el('div', undefined, `${clock(row.at)} ${row.label}`));
    }
    rail.append(timeline);

    this.bodyEl.replaceChildren(main, rail);
  }

  private renderAnswer(question: string): void {
    if (!this.askAnswerEl) return;
    const packet = askLive(question);
    const wrap = el('div');
    wrap.append(el('div', undefined, packet.answer));
    const followups = el('div', 'hs-dossier-followups');
    for (const f of packet.followUps) {
      const b = button('followup', f);
      followups.append(b);
    }
    wrap.append(followups);
    this.askAnswerEl.replaceChildren(wrap);
  }

  private memorySummary(): string | undefined {
    if (!this.subject) return undefined;
    const book = getPlaybookFor(memoryRef(this.subject.category));
    return book ? summarizePlaybook(book) : undefined;
  }

  // ── Interactions ──────────────────────────────────────────────────

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'close') {
      this.close();
      return;
    }
    if (action === 'share') {
      this.share();
      return;
    }
    if (action === 'more') {
      this.showAllRunnersUp = true;
      if (this.view) this.renderBody(this.view, getActiveActionBrief());
      return;
    }
    if (action === 'followup') {
      const q = target.textContent ?? '';
      if (q) this.renderAnswer(q);
      return;
    }
    const panelKey = target.closest<HTMLElement>('[data-panel-key]')?.dataset.panelKey;
    if (panelKey && this.subject) {
      recordAction(memoryRef(this.subject.category), 'panel-jump', panelKey);
      this.close();
      this.opts.onOpenPanel(panelKey);
    }
  }

  private share(): void {
    if (!this.subject || !this.view) return;
    const packet = buildSharePacket({
      shareId: `dossier-${this.subject.id}`,
      briefing: {
        title: this.view.title,
        generatedAt: Date.now(),
        summary: `${this.view.badge.text} — ${this.view.subline}`,
        category: this.subject.category,
        severityScore: this.subject.severityScore,
        confidence: this.subject.confidence,
        sections: [
          { heading: 'Why this surfaced', bullets: [...this.view.whySurfaced] },
          { heading: 'Evidence', bullets: this.view.evidence.map((c) => `${c.title} — ${c.statusLabel}`) },
          { heading: 'Timeline', bullets: this.view.timeline.map((r) => `${clock(r.at)} ${r.label}`) },
        ],
      },
    });
    void navigator.clipboard?.writeText(selectFormat(packet, 'markdown'));
    if (this.subject) recordAction(memoryRef(this.subject.category), 'export', 'dossier-share');
  }
}

// ── Module-private helpers ──────────────────────────────────────────

function memoryRef(category: string): { kind: string; evidence: string[]; region: string } {
  return { kind: `dossier:${category}`, evidence: [], region: '' };
}

function readPipelineEvents(situationId: string): TraceEventLike[] | undefined {
  try {
    const entry = getPipelineTraceRegistry().get(situationId);
    if (!entry) return undefined;
    return entry.events.map((e) => ({ at: e.at, stage: e.stage, reason: e.reason }));
  } catch {
    return undefined;
  }
}

function readNotificationEvents(situationId: string): TraceEventLike[] | undefined {
  try {
    const entries = getNotificationTraceRegistry().bySituation(`nws-${situationId}`);
    if (entries.length === 0) return undefined;
    return entries.flatMap((t) => t.events.map((e) => ({ at: e.at, kind: e.kind, reason: e.reason })));
  } catch {
    return undefined;
  }
}

function grid(cards: readonly EvidenceCardView[]): HTMLElement {
  const g = el('div', 'hs-dossier-grid');
  for (const c of cards) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `hs-card hs-card-${c.tone}`;
    card.dataset.panelKey = c.panelId;
    card.append(el('div', 'hs-card-title', c.title));
    if (c.narrative) card.append(el('div', 'hs-card-narrative', c.narrative));
    card.append(el('div', 'hs-card-status', c.statusLabel));
    card.append(el('div', 'hs-card-reason', c.reason));
    g.append(card);
  }
  return g;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(action: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.action = action;
  b.textContent = label;
  return b;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
```

Verify-while-wiring points: exact member names on `PipelineTraceEntry.events` / `NotificationTraceEntry.events` (read the two registry modules if the compiler disagrees); `askLive` import path; `bySituation` availability.

- [ ] **Step 3: Typecheck + lint + commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase3 && npm run typecheck:all && node scripts/lint-colors.mjs src/styles/home-shell.css && git add src/components/SituationDossier.ts src/styles/home-shell.css && git commit -m "feat(dossier): SituationDossier drawer component

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Hosting + entry wiring

**Files:**

- Modify: `src/components/HomeShellOverlay.ts` (own the dossier; briefing-row + event entry; palette command)
- Modify: `src/app/panel-layout.ts` (tracked `cb:map-focus` listener)

- [ ] **Step 1: HomeShellOverlay owns the dossier**

In `HomeShellOverlay.ts`:

1. Imports: `SituationDossier` from `@/components/SituationDossier`; `getCommandRegistry` from `@/services/command-palette/command-registry`; type `SituationDescriptor` from `@/services/insights/action-briefs`.
2. Field: `private dossier: SituationDossier | null = null;` and `private _onOpenDossier: ((e: Event) => void) | null = null;` and `private lastSituationCommandId: string | null = null;`
3. In `mount()`, after `root.append(this.mapSlot, scroll)` — construct and mount the drawer as the third/fourth children:

```ts
    this.dossier = new SituationDossier({
      getNarrative: (id) => this.getPanel(id)?.getNarrative() || undefined,
      onLocate: (lat, lon) => {
        document.dispatchEvent(new CustomEvent('cb:map-focus', { detail: { lat, lon } }));
      },
      onOpenPanel: (panelId) => {
        this.hide();
        document.dispatchEvent(new CustomEvent('cb:navigate-panel', { detail: { panelKey: panelId } }));
      },
    });
    this.dossier.mount(root);
    this._onOpenDossier = (e: Event) => {
      const id = (e as CustomEvent<{ situationId?: string }>).detail?.situationId;
      const subject = this.resolveSituation(id);
      if (subject) {
        if (!this.visible) this.show();
        this.dossier?.open(subject);
      }
    };
    document.addEventListener('cb:open-dossier', this._onOpenDossier);
```

4. `resolveSituation(id?: string): SituationDescriptor | undefined` private method:

```ts
  private resolveSituation(id?: string): SituationDescriptor | undefined {
    const active = getActiveSituation();
    if (!id) return active;
    if (active?.id === id) return active;
    const event = getRecentEvents().find((e) => e.eventId === id);
    if (!event) return active;
    return {
      id: event.eventId,
      title: event.description,
      category: event.domain === 'earthquake' ? 'earthquake' : 'severe_weather',
      severityScore: event.severity,
      confidence: 'medium',
    };
  }
```

5. In `onClick`, add a branch BEFORE the panel-key branch:

```ts
    const situationId = target.closest<HTMLElement>('[data-situation-id]')?.dataset.situationId;
    if (situationId) {
      this.dossier?.open(this.resolveSituation(situationId) ?? { id: situationId, title: situationId, category: 'severe_weather', severityScore: 50, confidence: 'low' });
      return;
    }
```

(Simplify honestly: `resolveSituation` never returns undefined when id matches an event or active situation; the inline fallback only guards a stale row.)

6. In `refresh()`, sync the palette command for the active situation:

```ts
    this.syncSituationCommand(getActiveSituation());
```

```ts
  private syncSituationCommand(active: SituationDescriptor | undefined): void {
    const reg = getCommandRegistry();
    if (this.lastSituationCommandId) {
      reg.unregister(this.lastSituationCommandId);
      this.lastSituationCommandId = null;
    }
    if (!active) return;
    const id = 'situation:active';
    reg.register({
      id,
      title: `Dossier: ${active.title}`,
      subtitle: 'active situation',
      keywords: ['situation', 'dossier', active.title.toLowerCase()],
      category: 'navigation',
      icon: '🗂️',
      weight: 1,
      action: () => document.dispatchEvent(new CustomEvent('cb:open-dossier', { detail: { situationId: active.id } })),
    });
    this.lastSituationCommandId = id;
  }
```

7. Teardown: in `destroy()`, `this.dossier?.destroy(); this.dossier = null;` and remove `_onOpenDossier` + unregister the situation command.
8. The shell's own Escape handler needs NO change — the dossier's capture handler consumes Escape first when open.

- [ ] **Step 2: `cb:map-focus` listener in panel-layout.ts**

Next to the existing `cb:focus-place` wiring, add (tracked, mirroring `_onFocusPlace`):

```ts
 this._onMapFocus = (e: Event) => {
   const detail = (e as CustomEvent<{ lat?: number; lon?: number }>).detail;
   if (detail?.lat !== undefined && detail?.lon !== undefined) {
     this.ctx.map?.setCenter(detail.lat, detail.lon, 8);
     this.ctx.map?.flashLocation(detail.lat, detail.lon, 3000);
   }
 };
 document.addEventListener('cb:map-focus', this._onMapFocus);
```

Field `private _onMapFocus: ((e: Event) => void) | null = null;`, removal in `destroy()` next to `_onFocusPlace`. (Unlike `cb:focus-place`, this deliberately does NOT navigateToPanel — the shell keeps the map as its backdrop.)

- [ ] **Step 3: Verify + commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase3 && npm run typecheck:all && npm run test:homeshell && git add src/components/HomeShellOverlay.ts src/app/panel-layout.ts && git commit -m "feat(dossier): shell hosting, briefing-row entry, palette command, map focus

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: E2E dossier smoke

**Files:**

- Modify: `e2e/home-shell-boot.spec.ts` (add one test)

- [ ] **Step 1: Add the test** (read the file first; match its conventions):

```ts
  test('dossier opens from an injected situation and Escape closes drawer only', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.home-shell')).toBeVisible({ timeout: 30_000 });
    await page.evaluate(async () => {
      const mod = await import('/src/services/insights/insights-state.ts');
      mod.setRecentEvents([
        {
          eventId: 'e2e-sit',
          description: 'E2E synthetic storm',
          domain: 'weather',
          severity: 90,
          at: Date.now(),
          location: { latitude: 41.6, longitude: -86.7 },
        },
      ]);
      mod.setActiveSituation({
        id: 'e2e-sit',
        title: 'E2E synthetic storm',
        category: 'severe_weather',
        severityScore: 90,
        confidence: 'high',
      });
    });
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('cb:open-dossier', { detail: { situationId: 'e2e-sit' } }));
    });
    const drawer = page.locator('.hs-dossier');
    await expect(drawer).toHaveClass(/hs-dossier--open/);
    await expect(page.locator('.hs-dossier .hs-card').first()).toBeVisible();
    await expect(page.locator('.hs-dossier-badge')).toHaveText('ACT SOON · HIGH CONF');
    await page.keyboard.press('Escape');
    await expect(drawer).not.toHaveClass(/hs-dossier--open/);
    await expect(page.locator('.home-shell')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/home-shell-active/);
  });
```

- [ ] **Step 2: Run it**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase3 && VITE_VARIANT=full npx playwright test e2e/home-shell-boot.spec.ts --reporter=line
```

Expected: 3/3 pass. (If the dossier evidence card assertion is flaky because narratives are empty on cold boot, assert on `.hs-card-title` text instead.)

- [ ] **Step 3: Commit**

```bash
cd /Users/bradleybond/Developer/crystalball/.worktrees/ui-shell-phase3 && git add e2e/home-shell-boot.spec.ts && git commit -m "test(dossier): e2e drawer open/escape smoke

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Finalize — scripts, docs, smoke, PR

- [ ] **Step 1:** package.json `test:homeshell` += `src/services/home-shell/__tests__/dossier-view.test.mts`. Run it; report real total (expect 49 + 6 dossier + 2 briefing additions = ~57; use actual).
- [ ] **Step 2:** CLAUDE.md Home Shell section: append two sentences: "Phase 3 added the situation dossier (`src/components/SituationDossier.ts`, `cb:open-dossier`): evidence composed via `evidenceFor` metadata (PlaybookCategory-keyed), honest why-surfaced from pipeline/notification traces, action brief + timeline rail, context-free ask bar. Entry: critical-band briefing rows, ⌘K 'Dossier: <title>', map fly via `cb:map-focus`."
- [ ] **Step 3:** Spec status: Phase 3 line → SHIPPED + deferrals note (marker-click entry: map is a non-interactive backdrop; situation-scoped ask: AskContext has no situation slot; trigger rationales: BigEventResult not persisted upstream; bespoke M-cards: Phase 4).
- [ ] **Step 4:** Full verification: `npm run test:homeshell && npm run typecheck:all && node scripts/lint-colors.mjs && npm run smoke:offline`. Coordinator runs the live browser smoke (default boot → click critical-band row → drawer with evidence/brief/timeline → ask bar returns an answer → share writes clipboard → Esc layering with Library and cmdk open).
- [ ] **Step 5:** Commit docs; push; real Codex cross-agent review (read-only sandbox, stdin diff, fix P1s, re-run to PASS); PR with honest markers; auto-merge; verify merged SHA vs tip.

---

## Self-review notes

- **Spec §4 coverage:** header + badge (Task 2/4), why-surfaced (Tasks 2/4 — trace-based, deviation documented), evidence grid + runners-up tap-to-add (2/4), action brief + timeline rail (4), ask bar (4), share/export (4), map fly-to on entry (4/5), briefing-row + ⌘K entry (3/5), e2e (6). Deferrals listed up top and recorded in the spec note (Task 7).
- **Type consistency:** `TraceEventLike`/`DossierInputs`/`DossierView`/`EvidenceCardView` (Task 2) consumed by Task 4; `BriefingLineView.entries` (Task 3) consumed by Task 3's renderBand; `PanelHealthLike`/`DeckCardView` reused from deck-view; `memoryRef` local to Task 4.
- **Verify-while-wiring flags:** trace registry event member names (Task 4), `askLive` path, palette `weight` presence (shipped Phase 2), `getActiveSituation` import in HomeShellOverlay (already imported).
- **Honesty invariants:** whySurfaced never fabricates trigger rationales; empty traces produce an explicit "no pipeline trace recorded" line; ask bar is labeled by capability (context-free), not promise.
