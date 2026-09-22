# UX-031 — System appearance repair evidence

Status: implementation and automated validation complete; final review in progress.
Draft PR #1720. Packaged native acceptance remains open.
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
Final command outputs and mutation proofs are recorded below. Proposed checks
in the design brief are not results.

## Historical dependency audit blocker

Before integrating merged prerequisite PR #1721, the old main lockfile produced
this audit baseline:

```text
{"info":0,"low":0,"moderate":6,"high":2,"critical":1,"total":9}
```

The package advisories include the existing map/loader dependency chain and
other existing dependencies. That baseline blocked an audit-clean claim at the time. PR #1721 subsequently
landed; the integrated dependency installation reports zero vulnerabilities.
Final integrated audit evidence is recorded during merge closeout.
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

## Final repaired-source verification

Final production source: `4da0d51417e51a9d5a585994fb7bae0b46736310`.
The earlier results above are historical; the following checks cover the final
subscription-capability repair. Node 22 was used throughout.

```text
bash scripts/agentic-validate.sh --tests 'test:system-theme'
# pass 20
# fail 0
[lint:conflicts] No merge conflict markers found.
[lint:json] Parsed 137 tracked JSON file(s).
[lint:yaml] Parsed 23 tracked YAML file(s).
[lint:shell] Checked 20 tracked shell file(s).
[lint:md] Checked 144 Markdown file(s).
Secret scan passed for 4746 file(s).
✓ built in 20.55s
Agentic validation gate passed.
Tests run: test:system-theme

npm run bundle:check
✓ All bundle-size policies satisfied.
```

Both exited 0. The gate includes all type checks and the full web build.
Logs: `agentic-gate-review1.log` and `bundle-check-review1.log` under the evidence
root. Main gzip is 442.8 KB against the unchanged 460 KB cap; total gzip is
4.90 MB against 6.00 MB. Build warnings about existing mixed static/dynamic
imports remain; no native build, installation or performance benchmark is claimed.

Final-source browser baselines in the separate clean mutation worktree report
5 passed / 0 failed for full and 5 passed / 0 failed for happy. Exact commands
and selected-case mutation results are in
[the mutation report](UX-031-MUTATION-PROOFS.md). All 16 deliberate regressions
failed their relevant assertions; 0 survived. Every applied diff was inspected,
every restored checksum matched, and the mutation worktree finished clean.

The final isolated WKWebView probe used manager SHA-256
`2fad21df8d2bfb8337612581921c91b8d12c106b2780e045bbd97592ef076e0d`
and reports `"failed" : 0, "passed" : 8` on macOS 27.0 / 26A428.
It received actual native media events through per-window appearance overrides.

```bash
python3 /Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/native/run.py /Users/bradleybond/Developer/crystalball/.worktrees/ux031-system-appearance-20260915 candidate-review1
```

The runner exited 0; assertion counts come from its JSON, not that exit status.
Copied source and results are in `native/candidate-review1`; exact harness commands
and scope are in `native/README.md`. This remains module/engine evidence only.

## Changed architecture and review status

- `src/utils/theme-manager.ts`: separates automatic application from manual
  persistence, preserves a session choice, and installs one supported listener.
- `src/config/variant.ts`, `src/main.ts`, `src/settings-main.ts`: shared variant
  resolution before theme bootstrap and subscriptions in both entries.
- `src/styles/window-chrome.css`, `src/styles/macos-native.css`: five light
  selector groups now match the html-owned theme; existing materials remain.
- `src/utils/__tests__/theme-manager.test.mts`, `e2e/system-theme.spec.ts`,
  `package.json`: focused behavioral coverage and its test command.

Independent source review found one P2, repaired in the first automatic cycle.
The second source assessment reports no blocking source findings and independently
ran 20 passing module tests. Final independent evidence review concluded: “No blocking findings in the source
and automated evidence reviewed for `4da0d51417e51a9d5a585994fb7bae0b46736310`.”
It verified all 16 mutation diffs, assertions/counts, restored checksums and clean
records against retained artifacts. The separate real Claude review remains
pending; its conclusion must pin the final committed tip. The user subsequently authorized source merge; packaged acceptance remains
tracked separately and is not claimed by source delivery.

Proposed final documentation commit: `Preserve reproducible appearance evidence`.
Draft PR description: Restore repeated system appearance changes in main and
Settings while respecting manual choices, storage failures and happy's light
default. Repair affected Mac light styles. Automated, mutation and isolated
WKWebView checks pass; packaged Tauri acceptance and inherited dependency audit
issues remain open. No migration or installation is included.

## Merge closeout repair 2 — full variant identity

After all seven required checks passed on the first reviewed tip, the broader
CI matrix exposed an additional real regression in `identity (full)`:

```text
Expected: not have attribute
Received: have attribute
1 failed
```

The shared resolver published `data-variant="full"`, conflicting with the
established full identity contract. The second bounded repair deletes the
attribute for full and preserves named attributes for other variants. Deletion
also clears stale or invalid values; merely skipping assignment is insufficient.
The existing `e2e/variant-identity.spec.ts` assertion is unchanged. Updated UX-031
fixtures now model the actual attribute-free full document.

Focused red/green evidence:

```text
# pass 18
# fail 4
# pass 22
# fail 0
```

Final gate, mutation and review evidence for this repair is recorded during
closeout. Earlier SHA-pinned reviews and mutation proofs remain historical;
they do not approve the changed resolver. This is the second automatic repair
cycle. A surviving blocker after this cycle requires escalation under AGENTS.md.

Native path clarification: the packaged Settings command opens the unified
Settings dialog in main; it does not create a separate `settings.html` window.
Packaged acceptance must cover main and that actual dialog. Standalone Settings
remains independently covered through its browser entry. The user authorized
source delivery to main on September 15; packaged native acceptance, initial
paint and complete macOS visual acceptance remain explicitly unfinished.

Repair 2 final gate (Node 22), before dependency-prerequisite integration:

```text
bash scripts/agentic-validate.sh --tests 'test:system-theme'
# pass 22
# fail 0
Secret scan passed for 4748 file(s).
✓ built in 17.17s
Agentic validation gate passed.
Tests run: test:system-theme

npm run bundle:check
✓ All bundle-size policies satisfied.
```

Both commands exited 0. Main remains 442.8 KB and total 4.90 MB with unchanged
limits. Sequential browser results from the same repair:

```text
6 passed (54.8s)
6 passed (1.1m)
1 passed (23.5s)
1 passed (27.5s)
```

The per-run logs are `identity-repair-{full,happy,tech,finance}.log`; final gate
log is `identity-repair-agentic-gate.log` in the retained evidence root.
Exact browser commands use `E2E_PORT=4301 VITE_VARIANT=full` and
`E2E_PORT=4302 VITE_VARIANT=happy` with
`npx playwright test e2e/variant-identity.spec.ts e2e/system-theme.spec.ts`;
tech and finance use ports 4303/4304 and only `e2e/variant-identity.spec.ts`.
Each run has its own evidence output directory. Final variant source SHA-256:
`7fd7eaf8742b552e37f2299e0bfb4cf4015511dc4e625031a9313dfd03c18055`.

Repair 2 clean-tree proof is appended to
[the mutation report](UX-031-MUTATION-PROOFS.md). Baseline 22 pass / 0 fail;
full-attribute regression 18 pass / 4 fail; build precedence 19 pass / 3 fail;
stored precedence 21 pass / 1 fail. All three applied diffs were inspected and
restored with matching SHA-256 and clean status. These proofs pin pre-integration
source `1bccc6b7f585c768e59b09dfa49e42d5bc032cf7`; rebase onto dependency main
`7bbb43b35ae150dbb32d91eec298fd26eecf2a42` changed none of the appearance source
bytes. Integrated validation is recorded separately.

## Integrated main-baseline verification

Appearance source bytes are unchanged after rebase onto merged PR #1721.
The resulting source tip is `fb494773e7e258549d9d147439ad6e7d4edc4ab5`.
Fresh Node 22 dependency installation and validation exited 0:

```text
npm ci
added 949 packages, and audited 951 packages in 39s
found 0 vulnerabilities

bash scripts/agentic-validate.sh --tests 'test:system-theme'
# pass 22
# fail 0
Secret scan passed for 4754 file(s).
✓ built in 19.47s
Agentic validation gate passed.
Tests run: test:system-theme

npm run bundle:check
✓ All bundle-size policies satisfied.

npm audit --json
{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}
```

The integrated enforcement report measures main 442.7 KB / 460 KB and total
5.10 MB / 6.00 MB. Vite's decimal output uses different size presentation;
these are the unchanged policy tool's measurements. Logs are `merge-npm-ci.log`,
`merge-agentic-gate.log`, `merge-bundle-check.log` and `merge-audit.json`.

Repair 2 full browser command (before dependency integration):

```bash
E2E_PORT=4301 VITE_VARIANT=full npx playwright test e2e/variant-identity.spec.ts e2e/system-theme.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/identity-repair-full-artifacts
```

Repair 2 happy browser command (before dependency integration):

```bash
E2E_PORT=4302 VITE_VARIANT=happy npx playwright test e2e/variant-identity.spec.ts e2e/system-theme.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/identity-repair-happy-artifacts
```

Repair 2 tech browser command (before dependency integration):

```bash
E2E_PORT=4303 VITE_VARIANT=tech npx playwright test e2e/variant-identity.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/identity-repair-tech-artifacts
```

Repair 2 finance browser command (before dependency integration):

```bash
E2E_PORT=4304 VITE_VARIANT=finance npx playwright test e2e/variant-identity.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/identity-repair-finance-artifacts
```

Integrated browser reruns, sequential and both exit 0:

```bash
E2E_PORT=4311 VITE_VARIANT=full npx playwright test e2e/variant-identity.spec.ts e2e/system-theme.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/merge-full-artifacts
```

```text
6 passed (43.8s)
```

```bash
E2E_PORT=4312 VITE_VARIANT=happy npx playwright test e2e/variant-identity.spec.ts e2e/system-theme.spec.ts --output=/Users/bradleybond/.crystalball-diagnostics/ux031-system-appearance-20260915/merge-happy-artifacts
```

```text
6 passed (41.3s)
```

Independent second-cycle source assessment found no blocking findings and
independently reran 22 passing module tests. Final evidence and opposite-agent
review must pin the final documentation tip before closeout. Native acceptance
remains an open tracker item, not a claim made by source merge.

Final independent evidence audit verified the integrated gate, audit, bundle
and browser results against raw logs; all three configuration mutation diffs,
assertions, counts, checksums and clean restores matched. It found no blocking
correctness or evidence findings. Quoted blank-line whitespace was normalized
for repository lint while raw artifacts remain unchanged.
