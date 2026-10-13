# Q20 PR A validation: sidecar lows (R3-SEC-006, R3-SEC-007, R4-LOW-004)

Plan: `docs/plans/2026-10-04-q20-remaining-lows.md`, approved by Bradley on
October 4, 2026 (four PRs by area). Based on `main`.

## What changed

- **R3-SEC-006: the SMS webhook fails closed.**
  - With SMS enabled and no `TWILIO_AUTH_TOKEN`, a caller without the bearer
    token gets 503 "Twilio signature required". The check runs before the
    body is read.
  - The in-app test path (bearer token) and signed Twilio webhooks are
    unchanged.
- **`/api/sms/config` validates every change** (`validateSmsConfigPatch` in
  `sms-security.mjs`). Only these are accepted:
  - `enabled`, as a boolean;
  - `allowlist`: at most 25 entries of `{ phoneNumber, name, tier }`.
  - **Numbers:** new or changed ones must be E.164 once spaces, dashes, dots
    and parentheses are stripped (`+1 (555) 000-0000` becomes
    `+15550000000`). Numbers already saved are kept as they are, so an older
    config stays editable.
  - **Names:** at most 64 plain characters.
  - **Tier:** `admin` or `readonly`.
  - **Rejected:** unknown keys at either level return 400, and the body is
    capped at 64 KB.
  - The SMS settings panel now shows the reason when a save is refused.
- **R3-SEC-007:** new `fetchPinnedFollowingRedirects`. Every hop connects to
  the address `isSafeUrl` resolved for it, redirects are followed by hand and
  re-checked, and redirect chains stop after 3 hops. `/api/feed-discovery`
  uses it for the homepage fetch and the HEAD probes; the probes reuse the
  homepage's pinned address.
- **R4-LOW-004:** new `serializeForInlineScript`. It escapes `<`, `>`, `&`,
  U+2028 and U+2029 so a payload can't close the Patreon callback's inline
  script. The value still parses back identically.
- **Lint cleanup:** fixed pre-existing lint errors in `sms-security.mjs`
  (nested ternary, callback references), because CI lints touched files.

## Tests

- `src-tauri/sidecar/__tests__/q20-sidecar-lows.test.mjs` (9 tests). The
  sidecar is imported with `HOME` pointed at a temporary directory, so the
  real `~/.config/crystalball` is never read or written.
- Existing SMS suites still pass (101 tests).
- New script: `test:sidecar-lows`.

`bash scripts/agentic-validate.sh --tests "test:sidecar-lows test:sms test:sidecar"`
on the Mac printed "Agentic validation gate passed."

| Suite | Result |
|---|---|
| `test:sidecar-lows` | 54 pass, 0 fail |
| `test:sms` | 101 pass, 0 fail |
| `test:sidecar` | 643 pass, 0 fail |

Changed-file ESLint with `--max-warnings=0` is clean.

## Mutation proof (16 mutations, all red, all restored by SHA)

| ID | Mutation | Result |
|---|---|---|
| A01 | webhook accepted without Twilio token | red (1 failing), restored `e13a726a6fc6` |
| A02 | unknown config keys accepted | red (1 failing), restored `de033c2a5bb1` |
| A03 | phone not checked as E.164 | red (2 failing), restored `de033c2a5bb1` |
| A04 | saved legacy numbers rejected | red (1 failing), restored `de033c2a5bb1` |
| A05 | allowlist uncapped | red (1 failing), restored `de033c2a5bb1` |
| A06 | control characters in names | red (1 failing), restored `de033c2a5bb1` |
| A07 | any tier accepted | red (1 failing), restored `de033c2a5bb1` |
| A08 | config spread unvalidated | red (1 failing), restored `e13a726a6fc6` |
| A09 | '<' left raw in inline script | red (1 failing), restored `e13a726a6fc6` |
| A10 | U+2028 left raw | red (1 failing), restored `e13a726a6fc6` |
| A11 | callback back to JSON.stringify | red (1 failing), restored `e13a726a6fc6` |
| A12 | hops not pinned | red (1 failing), restored `e13a726a6fc6` |
| A13 | redirect targets not re-checked | red (2 failing), restored `e13a726a6fc6` |
| A14 | fetch follows redirects itself | red (1 failing), restored `e13a726a6fc6` |
| A15 | hop limit loosened | red (1 failing), restored `e13a726a6fc6` |
| A16 | homepage fetch unpinned | red (1 failing), restored `e13a726a6fc6` |

All 16 were rerun against the final test file in one pass. Before that,
A11's failure message had printed the whole sidecar source and overflowed
the runner's buffer. The source pin now fails with a short message.

## Residual risks and follow-ups

- **IPv6-only hosts** stay unpinned, the same as `/api/rss-proxy` (the
  resolver hook only pins IPv4).
- **The SMS panel's new save-error line** has no component test; the repo
  has no SMS panel harness yet.
- **Status table:** the R3 doc's table lives on the handoff branch, so mark
  R3-SEC-006/007 and R4-LOW-004 there when it merges.

## October 11, 2026 private repair and fresh evidence

This section records private work on `codex/pr1779-oct11-private-resume`.
Publication is held and independent Sol review is pending. It makes no
claim that this repair has merged, shipped, or changed production data.

The original sections above, their 54/101/643 totals, and their 16-row
mutation table are retained as October 4 history. They are not fresh
proof for the October 11 code. The original approved plan is unchanged.
The new six real DOM scenarios supersede the historical statement that
the SMS panel lacks a component harness.

Fresh code freeze: `323efd1b32a8ef10869682ab0068d964f4803c3f`; tree `15c0f386cf72466bff741b71fd5df30945c89762`.
Base: `3836f56d01a5b7d7c34c5e126a87e74694d6b5eb`. Exactly ten own paths
change. Current-main scripts, targeted override mappings, security
controls, dependencies, lockfiles, shared Panel, isolated MCP helper,
Codex routing, and validation rules are retained.

### Admission and panel behavior

Every submitted recipient is strictly validated before any exception.
A submitted list above 25 is accepted only when the saved list is also
above 25, its length strictly decreases, and every submitted normalized
`(phoneNumber, name, tier)` tuple consumes an available saved occurrence.
New recipients, changed names or tiers, and increased duplicate counts
cannot use this removal exception. Malformed saved entries cannot
authorize survivors; removing them is permitted. Lists at or below 25
retain normal editing. There is no truncation or deduplication.

An omitted list on disable or no-op preserves all legacy recipients.
Disabled-to-enabled changes reject an effective final list above 25,
including when the request omits the list. Already-enabled legacy
lists can retain their enabled state while removing recipients.
An unchanged oversized list submitted in full is still rejected;
compatibility depends on partial disable/no-op bodies.

The panel posts patches and adopts the authoritative server response
only after success. HTTP refusal retains rows and displays an escaped
reason. Event listeners attach through the real post-render callback.
The live checkbox is reset from authoritative state before rendering,
including the second identical refusal when cached HTML skips a render.
Tests use real Panel/happy-dom events, an owned sidecar, HTTP GET/POST,
and persisted synthetic tuples. The hostile error fixture is explicitly
a presentation injection, separate from actual sidecar refusal.

### Fresh commands and literal output

All seven targeted scripts ran sequentially, followed by the unchanged
agentic gate. The following lines are copied from actual output.

Command: `/opt/homebrew/opt/node@22/bin/node /opt/homebrew/opt/node@22/lib/node_modules/npm/bin/npm-cli.js run test:sidecar-lows`

Actual child exit: `0`; preservation wrapper exit:
`0`. Source and raw index were exactly preserved.

Actual output from `t05-private-seven-exact-resource-20261011-test-sidecar-lows.log`:

```text
# tests 89
# pass 89
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Command: `/opt/homebrew/opt/node@22/bin/node /opt/homebrew/opt/node@22/lib/node_modules/npm/bin/npm-cli.js run test:sms-panel`

Actual child exit: `0`; preservation wrapper exit:
`0`. Source and raw index were exactly preserved.

Actual output from `t05-private-seven-exact-resource-20261011-test-sms-panel.log`:

```text
# tests 6
# pass 6
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Command: `/opt/homebrew/opt/node@22/bin/node /opt/homebrew/opt/node@22/lib/node_modules/npm/bin/npm-cli.js run test:sms`

Actual child exit: `0`; preservation wrapper exit:
`0`. Source and raw index were exactly preserved.

Actual output from `t05-private-seven-exact-resource-20261011-test-sms.log`:

```text
# tests 101
# pass 101
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Command: `/opt/homebrew/opt/node@22/bin/node /opt/homebrew/opt/node@22/lib/node_modules/npm/bin/npm-cli.js run test:sidecar`

Actual child exit: `0`; preservation wrapper exit:
`0`. Source and raw index were exactly preserved.

Actual output from `t05-private-seven-exact-resource-20261011-test-sidecar.log`:

```text
# tests 646
# pass 646
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Command: `/opt/homebrew/opt/node@22/bin/node /opt/homebrew/opt/node@22/lib/node_modules/npm/bin/npm-cli.js run test:secret-boundary`

Actual child exit: `0`; preservation wrapper exit:
`0`. Source and raw index were exactly preserved.

Actual output from `t05-private-seven-exact-resource-20261011-test-secret-boundary.log`:

```text
# tests 21
# pass 21
# fail 0
# cancelled 0
# skipped 0
# todo 0
# tests 15
# pass 15
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Command: `/opt/homebrew/opt/node@22/bin/node /opt/homebrew/opt/node@22/lib/node_modules/npm/bin/npm-cli.js run test:mcp-untrusted`

Actual child exit: `0`; preservation wrapper exit:
`0`. Source and raw index were exactly preserved.

Actual output from `t05-private-seven-exact-resource-20261011-test-mcp-untrusted.log`:

```text
# tests 1
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Actual output from `t05-private-seven-exact-resource-20261011-test-mcp-untrusted-mcp-untrusted-stage-1-9a220df6-f668-4575-a1b3-056abb28fdae.stdout.log`:

```text
# tests 24
# pass 24
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Actual output from `t05-private-seven-exact-resource-20261011-test-mcp-untrusted-mcp-untrusted-stage-2-f85cd368-cb03-49ce-a037-c9ab251919c7.stdout.log`:

```text
# tests 23
# pass 23
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Command: `/opt/homebrew/opt/node@22/bin/node /opt/homebrew/opt/node@22/lib/node_modules/npm/bin/npm-cli.js run test:mcp-companion`

Actual child exit: `0`; preservation wrapper exit:
`0`. Source and raw index were exactly preserved.

Actual output from `t05-private-seven-exact-resource-20261011-test-mcp-companion.log`:

```text
# tests 10
# pass 10
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Actual output from `t05-private-seven-exact-resource-20261011-test-mcp-companion-mcp-companion-stage-1-09c20cd6-f1d7-4db6-9a20-ee5abb15c70f.stdout.log`:

```text
# tests 49
# pass 49
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Command: `/bin/bash scripts/agentic-validate.sh --tests 'test:sidecar-lows test:sms-panel test:sms test:sidecar test:secret-boundary test:mcp-untrusted test:mcp-companion'`

Actual child exit: `0`; preservation wrapper exit:
`1`. Source bytes and modes stayed exact; raw-index preservation was false.

Actual output from `t05-private-seven-exact-resource-20261011-gate.log`:

```text
# tests 89
# pass 89
# fail 0
# cancelled 0
# skipped 0
# todo 0
# tests 6
# pass 6
# fail 0
# cancelled 0
# skipped 0
# todo 0
# tests 101
# pass 101
# fail 0
# cancelled 0
# skipped 0
# todo 0
# tests 646
# pass 646
# fail 0
# cancelled 0
# skipped 0
# todo 0
# tests 21
# pass 21
# fail 0
# cancelled 0
# skipped 0
# todo 0
# tests 15
# pass 15
# fail 0
# cancelled 0
# skipped 0
# todo 0
# tests 1
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# tests 10
# pass 10
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Actual output from `t05-private-seven-exact-resource-20261011-gate-mcp-companion-stage-1-85247719-1059-450e-9b27-bad4c844b58c.stdout.log`:

```text
# tests 49
# pass 49
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Actual output from `t05-private-seven-exact-resource-20261011-gate-mcp-untrusted-stage-1-c857f9e6-e0fe-415d-8a49-a15b05ee7204.stdout.log`:

```text
# tests 24
# pass 24
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Actual output from `t05-private-seven-exact-resource-20261011-gate-mcp-untrusted-stage-2-aa63b1aa-60b5-4b2f-8d4e-742158673b82.stdout.log`:

```text
# tests 23
# pass 23
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

```text
Agentic validation gate passed.
```

The MCP wrapper and its raw child stages have separate totals; they are
not added together. Binary resource artifacts are hashed, not presented
as test output. The gate also ran the unchanged lockfile, lint, typecheck,
secret, cross-agent, documentation, roadmap, and build checks.

The first T05 batch stopped at MCP untrusted: outer 0 pass / 1 fail,
inner stage 1 at 24 pass / 0 fail, and actual raw stage 2 at 18 pass /
2 loader failures. The wrapper left stage-2 counts null after its exit
failure; the 18/2 comes from the raw child TAP. The private checkout
lacked its separate MCP dependency tree. All 93 existing-lock packages
were admitted from 92 exact SHA-512-verified tarballs already cached,
prepared offline with lifecycle scripts disabled, and copied into an
ignored private test-resource directory. No tracked dependency, lockfile,
runtime helper, rule, or source changed. The failed batch remains recorded;
the complete child-command results above follow this resource preparation.

A second batch was started before the resource-copy guard result was
inspected. That guard had stopped before copying because the ignore
check omitted the directory path’s trailing slash. The second batch
therefore repeated the missing-module failures and is retained too.
The corrected copy receipt verifies all 3911 resource records, and the
qualified driver additionally checks those exact bytes and modes
before and after each command. This changes only outside validation
controls and ignored test resources, not production rules or helpers.

The completed full gate exited 0 in 86.733 seconds, but its preservation
wrapper exited 1. The batch passed flag remains false. The raw index
changed in 54 bytes: ctime/mtime cache fields for the three temporary
mutation targets and the trailing checksum. All 5066 source records,
modes, directories, HEAD, tree, staged objects, names, flags, non-time
index metadata, extensions, and clean status remain identical. The
observed index was audited and adopted; it was never restored secretly.
These changes are consistent with a Git stat refresh; the exact child
call was not traced. This qualification does not turn the old wrapper
result into a pass. Final documentation-tip validation follows separately.

Qualified gate adoption SHA-256: `f6baf470cb77fb09d8b5f91116ec649664b024cf27215439d4d36a2622dcb8da`.
Observed clean source/index freeze SHA-256: `b6e61d67f7a488b4f3b8f83913b0fabb568e3a00f5456539211a8b61be0c5b1a`.

Private command batch: `approved-batch/pr1779/oct11-private-resume-T05-preparation/t05-private-seven-exact-resource-20261011-batch-receipt.json`; SHA-256 `17c32251802f6e4b9de36246e32da42eb94a5986ebe4621078537911932f60e1`.
Raw logs and receipts live outside the checkout in the private task
evidence directory; these are not public artifact links.

### Fresh mutation proof

There are 48 accepted coverage runs in 31 families, covering 47 distinct
production edit recipes. A05 and R02-new-cap are the same edit, executed
separately and counted once as a distinct recipe. A11, A16, and R11
are source-only production callsite checks. Other helper tests use
injected inert dependencies; they are not live provider operation.

Every accepted run has an applied nonempty diff, a named AssertionError,
actual red counts, and restored green with the complete source, modes,
raw index, and target SHA exactly restored. Sidecar baselines/restores
are 89 pass / 0 fail; panel baselines/restores are 6 pass / 0 fail.
All original nine Q20 tests pass at every applicable restored boundary.

| Row | Production file | Actual red pass / fail | Proof |
|---|---|---|---|
| A01 | `src-tauri/sidecar/local-api-server.mjs` | 87 / 2 | behavior |
| A02 | `src-tauri/sidecar/sms-security.mjs` | 87 / 2 | behavior |
| A03-e164 | `src-tauri/sidecar/sms-security.mjs` | 85 / 4 | behavior |
| A03-normalization | `src-tauri/sidecar/sms-security.mjs` | 85 / 4 | behavior |
| A04 | `src-tauri/sidecar/sms-security.mjs` | 87 / 2 | behavior |
| A05 | `src-tauri/sidecar/sms-security.mjs` | 86 / 3 | behavior |
| A06-control | `src-tauri/sidecar/sms-security.mjs` | 85 / 4 | behavior |
| A06-del | `src-tauri/sidecar/sms-security.mjs` | 88 / 1 | behavior |
| A07 | `src-tauri/sidecar/sms-security.mjs` | 87 / 2 | behavior |
| A08 | `src-tauri/sidecar/local-api-server.mjs` | 66 / 23 | behavior |
| A09-left | `src-tauri/sidecar/local-api-server.mjs` | 88 / 1 | behavior |
| A09-right | `src-tauri/sidecar/local-api-server.mjs` | 88 / 1 | behavior |
| A09-ampersand | `src-tauri/sidecar/local-api-server.mjs` | 88 / 1 | behavior |
| A10 | `src-tauri/sidecar/local-api-server.mjs` | 88 / 1 | behavior |
| A11 | `src-tauri/sidecar/local-api-server.mjs` | 88 / 1 | source callsite |
| A12 | `src-tauri/sidecar/local-api-server.mjs` | 88 / 1 | behavior |
| A13-unsafe-redirect | `src-tauri/sidecar/local-api-server.mjs` | 87 / 2 | behavior |
| A13-first-verdict | `src-tauri/sidecar/local-api-server.mjs` | 88 / 1 | behavior |
| A14 | `src-tauri/sidecar/local-api-server.mjs` | 88 / 1 | behavior |
| A15 | `src-tauri/sidecar/local-api-server.mjs` | 88 / 1 | behavior |
| A16 | `src-tauri/sidecar/local-api-server.mjs` | 87 / 2 | source callsite |
| R01 | `src-tauri/sidecar/sms-security.mjs` | 84 / 5 | behavior |
| R02-decrease | `src-tauri/sidecar/sms-security.mjs` | 88 / 1 | behavior |
| R02-new-cap | `src-tauri/sidecar/sms-security.mjs` | 86 / 3 | behavior |
| R03-tuple | `src-tauri/sidecar/sms-security.mjs` | 88 / 1 | behavior |
| R03-name | `src-tauri/sidecar/sms-security.mjs` | 88 / 1 | behavior |
| R03-tier | `src-tauri/sidecar/sms-security.mjs` | 88 / 1 | behavior |
| R04-counts | `src-tauri/sidecar/sms-security.mjs` | 88 / 1 | behavior |
| R05-validation | `src-tauri/sidecar/sms-security.mjs` | 88 / 1 | behavior |
| R06-omitted | `src-tauri/sidecar/sms-security.mjs` | 88 / 1 | behavior |
| R06-reduction | `src-tauri/sidecar/sms-security.mjs` | 88 / 1 | behavior |
| R07 | `src/components/SmsSettingsPanel.ts` | 1 / 5 | behavior |
| R08 | `src/components/SmsSettingsPanel.ts` | 0 / 6 | behavior |
| R09-escape | `src/components/SmsSettingsPanel.ts` | 5 / 1 | behavior |
| R09-line | `src/components/SmsSettingsPanel.ts` | 3 / 3 | behavior |
| R10 | `src-tauri/sidecar/local-api-server.mjs` | 88 / 1 | behavior |
| R11 | `src-tauri/sidecar/local-api-server.mjs` | 87 / 2 | source callsite |
| R12 | `src-tauri/sidecar/local-api-server.mjs` | 88 / 1 | behavior |
| R13-object | `src-tauri/sidecar/sms-security.mjs` | 87 / 2 | behavior |
| R13-array | `src-tauri/sidecar/sms-security.mjs` | 88 / 1 | behavior |
| R13-keys | `src-tauri/sidecar/sms-security.mjs` | 86 / 3 | behavior |
| R13-name-length | `src-tauri/sidecar/sms-security.mjs` | 88 / 1 | behavior |
| R13-name-type | `src-tauri/sidecar/sms-security.mjs` | 88 / 1 | behavior |
| R13-phone-type | `src-tauri/sidecar/sms-security.mjs` | 88 / 1 | behavior |
| R14 | `src-tauri/sidecar/sms-security.mjs` | 87 / 2 | behavior |
| R15 | `src/components/SmsSettingsPanel.ts` | 5 / 1 | behavior |
| R13-entry-type | `src-tauri/sidecar/sms-security.mjs` | 88 / 1 | behavior |
| R13-null | `src-tauri/sidecar/sms-security.mjs` | 87 / 2 | behavior |

The first V7 A16 attempt remains unqualified. Its parser mistook four
inert strings inside an exact source-code assertion value for runtime
loader failures. The raw attempt and stop receipt are retained. The V8
classifier excludes only that exact known source literal in an
AssertionError actual field, retains all raw logs, and still rejects
real loader/setup failures. Thirteen outside parser checks, including
ten negative cases, precede the fresh qualified A16 run. No production
test, assertion, recipe, or validation rule changed for this correction.

Including the rejected attempt, 49 mutation attempts produced 147 actual
owned runner invocations. Each completed known process group was reaped.
The initial rejected A16 is not a 49th accepted proof.

A01’s extra held-body wait failure is supporting evidence only; its named
HTTP-status assertion qualifies the mutation. The owned runner did not time
out. R13-phone-type qualifies the direct boxed-string rejection; that
compound red stops before the later JSON phone-array API vector. It does
not claim a mutation-red API assertion that was never reached.

Root mutation adoption: `/Users/bradleybond/Documents/Codex/2026-10-04/task/approved-batch/pr1779/oct11-private-resume-T04/root-completed-T04-adoption.json`; SHA-256 `f6eddbdf4f7bd24959a02603a6295b085f00b1dc5e8487cd4581ce45e8016a23`.
Complete private artifact manifest SHA-256: `b6d419ed20e807843dc718660dcc6a9e9b8700994c0f5bc1b909f4836799581b`.
The manifest pins every applied diff, raw stage receipt/log, classifier
witness, qualified named assertion, target hash, and restoration record.

### Stored public-provider evidence and limits

The unchanged stored October 6 probe fetched `https://github.blog/`:
HTTP 200, 285505 bytes of actual HTML, SHA-256
`c67337d1c565df9e7fba863559d423364460c3bb9364a4821f8f4cb68227a5d2`.
The consumed fields are rel, type, href, and title. The three actual
alternate links are two RSS links and one XML oEmbed link. This does
not demonstrate that every XML-like link is a usable RSS feed.

The bounded HEAD probe followed `/feed` HTTP 301 to `/feed/` HTTP 200.
Both responses have zero entity bytes. The 695/823-byte `.body` files
are copies of headers, not feed XML. The captures were rehashed; no
fresh network or actual sidecar provider-adapter execution occurred.
Present availability and universal DNS-rebinding or IPv6 pinning are
not demonstrated. The inherited IPv6-only fallback remains.

Fetch rejection or transport outage in the panel was not exercised.
HTTP refusal is the demonstrated degraded path. Direct-only arrays
with named fields, functions, and boxed strings are schema tests, not
claims about representable JSON transport. An initial T03 sandbox run
is unqualified, including unavailable owned-group inspection; later
qualified runs use isolated HOME, offline resources, guarded loopback,
and explicit known process-group cleanup. Historical uncertainty is
retained rather than represented as a successful cleanup.

### Synthetic manual checks and rollback

- Disable the synthetic 27-recipient fixture; all rows remain.
- Remove recipients from 27 to 26 to 25; authority and tuples remain.
- Attempt enabling disabled 27 twice; each refusal resets the checkbox.
- Add at 27 is refused; add at 24 succeeds with authoritative 25.
- Inject a hostile refusal message; it renders as escaped plain text.

These steps execute in the test fixture, not Bradley’s installed app.
No production data, migration, release, or native installation was touched.
The private code can be reverted without truncating any saved list.
Independent Sol review and final documentation-tip validation follow
this append in separately SHA-pinned private evidence. Publication held.

## October 11 private F1 review repair (cycle 2 handoff)

The first independent Sol medium review of
`b53e02cb72fc068c54443dbc89a1530a9d9c1351` reported one P2 blocker, F1:
a rejected save could skip rendering and leave the Enabled checkbox showing
disabled while SMS remained enabled. This was a concrete degraded path in
the active repaired control. Its inherited origin and the earlier disclosed
lack of transport coverage did not close the finding.

Private code commit `d3c2b55f27dc86b18f9a11b8575705b600981d0f` changes only
`SmsSettingsPanel.saveConfig` and its bounded real-Panel test fixture against
that reviewed tip. It catches rejected requests and successful-response body
failures, retains the last confirmed configuration, and resolves to the
existing authoritative render path. The visible plain error is
`Save could not be confirmed. Please try again.` Error state clears only
after a parsed successful server response is adopted. A null/nonobject
successful body also reports an unconfirmed save. The partial patch,
deferred event callback, live-checkbox cache defense, escaped error rendering
and all sidecar security/admission code are unchanged by this supplement.

A lost response can follow server persistence. The error therefore does not
claim that every failure proves refusal or an unchanged server. The UI keeps
last-confirmed state until a confirmed response or later refresh; it does not
adopt the requested patch as confirmed authority. These synthetic fixtures
establish the bounded paths below, not universal outage or concurrency safety.

### Actual tests-first reproduction and focused green

The corrected pre-fix suite emitted these literal final lines:

```text
# tests 13
# pass 6
# fail 7
# cancelled 0
# skipped 0
```

All seven failed TAP blocks are named `testCodeFailure`/`ERR_ASSERTION`
state or error assertions. Seven separate unhandled panel-resource warnings
and corresponding diagnostic assertions are preserved; they are not seven
extra failed tests. An early message incorrectly called the TAP failures
unhandled-rejection failures. The actual blocks were inspected and the
outside seal classifier corrected before sealing; no runtime was rerun for
that classification correction.

An earlier fixture-lifecycle attempt was interrupted, emitted no final TAP
totals and remains unqualified. All seven failure cases now register
synchronously; per-callback teardown latches serialize fixture ownership,
and the module cleanup awaits the final latch. The fixture handles only its
own request bookkeeping, never the panel's rejected save chain. Native
assertions are recorded before cleanup and rethrown. No process/window
rejection suppression, private panel calls, copied validator, or Panel stub
was introduced. The original six test definitions and all assertions remain
byte-exact (5718 bytes, SHA-256
`1099b25b0b6e99e926eac1347c56e488eed6715e1d36a1304bf608d4c08f315a`).

One additive null-body case was integrated before production application.
The fixed panel suite then emitted:

```text
# tests 14
# pass 14
# fail 0
# cancelled 0
# skipped 0
```

Scoped ESLint exited 0 with empty output. The same unchanged candidate also
passed `test:sidecar-lows` (89 pass / 0 fail) and `test:sms` (101 pass / 0 fail).
No panel async resource warnings occur in the fixed focused run. Normal code
commit hooks exited 0 in 26.415 seconds, including the staged two-file secret
scan, both TypeScript configurations and lint-staged. Source bytes and modes
were preserved; the normal HEAD/stage/status/index transition is recorded as
expected rather than an unchanged-runtime index claim.

The first implementation audit wrongly expected the dirty status listing to
remain unchanged after the authorized source edit; lint was started before
that audit failure was inspected. Both mistakes are preserved. Root verified
only the permitted panel record changed, asserted the expected test-only to
panel-plus-test status transition, and explicitly resumed the unchanged
candidate. Runtime status/source/index guards remained strict.

### Three supplemental F1 mutation proofs

Each recipe ran from the clean normal code commit, confirmed a nonempty
applied diff, produced actual named behavior AssertionErrors, restored the
exact source/index/modes, then passed the full panel suite again. All nine
owned runner invocations completed and their known groups were reaped.

| Recipe | Mutation | Baseline pass / fail | Red pass / fail | Restored pass / fail |
| --- | --- | --- | --- | --- |
| F1-error | Remove only catch error presentation | 14 / 0 | 7 / 7 | 14 / 0 |
| F1-adopt | Adopt requested patch only in the failure catch | 14 / 0 | 7 / 7 | 14 / 0 |
| F1-null | Remove only unusable-body error presentation | 14 / 0 | 13 / 1 | 14 / 0 |

F1-adopt is an explicit single-path known-state inverse, not a literal
removed guard. The other two recipes remove only the indicated new error
presentation. The restored panel SHA-256 is
`84404e18b9ea7b3c9eacc1c1951a2e5adcc5e3c11fef8517fc6b41a41b10c38d`.
The test SHA-256 is
`d15813148115e2a1ae279143e1628871e8313a127e8f3f1f78de51e13052c71b`.
Root mutation adoption SHA-256:
`c35d59855779abea9927b3ee92c933b6a386b0fa0a155206abf58bb19e37a1fe`.
The private supplement lives under
`approved-batch/pr1779/oct11-private-resume-T07-review-repair/`.
Its 81 distinct mutation artifact references were rehashed independently.

The earlier 48-row/47-distinct/31-family T04 table and its 49 attempts/147
invocations remain exact history at code `323efd1b32a8ef10869682ab0068d964f4803c3f`.
These three supplemental recipes do not rewrite or retroactively enlarge
those old receipts. The intervening production delta is only saveConfig;
the fresh final matrix will run all seven scripts against the new final tip.

After exact mutation restoration, an explicit `git add --refresh` scoped
only to the panel refreshed its index stat cache before the new freeze.
A binary index audit found only panel ctime/mtime bytes plus checksum changed;
all 5066 source records, index objects/flags/extensions/tree, modes and clean
status remained exact. The observed new index is adopted, never secretly
restored to an older cache. This is a recorded preparation transition, not a
relaxation of source/index guards during runtime. Earlier T05 metadata-only
wrapper failure and resource failures remain preserved history.

### Bounded synthetic checks, review and rollback

The real DOM event tests exercise before-send Disable and Enable failures
twice, exact Add/Remove tuples, visible generic errors and confirmed retries.
Before-send failures retain real owned API/disk state. Separate JSON-read,
post-persistence response-loss and null-body fixtures prove the real API/disk
can change while the UI retains last-confirmed state and reports unconfirmed.
A confirmed retry adopts actual full server authority and clears the error.
These execute in owned fixtures, not Bradley's installed app.

This supplement supersedes the earlier unexercised-transport statement only
for those demonstrated fixtures. The dated Oct6 provider captures and IPv6
limitations above remain unchanged. No fresh provider probe, dependency or
lockfile change, shared Panel change, native installation, user data operation,
Sonnet transmission, external review disclosure, verdict or publication occurred.

At this dated documentation handoff, the exact-final seven-script matrix/full
gate and second independent Sol medium review remain to run. Their actual
results and final reviewed HEAD are pinned separately in private evidence.
Cycle 1's P2 finding remains the completion blocker until cycle 2 explicitly
resolves it. Two independent review cycles are the maximum; a surviving
finding stops the work rather than receiving a third cycle or downgrade.
Private code can be reverted without truncating a saved list. Publication
remains held and no shipped-state claim is made.
