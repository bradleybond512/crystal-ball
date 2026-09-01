# UX-013 hotel operational evidence validation

## Scope

This change is presentation-only. It adds no provider, schema, route, cache,
health vote, sidecar, Tauri, settings, dependency, or CSS behavior.

The shared presentation boundary recognizes directory hotel evidence only when:

```ts
node.category === 'hotel'
  && (node.directoryOnly || node.verification === 'directory')
```

Directory hotels display the approved disclosure, project operational,
inventory, power, and access to `unknown`, expose a bounded valid phone as
`Call to confirm`, and explicitly disclose when no callable number is
published. Expired directory evidence composes the expiry warning with the
same disclosure. The panel shows the directory row's retrieval time from
`retrievedAt ?? observedAt`.

Future official hotels and all non-hotel rows keep the existing generic call,
evidence, and panel time presentation. Loading, empty, degraded, and error
states are unchanged. Existing click-only navigation, keyboard buttons and
links, focus restoration, live regions, and responsive/resized-window layout
are unchanged.

## Test-first evidence

Tests were added before production changes and executed on Node 22.

- `npx tsx --import ./tests/panels/register-hook.mjs --test tests/lifelines-map.test.mts`
  was RED: `11 pass / 3 fail`. The new assertions found the missing shared
  directory predicate/projection, missing composed expiry disclosure, and
  missing preserved-state projection.
- `npx tsx --test src/components/__tests__/local-logistics-panel.test.mts`
  was RED: `10 pass / 2 fail`. The hotel card lacked the disclosure,
  fail-closed directory projection, confirmation-specific action, retrieval
  time, and missing-phone disclosure.
- `npx tsx --import ./tests/panels/register-hook.mjs --test
  src/components/__tests__/map-popup-lifeline.test.mts` was RED:
  `5 pass / 2 fail`. The hotel popup lacked the shared disclosure,
  confirmation-specific action, composed expiry copy, and missing-phone copy.
- Follow-up boundary tests for a future official hotel were RED at
  `0 pass / 1 fail` in each focused panel and popup run because both showed
  `Call to confirm` instead of the existing generic `Call`.

After the minimal production change and boundary correction:

- helper suite: `14 pass / 0 fail`;
- panel component suite: `13 pass / 0 fail`;
- popup component suite: `8 pass / 0 fail`.

## Mutation proofs

Implementation ownership prohibited a commit. Before each mutation, the
intended file was checksum-pinned, the mutation was confirmed in `git diff`,
and the mutation was restored with `apply_patch`. Each restored checksum
matched the pre-mutation checksum. No unrelated path was changed.

### 1. Hotel disclosure selection

- File: `src/components/disaster-lifelines-map-helpers.ts`
- SHA-256 before and after:
  `35e29bdc8a625ddaeb3b05f07efe41c4bd7fe0dfc1b7ea45061cda98b44fc2f1`
- Confirmed mutation: replaced the exact hotel-directory predicate with
  `const isHotelDirectory = false`.
- Targeted result: `12 pass / 2 fail`.
- Failing assertions: `false !== true` for `isHotelDirectory`, and the expired
  hotel evidence omitted the required composed directory disclosure.
- Restored result: `14 pass / 0 fail`.

### 2. Fail-closed status projection

- File: `src/components/disaster-lifelines-map-helpers.ts`
- SHA-256 before and after:
  `35e29bdc8a625ddaeb3b05f07efe41c4bd7fe0dfc1b7ea45061cda98b44fc2f1`
- Confirmed mutation: changed `expired || isHotelDirectory` to `expired`.
- Targeted result: `13 pass / 1 fail`.
- Failing assertion: the directory hotel projected `open`, `available`,
  `grid`, and `reachable` instead of four `unknown` values.
- Restored result: `14 pass / 0 fail`.

### 3. Confirmation call label and accessible name

- File: `src/components/LocalLogisticsPanel.ts`
- SHA-256 before and after:
  `cc466e2c7fd23b83981bc00fb77aa480ea8d9cfda1e0474ab11a1d3fe51ef1d8`
- Confirmed mutation: replaced the directory-hotel call label and accessible
  name with the generic `Call` / `Call Directory Hotel` presentation.
- Focused result: `0 pass / 1 fail`.
- Failing assertion: actual `{ label: 'Call', accessibleName: 'Call Directory
  Hotel' }` differed from the required confirmation label and full
  vacancy/current-operation/power/access accessible name.
- The exact checksum was restored.

### 4. Missing-phone disclosure

- File: `src/components/LocalLogisticsPanel.ts`
- SHA-256 before and after:
  `cc466e2c7fd23b83981bc00fb77aa480ea8d9cfda1e0474ab11a1d3fe51ef1d8`
- Confirmed mutation: removed `No callable public phone published.` from the
  directory-hotel no-call branch.
- Targeted suite result: `12 pass / 1 fail`.
- Failing assertion: the expired hotel card no longer matched
  `/No callable public phone published\./`.
- The exact checksum was restored.

### 5. Panel retrieval time

- File: `src/components/LocalLogisticsPanel.ts`
- SHA-256 before and after:
  `cc466e2c7fd23b83981bc00fb77aa480ea8d9cfda1e0474ab11a1d3fe51ef1d8`
- Confirmed mutation: changed `retrievedAt ?? observedAt` to `observedAt`.
- Focused result: `0 pass / 1 fail`.
- Failing assertion: rendered datetime
  `2026-08-14T12:00:00.000Z` differed from required retrieval datetime
  `2026-08-14T13:40:00.000Z`.
- The exact checksum was restored.

## Final validation

All final commands used Node 22.

- `npm run test:lifelines`: first runner `155 pass / 0 fail`; second runner
  `183 pass / 0 fail`.
- `npm run test:lifelines-map`: first runner `33 pass / 0 fail`; second runner
  `13 pass / 0 fail`.
- `npm run typecheck:all`: exit 0 (`tsc --noEmit` and
  `tsc --noEmit -p tsconfig.api.json`).
- `git diff --check`: exit 0.
- A fresh parent verification initially reported `182 pass / 1 fail` in the
  second `test:lifelines` runner. Its bounded tool output did not retain the
  failing assertion, and the failure could not be reproduced: the focused
  panel suite then passed `13 / 13`, followed by three consecutive complete
  second-runner results of `183 pass / 0 fail`.
- The first full agentic gate stopped at the production build because this
  isolated worktree had no local `node_modules/cesium/Build/Cesium/Workers`;
  module resolution had previously fallen through to the parent checkout.
  `npm ci` installed the lockfile-pinned worktree dependencies with
  `0 vulnerabilities`.
- `bash scripts/agentic-validate.sh --tests "test:lifelines
  test:lifelines-map"` was rerun from the start after that environment repair
  and passed targeted tests, lockfile validation, strict lint, type checking,
  secret scan, cross-agent policy, documentation freshness, roadmap checks,
  and the production build. The build retained the repository's existing
  chunk-size and ineffective-dynamic-import warnings.

## Manual verification

1. Open Disaster Lifelines for a saved place with an OSM hotel result.
2. Confirm the panel card and map popup show the exact directory disclosure and
   four unknown states.
3. Confirm a valid number exposes `Call to confirm` only after a click and its
   accessible name names vacancy, current operation, power, and access.
4. Confirm a missing or malformed number shows the no-call disclosure and no
   call control while Maps and source context remain available.
5. Confirm an official shelter and a simulated future official hotel retain
   the generic call/evidence presentation.

## Rollback and remaining risk

Rollback is a normal revert of the presentation and focused tests; no data or
schema migration exists. The remaining risk is upstream directory staleness,
which is stated explicitly and cannot be resolved without a separately
approved, credentialed, license-compatible operational provider.
