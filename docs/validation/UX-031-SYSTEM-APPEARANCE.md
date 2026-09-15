# UX-031 — System appearance repair evidence

Status: implementation/validation in progress. Draft PR #1720.
Risk: Standard frontend repair; medium QA risk. No installation or release.

## Intended behavior and boundaries

Main and Settings follow repeated system appearance changes when no manual
choice exists. Explicit choices remain authoritative, including within the
current document when storage fails. Happy retains its light default. Native
light styles use html-owned theme through the actual stylesheet cascade.

The change separates theme application from preference persistence, shares
variant resolution, connects both bootstrap listeners and repairs five light
selector groups. No new native command, dependency, data migration, materials
experiment or initial-paint guarantee is included.

## Evidence inventory

Local logs and native probe artifacts are retained under
`~/.crystalball-diagnostics/ux031-system-appearance-20260915/`.
Final command outputs, hashes, mutation counts and source-tip reviews will be
recorded here after validation completes. Proposed checks in the design brief
are not results.

## Known external release blockers

The unchanged main dependency lockfile produced this audit baseline:

```text
{"info":0,"low":0,"moderate":6,"high":2,"critical":1,"total":9}
```

The package advisories include the existing map/loader dependency chain and
other existing dependencies. `npm audit --audit-level=high` cannot be claimed
clean for this branch until the separately owned prerequisite repairs land.
No audit rule, dependency version or bundle limit is weakened in UX-031.

## Native acceptance and manual verification

An isolated WKWebView functional probe is scoped to engine/module behavior.
It cannot establish packaged Tauri appearance propagation, signing, deployment
compatibility, VoiceOver behavior or end-user visual acceptance.

Before native acceptance, test a reviewed package with no manual theme choice:
main and Settings should both follow light→dark→light, without creating a stored
choice. Select each manual theme, repeat system changes and reopen; the manual
choice must remain. Confirm native root, toolbar, map header and scrollbar
appearance with the real cascade. Restore test settings and use a disposable
profile so existing user choices remain intact. Verify happy's intended default
in its supported web build. Initial paint is explicitly a separate follow-up.

## Rollback

Revert this bounded change. Existing stored choices retain the same format and
must not be cleared or reclassified. There is no migration to reverse.

## Focused results before mutation proof

Node 22 was used for verification. The initial dependency setup under Node 26
emitted an engine warning; setup was repeated with the required Node 22 and
normal lifecycle scripts before claiming the PR. The lockfile is unchanged.

```text
npm run test:system-theme
# tests 19
# pass 19
# fail 0

node --import tsx --test src/components/__tests__/shell-a11y-contracts.test.mts
# tests 4
# pass 4
# fail 0

E2E_PORT=4291 VITE_VARIANT=full npx playwright test e2e/system-theme.spec.ts --output=/tmp/ux031-final-full
5 passed (1.3m)

E2E_PORT=4292 VITE_VARIANT=happy npx playwright test e2e/system-theme.spec.ts e2e/theme-toggle.spec.ts --output=/tmp/ux031-final-happy
13 passed (1.5m)
```

All four commands exited 0. The final browser runs were sequential with unique
output directories. Earlier concurrent baseline attempts had trace-file
collisions in addition to intended assertion failures. One early fixed-source
run reported 4 passed / 1 failed because the test incorrectly prohibited the
existing App variant-storage write; the test now checks absence before bootstrap.
Theme preference assertions were preserved. Those earlier logs remain retained.

The isolated native final-candidate result reports `"failed" : 0, "passed" : 8`;
old-source contrast reports `"failed" : 2, "passed" : 6`. Final tested manager
SHA-256 is `aed7fda0bbac0c3abe08b7ab61edb650878c0e688f0b0e73c11ad8a08025f044`.
Per-window native appearance changes produced actual media events. This is
module/engine evidence, not packaged acceptance or clean-tree mutation proof.
Native evidence, copied source and exact commands are under the local diagnostic
`native/README.md`; no app or global appearance settings were changed.

Browser hover coverage checks actual stylesheet rule applicability; it does not
prove native pointer rendering. Existing initial-paint tests are legacy toggle
regressions and do not establish flash-free pre-module rendering.

## Independent review repair 1

The first source review found one blocking P2: a MediaQueryList with only legacy
subscription methods caused the newly connected watcher to throw during
bootstrap. The repair checks subscription capability before installing the
listener. Unsupported hosts retain initial appearance and manual toggles; no
particular older OS version is claimed tested.

```text
Focused regression before repair: # pass 19 / # fail 1
Focused suite after repair: # pass 20 / # fail 0
```

The final manager SHA-256 after this repair is
`2fad21df8d2bfb8337612581921c91b8d12c106b2780e045bbd97592ef076e0d`.
Earlier native and browser results above identify their earlier source revision;
final-source verification and review remain required. This is the first repair
cycle, not a waiver of the finding or a completed review verdict.
