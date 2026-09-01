# Roadmap controller rerun evidence

Date: 2026-09-01

Implementation commit: `b605a2c3e44498b8de8b4bd3e5876eb92e073973`

Base commit: `d9b0aa1cf6fa38a21ea49fc350ca70d282291230`

## Scope

The pull-request roadmap workflow now resolves the event PR through the current
GitHub REST state. Only a currently open PR targeting `main` receives candidate
privileges. A merged, closed, or retargeted PR cannot retain provisional
evidence privileges or a stale entry from the open-PR listing.

The regression tests execute the deployed inline `actions/github-script` block
with bounded mocks rather than testing a copied implementation.

## Raw evidence index

The full raw logs were retained for independent review at these paths:

```text
d11fdacbff581f0b5f41aa2a928ef50f01a422d60ad128c637638e972dcc08d2  /private/tmp/roadmap-rerun-mutation-b605a2c3.log
c8abf809a6941b58d065bd6b2cdfbd162e559663fa03b990926a23b1fb9762b9  /private/tmp/roadmap-rerun-agentic-b605a2c3.log
```

The mutation log contains 916 lines. The agentic-validation log contains 479
lines. The hashes above were calculated after both commands completed.

## Mutation proof 1: current REST state is authoritative

Clean baseline:

```text
COMMAND: git status --short
COMMAND: git rev-parse HEAD
b605a2c3e44498b8de8b4bd3e5876eb92e073973
COMMAND: shasum -a 256 workflow test
f02154d086866b97ffcfbd70d662172dd1659b46e1cb4b642a5bf8d5054e44fe  .github/workflows/roadmap-controller.yml
4bedf9ffbbba0028cd9497f85df359874a3c77bbbfbfdd5f8585351bb3b2a8a0  tests/roadmap-controller.test.mjs
```

The confirmed-applied mutation removed the live `pulls.get` event lookup,
current-base filtering, stale-entry deletion, and open-state candidate gate. It
restored the former unconditional payload candidate:

```diff
-            const eventType = context.eventName;
-            let eventPull = null;
-            if (eventType === 'pull_request') {
-              const { data } = await github.rest.pulls.get({
-                owner: context.repo.owner,
-                repo: context.repo.repo,
-                pull_number: context.payload.pull_request.number,
-              });
-              eventPull = data;
-              byNumber.delete(eventPull.number);
-              if (eventPull.base.ref === base) byNumber.set(eventPull.number, eventPull);
-            }
             for (const number of referenced) {
               if (byNumber.has(number)) continue;
-              if (eventPull?.number === number) continue;
@@
+            const eventType = context.eventName;
             const candidatePrNumbers = [];
             if (eventType === 'pull_request') {
-              if (eventPull.base.ref === base && eventPull.state === 'open') {
-                candidatePrNumbers.push(eventPull.number);
-              }
+              candidatePrNumbers.push(context.payload.pull_request.number);
```

Raw TAP footer:

```text
1..27
# tests 27
# suites 0
# pass 22
# fail 5
# cancelled 0
# skipped 0
# todo 0
EXIT_CODE=1
```

The failing assertions were the post-merge current lookup, open current
candidate, closed-unmerged evidence, retargeted current base, and REST failure
fail-closed tests.

After restoration:

```text
f02154d086866b97ffcfbd70d662172dd1659b46e1cb4b642a5bf8d5054e44fe  .github/workflows/roadmap-controller.yml
4bedf9ffbbba0028cd9497f85df359874a3c77bbbfbfdd5f8585351bb3b2a8a0  tests/roadmap-controller.test.mjs
1..27
# tests 27
# suites 0
# pass 27
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

`git status --short` was empty before the mutation and after restoration.

## Mutation proof 2: stale list state is removed

The confirmed-applied mutation removed only the list/get race repair:

```diff
               });
               eventPull = data;
-              byNumber.delete(eventPull.number);
               if (eventPull.base.ref === base) byNumber.set(eventPull.number, eventPull);
```

The retarget test then retained the stale open-main record returned by
`pulls.list` even though `pulls.get` returned the current `release` base:

```text
not ok 14 - a retargeted pull_request event is excluded using its current REST base
error: |-
  Expected values to be strictly deep-equal:
  + actual - expected

  + [
  +   {
  +     base: 'main',
  +     number: 88,
  +     state: 'OPEN',
  +   }
  + ]
  - []
```

Raw TAP footer:

```text
1..27
# tests 27
# suites 0
# pass 26
# fail 1
# cancelled 0
# skipped 0
# todo 0
EXIT_CODE=1
```

After restoration, both original checksums matched, `git status --short` was
empty, and the suite returned to `27 pass / 0 fail`.

## Agentic validation

Command:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH \
  bash scripts/agentic-validate.sh --tests "test:roadmap-controller"
```

Raw relevant output:

```text
1..27
# tests 27
# suites 0
# pass 27
# fail 0
[lint:yaml] Parsed 23 tracked YAML file(s).
Secret scan passed for 4728 file(s).
transforming...✓ 5633 modules transformed.
✓ built in 17.00s
Agentic validation gate passed.
Tests run: test:roadmap-controller
```

The gate also passed the lockfile check, strict JSON/YAML/shell/Markdown/color
lint, both TypeScript configurations, documentation freshness, and the roadmap
controller. Existing bundle-size, dynamic-import, Browserslist-age, and plugin
timing warnings remained non-fatal and are unrelated to this workflow-only
change.

## Review escalation

The first independent review found the stale list/get retarget race, which was
repaired test-first. The second review confirmed the code repair but could not
audit mutation and full-gate evidence because only summarized results were
available. Human approval authorized this durable evidence record and one final
review cycle.

## Rollback

Revert the workflow, test, and evidence commits. No persisted data, schema,
permission, dependency, or runtime migration is involved. Rollback restores the
known post-merge rerun failure, so a roll-forward repair is preferred.
