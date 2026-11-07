# UX-038: Live News error-link output safety

## Scope and design

PR #1840 implements the previously claimed, approved output-boundary design.
The only production changes are `src/components/live-news-url.ts` and the two
error-link call sites in `LiveNewsPanel.ts`. A pure helper prefers an allowlisted
11-character video ID, otherwise an allowlisted `@` handle (Unicode letters,
marks, numbers, dot, hyphen, underscore; 1–100 characters after `@`). It encodes
the handle component and always returns the fixed HTTPS YouTube origin. Invalid
values fall back to the YouTube homepage. The template link also HTML-escapes its
URL. Neither supplied record nor stored channel data is changed.

The allowlist is an output safety boundary, not a claim that a channel exists or
an alteration to Add/Edit policy. Configured international handles are preserved.
Playback, providers, storage, dependencies and native settings are unchanged.
No release, tag, install, deployment or build dispatch was performed.

Discovery and design were delegated to Sonnet (medium). The corrected design
confirmed this minimal helper and two-call-site approach stays within approved
scope; a full DOM rewrite and ASCII-only handle policy were rejected. The first
proposal's incorrect Unicode `\w` assumption and source-text-only tests were
corrected before production implementation. Actual DOM tests exercise both real
methods without starting playback or providers.

## Acceptance and targeted checks

Node 22; `npm run test:live-news-links` runs helper/DOM tests and the existing HLS
regressions. Actual restored output:

```text
# tests 12
# pass 12
# fail 0
# tests 46
# pass 46
# fail 0
```

Before implementation, the first four real DOM tests reported `# pass 2` /
`# fail 2`: the embed-error payload produced an injected `onclick` attribute,
and bot-check retained an invalid encoded destination. The helper test file
initially failed to import the not-yet-existing helper (0 pass / 1 fail).

## Clean-tree mutation proofs

Each mutation started from clean implementation commit `ec909874911bdcbbab13cef190cd6774846a0dc4`.
For each, the SHA-256 was recorded, `git diff` confirmed a nonempty applied
mutation, the targeted 12-test helper/DOM suite ran red, and original bytes were
restored. The restored checksum matched and `git status --short` was empty after
every mutation. Existing HLS source tests were not substituted for behavioral
proof.

### video-guard

File: `src/components/live-news-url.ts`. Baseline **12 pass / 0 fail** → **10 pass / 2 fail**.

Restored SHA-256: `f40704022267f5385d44b3de1726d873d0b3d7c7f67e4ec343aa1de2d0d27137`.

Confirmed applied diff:

```diff
diff --git a/src/components/live-news-url.ts b/src/components/live-news-url.ts
index f9eff742f..dd7f73d02 100644
--- a/src/components/live-news-url.ts
+++ b/src/components/live-news-url.ts
@@ -3,7 +3,7 @@ const YOUTUBE_HOME = 'https://www.youtube.com/';
 /** Output boundary only: do not change or persist the supplied channel record. */
 export function youtubeWatchUrl(channel: { videoId?: unknown; handle?: unknown }): string {
   const { videoId, handle } = channel;
-  if (typeof videoId === 'string' && videoId.length === 11 && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
+  if (typeof videoId === 'string' && videoId.length > 0) {
     return `${YOUTUBE_HOME}watch?v=${encodeURIComponent(videoId)}`;
   }
   if (typeof handle === 'string') {
```

Actual failing tests:

```text
not ok 10 - invalid external video IDs fall back safely to a valid handle
not ok 11 - invalid inputs fail closed without mutating stored channel data
```

### handle-guard

File: `src/components/live-news-url.ts`. Baseline **12 pass / 0 fail** → **6 pass / 6 fail**.

Restored SHA-256: `f40704022267f5385d44b3de1726d873d0b3d7c7f67e4ec343aa1de2d0d27137`.

Confirmed applied diff:

```diff
diff --git a/src/components/live-news-url.ts b/src/components/live-news-url.ts
index f9eff742f..fb6fddcb4 100644
--- a/src/components/live-news-url.ts
+++ b/src/components/live-news-url.ts
@@ -10,7 +10,7 @@ export function youtubeWatchUrl(channel: { videoId?: unknown; handle?: unknown }
     // Compare the whole match: JavaScript's $ also matches before a final newline.
     // Unicode letters/marks/numbers preserve configured international handles.
     const match = /^@[\p{L}\p{M}\p{N}_.-]{1,100}$/u.exec(handle);
-    if (match?.[0] === handle) {
+    if (true) {
       return `${YOUTUBE_HOME}@${encodeURIComponent(handle.slice(1))}`;
     }
   }
```

Actual failing tests:

```text
not ok 1 - showEmbedError rejects markup and unsafe destination components
not ok 2 - showEmbedError fails closed for malformed persisted handles and preserves valid video links
not ok 4 - showBotCheckPrompt rejects markup and unsafe destination components
not ok 5 - showBotCheckPrompt fails closed for malformed persisted handles and preserves valid video links
not ok 9 - unsafe and malformed handles cannot become channel paths
not ok 11 - invalid inputs fail closed without mutating stored channel data
```

### component-encoding

File: `src/components/live-news-url.ts`. Baseline **12 pass / 0 fail** → **11 pass / 1 fail**.

Restored SHA-256: `f40704022267f5385d44b3de1726d873d0b3d7c7f67e4ec343aa1de2d0d27137`.

Confirmed applied diff:

```diff
diff --git a/src/components/live-news-url.ts b/src/components/live-news-url.ts
index f9eff742f..9bd3cc911 100644
--- a/src/components/live-news-url.ts
+++ b/src/components/live-news-url.ts
@@ -11,7 +11,7 @@ export function youtubeWatchUrl(channel: { videoId?: unknown; handle?: unknown }
     // Unicode letters/marks/numbers preserve configured international handles.
     const match = /^@[\p{L}\p{M}\p{N}_.-]{1,100}$/u.exec(handle);
     if (match?.[0] === handle) {
-      return `${YOUTUBE_HOME}@${encodeURIComponent(handle.slice(1))}`;
+      return `${YOUTUBE_HOME}@${handle.slice(1)}`;
     }
   }
   return YOUTUBE_HOME;
```

Actual failing tests:

```text
not ok 12 - encodes Unicode path components and keeps valid punctuation
```

### embed-callsite

File: `src/components/LiveNewsPanel.ts`. Baseline **12 pass / 0 fail** → **10 pass / 2 fail**.

Restored SHA-256: `9b3dd1d29abd7e507c01ae7c7cf8de84d6a1c5b36159f7dd97fde00c82748fde`.

Confirmed applied diff:

```diff
diff --git a/src/components/LiveNewsPanel.ts b/src/components/LiveNewsPanel.ts
index dc59d4be0..58696a969 100644
--- a/src/components/LiveNewsPanel.ts
+++ b/src/components/LiveNewsPanel.ts
@@ -932,7 +932,7 @@ export class LiveNewsPanel extends Panel {
 
   private showEmbedError(channel: LiveChannel, errorCode: number): void {
  this.destroyPlayer();
- const watchUrl = youtubeWatchUrl(channel);
+ const watchUrl = channel.videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(channel.videoId)}` : `https://www.youtube.com/${channel.handle}`;
 
  this.content.innerHTML = `
  <div class="live-offline">
```

Actual failing tests:

```text
not ok 1 - showEmbedError rejects markup and unsafe destination components
not ok 2 - showEmbedError fails closed for malformed persisted handles and preserves valid video links
```

### bot-callsite

File: `src/components/LiveNewsPanel.ts`. Baseline **12 pass / 0 fail** → **10 pass / 2 fail**.

Restored SHA-256: `9b3dd1d29abd7e507c01ae7c7cf8de84d6a1c5b36159f7dd97fde00c82748fde`.

Confirmed applied diff:

```diff
diff --git a/src/components/LiveNewsPanel.ts b/src/components/LiveNewsPanel.ts
index dc59d4be0..c2e44e545 100644
--- a/src/components/LiveNewsPanel.ts
+++ b/src/components/LiveNewsPanel.ts
@@ -1297,7 +1297,7 @@ export class LiveNewsPanel extends Panel {
 
   private showBotCheckPrompt(): void {
  const channel = this.activeChannel;
- const watchUrl = youtubeWatchUrl(channel);
+ const watchUrl = channel.videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(channel.videoId)}` : `https://www.youtube.com/${encodeURIComponent(channel.handle)}`;
 
  this.destroyPlayer();
  this.content.innerHTML = '';
```

Actual failing tests:

```text
not ok 4 - showBotCheckPrompt rejects markup and unsafe destination components
not ok 5 - showBotCheckPrompt fails closed for malformed persisted handles and preserves valid video links
```

## Validation and review

`bash scripts/agentic-validate.sh --tests "test:live-news-links"` completed with
exit 0 on Node 22. Actual final output:

```text
Agentic validation gate passed.
Tests run: test:live-news-links
This gate does NOT prove a new test fails without its fix — attach a mutation proof (AGENTS.md).
```

The gate ran targeted tests, lockfile check, strict lint, all typechecks, secret
scan, cross-agent setup check, docs check, roadmap check, and production build.
Build emitted existing import-extension/chunk warnings but completed. Final
independent Sonnet review remains required in a SHA-pinned verdict commit; no
self-review or PR-body marker substitutes for that gate.
An initial local gate attempt stopped at missing `@deck.gl/maplibre` in the
canonical checkout's older dependency installation. Validation was rerun using
the existing lock-compatible UX-047 dependency tree; no dependency files changed.

## Manual verification and remaining limits

The DOM test harness verifies both output methods, anchor attributes, unsafe
values, Unicode, valid videos, and the bot-check sign-in/retry controls. Packaged
app/manual playback verification was not run. Optional manual check: trigger an
embed error or bot-check for a configured international channel and verify its
Open on YouTube link targets that channel; use a disposable malformed stored
channel fixture and verify it offers only the YouTube homepage destination.

Rollback: revert the UX-038 helper, two call-site substitutions, tests and script.
There are no data migrations or persistent state changes to undo. Do not roll
back independent roadmap changes or release/install holds.

## Actual-main integration qualification (2026-11-07)

The final seven-file UX-038 delta is integrated linearly on actual main
`4edcc70c99069ef96a75a06aec2c4af94e2c7c06`, after #1854 and #1839 merged.
All upstream validation evidence is retained. The approved helper, both call
sites and tests are unchanged; no channel input/storage/provider policy changed.

The repaired composite execution `198046ab601ec2d82749caa9b98c2344a9a9169b`
(tree `7e431821c2137533703d3ec8f5e04a8260642ad2`) qualified the shared transport
repair with these actual results on Node 22.23.1:

- `bash scripts/agentic-validate.sh --tests "test:live-news-links test:warning-delivery"`:
  exit 0; link helper/DOM 12 pass / 0 fail, HLS 46 pass / 0 fail,
  warning delivery 45 pass / 0 fail; production build completed.
- `npm run lint:ci`: exit 0; 1006 baseline findings, no increases;
  zero errors, one ignored-declaration warning.
- `node --import tsx --test src/services/synthesis/__tests__/transport-evidence.test.mts`:
  14 pass / 0 fail.

Integration verified all 5559 non-evidence tracked input SHA-256 hashes against
that execution, plus all 674 production-build file hashes and modes. Root and
marketing installed-lock hashes remain respectively
`02e91294e87b69296908c7d0fc9657b5b15688cb31ac80fe7aa12170036f5c1f` and
`6975c2fe226936341b8ed25556144ee0d1a5ce8618f7f4d079eb6f10863ffff7`.
These are continuity proofs for earlier execution, not claims of new aggregate
or full-build runs. The five owned mutation receipts above remain applicable
by exact helper/call-site/test identity. No lint rules, baselines, exclusions,
or generated build outputs were changed to qualify this integration.

The complete effective plan against explicit actual main contains 49 scripts
and passes mapping ownership checks. Compared with the preceding prepared
composite, no suites were added; UX044 changed from PR-only npm execution to
trusted direct execution with the same command. That newly trusted path ran:

```text
tsx --test src/components/__tests__/critical-posture-banner.test.mts src/components/__tests__/summary-strip-announcements.test.mts
# tests 26
# pass 26
# fail 0
```

A fresh complete GitHub snapshot fetched all 1836 PR records and selected all
103 relevant main-target records (26 OPEN), including candidate #1840. The
unchanged roadmap controller exited 0 with an empty blocking list. No dependency
blocker was waived. Detailed local execution logs, exact selector stages, input
and build manifests and the snapshot are preserved in
`/private/tmp/ux038-nov7-evidence/`, including
`UX038-FINAL-MAIN-CONTINUITY.json` and `final-main-live-report.json`.

Final cross-agent review, verdict, hosted checks and closeout remain pending.
No push, merge, release, deployment or installation is claimed by this receipt.
