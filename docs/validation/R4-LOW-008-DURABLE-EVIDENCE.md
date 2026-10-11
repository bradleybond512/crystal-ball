# October 10–11 private repair evidence

The original-source record below is historical. Source
`7c2a576e09a65cbdf4832a4974e66f1d2c7bea50` is integrated onto main
`cc353c94de7a181a46366fdd6d33a1dc12d27cc8` in an isolated private checkout.
The normal-hooked unfixed baseline is `34d98f6d53ee3c76f45eb5bd4238710d822514cd`;
the final production/oracle freeze is `b352106a5a4ac638b2c95b8c1ee410f1cc19c15e`.
Three existing fixture bodies were strengthened in the test-only freeze
`e70a60d95867d3dddaab55efce3efabf05efbb40`; every production byte is identical.
This evidence-document commit changes only this report and the approved plan.

Two confirmed P2s drive the repair: overlapping SQLite handles forked a cached
chain head, and late collection from capped ledgers lost earlier scored states.
Tests-first SQLite regression evidence is 14 passing / 8 named behavioral
failures. Corrected actual producer fixtures are 15 passing / 3 behavioral
failures: forecast history disappears, outcomes retain 2,000 of 2,003, and
one EMA run retains 100 of 103. These are actual assertions, not setup errors.

## Executed validation

The frozen store suite passes 27 tests, retaining the original 14 and adding
concurrent-writer, coherent multi-page WAL snapshot, rollback, corruption,
reachable byte-cap and operation-count fixtures. After seeding 5,001 rows,
two appends read zero history pages and two indexed tails; explicit verification
then confirms a healthy 5,007-row chain. The capture/outbox suite passes 52 tests;
view and panel suites pass 8 and 5. The current evidence script passes 40 Node
and 65 TypeScript tests. All seven exact baseline files pass at `e70a60d`:
27, 6, 7, 52, 8, 5 and 2 tests, with zero failures or cancellations.
Normal commit hooks passed without source changes. All children were reaped.

The twelve domain commands below all ran at `b352106`, followed by the same
full agentic gate. Actual output includes `Agentic validation gate passed.`;
the gate exited 0 in 144.668 seconds and preserved all 5,035 source files.
Counts from overlapping commands are not summed into unique coverage.

| Command | Actual passing TAP totals | Failures |
|---|---|---|
| `test:evidence-journal` | 40 Node; 65 TypeScript | 0 |
| `test:sidecar` | 643 | 0 |
| `test:intelligence` | 589 | 0 |
| `test:algorithms` | 307 | 0 |
| `test:sidecar-routing` | 10 Node; 56 TypeScript | 0 |
| `test:secret-boundary` | 21 Node; 15 TypeScript | 0 |
| `test:renderer` | 15,352 | 0 |
| `test:diagnostics` | 439; 63 | 0 |
| `smoke:offline` | Exit 0; no invented TAP count | 0 |
| `test:agentic-gate` | 14 | 0 |
| `test:agentic-pipeline` | 65 | 0 |
| `test:install-scripts` | 56 fixture tests; no installation | 0 |

After the three fixture corrections, the evidence command and affected agentic
gate ran again at `e70a60d`: 40 + 65 tests, zero failures, gate exit 0 in
58.529 seconds. Production bytes remain identical to the twelve-domain freeze.
The final-document twelve-domain gate and independent Sol medium review are
pending at this document freeze; their exact-SHA receipts and reviewer conclusion
will be retained outside the source checkout. This report does not predict them.

The unchanged routing oracle exposed `before_seq` as unclassified. The cursor
is now explicitly personal/local-only, preserving refusal of cloud fallback;
its guard-removal mutation produced the named classification assertion. No
unknown-parameter fallback or local-route guard was weakened. Legacy ICAO and
webcam tests run under narrowly matched, external offline runner fixtures:
exact dummy ICAO HTTPS requests receive a fixture body, and the legacy webcam
DOM disables iframe page loading. Source and assertions remain unchanged.
Changed ICAO key/path and fetch controls remain blocked. The pinned guard and
fixture bootstrap propagate to owned Node children. These exercised JavaScript
controls are not universal operating-system network isolation or provider probes.
Initial setup/environment failures and the first hook test autofix are retained
and explicitly qualified; they are not behavioral results.

## Executed mutation proofs

Private artifacts retain each applied nonempty single-file diff, exact source
and fixture hashes, passing named baseline, raw TAP log, actual named
`ERR_ASSERTION`, and exact source/raw-index restoration. Every child was reaped
before restoration. Read-only plumbing and a copied index prevent the observer
from refreshing the original index; raw-index equality remains mandatory.

The original collection contains 130 executed definitions at `b352106`:
121 runtime assertion kills, 3 source-only assertion kills, 2 honest survivors
and 4 excluded unexpected reds. Runtime proofs include 119 ordinary production
paths and 2 injected malformed-projector defenses. Source-only rows establish
textual integration, not runtime security. The original 42 historical intents
have fresh accepted proofs: 40 runtime and 2 source-only. The earlier historical
summary table is retained as history rather than substituted for those receipts.

Three fixtures then gained explicit completion/deadline assertions and fresh
real-store responses, with all 52 test names and prior assertions retained;
49 other fixture blocks remain byte-exact. Six new serial executions at
`e70a60d` produced accepted runtime assertions:

| Variant | Clean pass/fail | Actual mutant pass/fail | Named observation |
|---|---|---|---|
| Request timeout multiplied by ten | 52/0 | 51/1 | Still unsettled at its ten-second deadline |
| Append chunk increased to 201 | 52/0 | 46/6 | Bounded reconciliation rejects at the real 200-row store limit |
| Finite watermark filter removed | 52/0 | 50/2 | First watermark completion rejects while a later receipt remains pending |
| Pending-identity backfill guard removed | 52/0 | 51/1 | Real SQL contains two states instead of one before the later watermark |
| Both evidence bearer guards bypassed | 6/0 | 5/1 | Unauthorized real GET returns 200 instead of 401 |
| Digest key and digest-value memo defenses removed | 52/0 | 49/3 | Changed scored digest is suppressed: one append instead of two |

All six have zero cancellations, exact full 5,035-file restoration and unchanged
raw index bytes. The combined auth mutant stops at its first GET assertion;
mutant POST/SQL-zero execution is not claimed. The clean baseline separately
checks GET 401, POST 401 and zero stored rows. Combined memo/auth variants test
retained defenses that protected the two original single-mutant survivors.
Those survivors remain recorded. The original four unexpected reds remain
excluded; their fresh assertion reruns are separate evidence.

Across 132 distinct definitions, 130 accepted proofs comprise 127 runtime
(125 ordinary paths and 2 injected defenses) and 3 source-only assertions,
plus 2 honest survivors. The 136 original-plus-supplement executions include
four excluded earlier attempts; stopped infrastructure attempts are preserved
separately. The obligation map identifies remaining proof limits: broad intent
clauses such as unchanged SQL batch limits, fixed totals IDs, export-header fields,
tuple separators and serialization ownership do not each have their own removed
mutant. No claim of an isolated kill for every broad clause is made.

The old annotation that the 4 KiB guard was unreachable is incorrect. Allowed
lone UTF-16 surrogate code units produce a 4,223-byte canonical scored payload.
The real normalizer refuses it; a 983-byte control is accepted, and removing
the guard produces a named assertion. This is a reachable production bound.

No current verdict, delivery, production readiness, installed-app behavior,
provider data, signed model-runtime identity or publication is claimed. Sol
model/effort controls are orchestration evidence. No #1777 Sonnet packet was sent;
its disclosure and publication gates remain separate.

## Current repair contract and limits

- Append reads tail and metadata after taking the SQL write lock. Summary,
  verification and JSONL export share one read snapshot per operation;
  corruption is reported and never silently healed.
- Immutable scored capture precedes every working cap; working windows,
  scoring and baseline math remain unchanged. The separate bounded outbox
  retains ready saved states until exact receipt acknowledgement.
- Admission markers persist before WebCrypto without IDs, hash inputs,
  payloads or free text. An interrupted hash is a visible refusal; it is not
  a promise of unconditional crash durability. Failed writes remain bounded
  and visibly unsaved. Malformed or over-limit saved state blocks admission.
- Bounds are 4,096 slots, 2 MiB reserved encoded storage, 2 MiB transient input,
  8 KiB per input and 4 KiB scored payload. Four capture workers share a
  four-job projection pool with bounded compatibility backfill; raw hash-input
  memo bytes remain accounted until exact receipt removal or terminal refusal
  and are never persisted. This bounds encoded inputs, not total JavaScript
  heap or arbitrary callers. Actual shared crypto highwater is four jobs,
  with twelve bounded production waiters. Terminal refusal credit uses a
  fixed, content-free 4,096-bit diagnostics bitmap: credit persists before
  slot removal and clears durably before reuse, avoiding duplicate restart
  counts after failed cleanup. This is internal v1 metadata; it changes no
  existing user or SQLite format. Actual guard mutations are recorded above.
- Short/malformed/lost append replies and sidecar outages retain receipts.
  Serialization, finite watermarks and fair retry prevent newer mutations
  from erasing acknowledged or queued earlier states.
- Local diagnostics remain visible while the backend is unavailable. Export
  warnings distinguish pending, refused and interrupted capture from the
  actual coherent SQLite export. SQLite-acknowledged evidence survives a
  WebKit reset; unsynced outbox state does not. Only export backs up a lost disk.
- The 256 MiB SQLite check is before a bounded append batch and may be exceeded
  by that one batch. Physical size is approximate; it is not an atomic renderer
  capture count. The hash chain detects partial tamper, not a consistent full
  rewrite. No import, installed-app or real provider claim is made.

## Historical original-source record

The following suite counts and 42 mutation summaries describe the original
Claude source, not the repaired current tip. Historical logs lack full applied
mutation diffs and named-assertion receipts for every row; fresh exact-SHA
proofs above supersede them for this private repair.

# R4-LOW-008 validation: durable calibration evidence

Plan: `docs/plans/2026-10-03-r4-low-008-durable-calibration-evidence.md`,
approved by Bradley on October 3, 2026 with every recommended option
(A: sidecar journal; B: scored fields only; C: the three core stores;
D: export now, import later). Based on `main` `a255546ee`.

## What changed

- **`src-tauri/sidecar/evidence-store.mjs`** (new): `evidence.db` on
  `node:sqlite`, beside `events.db`, using WAL with `synchronous = FULL`, a
  2 s busy timeout and file mode 0600.
  - **Append-only:** `BEFORE UPDATE` and `BEFORE DELETE` triggers abort.
  - **Idempotent:** rows are unique on `(kind, record_id, digest)`, and the
    digest is computed by the sidecar.
  - **Hash chain:** a meta row tracks the head hash and row count.
  - **No pruning:** a 256 MB ceiling refuses new appends rather than
    deleting.
  - **Allowlists:** per kind (`forecast`, `alert-outcome`, `ema-forecast`,
    `ema-forecast-totals`). Unknown fields are dropped and invalid entries
    are rejected one at a time, with value-free reasons.
- **`local-api-server.mjs`:** five bearer-gated routes under
  `/api/local-evidence/` (`append`, `missing`, `records`, `summary`,
  `export`).
  - Bodies are capped at 1 MB.
  - They answer 503 when the store failed to open.
  - The traffic recorder skips them.
  - The store opens at startup and closes with the server.
- **Why the `/api/local-` prefix:** both the renderer's fetch patch and the
  sidecar retry `/api/*` against the cloud API when the local handler is
  unreachable. `/api/local-*` is exempt from both fallbacks.
- **Renderer:**
  - `evidence-projection.ts`: scored projections and their inverses, plus
    the fold.
  - `evidence-journal.ts`: the client.
  - `evidence-journal-wiring.ts`: binds the three ledgers.
  - `evidence-bus.ts`: change notifications without an import cycle.
  - **Ledger hooks:** `outcome-ledger.ts`, `forecast-calibration-adapter.ts`
    and `forecast-accuracy.ts` gain a change notification and a deduplicating
    `mergeRebuilt…` method.
  - **Bug fix:** `forecast-accuracy.ts` now validates its stored blob, which
    was previously cast unchecked.
- **UI:** Belief Calibration gains an evidence-journal section. It shows
  counts, chain status, and warnings when the chain is broken or the journal
  is nearly full, plus "Export calibration evidence" (JSONL via the existing
  download path).
- **Bundle and config:**
  - `tauri.conf.json` bundles `sidecar/evidence-store.mjs`;
  - `.gitignore` covers `evidence.db*`;
  - new script `test:evidence-journal`;
  - targeted-test overrides for every touched source file.

## Privacy and safety properties (each pinned by a test)

- **Never stored or exported:**
  - claim text, resolution notes and evidence references;
  - outcome notes and driver scores;
  - coordinates.
- **Target keys and alert/situation IDs** are stored as `sha256:<hex>`.
- **Region labels** (coarse place names) are kept, because EMA resolution
  needs them.
- **Requests go only to an `http` loopback origin on an `/api/local-` path.**
  Outside the desktop app the client makes no request at all.
- **No evidence-journal MCP tool is added.** The source-reference check does
  not establish an operating-system or generic-tool privilege boundary.
- **Projection survives a rebuild unchanged.** A rebuilt record projects to
  the original digest, so a rebuilt ledger never re-appends. Proxy and direct
  label classes survive through the note prefix and provenance kind.

## Tests

`bash scripts/agentic-validate.sh --tests "test:evidence-journal test:sidecar"`
on the Mac printed "Agentic validation gate passed." The gate ran:

- lockfile;
- `lint:strict` (conflicts, JSON, YAML, shell, Markdown, colours);
- `typecheck:all`;
- `secrets:scan`;
- `cross-agent:check`;
- `docs:check`;
- `roadmap:check`;
- the production build.

| Suite | Result |
|---|---|
| `test:evidence-journal`, node part: `evidence-store` (14), `evidence-routes` (5), `evidence-journal-boundary` (7) | 26 pass, 0 fail |
| `test:evidence-journal`, tsx part: `evidence-journal.test.mts` (15), `evidence-journal-view.test.mts` (4) | 19 pass, 0 fail |
| `test:sidecar` (every sidecar instance now also opens `evidence.db`) | 643 pass, 0 fail |

Changed-file ESLint with `--max-warnings=0` is clean on every touched source
and test file.

Highlights:

- **End-to-end WebKit reset.** Records go into all three ledgers and are
  reconciled into a real `EvidenceStore`. Then `localStorage` and the
  singletons are wiped and the ledgers are rebuilt through the app wiring.
  Outcome stats, Brier score and EMA totals come back identical, claim text
  and notes do not, and a later reconcile appends nothing.
- **Digest agreement.** Renderer digests match the sidecar's byte for byte,
  including key order with mixed-case, numeric and accented keys.
- **Cloud and network guards.** Every route uses the `/api/local-` prefix,
  and non-loopback or browser-mode clients make no request.

## Historical mutation summaries (42 original claims)

Runner: `.worktrees/claude-q18-mutate.mjs` applies each mutation, runs its
suite, restores the file byte for byte, and checks the SHA-256.

| ID | Mutation | Suite | Result |
|---|---|---|---|
| S01 | drop UPDATE trigger | evidence-store | red (4 failing), restored `4a9101a5b404` |
| S02 | drop DELETE trigger | evidence-store | red (3 failing), restored `4a9101a5b404` |
| S03 | skip idempotency check | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S04 | verify ignores chain links | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S05 | verify ignores payload digest | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S06 | verify ignores head/count meta | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S07 | allowlist keeps unknown fields | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S08 | probability range unchecked | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S09 | control characters accepted | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S10 | size ceiling removed | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S11 | malformed triples reported present | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S12 | records oldest-first | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S13 | db file not chmod 0600 | evidence-store | red (1 failing), restored `4a9101a5b404` |
| S14 | raw ids accepted where hashes required | evidence-store | red (1 failing), restored `4a9101a5b404` |
| R01 | traffic recorder logs evidence | evidence-routes | red (1 failing), restored `35115e436698` |
| R02 | method check removed | evidence-routes | red (1 failing), restored `35115e436698` |
| R03 | 1 MB body cap removed | evidence-routes | red (1 failing), restored `35115e436698` |
| R04 | 503 guard removed | evidence-routes | red (1 failing), restored `35115e436698` |
| B01 | journal never started | boundary | red (1 failing), restored `fd8089aa08e7` |
| B02 | store not bundled | boundary | red (1 failing), restored `969535eb0c26` |
| P01 | claim text projected | evidence-journal | red (3 failing), restored `204a961a89ee` |
| P02 | ids not hashed | evidence-journal | red (8 failing), restored `204a961a89ee` |
| P03 | proxy origin lost | evidence-journal | red (2 failing), restored `204a961a89ee` |
| P04 | locale-aware key order | evidence-journal | red (1 failing), restored `204a961a89ee` |
| P05 | non-loopback base accepted | evidence-journal | red (2 failing), restored `fd94a66efe97` |
| P06 | requests outside desktop | evidence-journal | red (1 failing), restored `fd94a66efe97` |
| P07 | confirmed memo not kept | evidence-journal | red (1 failing), restored `fd94a66efe97` |
| P08 | rejected memo not kept | evidence-journal | red (1 failing), restored `fd94a66efe97` |
| P09 | fold ignores rank | evidence-journal | red (1 failing), restored `204a961a89ee` |
| P10 | rebuild even when full | evidence-journal | red (1 failing), restored `fd94a66efe97` |
| P11 | outcome merge duplicates | evidence-journal | red (1 failing), restored `efaf1ef0e0cb` |
| P12 | forecast merge not deduped | evidence-journal | red (1 failing), restored `c2a5ab57d69e` |
| P13 | EMA merge duplicates | evidence-journal | red (1 failing), restored `3946f95183e6` |
| P14 | blob cast unvalidated | evidence-journal | red (1 failing), restored `3946f95183e6` |
| P15 | totals never adopted | evidence-journal | red (1 failing), restored `3946f95183e6` |
| P16 | outcome ledger silent | evidence-journal | red (1 failing), restored `efaf1ef0e0cb` |
| P17 | forecast adapter silent | evidence-journal | red (1 failing), restored `c2a5ab57d69e` |
| P18 | EMA store silent | evidence-journal | red (1 failing), restored `3946f95183e6` |
| P19 | export message unescaped | evidence-journal-view | red (1 failing), restored `276d5d6d9e66` |
| P20 | export never disabled | evidence-journal-view | red (1 failing), restored `276d5d6d9e66` |
| P21 | alert id not hashed | evidence-journal | red (2 failing), restored `204a961a89ee` |
| P22 | rebuilt note loses prefix | evidence-journal | red (2 failing), restored `204a961a89ee` |

P07 first **survived**: no test covered an entry the journal already held
being confirmed from the `/missing` answer. I added "entries the journal
already holds are confirmed by one query and never re-queried", and P07 then
went red. After the busy-timeout change, S01–S14 were rerun against the final
file (SHA `4a9101a5b404`).

## Residual risks and follow-ups

- **Corrected payload-cap limitation:** the historical unreachable claim is
  superseded by the actual 4,223-byte valid scored fixture above. A current
  named assertion and actual guard-removal proof are required.
- **The hash chain detects partial edits, inserted rows and a removed tail.**
  It cannot detect someone rewriting the whole file consistently.
- **Rebuilt records have limits:**
  - Pending forecasts lack resolution criteria, so they expire rather than
    auto-resolve.
  - Their target keys are hashed, so a forecast that spans a reset won't
    pair with a live record for the same target.
- **Import of an export file** is decision D's follow-up. It is a new
  untrusted-input path and needs its own review.
- **Pre-existing:**
  - `forecast-calibration-adapter.ts` `loadPersisted` casts stored records
    without validating them.
  - `EventStorePanel`'s `/api/events/*` routes are not local-only (GET
    health only, so no data leaves).
- **Journaling the other evidence stores** is decision C's follow-up:
  - algo-eval;
  - hypothesis, correlation, source, cluster and credibility feedback;
  - the champion registry.
- **The R4 doc status table** lives only on the handoff branch, so update it
  when that branch merges.
