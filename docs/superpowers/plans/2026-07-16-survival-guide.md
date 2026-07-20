# Survival Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browsable, always-available, offline survival-guide reference (24 hazard + preparedness topics) with interactive readiness checklists and deep links from live surfaces.

**Architecture:** A new pure, fixture-tested service layer (`src/services/survival-guide/`) holds typed static guide content, a persisted checklist store, and pure readiness scoring. A `SurvivalGuidePanel` renders index + detail views. Deep links (`cb:open-survival-guide`) let Action Briefs, the Storm Mode strip, and ⌘K hand the user the right guide, and a Command Center row shows overall readiness.

**Tech Stack:** TypeScript, Vite, the repo's `Panel` base class, `tsx --test` (node test runner) for fixtures, the existing ⌘K command registry and `cb:open-panel`/`showToast` infrastructure.

**Spec:** `docs/superpowers/specs/2026-07-16-survival-guide-design.md`

**Working dir:** `/Users/bradleybond/Developer/crystalball/.worktrees/survival-guide`, branch `claude/survival-guide-spec`.

---

## Conventions for every task

- All commands run from the worktree root:
  `cd /Users/bradleybond/Developer/crystalball/.worktrees/survival-guide`
- Test files use the `.test.mts` extension and are run with `tsx --test` (matches `test:shortage`).
- Service files are **pure**: no DOM, no `fetch`, no globals, no `Date.now()` in content modules.
- Commit messages end with `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.
- Stage files **by name**, never `git add -A`.

---

## File Structure

**Create:**
- `src/services/survival-guide/guide-types.ts` — all types
- `src/services/survival-guide/guides/*.ts` — 24 per-guide content files
- `src/services/survival-guide/guide-library.ts` — aggregator + lookups
- `src/services/survival-guide/guide-links.ts` — category/hazard → guide maps
- `src/services/survival-guide/checklist-store.ts` — persisted checked-item store
- `src/services/survival-guide/readiness-score.ts` — pure scoring
- `src/services/survival-guide/__tests__/*.test.mts` — fixtures
- `src/services/command-palette/guide-commands.ts` — ⌘K entries
- `src/components/SurvivalGuidePanel.ts` — the panel

**Modify:**
- `src/config/panels.ts` — register panel + add to category `panelKeys`
- `src/config/panel-metadata.ts` — Library/⌘K metadata under `personal-safety`
- `src/app/panel-layout.ts` — instantiate panel + install guide commands
- `src/components/PersonalStormMode.ts` — "Full guide →" link
- `src/components/CommandCenterPanel.ts` — readiness row + action-brief guide link
- `package.json` — `test:survival-guide` script

---

## Task 1: Guide types

**Files:**
- Create: `src/services/survival-guide/guide-types.ts`
- Test: `src/services/survival-guide/__tests__/guide-types.test.mts`

- [ ] **Step 1: Write the types**

Create `src/services/survival-guide/guide-types.ts`:

```ts
/**
 * Survival Guide — static reference content types.
 *
 * Pure data contract. No DOM, no fetch, no globals. Guides are hand-authored
 * from public-domain US guidance (Ready.gov / FEMA / NWS / CDC) and read
 * offline. See docs/superpowers/specs/2026-07-16-survival-guide-design.md.
 */

export type GuideId =
  // hazards (17)
  | 'tornado'
  | 'flood'
  | 'hurricane'
  | 'severe_thunderstorm'
  | 'winter_storm'
  | 'extreme_heat'
  | 'wildfire'
  | 'wildfire_smoke'
  | 'earthquake'
  | 'power_grid_outage'
  | 'fuel_shortage'
  | 'food_shortage'
  | 'disease_outbreak'
  | 'cyber_banking_outage'
  | 'civil_unrest'
  | 'armed_conflict'
  | 'nuclear_radiological'
  // preparedness basics (7)
  | 'go_bag'
  | 'water_storage'
  | 'food_storage'
  | 'family_comms_plan'
  | 'first_aid_basics'
  | 'evacuation_planning'
  | 'shelter_in_place';

export type GuideKind = 'hazard' | 'preparedness';

export interface ChecklistItem {
  /** Globally unique + stable forever. Persistence keys on this, never index. */
  id: string;
  label: string;
  detail?: string;
  /** Importance weight; readiness scoring honors it. */
  weight: 1 | 2 | 3;
}

export interface GuideStep {
  /** Imperative, execution order. */
  label: string;
  /** The "why"/how-to depth the terse playbooks lack. */
  detail?: string;
}

export interface SurvivalGuide {
  id: GuideId;
  kind: GuideKind;
  title: string;
  /** One paragraph: what this is, why it's dangerous. */
  summary: string;
  /** Early indicators / how you'll know. */
  signs: string[];
  /** Days-to-hours ahead. */
  prepare: GuideStep[];
  /** Act-now, most-urgent-first. */
  during: GuideStep[];
  /** First minutes-to-hours after. */
  after: GuideStep[];
  /** Days-to-weeks. */
  recovery: string[];
  /** Deadly mistakes to avoid (rendered loud). */
  mistakes: string[];
  /** Supplies/prep; may be empty for pure-response hazards. */
  checklist: ChecklistItem[];
  relatedGuides: GuideId[];
  /** Provenance — e.g. 'Ready.gov — Tornadoes', 'NWS', 'FEMA P-320', 'CDC'. */
  sources: string[];
}

export interface GuideReadiness {
  guideId: GuideId;
  percent: number;
  checkedWeight: number;
  totalWeight: number;
  checkedCount: number;
  totalCount: number;
}

export interface OverallReadiness {
  percent: number;
  weakest: GuideId | null;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/services/survival-guide/__tests__/guide-types.test.mts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SurvivalGuide, GuideId } from '../guide-types.ts';

test('SurvivalGuide type accepts a well-formed guide', () => {
  const g: SurvivalGuide = {
    id: 'tornado',
    kind: 'hazard',
    title: 'Tornado',
    summary: 's',
    signs: ['a'],
    prepare: [{ label: 'p' }],
    during: [{ label: 'd' }],
    after: [{ label: 'a' }],
    recovery: ['r'],
    mistakes: ['m'],
    checklist: [{ id: 'tornado.x', label: 'x', weight: 2 }],
    relatedGuides: [],
    sources: ['NWS'],
  };
  const id: GuideId = g.id;
  assert.equal(id, 'tornado');
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx tsx --test src/services/survival-guide/__tests__/guide-types.test.mts`
Expected: PASS (1 test). (This is a type-compilation gate — it fails only if the types don't compile.)

- [ ] **Step 4: Commit**

```bash
git add src/services/survival-guide/guide-types.ts src/services/survival-guide/__tests__/guide-types.test.mts
git commit -m "feat(survival-guide): guide content types

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: First guide content file (tornado) + authoring template

This task establishes the content-file shape. Tasks 3–5 replicate it for the other 23 guides.

**Files:**
- Create: `src/services/survival-guide/guides/tornado.ts`

- [ ] **Step 1: Write the tornado guide**

Create `src/services/survival-guide/guides/tornado.ts`:

```ts
import type { SurvivalGuide } from '../guide-types';

export const TORNADO_GUIDE: SurvivalGuide = {
  id: 'tornado',
  kind: 'hazard',
  title: 'Tornado',
  summary:
    'A violently rotating column of air reaching the ground. Tornadoes can form ' +
    'in minutes with winds over 200 mph, tossing vehicles and leveling buildings. ' +
    'The difference between a Watch (conditions are favorable) and a Warning (one ' +
    'has been spotted or shown on radar) decides how fast you must act.',
  signs: [
    'NWS Tornado Warning for your county or a radar-indicated cell over you',
    'A dark, often greenish sky; large hail; a wall cloud or funnel',
    'A loud continuous roar like a freight train that does not fade',
    'A sudden calm or wind shift after a thunderstorm, or debris falling from the sky',
  ],
  prepare: [
    { label: 'Identify your safe room now', detail: 'Lowest floor, interior room, no windows — a basement, storm cellar, or an interior bathroom/closet.' },
    { label: 'Set up two ways to get warnings', detail: 'A NOAA Weather Radio plus Wireless Emergency Alerts on your phone; do not rely on outdoor sirens indoors.' },
    { label: 'Keep sturdy shoes and a helmet by the safe room', detail: 'Bike or sports helmets sharply cut head-injury risk from flying debris.' },
    { label: 'Practice the drill with everyone in the household', detail: 'Everyone should reach the safe spot in under two minutes.' },
  ],
  during: [
    { label: 'Get to your safe room immediately', detail: 'Do not wait to see it. Put as many walls between you and the outside as possible.' },
    { label: 'Cover your head and neck', detail: 'Get under a sturdy table; cover with a mattress, blankets, or your arms.' },
    { label: 'If in a mobile home, get out', detail: 'Mobile homes offer almost no protection — go to a sturdy building or a designated shelter now.' },
    { label: 'If caught driving, do not shelter under an overpass', detail: 'Overpasses accelerate wind. Either drive at right angles away from the tornado, or leave the car for a low-lying ditch and cover your head.' },
  ],
  after: [
    { label: 'Stay put until the warning is lifted', detail: 'A second tornado can follow the first.' },
    { label: 'Check yourself and others for injuries', detail: 'Give first aid; do not move the seriously injured unless they are in immediate danger.' },
    { label: 'Watch for hazards', detail: 'Downed power lines, gas leaks, broken glass, and unstable structures. Do not enter damaged buildings.' },
    { label: 'Text, do not call', detail: 'Texts get through when networks are congested; conserve phone battery.' },
  ],
  recovery: [
    'Photograph damage before cleanup for insurance claims.',
    'Wear boots and gloves; assume downed lines are live.',
    'Check on neighbors, especially the elderly and those with disabilities.',
    'Only return to a damaged home after officials say it is structurally safe.',
  ],
  mistakes: [
    'Opening windows to "equalize pressure" — it does nothing and wastes life-saving seconds.',
    'Sheltering in a mobile home or vehicle instead of a sturdy structure.',
    'Hiding under a highway overpass, which funnels and speeds up the wind.',
    'Leaving shelter at the first lull — the calm can be the eye or a gap between cells.',
  ],
  checklist: [
    { id: 'tornado.safe_room', label: 'Safe room identified (interior, lowest floor, no windows)', weight: 3 },
    { id: 'tornado.weather_radio', label: 'NOAA Weather Radio or WEA alerts enabled', weight: 3 },
    { id: 'tornado.helmets', label: 'Helmets stored in the safe room', weight: 2 },
    { id: 'tornado.shoes', label: 'Sturdy shoes by the safe room', weight: 1 },
    { id: 'tornado.drill', label: 'Household drill practiced', weight: 2 },
  ],
  relatedGuides: ['severe_thunderstorm', 'shelter_in_place', 'go_bag'],
  sources: ['Ready.gov — Tornadoes', 'NWS — Tornado Safety', 'FEMA P-320 (safe rooms)'],
};
```

- [ ] **Step 2: Typecheck the file compiles**

Run: `npx tsc --noEmit 2>&1 | grep -c survival-guide/guides/tornado || echo 0`
Expected: `0` (no type errors referencing this file).

- [ ] **Step 3: Commit**

```bash
git add src/services/survival-guide/guides/tornado.ts
git commit -m "feat(survival-guide): tornado guide + content template

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Remaining hazard guides (16 files)

Write one file per guide, each exporting `const <NAME>_GUIDE: SurvivalGuide`, following the tornado template exactly (same field set, `kind: 'hazard'`, `checklist` item ids prefixed with the guide id, every guide has ≥1 `sources` entry). Fill real content distilled from Ready.gov / FEMA / NWS / CDC public guidance — no placeholder text.

**Files (create all):**
- `src/services/survival-guide/guides/flood.ts` → `FLOOD_GUIDE`
- `src/services/survival-guide/guides/hurricane.ts` → `HURRICANE_GUIDE`
- `src/services/survival-guide/guides/severe-thunderstorm.ts` → `SEVERE_THUNDERSTORM_GUIDE`
- `src/services/survival-guide/guides/winter-storm.ts` → `WINTER_STORM_GUIDE`
- `src/services/survival-guide/guides/extreme-heat.ts` → `EXTREME_HEAT_GUIDE`
- `src/services/survival-guide/guides/wildfire.ts` → `WILDFIRE_GUIDE`
- `src/services/survival-guide/guides/wildfire-smoke.ts` → `WILDFIRE_SMOKE_GUIDE`
- `src/services/survival-guide/guides/earthquake.ts` → `EARTHQUAKE_GUIDE`
- `src/services/survival-guide/guides/power-grid-outage.ts` → `POWER_GRID_OUTAGE_GUIDE`
- `src/services/survival-guide/guides/fuel-shortage.ts` → `FUEL_SHORTAGE_GUIDE`
- `src/services/survival-guide/guides/food-shortage.ts` → `FOOD_SHORTAGE_GUIDE`
- `src/services/survival-guide/guides/disease-outbreak.ts` → `DISEASE_OUTBREAK_GUIDE`
- `src/services/survival-guide/guides/cyber-banking-outage.ts` → `CYBER_BANKING_OUTAGE_GUIDE`
- `src/services/survival-guide/guides/civil-unrest.ts` → `CIVIL_UNREST_GUIDE`
- `src/services/survival-guide/guides/armed-conflict.ts` → `ARMED_CONFLICT_GUIDE`
- `src/services/survival-guide/guides/nuclear-radiological.ts` → `NUCLEAR_RADIOLOGICAL_GUIDE`

- [ ] **Step 1: Write flood, hurricane, severe-thunderstorm, winter-storm, extreme-heat** (5 files, tornado template)

Each is a full `SurvivalGuide`. Authoring rules per guide:
- `id` matches the `GuideId`; `kind: 'hazard'`.
- `summary` = one paragraph on what it is + why it kills.
- `signs`/`prepare`/`during`/`after` non-empty; `during` most-urgent-first.
- `recovery` + `mistakes` non-empty.
- `checklist` items: `id` = `<guideId>.<slug>`, `weight` 1–3, life-safety items weight 3.
- `relatedGuides` reference real `GuideId`s (never self).
- `sources` = the public guidance distilled (Ready.gov / FEMA / NWS / CDC).

Content anchors (use official guidance for the specifics):
- **flood**: "Turn Around, Don't Drown"; 6 inches moving water knocks you down, 12 floats a car; move to higher ground; never walk/drive through floodwater; checklist weight-3 items = flood-safe evacuation route + NWS/WEA alerts. sources: 'Ready.gov — Floods', 'NWS — Flood Safety', 'FEMA'.
- **hurricane**: know your evacuation zone + surge risk; the water (surge/inland flooding) kills more than wind; finish prep before the cone arrives; shelter in an interior room away from windows; checklist = evacuation zone known, 7-day supplies, storm shutters/boards, full fuel tank. sources: 'Ready.gov — Hurricanes', 'NWS — NHC', 'FEMA'.
- **severe_thunderstorm**: "When thunder roars, go indoors"; damaging straight-line wind + large hail + lightning + can spawn tornadoes; stay off corded electronics/plumbing; checklist = WEA alerts, secure outdoor items, surge protection. relatedGuides includes `tornado`. sources: 'Ready.gov — Thunderstorms & Lightning', 'NWS'.
- **winter_storm**: hypothermia + CO poisoning + frozen pipes + road death; keep a car winter kit; never run a generator/grill indoors; layer + stay dry; checklist = home heat backup plan, car winter kit, CO detector, 3-day water/food. sources: 'Ready.gov — Winter Weather', 'NWS', 'CDC'.
- **extreme_heat**: heat stroke is a medical emergency; never leave people/pets in cars; hydrate + find AC/cooling center; know signs of heat exhaustion vs stroke; checklist = cooling-center location, AC/fan plan, electrolyte supplies, check-in plan for vulnerable people. sources: 'Ready.gov — Extreme Heat', 'CDC', 'NWS — HeatRisk'.

- [ ] **Step 2: Write wildfire, wildfire-smoke, earthquake, power-grid-outage** (4 files)

- **wildfire**: two evacuation routes; go-bag ready; park facing out; close vents/windows; leave early — do not wait for an order if you feel unsafe; checklist = go-bag ready (weight 3), two routes, defensible space, N95 masks, alerts (CodeRed/Nixle). relatedGuides `wildfire_smoke`, `evacuation_planning`, `go_bag`. sources: 'Ready.gov — Wildfires', 'CAL FIRE / Ready for Wildfire', 'NIFC'.
- **wildfire_smoke**: PM2.5 harms heart/lungs; check AQI; create a clean-air room with a HEPA/box-fan filter; N95 (not cloth) outdoors; limit exertion; checklist = HEPA or box-fan filter, N95 masks, AQI source bookmarked, clean-air room chosen. relatedGuides `wildfire`, `shelter_in_place`. sources: 'AirNow.gov', 'CDC', 'EPA'.
- **earthquake**: "Drop, Cover, Hold On"; do not run outside; expect aftershocks; if near coast + strong/long shaking, move to high ground (tsunami); checklist = heavy furniture anchored, gas-shutoff wrench, sturdy-table cover spots known, water stored. relatedGuides `shelter_in_place`, `go_bag`, `water_storage`. sources: 'Ready.gov — Earthquakes', 'USGS', 'FEMA / Great ShakeOut'.
- **power_grid_outage**: keep fridge/freezer closed (4 hrs / 48 hrs full); never run a generator indoors or in a garage (CO); medically fragile need a power plan; watch food safety "when in doubt, throw it out"; checklist = generator + outdoor-only plan, CO detector, powered-medical-device backup, coolers + ice plan, cash on hand. relatedGuides `cyber_banking_outage`, `water_storage`, `food_storage`. sources: 'Ready.gov — Power Outages', 'CDC (CO safety)', 'FoodSafety.gov'.

- [ ] **Step 3: Write fuel-shortage, food-shortage, disease-outbreak** (3 files)

- **fuel_shortage**: keep tank above half; do not panic-buy or hoard gasoline in unsafe containers; confirm with two sources; plan for heating-fuel dependence; checklist = tank-above-half habit, approved fuel containers, heating-fuel reserve plan, non-driving errand plan. relatedGuides `power_grid_outage`, `evacuation_planning`. sources: 'Ready.gov', 'EIA', 'US Fire Administration (fuel storage safety)'.
- **food_shortage**: build a 2-week non-perishable supply gradually (not panic-buying); rotate FIFO; store calorie-dense shelf-stable food + manual can opener; account for diets/allergies/pets; checklist = 2-week non-perishable supply, manual can opener, FIFO rotation, special-diet/pet food. relatedGuides `water_storage`, `food_storage`. sources: 'Ready.gov — Food', 'USDA', 'FEMA'.
- **disease_outbreak**: follow official public-health guidance; hand hygiene + stay home when sick; keep 2–4 weeks of meds + a sick-room plan; verify info from CDC/local health dept, not rumor; checklist = 2–4 week medication supply, sick-room plan, hygiene supplies, trusted info source bookmarked. relatedGuides `first_aid_basics`, `shelter_in_place`. sources: 'CDC', 'Ready.gov — Pandemic', 'WHO'.

- [ ] **Step 4: Write cyber-banking-outage, civil-unrest, armed-conflict, nuclear-radiological** (4 files)

- **cyber_banking_outage**: keep a small cash reserve; know a card outage can hit fuel/groceries; do not fall for "your account is locked" scams during outages; keep offline copies of key account/contact info; checklist = cash reserve, offline record of key accounts, secondary payment method, MFA on financial accounts. relatedGuides `power_grid_outage`. sources: 'CISA', 'FDIC / consumer guidance', 'Ready.gov'.
- **civil_unrest**: avoid crowds and demonstrations; leave early if one forms; know two exit routes; keep documents + go-bag ready; do not film confrontations up close; checklist = two exit routes home, go-bag ready, documents copied, local-news/official-alert source. relatedGuides `evacuation_planning`, `go_bag`, `shelter_in_place`. sources: 'State Dept traveler guidance', 'Ready.gov', 'ICRC (civilian safety)'.
- **armed_conflict**: the decision is shelter-in-place vs evacuate — decide on official guidance + your safety; keep documents/cash/meds/go-bag ready; identify the strongest interior shelter; have a family reunification + out-of-area contact plan; if evacuating, leave early on official routes. checklist = go-bag + documents + cash ready, strongest interior shelter identified, reunification plan, out-of-area contact, evacuation route + shelter-in-place both planned. relatedGuides `shelter_in_place`, `evacuation_planning`, `go_bag`, `nuclear_radiological`, `family_comms_plan`. sources: 'ICRC', 'Ready.gov', 'FEMA'.
- **nuclear_radiological**: "Get Inside, Stay Inside, Stay Tuned"; put mass (concrete/earth) + distance between you and fallout; go to a basement or building center; remove + bag outer clothing, wash; shelter 24–48h+ until officials guide you out; do not take potassium iodide unless public-health officials direct it. checklist = nearest sturdy/below-grade shelter known, sealed water/food in shelter, battery/hand-crank radio, plan to shelter 24h+, shelter-in-place supplies. relatedGuides `shelter_in_place`, `armed_conflict`, `water_storage`. sources: 'Ready.gov — Nuclear Explosion', 'CDC Radiation Emergencies', 'FEMA'.

- [ ] **Step 5: Typecheck all 16 compile**

Run: `npx tsc --noEmit 2>&1 | grep survival-guide/guides || echo "guides OK"`
Expected: `guides OK`.

- [ ] **Step 6: Commit**

```bash
git add src/services/survival-guide/guides/flood.ts src/services/survival-guide/guides/hurricane.ts src/services/survival-guide/guides/severe-thunderstorm.ts src/services/survival-guide/guides/winter-storm.ts src/services/survival-guide/guides/extreme-heat.ts src/services/survival-guide/guides/wildfire.ts src/services/survival-guide/guides/wildfire-smoke.ts src/services/survival-guide/guides/earthquake.ts src/services/survival-guide/guides/power-grid-outage.ts src/services/survival-guide/guides/fuel-shortage.ts src/services/survival-guide/guides/food-shortage.ts src/services/survival-guide/guides/disease-outbreak.ts src/services/survival-guide/guides/cyber-banking-outage.ts src/services/survival-guide/guides/civil-unrest.ts src/services/survival-guide/guides/armed-conflict.ts src/services/survival-guide/guides/nuclear-radiological.ts
git commit -m "feat(survival-guide): 16 hazard guides

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Preparedness-basics guides (7 files)

Same shape, `kind: 'preparedness'`. These are checklist-heavy (they're the "get ready" guides). `during`/`after` are still filled (e.g. go-bag "during" = grab-and-go steps) but `signs` may describe when you'd reach for the item.

**Files (create all):**
- `src/services/survival-guide/guides/go-bag.ts` → `GO_BAG_GUIDE`
- `src/services/survival-guide/guides/water-storage.ts` → `WATER_STORAGE_GUIDE`
- `src/services/survival-guide/guides/food-storage.ts` → `FOOD_STORAGE_GUIDE`
- `src/services/survival-guide/guides/family-comms-plan.ts` → `FAMILY_COMMS_PLAN_GUIDE`
- `src/services/survival-guide/guides/first-aid-basics.ts` → `FIRST_AID_BASICS_GUIDE`
- `src/services/survival-guide/guides/evacuation-planning.ts` → `EVACUATION_PLANNING_GUIDE`
- `src/services/survival-guide/guides/shelter-in-place.ts` → `SHELTER_IN_PLACE_GUIDE`

- [ ] **Step 1: Write go-bag, water-storage, food-storage** (3 files)

- **go_bag**: one per person, grab-and-go in 60 seconds; checklist = 3-day water (weight 3), non-perishable food, meds (weight 3), flashlight + batteries, first-aid kit, phone charger/battery, cash, copies of documents, N95 masks, whistle, weather radio, sturdy shoes, spare clothes, emergency blanket. sources: 'Ready.gov — Build A Kit', 'FEMA', 'Red Cross'.
- **water_storage**: one gallon per person per day, 3 days minimum / 2 weeks ideal; store commercially bottled or properly sanitized containers; replace per label; know how to disinfect (boil 1 min, or unscented bleach); checklist = 1 gal/person/day for 3 days (weight 3), 2-week goal, food-grade containers, disinfection method known. sources: 'Ready.gov — Water', 'CDC (water treatment)', 'FEMA'.
- **food_storage**: 2-week shelf-stable supply; calorie-dense, low-water-needs foods; manual can opener; rotate FIFO; account for infants/pets/diets; checklist = 2-week supply, manual can opener, FIFO rotation labels, special-diet/infant/pet food. sources: 'Ready.gov — Food', 'USDA', 'FEMA'.

- [ ] **Step 2: Write family-comms-plan, first-aid-basics** (2 files)

- **family_comms_plan**: pick an out-of-area contact (local lines jam); everyone memorizes/carries it; agree on two meeting places (near home + outside neighborhood); know school/work reunification plans; text over call; checklist = out-of-area contact chosen + shared (weight 3), two meeting places, contact card in each go-bag, school/work plans known. sources: 'Ready.gov — Make A Plan', 'FEMA', 'Red Cross'.
- **first_aid_basics**: keep a stocked kit; learn to control bleeding (pressure/tourniquet), CPR, recognize shock/stroke/heart attack; know your family's meds + allergies; checklist = stocked first-aid kit (weight 3), bleeding-control supplies, CPR training, med/allergy list, know nearest ER. sources: 'Red Cross', 'CDC', 'Ready.gov'.

- [ ] **Step 3: Write evacuation-planning, shelter-in-place** (2 files)

- **evacuation_planning**: know your zones + two routes out (highways jam); keep tank above half; plan for pets + mobility needs; grab go-bag + documents; agree where to meet + who to call; leave early; checklist = two evacuation routes (weight 3), go-bag + documents ready, pet/mobility plan, tank-above-half habit, destination + contact agreed. relatedGuides `go_bag`, `family_comms_plan`. sources: 'Ready.gov — Evacuation', 'FEMA'.
- **shelter_in_place**: when outside air/threat is the danger, get in, seal up, tune in; interior room, close/seal doors-windows-vents; have water/food/radio/sanitation inside; know it's temporary until officials clear you; checklist = interior shelter room chosen (weight 3), sealing supplies (plastic + tape), radio, water/food/sanitation in room, official alert source. relatedGuides `nuclear_radiological`, `wildfire_smoke`, `disease_outbreak`. sources: 'Ready.gov — Shelter', 'CDC', 'FEMA'.

- [ ] **Step 4: Typecheck all 7 compile**

Run: `npx tsc --noEmit 2>&1 | grep survival-guide/guides || echo "guides OK"`
Expected: `guides OK`.

- [ ] **Step 5: Commit**

```bash
git add src/services/survival-guide/guides/go-bag.ts src/services/survival-guide/guides/water-storage.ts src/services/survival-guide/guides/food-storage.ts src/services/survival-guide/guides/family-comms-plan.ts src/services/survival-guide/guides/first-aid-basics.ts src/services/survival-guide/guides/evacuation-planning.ts src/services/survival-guide/guides/shelter-in-place.ts
git commit -m "feat(survival-guide): 7 preparedness-basics guides

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Guide library aggregator

**Files:**
- Create: `src/services/survival-guide/guide-library.ts`
- Test: `src/services/survival-guide/__tests__/guide-library.test.mts`

- [ ] **Step 1: Write the aggregator**

Create `src/services/survival-guide/guide-library.ts`:

```ts
/**
 * Aggregates the 24 per-guide content files into one library + lookups.
 * Pure. No DOM, no fetch.
 */

import type { GuideId, SurvivalGuide } from './guide-types';

import { TORNADO_GUIDE } from './guides/tornado';
import { FLOOD_GUIDE } from './guides/flood';
import { HURRICANE_GUIDE } from './guides/hurricane';
import { SEVERE_THUNDERSTORM_GUIDE } from './guides/severe-thunderstorm';
import { WINTER_STORM_GUIDE } from './guides/winter-storm';
import { EXTREME_HEAT_GUIDE } from './guides/extreme-heat';
import { WILDFIRE_GUIDE } from './guides/wildfire';
import { WILDFIRE_SMOKE_GUIDE } from './guides/wildfire-smoke';
import { EARTHQUAKE_GUIDE } from './guides/earthquake';
import { POWER_GRID_OUTAGE_GUIDE } from './guides/power-grid-outage';
import { FUEL_SHORTAGE_GUIDE } from './guides/fuel-shortage';
import { FOOD_SHORTAGE_GUIDE } from './guides/food-shortage';
import { DISEASE_OUTBREAK_GUIDE } from './guides/disease-outbreak';
import { CYBER_BANKING_OUTAGE_GUIDE } from './guides/cyber-banking-outage';
import { CIVIL_UNREST_GUIDE } from './guides/civil-unrest';
import { ARMED_CONFLICT_GUIDE } from './guides/armed-conflict';
import { NUCLEAR_RADIOLOGICAL_GUIDE } from './guides/nuclear-radiological';
import { GO_BAG_GUIDE } from './guides/go-bag';
import { WATER_STORAGE_GUIDE } from './guides/water-storage';
import { FOOD_STORAGE_GUIDE } from './guides/food-storage';
import { FAMILY_COMMS_PLAN_GUIDE } from './guides/family-comms-plan';
import { FIRST_AID_BASICS_GUIDE } from './guides/first-aid-basics';
import { EVACUATION_PLANNING_GUIDE } from './guides/evacuation-planning';
import { SHELTER_IN_PLACE_GUIDE } from './guides/shelter-in-place';

/** Library order = display order (hazards first, then preparedness). */
export const ALL_GUIDES: readonly SurvivalGuide[] = [
  TORNADO_GUIDE,
  FLOOD_GUIDE,
  HURRICANE_GUIDE,
  SEVERE_THUNDERSTORM_GUIDE,
  WINTER_STORM_GUIDE,
  EXTREME_HEAT_GUIDE,
  WILDFIRE_GUIDE,
  WILDFIRE_SMOKE_GUIDE,
  EARTHQUAKE_GUIDE,
  POWER_GRID_OUTAGE_GUIDE,
  FUEL_SHORTAGE_GUIDE,
  FOOD_SHORTAGE_GUIDE,
  DISEASE_OUTBREAK_GUIDE,
  CYBER_BANKING_OUTAGE_GUIDE,
  CIVIL_UNREST_GUIDE,
  ARMED_CONFLICT_GUIDE,
  NUCLEAR_RADIOLOGICAL_GUIDE,
  GO_BAG_GUIDE,
  WATER_STORAGE_GUIDE,
  FOOD_STORAGE_GUIDE,
  FAMILY_COMMS_PLAN_GUIDE,
  FIRST_AID_BASICS_GUIDE,
  EVACUATION_PLANNING_GUIDE,
  SHELTER_IN_PLACE_GUIDE,
];

const BY_ID: ReadonlyMap<GuideId, SurvivalGuide> = new Map(ALL_GUIDES.map((g) => [g.id, g]));

export function allGuides(): readonly SurvivalGuide[] {
  return ALL_GUIDES;
}

export function getGuide(id: GuideId): SurvivalGuide | undefined {
  return BY_ID.get(id);
}

export function guidesByKind(kind: SurvivalGuide['kind']): SurvivalGuide[] {
  return ALL_GUIDES.filter((g) => g.kind === kind);
}
```

- [ ] **Step 2: Write the failing test**

Create `src/services/survival-guide/__tests__/guide-library.test.mts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allGuides, getGuide, guidesByKind } from '../guide-library.ts';

test('library holds all 24 guides with unique ids', () => {
  const guides = allGuides();
  assert.equal(guides.length, 24);
  const ids = new Set(guides.map((g) => g.id));
  assert.equal(ids.size, 24);
});

test('17 hazards + 7 preparedness', () => {
  assert.equal(guidesByKind('hazard').length, 17);
  assert.equal(guidesByKind('preparedness').length, 7);
});

test('every guide is well-formed', () => {
  const seenChecklistIds = new Set<string>();
  for (const g of allGuides()) {
    assert.ok(g.summary.length > 0, `${g.id} summary`);
    assert.ok(g.signs.length > 0, `${g.id} signs`);
    assert.ok(g.prepare.length > 0, `${g.id} prepare`);
    assert.ok(g.during.length > 0, `${g.id} during`);
    assert.ok(g.after.length > 0, `${g.id} after`);
    assert.ok(g.mistakes.length > 0, `${g.id} mistakes`);
    assert.ok(g.sources.length > 0, `${g.id} sources`);
    for (const item of g.checklist) {
      assert.ok(item.id.startsWith(`${g.id}.`), `${item.id} must be prefixed by guide id`);
      assert.ok(!seenChecklistIds.has(item.id), `duplicate checklist id ${item.id}`);
      seenChecklistIds.add(item.id);
    }
    for (const rel of g.relatedGuides) {
      assert.notEqual(rel, g.id, `${g.id} relatedGuides must not self-reference`);
      assert.ok(getGuide(rel), `${g.id} relatedGuides -> unknown ${rel}`);
    }
  }
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx tsx --test src/services/survival-guide/__tests__/guide-library.test.mts`
Expected: PASS (3 tests). If a guide fails a `.length > 0` or prefix assertion, fix that guide's content (this catches authoring gaps from Tasks 2–4).

- [ ] **Step 4: Commit**

```bash
git add src/services/survival-guide/guide-library.ts src/services/survival-guide/__tests__/guide-library.test.mts
git commit -m "feat(survival-guide): guide library aggregator + completeness tests

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Guide links (category/hazard → guide)

`WeatherHazardKind` is the union in `src/services/weather/weather-threat-types.ts`. `PlaybookCategory` is the union in `src/services/insights/reaction-playbooks.ts`.

**Files:**
- Create: `src/services/survival-guide/guide-links.ts`
- Test: `src/services/survival-guide/__tests__/guide-links.test.mts`

- [ ] **Step 1: Confirm the source unions**

Run: `grep -n "export type WeatherHazardKind" -A 30 src/services/weather/weather-threat-types.ts`
Run: `grep -n "export type PlaybookCategory" -A 14 src/services/insights/reaction-playbooks.ts`
Note the exact member names — the maps below must be **total** over both unions.

- [ ] **Step 2: Write the link maps**

Create `src/services/survival-guide/guide-links.ts`. Fill every `WeatherHazardKind` and every `PlaybookCategory` key (use the members printed in Step 1 — do not guess). Template:

```ts
/**
 * Maps live-situation taxonomies onto survival guides so reactive surfaces
 * (Action Brief, Storm Mode, dossier) can deep-link to the right reference.
 * Pure. Must be TOTAL over both source unions — enforced by unit test.
 */

import type { GuideId } from './guide-types';
import type { PlaybookCategory } from '../insights/reaction-playbooks';
import type { WeatherHazardKind } from '../weather/weather-threat-types';

/** Each PlaybookCategory → one or more guides (most-relevant first). */
export const GUIDES_BY_PLAYBOOK_CATEGORY: Record<PlaybookCategory, readonly GuideId[]> = {
  severe_weather: ['severe_thunderstorm', 'tornado', 'flood', 'shelter_in_place'],
  wildfire: ['wildfire', 'wildfire_smoke', 'evacuation_planning'],
  oil_fuel_shortage: ['fuel_shortage'],
  food_shortage: ['food_shortage', 'food_storage'],
  cyber_campaign: ['cyber_banking_outage'],
  banking_outage: ['cyber_banking_outage'],
  conflict_escalation: ['armed_conflict', 'shelter_in_place', 'go_bag'],
  travel_disruption: ['evacuation_planning', 'go_bag'],
  grid_outage: ['power_grid_outage'],
  disease_outbreak: ['disease_outbreak'],
  earthquake: ['earthquake', 'shelter_in_place'],
  // NOTE: if Step 1 shows a PlaybookCategory member not listed here, add it.
};

/** Each WeatherHazardKind → the single best guide. */
export const GUIDE_BY_WEATHER_HAZARD: Record<WeatherHazardKind, GuideId> = {
  // Fill EVERY member from Step 1. Examples (rename/extend to match the real union):
  tornado: 'tornado',
  flash_flood: 'flood',
  flood: 'flood',
  hurricane: 'hurricane',
  severe_thunderstorm: 'severe_thunderstorm',
  winter_storm: 'winter_storm',
  extreme_heat: 'extreme_heat',
  wildfire: 'wildfire',
  wildfire_smoke: 'wildfire_smoke',
  // ...map each remaining hazard to its closest guide (e.g. high_wind ->
  // severe_thunderstorm, blizzard -> winter_storm, dust_storm ->
  // shelter_in_place). No hazard may be left out.
};

export function guidesForPlaybookCategory(cat: PlaybookCategory): readonly GuideId[] {
  return GUIDES_BY_PLAYBOOK_CATEGORY[cat] ?? [];
}

export function guideForWeatherHazard(hazard: WeatherHazardKind): GuideId | undefined {
  return GUIDE_BY_WEATHER_HAZARD[hazard];
}
```

- [ ] **Step 3: Write the totality test**

Create `src/services/survival-guide/__tests__/guide-links.test.mts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDES_BY_PLAYBOOK_CATEGORY, GUIDE_BY_WEATHER_HAZARD, guidesForPlaybookCategory, guideForWeatherHazard } from '../guide-links.ts';
import { getGuide } from '../guide-library.ts';

test('every playbook-category guide id resolves', () => {
  for (const [cat, ids] of Object.entries(GUIDES_BY_PLAYBOOK_CATEGORY)) {
    assert.ok(ids.length > 0, `${cat} has no guides`);
    for (const id of ids) assert.ok(getGuide(id), `${cat} -> unknown ${id}`);
  }
});

test('every weather-hazard guide id resolves', () => {
  for (const [hazard, id] of Object.entries(GUIDE_BY_WEATHER_HAZARD)) {
    assert.ok(getGuide(id), `${hazard} -> unknown ${id}`);
  }
});

test('lookups return expected shapes', () => {
  assert.ok(Array.isArray(guidesForPlaybookCategory('earthquake')));
  assert.equal(guideForWeatherHazard('tornado'), 'tornado');
});
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx tsx --test src/services/survival-guide/__tests__/guide-links.test.mts`
Expected: PASS (3 tests).
Run: `npx tsc --noEmit 2>&1 | grep guide-links || echo OK`
Expected: `OK` — **critically**, if the `Record<WeatherHazardKind, GuideId>` or `Record<PlaybookCategory, ...>` is missing a member, `tsc` errors here. That compile error IS the totality guarantee; fix by adding the missing key.

- [ ] **Step 5: Commit**

```bash
git add src/services/survival-guide/guide-links.ts src/services/survival-guide/__tests__/guide-links.test.mts
git commit -m "feat(survival-guide): category/hazard -> guide link maps

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Readiness scoring (pure)

> **LEARNING-MODE CONTRIBUTION:** The weighted-ratio formula below is the default. If the user wants a different emphasis (e.g. a guide isn't "ready" until every weight-3 item is checked, regardless of percent), this is the function to change. The signature and return type are fixed by Task 1; only the body is open.

**Files:**
- Create: `src/services/survival-guide/readiness-score.ts`
- Test: `src/services/survival-guide/__tests__/readiness-score.test.mts`

- [ ] **Step 1: Write the failing test**

Create `src/services/survival-guide/__tests__/readiness-score.test.mts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SurvivalGuide } from '../guide-types.ts';
import { computeGuideReadiness, computeOverallReadiness } from '../readiness-score.ts';

function guide(id: string, checklist: SurvivalGuide['checklist']): SurvivalGuide {
  return {
    id: id as SurvivalGuide['id'], kind: 'hazard', title: id, summary: 's',
    signs: ['a'], prepare: [{ label: 'p' }], during: [{ label: 'd' }],
    after: [{ label: 'a' }], recovery: ['r'], mistakes: ['m'],
    checklist, relatedGuides: [], sources: ['x'],
  };
}

const g = guide('tornado', [
  { id: 'tornado.a', label: 'a', weight: 3 },
  { id: 'tornado.b', label: 'b', weight: 1 },
]);

test('empty checklist -> null', () => {
  assert.equal(computeGuideReadiness(guide('flood', []), new Set()), null);
});

test('0 checked -> 0%', () => {
  const r = computeGuideReadiness(g, new Set());
  assert.equal(r?.percent, 0);
});

test('all checked -> 100%', () => {
  const r = computeGuideReadiness(g, new Set(['tornado.a', 'tornado.b']));
  assert.equal(r?.percent, 100);
});

test('weights respected (weight-3 of 4 total = 75%)', () => {
  const r = computeGuideReadiness(g, new Set(['tornado.a']));
  assert.equal(r?.percent, 75);
  assert.equal(r?.checkedCount, 1);
});

test('unknown checked ids ignored', () => {
  const r = computeGuideReadiness(g, new Set(['tornado.a', 'not-a-real-id']));
  assert.equal(r?.checkedCount, 1);
});

test('overall = mean of per-guide, weakest = lowest', () => {
  const a = guide('tornado', [{ id: 'tornado.a', label: 'a', weight: 1 }]);
  const b = guide('flood', [{ id: 'flood.a', label: 'a', weight: 1 }, { id: 'flood.b', label: 'b', weight: 1 }]);
  const overall = computeOverallReadiness([a, b], new Set(['tornado.a', 'flood.a']));
  // tornado 100%, flood 50% -> mean 75, weakest flood
  assert.equal(overall.percent, 75);
  assert.equal(overall.weakest, 'flood');
});

test('overall ignores checklist-less guides', () => {
  const a = guide('tornado', [{ id: 'tornado.a', label: 'a', weight: 1 }]);
  const none = guide('civil_unrest', []);
  const overall = computeOverallReadiness([a, none], new Set(['tornado.a']));
  assert.equal(overall.percent, 100);
  assert.equal(overall.weakest, 'tornado');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/survival-guide/__tests__/readiness-score.test.mts`
Expected: FAIL ("Cannot find module '../readiness-score.ts'").

- [ ] **Step 3: Write the implementation**

Create `src/services/survival-guide/readiness-score.ts`:

```ts
/**
 * Pure readiness scoring over a guide's checklist. No state, no storage.
 * Default: weighted ratio of checked-item weight to total weight.
 */

import type { GuideId, GuideReadiness, OverallReadiness, SurvivalGuide } from './guide-types';

export function computeGuideReadiness(
  guide: SurvivalGuide,
  checkedIds: ReadonlySet<string>,
): GuideReadiness | null {
  if (guide.checklist.length === 0) return null;

  let totalWeight = 0;
  let checkedWeight = 0;
  let checkedCount = 0;
  for (const item of guide.checklist) {
    totalWeight += item.weight;
    if (checkedIds.has(item.id)) {
      checkedWeight += item.weight;
      checkedCount += 1;
    }
  }

  const percent = totalWeight === 0 ? 0 : Math.round((checkedWeight / totalWeight) * 100);
  return {
    guideId: guide.id,
    percent,
    checkedWeight,
    totalWeight,
    checkedCount,
    totalCount: guide.checklist.length,
  };
}

export function computeOverallReadiness(
  guides: readonly SurvivalGuide[],
  checkedIds: ReadonlySet<string>,
): OverallReadiness {
  const scored = guides
    .map((g) => computeGuideReadiness(g, checkedIds))
    .filter((r): r is GuideReadiness => r !== null);

  if (scored.length === 0) return { percent: 0, weakest: null };

  const sum = scored.reduce((acc, r) => acc + r.percent, 0);
  const percent = Math.round(sum / scored.length);

  let weakest: GuideId | null = null;
  let lowest = Infinity;
  for (const r of scored) {
    if (r.percent < lowest) {
      lowest = r.percent;
      weakest = r.guideId;
    }
  }
  return { percent, weakest };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/survival-guide/__tests__/readiness-score.test.mts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/survival-guide/readiness-score.ts src/services/survival-guide/__tests__/readiness-score.test.mts
git commit -m "feat(survival-guide): pure readiness scoring

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Persisted checklist store

Mirrors the saved-places singleton pattern: a module-closure `Set`, `safeSetItem` persistence, subscriber list. Key `cb-survival-checklist` is **not** added to `EVICTABLE_CACHE_PREFIXES`, so it's precious-by-default and never evicted.

**Files:**
- Create: `src/services/survival-guide/checklist-store.ts`
- Test: `src/services/survival-guide/__tests__/checklist-store.test.mts`

- [ ] **Step 1: Write the failing test**

Create `src/services/survival-guide/__tests__/checklist-store.test.mts`:

```ts
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// In-memory localStorage shim for node test runtime.
class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
(globalThis as Record<string, unknown>).localStorage = new MemStorage();

const {
  isChecked, setChecked, toggle, getCheckedIds, subscribe, _resetForTest, _hydrateForTest,
} = await import('../checklist-store.ts');

beforeEach(() => {
  (globalThis.localStorage as unknown as MemStorage).clear();
  _resetForTest();
});

test('toggle round-trips through storage', () => {
  assert.equal(isChecked('tornado.safe_room'), false);
  toggle('tornado.safe_room');
  assert.equal(isChecked('tornado.safe_room'), true);
  // A fresh hydrate reads persisted state.
  _resetForTest();
  _hydrateForTest();
  assert.equal(isChecked('tornado.safe_room'), true);
});

test('setChecked(false) removes', () => {
  setChecked('a.b', true);
  setChecked('a.b', false);
  assert.equal(getCheckedIds().has('a.b'), false);
});

test('subscribers fire on change', () => {
  let calls = 0;
  const un = subscribe(() => { calls += 1; });
  toggle('x.y');
  assert.equal(calls, 1);
  un();
  toggle('x.z');
  assert.equal(calls, 1);
});

test('pruneUnknown drops ids not in the valid set', async () => {
  const { pruneUnknown } = await import('../checklist-store.ts');
  setChecked('keep.a', true);
  setChecked('drop.b', true);
  pruneUnknown(new Set(['keep.a']));
  assert.equal(isChecked('keep.a'), true);
  assert.equal(isChecked('drop.b'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/services/survival-guide/__tests__/checklist-store.test.mts`
Expected: FAIL ("Cannot find module '../checklist-store.ts'").

- [ ] **Step 3: Write the implementation**

Create `src/services/survival-guide/checklist-store.ts`:

```ts
/**
 * Persisted survival-checklist state: which ChecklistItem ids are ticked.
 *
 * Singleton (module closure). Persists to localStorage key
 * `cb-survival-checklist` via the quota-safe writer. The key is deliberately
 * NOT in EVICTABLE_CACHE_PREFIXES, so quota-pressure eviction never wipes the
 * user's prep state. Degrades to in-memory when storage is unavailable —
 * guides stay readable, ticks last the session, nothing throws.
 */

import { safeSetItem } from '@/utils';

const STORAGE_KEY = 'cb-survival-checklist';
const VERSION = 1;

let checked = new Set<string>();
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return;
    const parsed = JSON.parse(raw) as { v?: number; checked?: unknown };
    if (parsed && parsed.v === VERSION && Array.isArray(parsed.checked)) {
      checked = new Set(parsed.checked.filter((x): x is string => typeof x === 'string'));
    }
  } catch {
    // Corrupt/absent — start empty.
  }
}

function persist(): void {
  try {
    safeSetItem(STORAGE_KEY, JSON.stringify({ v: VERSION, checked: [...checked] }));
  } catch {
    // safeSetItem never throws; guard is belt-and-suspenders for the shim.
  }
}

function notify(): void {
  for (const fn of listeners) fn();
}

export function getCheckedIds(): ReadonlySet<string> {
  hydrate();
  return checked;
}

export function isChecked(id: string): boolean {
  hydrate();
  return checked.has(id);
}

export function setChecked(id: string, value: boolean): void {
  hydrate();
  const had = checked.has(id);
  if (value && !had) checked.add(id);
  else if (!value && had) checked.delete(id);
  else return;
  persist();
  notify();
}

export function toggle(id: string): void {
  setChecked(id, !isChecked(id));
}

/** Drop any checked id not present in `validIds` (content edits). */
export function pruneUnknown(validIds: ReadonlySet<string>): void {
  hydrate();
  let changed = false;
  for (const id of [...checked]) {
    if (!validIds.has(id)) {
      checked.delete(id);
      changed = true;
    }
  }
  if (changed) {
    persist();
    notify();
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only. */
export function _resetForTest(): void {
  checked = new Set();
  hydrated = false;
  listeners.clear();
}
/** Test-only: force a re-read from storage. */
export function _hydrateForTest(): void {
  hydrate();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/services/survival-guide/__tests__/checklist-store.test.mts`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify the key is NOT evictable**

Run: `grep -c "cb-survival-checklist" src/utils/safe-storage.ts`
Expected: `0` (absent from the evictable list = precious). If someone added it, remove it.

- [ ] **Step 6: Commit**

```bash
git add src/services/survival-guide/checklist-store.ts src/services/survival-guide/__tests__/checklist-store.test.mts
git commit -m "feat(survival-guide): persisted checklist store

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Wire the test script + run the full suite

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the test script**

In `package.json`, immediately after the `"test:datacenter": ...` line (line ~81), add:

```json
    "test:survival-guide": "tsx --test src/services/survival-guide/__tests__/guide-types.test.mts src/services/survival-guide/__tests__/guide-library.test.mts src/services/survival-guide/__tests__/guide-links.test.mts src/services/survival-guide/__tests__/readiness-score.test.mts src/services/survival-guide/__tests__/checklist-store.test.mts",
```

(Ensure the preceding line keeps its trailing comma and JSON stays valid.)

- [ ] **Step 2: Run the full survival-guide suite**

Run: `npm run test:survival-guide`
Expected: all suites PASS, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test(survival-guide): add test:survival-guide script

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 10: SurvivalGuidePanel (index + detail + checklist)

The panel owns deep-link handling: it listens for `cb:open-survival-guide`, selects the target guide (or index on unknown/missing id + toast), and re-dispatches `cb:open-panel` so the shell/classic machinery fronts it.

**Files:**
- Create: `src/components/SurvivalGuidePanel.ts`

Reference patterns: `ShortageRadarPanel.ts` (Panel subclass, delegated click handler, `renderWhenVisible`, `destroy`), `Panel.setContent(html)`.

- [ ] **Step 1: Write the panel**

Create `src/components/SurvivalGuidePanel.ts`:

```ts
import { Panel } from './Panel';
import { showToast } from './Toast';
import type { GuideId, SurvivalGuide } from '@/services/survival-guide/guide-types';
import { allGuides, getGuide, guidesByKind } from '@/services/survival-guide/guide-library';
import { computeGuideReadiness } from '@/services/survival-guide/readiness-score';
import { getCheckedIds, isChecked, toggle, subscribe } from '@/services/survival-guide/checklist-store';

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

export class SurvivalGuidePanel extends Panel {
  private selected: GuideId | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    super({
      id: 'survival-guide',
      title: 'Survival Guide',
      trackActivity: true,
      infoTooltip:
        'Offline reference guidance for hazards and preparedness. Distilled from public FEMA/Ready.gov/NWS/CDC materials — always follow local emergency officials.',
    });
    this.start();
  }

  private start(): void {
    this.render();
    this.unsubscribe = subscribe(() => this.renderWhenVisible(() => this.render()));
    if (typeof document !== 'undefined') {
      document.addEventListener('cb:open-survival-guide', this.onDeepLink as EventListener);
      this.element.addEventListener('click', this.onClick);
    }
  }

  public override destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('cb:open-survival-guide', this.onDeepLink as EventListener);
      this.element.removeEventListener('click', this.onClick);
    }
    super.destroy();
  }

  /** Deep link: select the guide (or index) and ask the shell to front us. */
  private readonly onDeepLink = (ev: Event): void => {
    const id = (ev as CustomEvent<{ guideId?: string }>).detail?.guideId;
    if (id && getGuide(id as GuideId)) {
      this.selected = id as GuideId;
    } else {
      this.selected = null;
      if (id) showToast({ title: 'Guide not found', message: `No survival guide for "${id}".`, severity: 'normal' });
    }
    this.render();
    document.dispatchEvent(new CustomEvent('cb:open-panel', { detail: { panelKey: 'survival-guide' } }));
  };

  private readonly onClick = (ev: Event): void => {
    const target = ev.target as Element | null;
    if (!target) return;

    const card = target.closest('[data-guide-open]');
    if (card) {
      this.selected = card.getAttribute('data-guide-open') as GuideId;
      this.render();
      return;
    }
    if (target.closest('[data-guide-back]')) {
      this.selected = null;
      this.render();
      return;
    }
    const rel = target.closest('[data-guide-nav]');
    if (rel) {
      this.selected = rel.getAttribute('data-guide-nav') as GuideId;
      this.render();
      return;
    }
    const check = target.closest('[data-guide-check]');
    if (check) {
      toggle(check.getAttribute('data-guide-check') as string);
      this.render();
      return;
    }
  };

  private render(): void {
    const html = this.selected ? this.renderDetail(this.selected) : this.renderIndex();
    this.setContent(html);
  }

  private renderIndex(): string {
    const section = (title: string, guides: SurvivalGuide[]): string => `
      <div style="margin-bottom:16px;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;opacity:0.7;margin:0 0 8px;">${esc(title)}</div>
        <div style="display:grid;gap:8px;">
          ${guides.map((g) => this.renderCard(g)).join('')}
        </div>
      </div>`;
    return `<div style="padding:12px;">
      ${section('Hazards', guidesByKind('hazard'))}
      ${section('Preparedness Basics', guidesByKind('preparedness'))}
    </div>`;
  }

  private renderCard(g: SurvivalGuide): string {
    const readiness = computeGuideReadiness(g, getCheckedIds());
    const ring = readiness
      ? `<span style="font-variant-numeric:tabular-nums;font-size:12px;opacity:0.85;">${readiness.percent}%</span>`
      : '';
    return `<button type="button" data-guide-open="${g.id}" style="display:flex;justify-content:space-between;align-items:center;gap:10px;text-align:left;padding:10px 12px;border:1px solid var(--border-subtle,#333);border-radius:8px;background:rgba(255,255,255,0.02);cursor:pointer;color:inherit;width:100%;">
      <span><span style="font-weight:600;">${esc(g.title)}</span><br><span style="font-size:12px;opacity:0.7;">${esc(g.summary.slice(0, 90))}${g.summary.length > 90 ? '…' : ''}</span></span>
      ${ring}
    </button>`;
  }

  private renderDetail(id: GuideId): string {
    const g = getGuide(id);
    if (!g) return this.renderIndex();
    const readiness = computeGuideReadiness(g, getCheckedIds());

    const steps = (title: string, items: SurvivalGuide['during']): string =>
      items.length === 0 ? '' : `
        <div style="margin:14px 0;">
          <div style="font-weight:600;margin-bottom:6px;">${esc(title)}</div>
          <ol style="margin:0;padding-left:18px;display:grid;gap:6px;">
            ${items.map((s) => `<li>${esc(s.label)}${s.detail ? `<br><span style="font-size:12px;opacity:0.7;">${esc(s.detail)}</span>` : ''}</li>`).join('')}
          </ol>
        </div>`;

    const bullets = (title: string, items: readonly string[]): string =>
      items.length === 0 ? '' : `
        <div style="margin:14px 0;">
          <div style="font-weight:600;margin-bottom:6px;">${esc(title)}</div>
          <ul style="margin:0;padding-left:18px;display:grid;gap:4px;">${items.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        </div>`;

    const mistakes = `
      <div style="margin:14px 0;padding:10px 12px;border:1px solid var(--sev-critical,#ff453a);border-radius:8px;background:rgba(255,69,58,0.08);">
        <div style="font-weight:700;color:var(--sev-critical,#ff453a);margin-bottom:6px;">Deadly mistakes to avoid</div>
        <ul style="margin:0;padding-left:18px;display:grid;gap:4px;">${g.mistakes.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      </div>`;

    const checklist = g.checklist.length === 0 ? '' : `
      <div style="margin:14px 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-weight:600;">Readiness checklist</span>
          ${readiness ? `<span style="font-size:12px;opacity:0.85;">${readiness.percent}% · ${readiness.checkedCount}/${readiness.totalCount}</span>` : ''}
        </div>
        <div style="display:grid;gap:6px;">
          ${g.checklist.map((item) => `
            <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;">
              <input type="checkbox" data-guide-check="${esc(item.id)}" ${isChecked(item.id) ? 'checked' : ''} style="margin-top:3px;">
              <span>${esc(item.label)}${item.detail ? `<br><span style="font-size:12px;opacity:0.7;">${esc(item.detail)}</span>` : ''}</span>
            </label>`).join('')}
        </div>
      </div>`;

    const related = g.relatedGuides.length === 0 ? '' : `
      <div style="margin:14px 0;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
        <span style="font-size:12px;opacity:0.7;">Related:</span>
        ${g.relatedGuides.map((r) => { const rg = getGuide(r); return rg ? `<button type="button" data-guide-nav="${r}" style="font-size:12px;padding:3px 8px;border:1px solid var(--border-subtle,#333);border-radius:999px;background:transparent;color:inherit;cursor:pointer;">${esc(rg.title)}</button>` : ''; }).join('')}
      </div>`;

    return `<div style="padding:12px;">
      <button type="button" data-guide-back style="font-size:12px;background:transparent;border:none;color:inherit;opacity:0.75;cursor:pointer;padding:0 0 8px;">‹ All guides</button>
      <div style="font-size:18px;font-weight:700;">${esc(g.title)}</div>
      <p style="opacity:0.85;font-size:13px;margin:6px 0 0;">${esc(g.summary)}</p>
      ${bullets('Know the signs', g.signs)}
      ${steps('Prepare ahead', g.prepare)}
      ${steps('During — act now', g.during)}
      ${steps('Immediately after', g.after)}
      ${bullets('Recovery', g.recovery)}
      ${mistakes}
      ${checklist}
      ${related}
      <div style="margin-top:16px;padding-top:10px;border-top:1px solid var(--border-subtle,#333);font-size:11px;opacity:0.6;">
        Sources: ${g.sources.map(esc).join(' · ')}.<br>
        Reference guidance distilled from public materials — always follow instructions from local emergency officials.
      </div>
    </div>`;
  }
}
```

- [ ] **Step 2: Verify the Panel base API used matches**

Run: `grep -n "protected element\|public element\|this.element\|setContent\|renderWhenVisible" src/components/Panel.ts | head`
Expected: confirms `this.element` (the panel root) and `setContent`/`renderWhenVisible` exist. If the root member is named differently (e.g. `this.el` or `this.body`), update the two `this.element` references in the panel to match.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep SurvivalGuidePanel || echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add src/components/SurvivalGuidePanel.ts
git commit -m "feat(survival-guide): SurvivalGuidePanel (index + detail + checklist)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 11: Register + instantiate the panel

**Files:**
- Modify: `src/config/panels.ts` (2 edits)
- Modify: `src/config/panel-metadata.ts` (1 edit)
- Modify: `src/app/panel-layout.ts` (2 edits)

- [ ] **Step 1: Register in FULL_PANELS**

In `src/config/panels.ts`, after the `'air-smoke': { name: 'Air & Smoke', enabled: true, priority: 1 },` line (~322), add:

```ts
  'survival-guide': { name: 'Survival Guide', enabled: true, priority: 1 },
```

- [ ] **Step 2: Add to the category `panelKeys` list**

In `src/config/panels.ts` line ~1220, find `'air-smoke',` inside the `panelKeys` array (the `personal-safety`/hazards category block) and insert `'survival-guide',` right after it.

- [ ] **Step 3: Add Library/⌘K metadata**

In `src/config/panel-metadata.ts`, in the `PANEL_METADATA` object, add (alphabetical neighborhood, near other `personal-safety` entries):

```ts
  'survival-guide': { domain: 'personal-safety', tags: ['survival', 'guide', 'preparedness', 'emergency', 'checklist', 'shelter', 'evacuation'], tier: 'library', featured: true, icon: '🧭', evidenceFor: ['severe_weather', 'wildfire', 'earthquake', 'conflict_escalation', 'grid_outage', 'disease_outbreak'] },
```

- [ ] **Step 4: Import + instantiate the panel**

In `src/app/panel-layout.ts`, near the other panel imports (~line 426, by `ShortageRadarPanel`), add:

```ts
import { SurvivalGuidePanel } from '@/components/SurvivalGuidePanel';
```

Then near the `this.ctx.panels['shortage-radar'] = new ShortageRadarPanel();` line (~2051), add:

```ts
    this.ctx.panels['survival-guide'] = new SurvivalGuidePanel();
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "survival-guide|SurvivalGuide|panels.ts|panel-metadata" || echo OK`
Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add src/config/panels.ts src/config/panel-metadata.ts src/app/panel-layout.ts
git commit -m "feat(survival-guide): register + instantiate the panel

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 12: ⌘K guide commands

**Files:**
- Create: `src/services/command-palette/guide-commands.ts`
- Modify: `src/app/panel-layout.ts` (install alongside place commands)

Reference: `src/services/command-palette/place-commands.ts` (builder + installer), `command-registry.ts` (`PaletteCommand`, `getCommandRegistry`).

- [ ] **Step 1: Write the command builder + installer**

Create `src/services/command-palette/guide-commands.ts`:

```ts
/**
 * ⌘K commands for survival guides: "Guide: Tornado" etc. Selecting one emits
 * cb:open-survival-guide, which the SurvivalGuidePanel handles (select + front).
 */

import type { CommandRegistry, PaletteCommand } from './command-registry';
import { allGuides } from '@/services/survival-guide/guide-library';

export function buildGuideCommands(dispatch: (name: string, detail?: unknown) => void): PaletteCommand[] {
  return allGuides().map((g) => ({
    id: `guide:${g.id}`,
    title: `Guide: ${g.title}`,
    subtitle: g.kind === 'hazard' ? 'survival guide' : 'preparedness guide',
    keywords: [g.title.toLowerCase(), 'guide', 'survival', 'preparedness', 'emergency', g.id],
    category: 'navigation',
    icon: '🧭',
    weight: 0,
    action: () => dispatch('cb:open-survival-guide', { guideId: g.id }),
  }));
}

/** Registers all guide commands once. Returns an uninstall thunk. */
export function installGuideCommands(
  registry: CommandRegistry,
  dispatch: (name: string, detail?: unknown) => void,
): () => void {
  const cmds = buildGuideCommands(dispatch);
  for (const c of cmds) registry.register(c);
  return () => {
    for (const c of cmds) registry.unregister(c.id);
  };
}
```

- [ ] **Step 2: Write the failing test**

Create `src/services/survival-guide/__tests__/guide-commands.test.mts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGuideCommands } from '../../command-palette/guide-commands.ts';

test('one command per guide, dispatches deep-link event', () => {
  const dispatched: Array<{ name: string; detail: unknown }> = [];
  const cmds = buildGuideCommands((name, detail) => dispatched.push({ name, detail }));
  assert.equal(cmds.length, 24);
  assert.ok(cmds.every((c) => c.id.startsWith('guide:')));
  const tornado = cmds.find((c) => c.id === 'guide:tornado');
  assert.ok(tornado);
  tornado!.action();
  assert.deepEqual(dispatched[0], { name: 'cb:open-survival-guide', detail: { guideId: 'tornado' } });
});
```

Add this file to the `test:survival-guide` script in `package.json` (append the path to the command string).

- [ ] **Step 3: Run test**

Run: `npx tsx --test src/services/survival-guide/__tests__/guide-commands.test.mts`
Expected: PASS (1 test).

- [ ] **Step 4: Install the commands at boot**

In `src/app/panel-layout.ts`:

Add an import near the `installPlaceCommands` import (~line 89):

```ts
import { installGuideCommands } from '@/services/command-palette/guide-commands';
```

Find where `installPlaceCommands(getCommandRegistry(), {...})` is called (~line 1267). Immediately after that statement, add:

```ts
    installGuideCommands(getCommandRegistry(), (name, detail) =>
      document.dispatchEvent(new CustomEvent(name, { detail })),
    );
```

(Guide commands are static — no uninstall bookkeeping needed, unlike place commands which re-sync.)

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit 2>&1 | grep -E "guide-commands|panel-layout" || echo OK`
Expected: `OK`.
Run: `npm run test:survival-guide`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/command-palette/guide-commands.ts src/services/survival-guide/__tests__/guide-commands.test.mts src/app/panel-layout.ts package.json
git commit -m "feat(survival-guide): ⌘K guide commands

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 13: Storm Mode deep link

Add a "Full guide →" link to the Personal Storm Mode strip that emits `cb:open-survival-guide` for the matching weather hazard.

**Files:**
- Modify: `src/components/PersonalStormMode.ts`

- [ ] **Step 1: Locate the hazard field + render + click handling**

Run: `grep -n "hazard\|WeatherHazardKind\|render\|addEventListener\|dispatchEvent\|innerHTML\|data-" src/components/PersonalStormMode.ts | head -30`
Note: (a) the property holding the current `WeatherHazardKind`, (b) where the card HTML is built, (c) whether there's an existing delegated click handler.

- [ ] **Step 2: Add the link to the card HTML**

In the card's HTML template, add a button wherever action links belong (near the ack/snooze controls). Use the hazard value in scope:

```ts
`<button type="button" data-storm-guide="${hazardKind}" style="font-size:12px;background:transparent;border:none;color:var(--accent,#8ab4f8);cursor:pointer;padding:4px 0;">Full guide →</button>`
```

- [ ] **Step 3: Handle the click**

Add these imports at the top of the file:

```ts
import { guideForWeatherHazard } from '@/services/survival-guide/guide-links';
```

In the strip's click handler (add a delegated listener if none exists, mirroring `ShortageRadarPanel.onRowToggle`), handle the button:

```ts
const guideBtn = (ev.target as Element | null)?.closest('[data-storm-guide]');
if (guideBtn) {
  const hazard = guideBtn.getAttribute('data-storm-guide');
  const guideId = hazard ? guideForWeatherHazard(hazard as import('@/services/weather/weather-threat-types').WeatherHazardKind) : undefined;
  if (guideId) document.dispatchEvent(new CustomEvent('cb:open-survival-guide', { detail: { guideId } }));
  return;
}
```

If a delegated handler is added fresh, remove it in the component's teardown (match the existing cleanup pattern in the file).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep PersonalStormMode || echo OK`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add src/components/PersonalStormMode.ts
git commit -m "feat(survival-guide): Storm Mode -> full guide deep link

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 14: Command Center readiness row + action-brief guide link

**Files:**
- Modify: `src/components/CommandCenterPanel.ts`

- [ ] **Step 1: Add imports**

Near the top imports of `CommandCenterPanel.ts`, add:

```ts
import { allGuides, getGuide } from '@/services/survival-guide/guide-library';
import { getCheckedIds, subscribe as subscribeChecklist } from '@/services/survival-guide/checklist-store';
import { computeOverallReadiness } from '@/services/survival-guide/readiness-score';
```

- [ ] **Step 2: Subscribe to checklist changes**

Find the panel's start/subscribe block (~line 162, where `disclosureService.subscribe(...)` is set). Add a field near the other `unsubscribe*` fields (~line 134):

```ts
  private unsubscribeChecklist: (() => void) | null = null;
```

In the subscribe block:

```ts
    this.unsubscribeChecklist = subscribeChecklist(() => this.render());
```

In `destroy()` (near the other `unsubscribe?.()` calls, ~line 179):

```ts
    this.unsubscribeChecklist?.();
    this.unsubscribeChecklist = null;
```

- [ ] **Step 3: Add a readiness-row builder**

Add a private method to the class:

```ts
  private renderReadinessRow(): string {
    const overall = computeOverallReadiness(allGuides(), getCheckedIds());
    const weak = overall.weakest ? getGuide(overall.weakest) : null;
    const target = overall.weakest ?? '';
    const weakText = weak ? ` · weakest: ${weak.title}` : '';
    return `<button type="button" data-cc-open-guide="${target}" style="display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;text-align:left;padding:8px 12px;border:1px solid var(--border-subtle,#333);border-radius:8px;background:rgba(255,255,255,0.02);color:inherit;cursor:pointer;">
      <span style="font-size:13px;">Preparedness ${overall.percent}%${weakText}</span>
      <span style="opacity:0.6;font-size:12px;">Survival guide ›</span>
    </button>`;
  }
```

- [ ] **Step 4: Place the row in the summary/full render**

In the `summary`-level return block (~line 268) and the default/full render block, add `${this.renderReadinessRow()}` after the risk-headline / top-things content (e.g. right after `${this.renderTopThings(...)}`). Keep it out of the `raw` JSON block.

- [ ] **Step 5: Handle the row click**

Find the panel's existing click handler (or the base Panel delegation). Add handling for `[data-cc-open-guide]`:

```ts
    const guideRow = (ev.target as Element | null)?.closest('[data-cc-open-guide]');
    if (guideRow) {
      const guideId = guideRow.getAttribute('data-cc-open-guide') || undefined;
      document.dispatchEvent(new CustomEvent('cb:open-survival-guide', { detail: { guideId } }));
      return;
    }
```

If the panel has no click handler yet, add a delegated one on `this.element` in start() and remove it in destroy(), matching `ShortageRadarPanel`.

- [ ] **Step 6: Add "Full guide →" to the rendered action brief (if a brief is shown)**

Where the action brief is rendered (the block using `getActiveActionBrief()` / `actionBrief`), if the active situation carries a `PlaybookCategory`, resolve the first guide and add a link. Add import:

```ts
import { guidesForPlaybookCategory } from '@/services/survival-guide/guide-links';
```

Run: `grep -n "category\|PlaybookCategory\|getActiveSituation\|actionBrief" src/components/CommandCenterPanel.ts | head` to find the category in scope. Then, in the action-brief HTML, append:

```ts
`${(() => { const cat = /* the active situation category in scope */ undefined; const ids = cat ? guidesForPlaybookCategory(cat) : []; const g = ids[0] ? getGuide(ids[0]) : null; return g ? `<button type="button" data-cc-open-guide="${g.id}" style="font-size:12px;background:transparent;border:none;color:var(--accent,#8ab4f8);cursor:pointer;padding:4px 0;">Full guide: ${g.title} →</button>` : ''; })()}`
```

If the active category isn't readily in scope in that block, skip the inline brief link (the readiness row + ⌘K + Storm Mode already satisfy the deep-link requirement) and note it in the commit message. Do not leave a broken reference.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep CommandCenter || echo OK`
Expected: `OK`.

- [ ] **Step 8: Commit**

```bash
git add src/components/CommandCenterPanel.ts
git commit -m "feat(survival-guide): Command Center readiness row + guide link

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 15: Full verification + build

- [ ] **Step 1: Full survival-guide suite**

Run: `npm run test:survival-guide`
Expected: all PASS, 0 failures.

- [ ] **Step 2: Full typecheck (both configs)**

Run: `npm run typecheck:all`
Expected: 0 errors. This is the project's zero-error gate; fix anything before proceeding.

- [ ] **Step 3: Docs-freshness check (panel/count drift)**

Run: `npm run docs:check`
Expected: passes, or flags only pre-existing unrelated drift. If it flags the new panel count, update the referenced doc/count it points to.

- [ ] **Step 4: Verify in the running app (browser preview)**

Follow the verification workflow:
1. `preview_start` with the dev config (or `npm run dev` config in `.claude/launch.json`).
2. Open ⌘K, type "Guide: Tornado", select it → the Survival Guide panel opens to the tornado detail.
3. Tick a checklist item → readiness % updates in the detail header and (if visible) the Command Center row.
4. Reload → the ticked item persists (checklist store round-trip).
5. `read_console_messages` → no errors from the new panel.
6. Screenshot the detail view as proof.

- [ ] **Step 5: Push + open PR**

```bash
git push origin claude/survival-guide-spec
```

Open a PR to `origin/main`. Per repo policy, put the cross-agent review marker in the PR body (`claude/*` branch → Codex reviewer) and let auto-merge land it after checks pass.

---

## Self-Review (completed during planning)

**Spec coverage:**
- Browsable library + 24 guides → Tasks 2–5 ✓
- Structured phase skeleton → Task 1 schema + Tasks 2–4 content ✓
- Interactive checklists w/ persistence → Task 8 ✓
- Per-guide + overall readiness + Command Center rollup → Tasks 7 + 14 ✓
- Deep links (Action Brief, Dossier via evidenceFor, Storm Mode, ⌘K) → Tasks 11 (metadata `evidenceFor`), 12, 13, 14 ✓
- Panel registration (all 4 surfaces) → Tasks 10–11 ✓
- Offline / pure / fixture-tested → every service task is pure + has fixtures ✓
- Sources + disclaimer footer → Task 10 detail render ✓
- Error handling (unknown id, storage down, stale ids) → Task 8 (fallback + prune), Task 10 (toast) ✓
- Test script → Task 9 ✓

**Placeholder scan:** Content authoring in Tasks 3–4 gives concrete per-guide anchors rather than "write content here"; the only intentionally deferred detail is the exact `WeatherHazardKind` member names (Task 6 Step 1 prints them before use) and the Command Center category-in-scope (Task 14 Step 6 has a documented skip path). No "TBD"/"handle edge cases" left.

**Type consistency:** `computeGuideReadiness`/`computeOverallReadiness`, `GuideReadiness`/`OverallReadiness`, `getCheckedIds`/`isChecked`/`toggle`/`subscribe`/`pruneUnknown`, `guidesForPlaybookCategory`/`guideForWeatherHazard`, and the `cb:open-survival-guide` `{ guideId }` payload are used identically across Tasks 7–14. Panel base member `this.element` is verification-gated in Task 10 Step 2.
