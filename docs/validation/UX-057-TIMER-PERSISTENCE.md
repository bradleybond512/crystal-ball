# UX-057 — six timer persistence paths

November 19, 2026. Draft #1917. Test candidate:
`600ad703c60b4d0c4ec13dc75f6880f24ee1d4f5`.

## Result and scope

Twelve fixtures execute the six actual captured interval callbacks. Repeated
idle ticks make zero storage-write attempts; explicit preferences, deliverable
digests and due work persist and reload. The original PR1731 L2 assertion that
all six write every tick is corrected by a dated addendum. No runtime write was
removed and no performance or energy saving is claimed. Full UX-057 remains
IN PROGRESS pending lifecycle/storage-recovery acceptance.

Only tests, the package test entry, six exact test mappings and documentation
change. The VM loader transpiles unchanged modules and rejects unmapped imports.
HappyDOM supplies the DOM; synthetic storage records attempted and successful
writes. Service/UI dependencies are explicit fixtures; actual cognition grading,
drift math and idle scheduling execute. Linked ACC-104 forecasts remain excluded
from duplicate grading. Network/native access is denied and callbacks are bounded.
Initialization writes are separated from measured ticks; reload uses fresh module
realms with synthetic persisted bytes. No installed profile, credential, app,
provider, dependency or production policy was changed or accessed.

| Path | Idle evidence | Positive persistence and limits |
| --- | --- | --- |
| Phishstats panel | Three refreshes, zero writes | Slider persists/reloads; denied storage retains current handling; destroy stops refresh |
| TV mode | Three cycles, zero writes | Explicit interval persists/reloads; storage exceptions remain observable; destroy clears timer |
| Digest | Empty and retired-only ticks, zero writes | Deliverable digest persists/reloads; denied save still delivers; destroy clears timer/subscription |
| Improvement scheduler | Disabled-at-due and just-before-due, zero writes | Due run saves schedule/history; reload and stop verified; denied writes preserve only memory |
| Consolidation | Disabled/Ghost/not-due, zero writes | Successful due run persists timestamp; failure does not advance it; reload respects cadence |
| Self-tuning | Ghost/not-due, zero writes | Actual legacy grading/drift run and completion persist; linked rows skipped; reload respects cadence |

## Actual validation

`npm run test:ux057` (new fixtures plus existing scheduler, cognition, digest
consumer and Phishstats regressions):

```text
# tests 105
# pass 105
# fail 0
# cancelled 0
```

Full command:

```sh
bash scripts/agentic-validate.sh --tests "test:ux057 test:agentic-pipeline test:roadmap-controller"
```

Actual output in script order:

```text
# pass 105
# fail 0
# pass 85
# fail 0
# pass 135
# fail 0
Agentic validation gate passed.
Tests run: test:ux057 test:agentic-pipeline test:roadmap-controller
```

Lockfile consistency, strict lint, both TypeScript configurations, secret scan,
cross-agent configuration, documentation, roadmap and web build exited zero.
Scoped test ESLint and `git diff --check` also exited zero. Existing changelog and
roadmap advisories, Vite future-loader and bundle-size warnings remain visible.
Strict selection names nine scripts with no unmapped changes. All nine executed
locally: the three above ran in the gate; the six remaining commands produced:

| Command | Actual output |
| --- | --- |
| `npm run test:desktop-identity` | `# pass 46`, `# fail 0`; `# pass 15`, `# fail 0`; `# pass 24`, `# fail 0` |
| `npm run test:domain-retirement` | `# pass 2`, `# fail 0` |
| `npm run test:e2e:ci-wiring` | `# pass 25`, `# fail 0` |
| `npm run test:install-scripts` | `# pass 63`, `# fail 0` |
| `npm run test:sidecar-ci` | `# pass 16`, `# fail 0` |
| `npm run test:workflow-security` | `# pass 96`, `# fail 0` |

Every run reported zero cancellations. Hosted implementation execution awaits
publication approval; these local runs are not hosted results.

## Review and investigation history

Early independent Sol review found a fixture gap: a disabled scheduler was tested
before its deadline, allowing the not-due guard to mask a missing disabled guard.
The fixture now tests disabled work at its deadline. Removing that guard produces
10 pass / 2 fail; restoration returns 12 pass / 0 fail. The first repair cycle closed that gap. A second review found that the TV
storage-exception and self-tuning storage-denial tests had not turned red under
any original control. Two additional source mutations now make each fail 11/1
and restore to 12/0, with unchanged source hashes and clean scratch state. All
12 new tests have now been observed failing under at least one of 13 controls.
This second cycle changed proof evidence only; candidate tests/code stayed fixed.
Final exact-tip Sol and actual Sonnet review must clear before the recorded
verdict and separate implementation-publication approval.

The mutation runner stopped before changing digest source because its exact
indentation match found zero occurrences. Its fail-closed assertion prevented
false coverage. The corrected match resumed the campaign; original and resumed
logs remain available. No unmatched edit was counted as a mutation proof.

## Limits, manual verification and rollback

Consolidation and self-tuning expose no stop API: fixture cleanup proves no
production teardown contract. TV read/write exceptions remain observable. These
open limits need a separate production design; none is silently repaired here.
Fixture cadence evidence does not establish integrated app behavior, wall-clock
performance, storage-volume reduction, or battery savings. No prediction equation,
promotion, notification, acquisition or persistence schema changes.

The published documentation claim's audit still reports one critical marketing
`react-server-dom-webpack` finding; all six npm projects report zero high findings.
That existing dependency issue and hosted implementation checks remain open.
Merging, auto-merge, releases, deployment and installation remain paused.

Manual verification: run `npm run test:ux057`, inspect zero attempted writes on
idle paths and positive persisted bytes after genuine changes/due work. Do not
substitute a fixture's cleanup for the absent cognition stop APIs. Rollback
removes tests/script/mappings and documentation corrections; no data migration
or runtime rollback is necessary.

Implementation commit: `Verify timer persistence before changing runtime policy`.
Draft description: characterize all six reported timer writers with isolated
fixtures, correct the unsupported every-tick finding, preserve open lifecycle
and storage-failure limits, and change no production behavior.

Raw receipts are retained in the current Codex task's `next-nov18b/` directory.

## Mutation proofs

Source: `600ad703c60b4d0c4ec13dc75f6880f24ee1d4f5`.

Command: `/opt/homebrew/opt/node@22/bin/node --import tsx --test tests/ux057/timer-persistence.test.mts` in detached scratch `/tmp/ux057-mutations-600ad703c60b`.

Baseline: 12 pass / 0 fail / 0 cancelled. All 11 mutations caught; each restored run is 12 pass / 0 fail / 0 cancelled.

| Control | Mutated file | Red pass/fail | Failing test assertions |
| --- | --- | --- | --- |
| phish-idle | `src/components/PhishstatsFeedPanel.ts` | 11/1 | phish refresh is write-free; slider persists across reload and destroy stops refresh |
| tv-idle | `src/services/tv-mode.ts` | 11/1 | TV cycling is write-free; explicit interval persists across reload and destroy clears timer |
| digest-idle | `src/services/notification-digest.ts` | 10/2 | empty and retired-only digest ticks do not write; deliverable digest persists and teardown unsubscribes; digest denied save preserves current delivery but does not invent persisted history |
| scheduler-not-due | `src/services/intelligence/improvement-scheduler.ts` | 11/1 | disabled/not-due scheduler timers do not write; due history and schedule survive reload and stop |
| consolidation-not-due | `src/services/cognition/consolidation-cadence.ts` | 11/1 | disabled/Ghost/not-due consolidation writes nothing; successful due work advances and reloads cadence |
| self-tuning-not-due | `src/services/cognition/self-tuning.ts` | 11/1 | Ghost/not-due self-tuning writes nothing; actual due grading/drift and completion persist across reload |
| phish-save | `src/components/PhishstatsFeedPanel.ts` | 10/2 | phish refresh is write-free; slider persists across reload and destroy stops refresh; phish denied reads use default and denied writes retain only current in-memory preference |
| consolidation-save | `src/services/cognition/consolidation-cadence.ts` | 10/2 | disabled/Ghost/not-due consolidation writes nothing; successful due work advances and reloads cadence; failed consolidation or denied storage never falsely advances the saved cadence |
| tv-cancel | `src/services/tv-mode.ts` | 11/1 | TV cycling is write-free; explicit interval persists across reload and destroy clears timer |
| digest-unsubscribe | `src/services/notification-digest.ts` | 11/1 | empty and retired-only digest ticks do not write; deliverable digest persists and teardown unsubscribes |
| scheduler-disabled | `src/services/intelligence/improvement-scheduler.ts` | 10/2 | disabled/not-due scheduler timers do not write; due history and schedule survive reload and stop; scheduler denied writes keep in-memory result but reload retains the previously saved schedule |

Each `<control>.diff` records the confirmed applied source edit; `<control>-red.log` and `<control>-restored.log` preserve actual assertions and counts. `results.json` records per-control diff hashes, source hashes, clean restoration and exact raw paths. `source-checksums.json` pins all six production files; `final-status.txt` confirms original hashes and empty Git status.

The first runner stopped before applying digest-idle because its exact indentation match count was zero. No green coverage was inferred. The corrected runner resumed after preserving the first two completed controls; the original stopped log and separate resume log remain one directory above.

### Source SHA256

- `src/components/PhishstatsFeedPanel.ts`: `b3963a992a027c67772b07917044e0ca1cac9246489915ca1495ea1a040266ca`
- `src/services/cognition/consolidation-cadence.ts`: `65277bca2022df86d8101dadf54f2be2be1ba46bce3fc7b4eece21797f5fa8cd`
- `src/services/cognition/self-tuning.ts`: `32c1bef65f96e8d64afdb63f98bba902569f99a23c419ac868f1f8464be32890`
- `src/services/intelligence/improvement-scheduler.ts`: `6a94f1649ecef3fa97f8a363ab7774496ec5b3b0090baacd1a5732d799b2b227`
- `src/services/notification-digest.ts`: `c0d2a13c92c5ce99d4e6537c86c49fed552776b25da37108a03590e3527e0b5a`
- `src/services/tv-mode.ts`: `3ea405d31e68489cec57d12236b7588c116f0d311a5d986aadd492fc2a1a95ce`

### Proof limits

Synthetic in-memory storage and deterministic captured callbacks only. Actual six source modules and internal grading/drift logic execute, with explicit synthetic dependencies. No installed storage, native app, network data, device energy, or elapsed-time benefit is measured. Consolidation/self-tuning lack production stop APIs; fixture disposal is not a lifecycle guarantee. TV storage exceptions remain characterized. Production candidate code is unchanged.

## Additional storage-failure proofs

Source: `600ad703c60b4d0c4ec13dc75f6880f24ee1d4f5`. Shared candidate unchanged; no test/production edits.

Command: `/opt/homebrew/opt/node@22/bin/node --import tsx --test tests/ux057/timer-persistence.test.mts` in detached `/tmp/ux057-mutations-600ad703c60b`.

Fresh baseline 12 pass / 0 fail / 0 cancelled.

| Control | Applied mutation | Red | Restored | Failing assertion |
| --- | --- | --- | --- | --- |
| tv-exception-swallowed | `src/services/tv-mode.ts` | 11 pass / 1 fail | 12 pass / 0 fail | TV storage read and write exceptions stay observable without claiming recovery |
| self-tuning-containment-removed | `src/services/cognition/self-tuning.ts` | 11 pass / 1 fail | 12 pass / 0 fail | self-tuning storage denial is contained and does not invent a persisted completion |

Both actual applied diffs, red/restored logs and source/diff SHA256s are preserved here. Exact source hash restoration and clean Git status were checked after each control. No cancellations/skips.

Combined with the unchanged prior eleven proofs, 13/13 controls were caught and all twelve new test cases were observed failing under at least one applied mutation. Prior eleven receipts remain unchanged. This closes the two previously unhit test cases; it does not claim exhaustive coverage.

Same synthetic-storage and lifecycle limitations as the original report apply. No native/live/installed data was accessed.
